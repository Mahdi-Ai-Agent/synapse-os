---
description: Conventions for apps/desktop — the Mac app (Electron).
paths:
  - "apps/desktop/**"
---

# apps/desktop

- Spec: `docs/ARCHITECTURE.md` "Desktop app"; building and installing: `docs/DEPLOY.md` "On a Mac".
- The app runs the same server as `pnpm start` (`apps/server/src/main.ts`, bundled); never fork server behaviour for the app. Configure it through the environment in `src/shell.ts` `serverEnv`, and change the server itself when both should change.
- Pure logic lives in `src/shell.ts` (no Electron import) with tests in `test/shell.test.ts`; `src/main.ts` only wires Electron. The app's own words (quit dialog, start page) are in `src/strings.ts` in fa and en; menus keep macOS's English role labels.
- Nothing ships in `node_modules`: `scripts/stage.ts` bundles everything. A server dependency that cannot be bundled (native code, or files read at run time) needs a place in `stage.ts` and a check in the packed app.
- Test a packed app on scratch data only, built with `SYNAPSE_DESKTOP_TEST_BUILD=1 pnpm mac:dmg` (the owner's build has the inspector fuse off): `SYNAPSE_DESKTOP_DATA=<tmp> SYNAPSE_DESKTOP_PORT=<free port> release/mac-arm64/Synapse.app/Contents/MacOS/Synapse --inspect=127.0.0.1:<port>`, driven through the inspector (close that connection before waiting for the app to quit). Never test against the owner's `~/Library/Application Support/Synapse`.
