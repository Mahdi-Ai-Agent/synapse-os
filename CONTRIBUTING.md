# Contributing to Synapse

Thank you for helping. Bug reports, ideas, translations and code are all welcome — in English or Persian.

## Before you start

- **Questions and ideas:** open a [Discussion](../../discussions) or a feature request issue.
- **Bugs:** use the bug report form; include your OS, how you run Synapse (Mac app, Docker, from source), the engine (Claude Code, Codex, an API) and what Settings → Diagnostics shows.
- **Security problems:** never in a public issue — see [SECURITY.md](SECURITY.md).
- **Never paste your vault, API keys, tokens or sign-in codes** into an issue. Reproduce with the fictional sample vault (`pnpm vault:seed`) whenever you can.

## Set up

```bash
corepack enable                     # pnpm 9
pnpm install
SYNAPSE_VAULT=/tmp/synapse-dev pnpm vault:seed   # a throwaway vault with sample data, outside the repo
SYNAPSE_VAULT=/tmp/synapse-dev pnpm dev          # web http://localhost:5173, server :4317
```

The vault must never live inside this repository (Claude Code would load the repo's own instructions into the brain).

## How the repository works

Read [AGENTS.md](AGENTS.md) first: it is the index for people and coding agents alike — the resume protocol, the repo map, the commands and the invariants. Then:

- The specs in [docs/](docs) (`ARCHITECTURE`, `VAULT-SPEC`, `BRAIN-ENGINES`, `UI-DESIGN`) are canonical. Code and comments point to them; when they disagree, fix one and say which in the commit.
- Conventions per package live in [.claude/rules/](.claude/rules) (`typescript.md`, `web.md`, `server.md`, `core.md`, …).
- Record an architectural choice in [docs/DECISIONS.md](docs/DECISIONS.md) and a lesson learned the hard way in [memory/lessons.md](memory/lessons.md).

## Rules that keep Synapse what it is

- **Synapse never reads or stores AI credentials.** Sign-in happens in the vendor's own CLI.
- **Every shipped file is English**; Persian appears only in the UI dictionary (`apps/web/src/i18n/fa.ts`), skill trigger phrases, sample content and `README.fa.md`.
- **Every user-visible string goes through `t()`** with the key in both `fa.ts` and `en.ts`. The UI is RTL-first: use logical CSS utilities (`ms-`, `pe-`, `start-`), never `ml-`/`right-`.
- **No native dependencies** and an Obsidian-compatible vault format (`[[Title]]` links, YAML frontmatter).
- **Tests come with changes:** `packages/*` changes with vitest tests; vault skill changes with `eval/` cases and a `pnpm vault:context` check (≤ 2.5k tokens).

## Before you open a pull request

```bash
pnpm typecheck && pnpm test         # both must pass (check the exit status, not just the output)
pnpm vault:validate                 # when you touched the vault format or the template
```

- Keep a pull request to one change, explain the why, and add screenshots for UI changes (both themes, both languages when layout is involved).
- Update `docs/STATUS.md` when you finish a unit of work.
- By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

## Translations

The interface strings are in `apps/web/src/i18n/`. A new language needs a dictionary with every key of `en.ts` and, for a right-to-left language, a check of every page in both themes.
