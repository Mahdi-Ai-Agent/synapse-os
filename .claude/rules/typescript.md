---
description: TypeScript conventions for every package and app in the repo.
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

- ESM only (`"type": "module"`), `strict` + `noUncheckedIndexedAccess`. `moduleResolution: bundler`; extensionless relative imports are fine; never `require`.
- No `any`; use `unknown` and narrow. `import type` for types. Named exports; default exports only for React components and config files.
- Validate at boundaries (server routes: zod). Library code (`packages/*`) trusts typed inputs.
- Errors: throw `Error` with an actionable message; never swallow silently. Server maps errors to HTTP codes.
- Dates are ISO 8601 strings with offset in data; use `Intl` only for display.
- Tests: `test/*.test.ts` with vitest, `describe` named after the module. Run `pnpm test` before claiming done.
- No `console.log` in library code; the server uses the Fastify logger.
