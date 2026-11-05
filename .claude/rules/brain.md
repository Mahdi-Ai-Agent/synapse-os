---
description: Conventions for packages/brain — engine contract, stream parsing, process safety.
paths:
  - "packages/brain/**"
---

# packages/brain

- The contract is `src/types.ts`; behavior is specified in `docs/BRAIN-ENGINES.md`.
- Parse engine streams defensively: ignore unknown line types, never throw on shape, always emit a final `result` or `error`.
- Spawn with a sanitized env: drop `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*` (they leak host-session state and slow startup 12×).
- Cancel with SIGINT; escalate to SIGTERM after 5 s.
- Probes must be free: `claude --version`, `claude auth status`. Never read credential files. Never make a paid call to check login.
- Sign-in from the app runs only the CLI's own command from its `signIn` spec (`docs/BRAIN-ENGINES.md` "Sign-in from the app"); never read, copy or log what the CLI stores, and show only links on the spec's vendor hosts.
- No vault logic here; the engine only knows a `cwd` and a prompt.
