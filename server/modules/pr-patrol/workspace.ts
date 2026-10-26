import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gh, type PrSnapshot } from "./github.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

function slug(repo: string): string {
  return repo.replace("/", "__");
}

/** Per-repo partial clone with no checkout; PR work happens in worktrees hanging off it. */
async function ensureClone(workdir: string, repo: string): Promise<string> {
  const dir = path.join(workdir, "repos", slug(repo));
  if (fs.existsSync(path.join(dir, ".git"))) return dir;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await gh(["repo", "clone", repo, dir, "--", "--filter=blob:none", "--no-checkout"]);
  return dir;
}

export type PrWorkspace = { path: string; startSha: string; branch: string };

/** A worktree on a local branch reset to the PR head (and the base fetched, for conflict merges). */
export async function preparePrWorktree(workdir: string, s: PrSnapshot): Promise<PrWorkspace> {
  const clone = await ensureClone(workdir, s.repo);
  await git(clone, [
    "fetch",
    "--no-tags",
    "origin",
    `+refs/heads/${s.headRefName}:refs/remotes/origin/${s.headRefName}`,
    `+refs/heads/${s.baseRefName}:refs/remotes/origin/${s.baseRefName}`,
  ]);
  const wt = path.join(workdir, "worktrees", `${slug(s.repo)}__${s.number}`);
  const branch = `pr-patrol/${s.number}`;
  if (!fs.existsSync(path.join(wt, ".git"))) {
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    await git(clone, ["worktree", "prune"]);
    await git(clone, ["worktree", "add", "-f", "-B", branch, wt, `origin/${s.headRefName}`]);
  } else {
    await git(wt, ["merge", "--abort"]).catch(() => undefined);
    await git(wt, ["checkout", "-f", "-B", branch, `origin/${s.headRefName}`]);
    await git(wt, ["reset", "--hard", `origin/${s.headRefName}`]);
    await git(wt, ["clean", "-fd"]);
  }
  return { path: wt, startSha: await git(wt, ["rev-parse", "HEAD"]), branch };
}

export type PushOutcome =
  | { status: "no_changes" }
  | { status: "dirty"; files: string }
  | { status: "rewrote_history" }
  | { status: "dry_run"; commits: number; head: string }
  | { status: "pushed"; commits: number; head: string }
  | { status: "rejected"; error: string };

/**
 * Makes every new commit subject start with `prefix`. Only rewrites commits that were never pushed
 * (startSha..HEAD); a linear range is reworded via rebase --exec, a range with merges only at its tip.
 */
export async function ensureCommitPrefix(ws: PrWorkspace, prefix: string): Promise<void> {
  const range = `${ws.startSha}..HEAD`;
  const subjects = (await git(ws.path, ["log", "--format=%s", range])).split("\n").filter(Boolean);
  if (subjects.every((subj) => subj.startsWith(prefix))) return;
  const merges = await git(ws.path, ["rev-list", "--merges", range]);
  const amendHead = `subj=$(git log -1 --format=%s); case "$subj" in "${prefix}"*) ;; *) git commit --amend --no-verify -q -m "${prefix} $(git log -1 --format=%B)" ;; esac`;
  if (!merges) {
    await git(ws.path, ["-c", "core.hooksPath=/dev/null", "rebase", "-q", ws.startSha, "--exec", amendHead]);
  } else {
    await execFileAsync("sh", ["-c", amendHead], { cwd: ws.path });
  }
}

/** Fast-forward-only push of the agent's commits to the PR branch. Never forces. */
export async function pushAgentCommits(
  ws: PrWorkspace,
  s: PrSnapshot,
  write: boolean,
  prefix: string,
): Promise<PushOutcome> {
  const dirty = await git(ws.path, ["status", "--porcelain"]);
  const head = await git(ws.path, ["rev-parse", "HEAD"]);
  if (head === ws.startSha) return dirty ? { status: "dirty", files: dirty } : { status: "no_changes" };
  try {
    await git(ws.path, ["merge-base", "--is-ancestor", ws.startSha, head]);
  } catch {
    return { status: "rewrote_history" };
  }
  try {
    await ensureCommitPrefix(ws, prefix);
  } catch {
    await git(ws.path, ["rebase", "--abort"]).catch(() => undefined);
    await git(ws.path, ["reset", "--hard", head]); // keep the agent's commits as they were
  }
  const finalHead = await git(ws.path, ["rev-parse", "HEAD"]);
  const commits = Number(await git(ws.path, ["rev-list", "--count", `${ws.startSha}..${finalHead}`]));
  if (!write) return { status: "dry_run", commits, head: finalHead };
  try {
    await git(ws.path, ["push", "origin", `HEAD:refs/heads/${s.headRefName}`]);
    return { status: "pushed", commits, head: finalHead };
  } catch (err) {
    return { status: "rejected", error: (err as Error).message.slice(0, 500) };
  }
}
