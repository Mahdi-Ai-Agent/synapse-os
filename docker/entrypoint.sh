#!/bin/sh
# Container start (docs/DEPLOY.md): an empty vault on the first run, then the server.
set -e
VAULT="${SYNAPSE_VAULT:-/data/vault}"
if ! mkdir -p "$VAULT" "${HOME:-/data/home}" 2>/dev/null || ! [ -w "$VAULT" ]; then
  echo "synapse: /data is not writable by the app user (uid $(id -u)). Mount a named volume at /data (Coolify: Persistent Storage, Volume Mount), or chown the host folder to $(id -u):$(id -g)." >&2
  exit 1
fi
if [ ! -f "$VAULT/AGENTS.md" ]; then
  echo "synapse: creating an empty vault at $VAULT"
  /app/node_modules/.bin/tsx /app/scripts/create-vault.ts "$VAULT"
fi
exec /app/node_modules/.bin/tsx /app/apps/server/src/main.ts
