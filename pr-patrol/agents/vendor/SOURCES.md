# Vendored agent prompts

Fetched 2026-10-26. Each folder keeps the upstream LICENSE. Files are used as prompt text
by pr-patrol (server/modules/pr-patrol/prompts.ts); they are not modified here — role-specific
overrides (headless mode, output contract, no-push rule) are appended at prompt-build time.

| Folder | Upstream | Commit | License |
|---|---|---|---|
| anthropic-pr-review-toolkit | https://github.com/anthropics/claude-plugins-official/tree/58267944f92187b7d6a1c822165c96c81c864806/plugins/pr-review-toolkit | 58267944f92187b7d6a1c822165c96c81c864806 | Apache-2.0 |
| claude-code-action | https://github.com/anthropics/claude-code-action/tree/925afb53776cf1a2b738c6bdbed37b4d4000ef13/.claude/agents | 925afb53776cf1a2b738c6bdbed37b4d4000ef13 | MIT |
| compound-engineering | https://github.com/EveryInc/compound-engineering-plugin/tree/9f5b16fc617fb5bf4817c8f42537b626c17abd05/skills/ce-resolve-pr-feedback | 9f5b16fc617fb5bf4817c8f42537b626c17abd05 | MIT |
| superpowers | https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/receiving-code-review | 2ce8aa15d05bd57213e6f746f953aafb7ded7a8b | MIT |
| openai-skills | https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-fix-ci | 49f948faa9258a0c61caceaf225e179651397431 | Apache-2.0 |
| openai-codex-babysit-pr | https://github.com/openai/codex/tree/a770e5b8470d3320eb53a56a286ea4a0a70a1f59/.codex/skills/babysit-pr | a770e5b8470d3320eb53a56a286ea4a0a70a1f59 | Apache-2.0 |
