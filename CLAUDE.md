# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- `.claude/rules/` load by path: docs, typescript, core, server, web, desktop, brain, vault-template, memory.
- Skills: `/status`, `/handoff`, `/retro`.
- Hooks (`.claude/settings.json`): `guard-status.sh` blocks `git commit` when code is staged without `docs/STATUS.md`; `capture-lesson.sh` appends a lesson stub when a test/build command fails.

Current lessons (always available): @memory/lessons.md
