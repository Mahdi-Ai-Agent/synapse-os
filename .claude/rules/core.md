---
description: Conventions for packages/core — pure vault logic implementing docs/VAULT-SPEC.md.
paths:
  - "packages/core/**"
---

# packages/core

- Pure functions; no network, no process, no server/UI imports. File IO only in `vault-fs.ts`.
- `docs/VAULT-SPEC.md` is the contract. Follow it exactly; if it is wrong, fix the spec in the same change.
- Inject `now()` and `newId()` where needed so builders stay deterministic in tests.
- Link normalization = Unicode NFC + trim + case-fold; resolution by `title` then `aliases`; unresolved → ghost nodes.
- Frontmatter serialize must round-trip (test it). Preserve unknown frontmatter keys.
- Export the public surface only from `src/index.ts`.
