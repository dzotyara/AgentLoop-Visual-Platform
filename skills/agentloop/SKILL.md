---
name: agentloop
description: Talk to the user's AgentLoop / "OpenClaw" — the Claw-Empire fork with the pr-patrol auto-fix loop running at http://127.0.0.1:8800 (repo dzotyara/AgentLoop-Visual-Platform, checkout ~/Projects/pr-loop). Use whenever the user asks about AgentLoop, OpenClaw, the PR patrol or its agents (Argus, Patch, Medic, Weaver, Gate) — e.g. "что с моими PR", "что делают агенты", "что готово к мержу", "сколько потратили агенты", "что Medic сделал в 11087", "проверь PR сейчас", "AgentLoop живой?". Reads live status, PR details, agent activity and run logs, Claude spend; can trigger a patrol check.
---

# AgentLoop (the user's "OpenClaw")

AgentLoop is a local Claw-Empire fork whose **pr-patrol** loop watches the user's open GitHub PRs and runs
Claude Code agents on them: **Weaver** resolves merge conflicts, **Medic** fixes failing CI, **Patch** fixes
review comments and P0/P1 review findings (commits tagged `[fix]`), **Argus** reviews each new head and posts a
`[review]` comment with P0–P3 findings, **Gate** declares a PR ready to merge (checks green, no conflicts,
comments handled, review clean, no standing "changes requested"). The 2D office UI is http://127.0.0.1:8800.

## How to use

Everything goes through one zero-dependency script; it reads the API port and token from `~/Projects/pr-loop/.env`
(override with `AGENTLOOP_DIR`, `AGENTLOOP_URL`, `AGENTLOOP_TOKEN`):

```bash
node ~/.claude/skills/agentloop/agentloop.mjs <command>
```

| User wants                                                                      | Command                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Overview: every PR, its phase, who works on what                                | `status`                                                        |
| One PR in depth: checks, unhandled comments, agent runs with their notes, spend | `pr <number \| repo#number \| owner/repo#number>`               |
| What can be merged                                                              | `ready`                                                         |
| The crew and what each agent is doing right now                                 | `agents`                                                        |
| Claude spend today / 7d / 30d, by model, agent, PR                              | `costs`                                                         |
| What an agent actually did (tool calls + its final report)                      | `log <pr \| taskId> [lines]` (latest run of that PR by default) |
| "Check now" / re-run the patrol                                                 | `tick` (then `status` after ~30 s)                              |
| Is it up, which mode                                                            | `health`                                                        |

Run the command, then answer in the user's language in a few lines: lead with what matters (needs-you PRs,
what is ready, what an agent is doing), and include PR links from the output. For "what did the agent do",
prefer `log` over guessing from `pr` notes.

## Rules

- Read-only except `tick`. Never merge PRs, edit `~/Projects/pr-loop/.env` (e.g. `PR_PATROL_WRITE`,
  `PR_PATROL_REPLY_THREADS`), delete agents or restart the server unless the user asks for that explicitly.
- Spend figures are Claude Code's own API list-price numbers, not the user's subscription bill — say so when quoting money.
- If the script says AgentLoop is not reachable, tell the user and offer to start it
  (`cd ~/Projects/pr-loop && pnpm dev:local`); do not start it unasked.
- Phases: working (agent on it) · needs you (blocked: attempts exhausted or a dry-run fix awaiting push) ·
  waiting (CI running, or a reviewer's changes-requested still standing) · queued · ready · skipped (merged/closed/draft/fork).
