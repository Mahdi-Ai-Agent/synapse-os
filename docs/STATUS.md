# Status

Living progress ledger. Read this first in every session. Protocol: `.claude/rules/docs-protocol.md`.

## Now
- **Version 0.3.1, the first open-source release** (2026-11-05): Phases 0–39 of `docs/PLAN.md` are built. Synapse runs from source (`pnpm dev`, `pnpm start`), as a Docker image for a self-hosted server, and as a Mac app (`pnpm mac:dmg`, Apple silicon) with an AES-256 encrypted vault and Touch ID. Engines: Claude Code CLI, Codex CLI, Anthropic, OpenAI and OpenRouter APIs. The interface is Persian (RTL) and English, light and dark.

## Done
- 2026-10-31 — Phases 0–5a: monorepo, vault format and agent layer, index and graph, the Claude Code brain with undo, life views and reviews, more engines, the PWA with LAN pairing.
- 2026-10-31 → 2026-11-01 — Phases 6–15: the living map (categories as regions, typed shapes, the ignition), kinds and a chat-first shell, maps as islands with connections, scopes, a brain you can watch on the map.
- 2026-11-01 — Phases 16–23: the Docker image and deployment guide, the owner account with a first-run setup code, signing in to subscriptions from Settings, live events over HTTP behind a CDN, the messenger chat, the MCP server with its own OAuth.
- 2026-11-01 → 2026-11-02 — Phases 24–33: the names switch and colour picker, spreading and gathering that stay, one map across every open copy, engine notices, backup and move, the Mac app (Electron), a full daily review, a page for every category and island.
- 2026-11-04 → 2026-11-05 — Phases 34–38: the desktop's encrypted vault with password, recovery key and Touch ID; a light theme; the guide, plan, inbox and "me" as separate pages; places from the whole to the parts; a 24-hour clock; the Goals page; a place's own map.
- 2026-11-05 — Phase 39: open source — this repository, READMEs in English and Persian, community files and issue forms.

## Next up
1. Signed and notarized Mac releases on GitHub (a DMG anyone can open without right-click → Open).
2. A Windows and Linux desktop build of the Electron app.
3. Local-model engines (an OpenAI-compatible local endpoint is already possible through the OpenAI API engine's base URL; a first-class engine with a model list would make it easy).
4. Embeddings for "related items" once an API-key or local engine is configured.
5. Large vaults: per-area sub-indexes before `index/INDEX.md` passes ~1.5k tokens; the map's layout in a worker when a cold layout takes more than 250 ms.
6. A mobile companion beyond the PWA (`docs/PLAN.md` Phase 5c).

## Blocked / open questions
- The Mac app is signed ad hoc; distributing it needs an Apple Developer ID for signing and notarization.
- Live verification of the API-key engines against every provider is partial (unit-tested); Claude Code is verified end to end and Codex against its real binary and stream.
- The TipTap editor converts `[[Title]]` on the final `]` keystroke; pasted text stays literal `[[Title]]`, which is still a valid link on disk.

## How to resume
```bash
pnpm install
SYNAPSE_VAULT=/tmp/synapse-dev pnpm vault:seed   # fictional sample data, outside the repo (default vault: ~/Synapse/vault)
SYNAPSE_VAULT=/tmp/synapse-dev pnpm dev          # server :4317 + Vite :5173
pnpm build && pnpm start                         # production: one origin at http://127.0.0.1:4317
pnpm test && pnpm typecheck && pnpm vault:validate
pnpm eval:vault                                  # runs claude -p per case; needs a signed-in Claude Code
pnpm mac:dmg                                     # apps/desktop/release/Synapse-<version>-arm64.dmg
node apps/web/scripts/shoot.mjs http://127.0.0.1:5173/ /tmp/shots '{"width":1440,"height":900,"settle":6000,"shots":[{"name":"map"}]}' --gpu
```
Read order: `AGENTS.md` → this file → the current phase in `docs/PLAN.md` → the spec for the area you touch (`docs/ARCHITECTURE.md`, `VAULT-SPEC.md`, `BRAIN-ENGINES.md`, `UI-DESIGN.md`) → `.claude/rules/` for its conventions.

Last updated: 2026-11-05 by Claude (Opus 5.5) — first public release, 0.3.1.
