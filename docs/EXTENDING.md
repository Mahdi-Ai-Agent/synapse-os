# Extending Synapse

Synapse is built to a portable standard (from the user's `agent-creator` project) so any agent — Claude Code, Codex, or a human — can extend it correctly without extra tooling. This file is a deliberately condensed snapshot; when it disagrees with a rule in `.claude/rules/`, the rule wins.

## Core principles

- **Recursive decomposition + conditional loading.** `AGENTS.md`/`CLAUDE.md` stay thin indexes. Detail lives in `docs/`, paths-scoped `.claude/rules/`, skill `references/`, and scripts. Read only what the task needs. File count does not matter; tokens do. Every fact in exactly one place; no orphan files.
- **Two layers, same law.** The codebase layer (this repo) and the vault layer (`packages/vault-template/template/`, copied into every user vault). Vault nodes carry a one-line `summary` so an index line stands in for the file; the brain reads `index/INDEX.md` first and opens nodes on demand.
- **Minimize, quality first.** Short precise English in every shipped file; Persian only in trigger phrases. Split growing files; never truncate.
- **Eval-driven.** Add or change a vault skill via draft → `pnpm eval:vault` → improve. Core logic changes come with vitest tests.
- **Hooks for guarantees.** Prose is followed ~60–70% of the time; must-happen behavior is a hook wired in `.claude/settings.json` (the only place Claude Code reads).

## File-type rules (condensed)

- **Instruction files:** `AGENTS.md` canonical (purpose, invariants, pointers, resume protocol); `CLAUDE.md` = `@AGENTS.md` + Claude-specific pointers. ≤150 lines. No procedures inside.
- **Rule** (`.claude/rules/<name>.md`): `description` + `paths:` globs; one concern per rule; without `paths:` it loads every session (avoid).
- **Skill** (`.claude/skills/<name>/SKILL.md`): directory name is the command; `description` (+ `when_to_use`) is the trigger, third person, what + when, ≤1536 chars combined; body is a router; detail in `references/`; executables in `scripts/` run via `${CLAUDE_SKILL_DIR}`; `allowed-tools` grants, `disallowed-tools` restricts.
- **Subagent** (`.claude/agents/<name>.md`): isolated context, compact return; `model:` chosen by eval (start cheap, escalate on failure). Not used yet (see map).
- **Script:** args/stdin in, JSON out, exit codes; TypeScript via `tsx` in this repo.
- **Hook:** shell script in `.claude/hooks/`, wired in `.claude/settings.json`; `PostToolUse` fires only on success — use `PostToolUseFailure` for failures; guard every `jq`; test with a piped sample payload.
- **Docs:** specs in `docs/*.md` are canonical; code comments and instruction files point to them, never restate them. Progress only in `docs/STATUS.md`; decisions only in `docs/DECISIONS.md`.

## Self-improvement loop

On a failed test/build, a user correction, or a retro: add a one-line NEVER/ALWAYS lesson under a `## topic` in `memory/lessons.md` (why + fix; overflow detail in `memory/<topic>.md`). Edit or remove duplicates. Second occurrence → `/retro` proposes promotion into a rule, applied only with human approval. The vault layer has the same loop in its own `memory/`.

## Secrets

No secrets are needed in v1. API-key engines (Phase 4) read `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` from the environment or `.env` (gitignored, documented in `.env.example`). Synapse never stores vendor OAuth credentials.

## Architecture map (present vs intentionally omitted)

| Part | Status | Notes / how to add |
|---|---|---|
| `.claude/rules/` (repo) | present | paths-scoped per area: docs, typescript, core, server, web, brain, vault-template, memory |
| `.claude/skills/` (repo) | present | `/status`, `/handoff`, `/retro` |
| `.claude/agents/` (subagents) | **omitted** | none needed yet; add `.claude/agents/<name>.md` for an isolated/parallel/cheaper task (e.g. a vault auditor), pick `model:` by eval |
| `.claude/hooks/` + `settings.json` (repo) | present | `guard-status.sh` (PreToolUse on `git commit`), `capture-lesson.sh` (PostToolUseFailure) |
| `scripts/` | present | `create-vault`, `seed-sample-vault`, `estimate-vault-context`, `validate-vault` |
| `eval/` | present | vault skill trigger cases + harness; vitest for packages |
| `memory/lessons.md` (repo) | present | seeded; loop block in `AGENTS.md` |
| Vault agent layer | present | `packages/vault-template/template/`: `AGENTS.md`, `CLAUDE.md`, rules per node type, skills `capture`/`ask`/`link`/`daily`/`weekly`, `guard-paths.sh`, memory seeds; re-synced into existing vaults at server start |
| Vault subagents | **omitted** | add only if a vault task needs isolation (e.g. weekly review over many nodes) |
| Secrets (`.env.example`) | present (placeholders only) | fill when Phase 4 engines arrive |
| MCP servers | **omitted** | brain runs with `--strict-mcp-config`; add a server via `--mcp-config` in the engine only if a capability needs it |
