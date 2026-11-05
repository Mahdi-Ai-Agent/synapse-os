# Security policy

Synapse holds people's private notes, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: the repository's **Security** tab → **Report a vulnerability** (private vulnerability reporting). Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer within a week.

## Scope

In scope: the server (`apps/server` — the account and sessions, pairing, the MCP endpoint and its OAuth, the brain runner), the web UI, the Mac app's encrypted vault and lock (`apps/desktop`), the Docker image, and the vault agent layer (`packages/vault-template`, for example a way for the brain to write outside `nodes/` and `memory/`).

Out of scope: the AI vendors' own CLIs and services, and a server you exposed without HTTPS.

## What Synapse promises

- It never reads, stores or proxies AI credentials (sign-in happens in the vendor's own CLI).
- API keys stay in the vault's private settings file (`.synapse/`), never in logs or exports.
- The server listens only on loopback unless the owner turns on phone access or sets `SYNAPSE_HOST`.
- The Mac app's vault is an AES-256 encrypted disk image; its key is wrapped by the password, a recovery key and optionally Touch ID, and never passed in arguments, environment or logs.

The design is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ("Access control", "Desktop protection").
