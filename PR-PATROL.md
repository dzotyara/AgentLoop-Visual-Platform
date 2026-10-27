# PR Patrol: the auto-fix loop

AgentLoop Visual Platform is [Claw-Empire](https://github.com/GreenSheep01201/claw-empire) (Apache-2.0) plus
**pr-patrol**: a server module that watches your open GitHub PRs and keeps a team of Claude Code agents
working on them until each one is ready to merge. Every agent run is a kanban task, and the agent doing it
sits at its desk in the pixel office while it works.

It behaves like Claude's "Auto-fix PR" setting, with an extra review stage:

| Event on the PR                                            | Agent  | What happens                                                                  |
| ---------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| Merge conflict with the base                               | Weaver | `git merge origin/<base>`, resolves, commits the merge                        |
| Failing CI check                                           | Medic  | reads the failed logs; fixes branch-caused failures, re-runs flaky/infra ones |
| Unhandled review comments                                  | Patch  | judges each comment, fixes the valid ones, drafts replies                     |
| New head commit not yet reviewed                           | Argus  | own review of the diff, posted as a `[review]` PR comment with P0–P3 findings |
| Blocking (P0/P1) review findings                           | Patch  | verifies each finding, fixes or declines it                                   |
| Checks green, no conflicts, feedback handled, review clean | Gate   | posts a "Ready" task and notifies the CEO desk                                |

The loop ticks every `PR_PATROL_INTERVAL_MS` and right after each run, takes one action per PR at a time
(priority as in the table), and stops retrying an action after `PR_PATROL_MAX_ATTEMPTS`. Review rounds per PR
are capped by `PR_PATROL_MAX_REVIEW_ROUNDS` so review→fix cannot ping-pong forever.

## Safety model

- **Dry run by default** (`PR_PATROL_WRITE=0`): agents work and commit in local worktrees under
  `~/.pr-loop/worktrees`, nothing leaves your machine. Flip to `1` to push.
- **Agents never push.** The loop pushes their commits itself, fast-forward only (`git push origin HEAD:<branch>`,
  never `--force`), and refuses if the agent rewrote history or left uncommitted changes.
- Agents are told not to run GitHub write commands; PR comments and CI logs are passed as untrusted data.
- Every change an agent makes is committed as `[fix] …`; the review itself is a `[review]` PR comment
  (write mode only) with findings labelled P0 (prod/data/security) · P1 (real bug, broken build, repo-rule
  violation) · P2 (should fix) · P3 (nit). P0/P1 are fixed automatically, P2/P3 are left for the author.
- Agents cannot push or open PRs: the clone's `origin` has a dead pushurl, and the loop pushes by explicit
  URL to the PR's own branch only.
- Replying to and resolving review threads is a separate opt-in (`PR_PATROL_REPLY_THREADS=1`), because it
  posts under your `gh` account.
- Fork PRs are skipped (their branches cannot be pushed). Drafts are skipped unless `PR_PATROL_INCLUDE_DRAFTS=1`.
- Agents run `claude --dangerously-skip-permissions` (Claw-Empire's stock CLI mode) with your `gh`/git
  credentials in their environment. Each repo's own `CLAUDE.md` / `AGENTS.md` applies inside its worktree.

## Run it

Requirements: Node 22+, pnpm, an authenticated `gh` (`gh auth status`), and Claude Code (`claude`) logged in.

```bash
pnpm install
cp .env.example .env   # then set OAUTH_ENCRYPTION_SECRET and API_AUTH_TOKEN
pnpm patrol:plan       # read-only: what the loop would do for each PR right now
pnpm dev:local         # UI http://127.0.0.1:8800 · API http://127.0.0.1:8790
```

`GET /api/pr-patrol/status` shows every patrolled PR with its phase (`working`, `waiting`, `blocked`, `ready`, …)
and reasons; `POST /api/pr-patrol/tick` forces a tick. Both need `Authorization: Bearer $API_AUTH_TOKEN`.

All knobs are in `.env.example` under `pr-patrol`. Which PRs are patrolled is a `gh search prs` query
(`PR_PATROL_QUERY`, default `author:@me`), narrowed by `PR_PATROL_REPOS` / `PR_PATROL_EXCLUDE_REPOS`.
Checks that no commit can fix (e.g. merge-queue gates) go in `PR_PATROL_IGNORE_CHECKS`.

## Where things live

- `server/modules/pr-patrol/decide.ts` — the loop's decision for one PR (pure, unit-tested)
- `server/modules/pr-patrol/index.ts` — ticking, kanban tasks, agent status, running Claude Code, settling results
- `server/modules/pr-patrol/github.ts` — `gh` reads: PR state, checks, review threads/comments
- `server/modules/pr-patrol/workspace.ts` — per-repo partial clones, per-PR worktrees, fast-forward push
- `server/modules/pr-patrol/prompts.ts` — role prompts built from the vendored agents
- `server/modules/pr-patrol/pipeline.ts` — pipeline settings edited from the loop graph (per step on/off, model,
  max attempts; max concurrent agents, max review rounds), `GET`/`PUT /api/pr-patrol/pipeline`, layered over the env
  config on every tick
- `pr-patrol/agents/vendor/` — open-source agent prompts, pinned by commit, with their licenses ([SOURCES.md](pr-patrol/agents/vendor/SOURCES.md))

## Vendored agents

| Role                       | Source                                                                                        | License    |
| -------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| Reviewer                   | anthropics/claude-plugins-official `pr-review-toolkit` (code-reviewer, silent-failure-hunter) | Apache-2.0 |
| Security reviewer          | anthropics/claude-code-action `security-code-reviewer`                                        | MIT        |
| Comment fixer              | EveryInc/compound-engineering-plugin `pr-comment-resolver`                                    | MIT        |
| Receiving review           | obra/superpowers `receiving-code-review`                                                      | MIT        |
| CI fixer                   | openai/skills `gh-fix-ci`                                                                     | Apache-2.0 |
| Flaky-vs-branch heuristics | openai/codex `babysit-pr` heuristics                                                          | Apache-2.0 |
