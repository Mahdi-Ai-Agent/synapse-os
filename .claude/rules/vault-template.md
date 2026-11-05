---
description: Conventions for packages/vault-template — the vault's agent layer and sample data.
paths:
  - "packages/vault-template/**"
---

# packages/vault-template

- `template/` is a Claude Code / Codex agent folder and follows the agent-creator standard: `AGENTS.md` is a router (≤90 lines); rules carry `paths:` per node folder; a skill's `description` is its trigger (English + short Persian phrases), its body is a router, detail lives in `references/`.
- English only, except trigger phrases. No user-specific facts in the template — they belong in a real vault's `memory/profile.md`.
- After any change: `pnpm vault:context` (≤2.5k tokens) and `pnpm eval:vault` (needs a logged-in `claude`).
- Sample data (`src/sample-data.ts`) must pass `pnpm vault:validate` and cover every node type with Persian and English titles.
- Hooks in `template/.claude/hooks/` are tested by piping a sample payload before shipping.
