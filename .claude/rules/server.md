---
description: Conventions for apps/server — the Fastify brain host.
paths:
  - "apps/server/**"
---

# apps/server

- One file per route group in `src/routes/`; register in `src/app.ts`. Routes never touch `fs` or `git` directly: vault access goes through `VaultService`, git through `vault-git.ts`, broadcasts through `ws.ts`.
- Routes and WS event names live in `docs/ARCHITECTURE.md`; update it when adding one.
- Validate request bodies with zod; return `{error: {message}}` with a proper status.
- Brain runs are single-flight per vault (queue), cancellable (SIGINT). Never log full prompts above debug level.
- Never write outside the vault; inside it only `nodes/`, `memory/`, `index/`, `.synapse/`.
- MCP (docs/ARCHITECTURE.md "MCP connector"): tools live in `mcp-tools.ts` and reach the vault only through `VaultService` and `vault-git.ts`; every write is one `mcp(<app>): …` commit; a new tool comes with a case in `test/mcp.test.ts`. OAuth state lives in `connections.ts` (tokens only as SHA-256); absolute URLs come from `public-url.ts`, never from a hard-coded host.
- Backup (docs/ARCHITECTURE.md "Backup"): export and import live in `backup.ts`; an export never carries `settings.json`, `auth.json`, `pairing.json`, `connections.json` or engine transcripts, and an import writes only under `nodes/`, `memory/` and the three app files it names (`APP_FILES`).
