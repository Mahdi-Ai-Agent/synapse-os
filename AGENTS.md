# Synapse — instructions for agents

Synapse is an AI-native second brain + life OS: a local Markdown vault (the user's data), an index-first brain that runs on the user's own AI subscription (first via the installed Claude Code CLI), and a graph UI. This file is the index for any agent — Claude Code, Codex, or a human — working on the codebase. Read what it points to only when the task needs it.

## Resume protocol (every session)

1. Read `docs/STATUS.md`: where we are, what is next, what is blocked.
2. Read only the current phase in `docs/PLAN.md`.
3. Open only the files STATUS and the task name. Do not re-survey the repo.
4. End every work unit by updating `docs/STATUS.md` (Claude Code: `/status`). A hook blocks `git commit` when code is staged without it.
5. Record architectural choices in `docs/DECISIONS.md`; put lessons in `memory/lessons.md`.

## Repo map

| Path | What it is | Spec |
|---|---|---|
| `packages/core` | pure vault logic: frontmatter, wikilinks, index + graph builders, search | `docs/VAULT-SPEC.md` |
| `packages/brain` | `BrainEngine` contract + engines (`claude-cli` now) | `docs/BRAIN-ENGINES.md` |
| `packages/vault-template` | the vault's agent layer (`template/`) + sample data | `docs/VAULT-SPEC.md` |
| `apps/server` | Fastify brain host: vault service, REST + WS, brain router, vault git | `docs/ARCHITECTURE.md` |
| `apps/web` | Vite + React UI, fa/en, RTL; the living graph is a three.js renderer in `src/graph/` | `docs/UI-DESIGN.md` |
| `apps/desktop` | the Mac app (Electron): one window on the app's own server, packed as a DMG | `docs/ARCHITECTURE.md` "Desktop app" |
| `scripts/`, `eval/` | vault tooling (tsx) and the skill trigger eval | `docs/ARCHITECTURE.md` |
| `docs/` | PLAN · STATUS · DECISIONS · specs · RESEARCH · EXTENDING | `.claude/rules/docs-protocol.md` |

## Commands

```bash
pnpm install && pnpm vault:create && pnpm dev   # server :4317, web :5173, an empty vault at ~/Synapse/vault (vault:seed = demo data)
pnpm test · pnpm typecheck · pnpm vault:context · pnpm vault:validate · pnpm eval:vault
pnpm mac:dmg                                    # the Mac app → apps/desktop/release/Synapse-<version>-arm64.dmg
```

## Invariants

- Every shipped file is English; talk to the user in their language (Persian). Persian appears only in the UI dictionary (`apps/web/src/i18n/fa.ts`), skill trigger phrases, sample content, `README.fa.md` and the bilingual issue forms in `.github/`.
- The vault never lives inside this repo (default `~/Synapse/vault`). Never commit vault contents or `agent-creator/` (reference only, gitignored).
- Synapse never reads or stores AI credentials. Login happens in the vendor's own CLI: in a terminal (`claude` → `/login`), or from Settings, which runs that CLI's own sign-in command and passes the user's one-time code to its terminal only — never to disk or logs (`docs/BRAIN-ENGINES.md` "Sign-in from the app"). The brain is the user's unmodified `claude` binary spawned headless with `cwd = vault`.
- Specs in `docs/*.md` are canonical. Code, comments and instruction files point to them; they never restate them.
- One canonical location per fact; no orphan files. Keep this file ≤150 lines; push detail into `docs/` or `.claude/rules/`.
- The brain reads `index/INDEX.md` first and opens nodes on demand; the app generates `index/`, the brain never writes it.
- No native dependencies in v1 (no SQLite). Vault format stays Obsidian-compatible: `[[Title]]` links, YAML frontmatter.
- Tests: `packages/*` changes come with vitest tests; vault skill changes come with `eval/` cases and a `pnpm vault:context` check (≤2.5k tokens).

## Conventions (load on demand)

Rules in `.claude/rules/` are scoped by path and load automatically in Claude Code. Other agents: read the rule for the folder you touch.

- `docs-protocol.md` — STATUS/PLAN/DECISIONS maintenance (docs/**)
- `typescript.md` — language conventions (**/*.ts, **/*.tsx)
- `core.md` · `server.md` · `web.md` · `desktop.md` · `brain.md` · `vault-template.md` — per-package conventions
- `self-improvement.md` — the lessons loop (memory/**)

## Skills (Claude Code)

- `/status` — refresh `docs/STATUS.md` from git state and the PLAN checklist.
- `/handoff` — verify STATUS/PLAN/git consistency and write the resume note for the next agent.
- `/retro` — curate `memory/lessons.md` and promote recurrent lessons into rules (human-approved).

## Self-improvement loop

When a test/build fails, the user corrects you, or a retro finds friction: add a one-line NEVER/ALWAYS lesson under its `## topic` in `memory/lessons.md` (why + fix; one fact, one place; edit duplicates instead of appending). Second occurrence → `/retro` proposes promotion into a rule. Full spec: `.claude/rules/self-improvement.md`.
