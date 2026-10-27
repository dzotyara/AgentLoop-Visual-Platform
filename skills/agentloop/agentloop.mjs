#!/usr/bin/env node
// AgentLoop CLI for the agentloop skill: talks to a running AgentLoop (Claw-Empire fork + pr-patrol).
// Zero dependencies. Reads the API port and token from the AgentLoop checkout's .env.
//
//   node agentloop.mjs status            PRs by phase, who works on what, ready to merge
//   node agentloop.mjs pr <n|repo#n>     one PR: checks, comments, agent runs, spend
//   node agentloop.mjs ready             PRs ready to merge
//   node agentloop.mjs agents            the crew and what each one is doing now
//   node agentloop.mjs costs             Claude spend: today / 7d / 30d, by model, agent, PR
//   node agentloop.mjs log <pr|taskId> [n]   what an agent did in its latest (or given) run
//   node agentloop.mjs tick              ask the loop to check all PRs now
//   node agentloop.mjs health            is AgentLoop up, which mode it runs in
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.AGENTLOOP_DIR || path.join(os.homedir(), "Projects", "pr-loop");

function readEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(DIR, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    // no .env: fall back to defaults / process env
  }
  return env;
}

const fileEnv = readEnv();
const PORT = process.env.AGENTLOOP_PORT || fileEnv.PORT || "8790";
const BASE = process.env.AGENTLOOP_URL || `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.AGENTLOOP_TOKEN || fileEnv.API_AUTH_TOKEN || "";
const UI = process.env.AGENTLOOP_UI || "http://127.0.0.1:8800";

async function api(p, init = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${p}`, {
      ...init,
      headers: { ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(init.headers || {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    fail(
      `AgentLoop is not reachable at ${BASE} (${err.cause?.code || err.message}).\nStart it: cd ${DIR} && pnpm dev:local`,
    );
  }
  if (res.status === 401) fail(`AgentLoop rejected the token (401). Check API_AUTH_TOKEN in ${DIR}/.env`);
  if (!res.ok) fail(`${p} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const usd = (v) => (v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${(v ?? 0).toFixed(3)}`);
const ago = (ms) => {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
const PHASE = {
  working: "🔵 working",
  blocked: "🔴 needs you",
  waiting: "🟡 waiting",
  watching: "⚪ queued",
  ready: "🟢 ready",
  error: "❗ error",
  skipped: "· skipped",
};
const ORDER = ["working", "blocked", "waiting", "watching", "ready", "error", "skipped"];
const ACTION = {
  review: "Review",
  fix_review: "Fix review findings",
  address_feedback: "Address comments",
  fix_ci: "Fix CI",
  fix_conflict: "Resolve conflict",
};

function checks(snapshot) {
  const live = (snapshot?.checks ?? []).filter((c) => !c.ignored);
  const n = (st) => live.filter((c) => c.state === st).length;
  if (!live.length) return "no checks";
  return [
    n("failure") && `${n("failure")} failing`,
    n("pending") && `${n("pending")} pending`,
    n("success") && `${n("success")} passing`,
  ]
    .filter(Boolean)
    .join(", ");
}

function findPr(status, arg) {
  const prs = status.prs;
  const hit =
    prs.find((p) => p.pr_key === arg) ||
    prs.find((p) => `${p.repo.split("/")[1]}#${p.number}` === arg) ||
    prs.find((p) => String(p.number) === String(arg).replace(/^#/, ""));
  if (!hit) fail(`No patrolled PR matches "${arg}". Known: ${prs.map((p) => p.pr_key).join(", ")}`);
  return hit;
}

async function status() {
  const s = await api("/api/pr-patrol/status");
  const costs = await api("/api/claude-costs").catch(() => null);
  const prs = s.prs
    .filter((p) => p.phase !== "skipped")
    .sort((a, b) => ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase));
  console.log(
    `AgentLoop ${UI} · mode: ${s.write ? "pushing fixes" : "dry run"} · checked ${ago(s.lastTick.at)}` +
      (costs ? ` · spend today ${usd(costs.today.costUsd)}` : "") +
      (s.lastTick.error ? `\n⚠ last tick error: ${s.lastTick.error}` : ""),
  );
  for (const p of prs) {
    const who = p.agent ? ` — ${p.agent.name}: ${ACTION[p.agent.action] ?? p.agent.action} ▸ ${p.agent.activity}` : "";
    console.log(`${(PHASE[p.phase] ?? p.phase).padEnd(14)} ${p.pr_key}  ${p.title.slice(0, 70)}`);
    console.log(`${" ".repeat(15)}${p.agent ? who.slice(3) : p.summary}  [${checks(p.snapshot)}]`);
  }
  if (!prs.length) console.log("No open PRs are patrolled.");
}

async function pr(arg) {
  if (!arg) fail("Usage: pr <number | repo#number | owner/repo#number>");
  const s = await api("/api/pr-patrol/status");
  const p = findPr(s, arg);
  const costs = await api("/api/claude-costs").catch(() => null);
  const spend = costs?.byPr.find((b) => b.key === p.pr_key);
  const snap = p.snapshot;
  console.log(`${p.pr_key}  ${p.title}\n${p.url}`);
  if (snap)
    console.log(
      `${snap.headRefName} → ${snap.baseRefName} · merge: ${snap.mergeable} · review: ${snap.reviewDecision ?? "—"}`,
    );
  console.log(`Phase: ${PHASE[p.phase] ?? p.phase} — ${p.summary}`);
  if (p.notes.length) console.log(`Notes: ${p.notes.join("; ")}`);
  if (p.agent)
    console.log(
      `Now: ${p.agent.name} · ${ACTION[p.agent.action] ?? p.agent.action} ▸ ${p.agent.activity} (${p.agent.toolCalls} tool calls)`,
    );
  console.log(`Checks: ${checks(snap)}`);
  for (const c of (snap?.checks ?? []).filter((c) => c.state === "failure" || c.state === "pending")) {
    console.log(
      `  ${c.state === "failure" ? "✕" : "…"} ${c.workflow ? `${c.workflow} / ` : ""}${c.name}${c.ignored ? " (ignored)" : ""}  ${c.detailsUrl ?? ""}`,
    );
  }
  const fb = snap?.feedback ?? [];
  console.log(`Comments: ${fb.length} (${fb.filter((f) => !f.handled).length} unhandled)`);
  for (const f of fb.filter((f) => !f.handled).slice(0, 8)) {
    console.log(
      `  ● @${f.author}${f.path ? ` ${f.path}${f.line ? `:${f.line}` : ""}` : ""}: ${f.excerpt.replace(/\s+/g, " ").slice(0, 140)}`,
    );
  }
  console.log(
    `Own review rounds: ${p.review_rounds} · agent spend: ${spend ? `${usd(spend.costUsd)} over ${spend.runs} run(s)` : "none"}`,
  );
  if (p.actions.length) console.log("Agent runs (newest first):");
  for (const a of p.actions.slice(0, 8)) {
    console.log(
      `  ${a.status === "done" ? "✓" : a.status === "failed" ? "✕" : "…"} ${ACTION[a.action] ?? a.action} · ${ago(a.updatedAt)} · task ${a.taskId ?? "?"}`,
    );
    if (a.note) console.log(`    ${a.note.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

async function ready() {
  const s = await api("/api/pr-patrol/status");
  const prs = s.prs.filter((p) => p.phase === "ready");
  if (!prs.length) return console.log("Nothing is ready to merge yet.");
  console.log(`Ready to merge (${prs.length}):`);
  for (const p of prs)
    console.log(
      `🟢 ${p.pr_key}  ${p.title.slice(0, 80)}\n   ${p.url}${p.notes.length ? `\n   note: ${p.notes.join("; ")}` : ""}`,
    );
}

async function agents() {
  const s = await api("/api/pr-patrol/status");
  const list = await api("/api/agents");
  const all = Array.isArray(list) ? list : list.agents;
  const working = new Map(s.prs.filter((p) => p.agent).map((p) => [p.agent.id, p]));
  for (const a of all) {
    const p = working.get(a.id);
    console.log(
      `${a.avatar_emoji ?? ""} ${a.name.padEnd(8)} ${(a.status ?? "").padEnd(8)} ` +
        (p
          ? `${p.pr_key}: ${ACTION[p.agent.action] ?? p.agent.action} ▸ ${p.agent.activity}`
          : `tasks done: ${a.stats_tasks_done ?? 0}`),
    );
  }
}

async function costs() {
  const c = await api("/api/claude-costs");
  console.log(`Claude spend (API list prices, as reported by Claude Code):`);
  console.log(
    `  today ${usd(c.today.costUsd)} (${c.today.runs} runs) · 7d ${usd(c.last7d.costUsd)} · 30d ${usd(c.last30d.costUsd)} · all ${usd(c.allTime.costUsd)}`,
  );
  console.log(`  by model (7d): ${c.byModel.map((m) => `${m.key} ${usd(m.costUsd)}`).join(", ") || "—"}`);
  console.log(`  by agent (7d): ${c.byAgent.map((a) => `${a.label} ${usd(a.costUsd)}`).join(", ") || "—"}`);
  console.log(
    `  by PR: ${
      c.byPr
        .slice(0, 8)
        .map((b) => `${b.key} ${usd(b.costUsd)}`)
        .join(", ") || "—"
    }`,
  );
}

/** Human summary of one stream-json run log: tool calls in order, then the final result. */
function summarizeLog(file, maxLines) {
  const text = fs.readFileSync(file, "utf8");
  const runs = text.split("===== task run start ");
  const last = runs[runs.length - 1];
  const steps = [];
  let result = null;
  for (const line of last.split("\n")) {
    if (!line.startsWith("{")) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === "assistant") {
      for (const b of evt.message?.content ?? []) {
        if (b.type === "tool_use") {
          const i = b.input ?? {};
          const what = i.description || i.command || i.file_path || i.pattern || i.prompt || "";
          steps.push(`▸ ${b.name}: ${String(what).replace(/\s+/g, " ").slice(0, 110)}`);
        }
      }
    }
    if (evt.type === "result") result = evt;
  }
  console.log(`Run started ${last.slice(0, 24)} · ${steps.length} tool call(s)`);
  for (const s of steps.slice(-maxLines)) console.log(`  ${s}`);
  if (result) {
    console.log(
      `Result: ${result.subtype} · ${result.num_turns} turns · ${usd(result.total_cost_usd ?? 0)} · ${Math.round((result.duration_ms ?? 0) / 1000)}s`,
    );
    if (typeof result.result === "string") console.log(result.result.slice(0, 1200));
  } else {
    console.log("(still running or no result yet)");
  }
}

async function log(arg, n) {
  if (!arg) fail("Usage: log <pr | taskId> [lines]");
  let taskId = arg;
  if (!/^[0-9a-f-]{36}$/.test(arg)) {
    const s = await api("/api/pr-patrol/status");
    const p = findPr(s, arg);
    taskId = p.agent?.taskId ?? p.actions.find((a) => a.taskId)?.taskId;
    if (!taskId) fail(`${p.pr_key} has no agent runs yet.`);
  }
  const file = path.join(DIR, "logs", `${taskId}.log`);
  if (!fs.existsSync(file)) fail(`No log for task ${taskId} at ${file}`);
  console.log(`Task ${taskId}`);
  summarizeLog(file, Number(n) || 25);
}

async function tick() {
  await api("/api/pr-patrol/tick", { method: "POST" });
  console.log("Patrol tick requested; agents start within a few seconds where work is due. Run `status` in ~30s.");
}

async function health() {
  const s = await api("/api/pr-patrol/status");
  console.log(
    `AgentLoop up · API ${BASE} · UI ${UI}\n` +
      `patrol: ${s.enabled ? "on" : "off"} · mode: ${s.write ? "pushing fixes" : "dry run"} · thread replies: ${s.replyToThreads ? "on" : "off"} · ` +
      `own review: ${s.review ? "on" : "off"} · every ${s.intervalMs / 1000}s · max ${s.maxConcurrent} agents · ${s.prs.length} PR(s) tracked`,
  );
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { status, pr, ready, agents, costs, log, tick, health };
if (!commands[cmd]) {
  console.log("Usage: agentloop.mjs <status|pr <n>|ready|agents|costs|log <pr|taskId> [n]|tick|health>");
  process.exit(cmd ? 1 : 0);
}
await commands[cmd](...args);
