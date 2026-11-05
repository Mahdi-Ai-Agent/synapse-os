# Synapse in one image: the brain host, the built web UI and the user's Claude Code CLI (docs/DEPLOY.md).
# The vault lives in a volume at /data; the CLI keeps its state under /data/home.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
  && apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/brain/package.json packages/brain/
COPY packages/vault-template/package.json packages/vault-template/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runtime
# The brains: the user's own, unmodified Claude Code and Codex CLIs. Each keeps its own sign-in under $HOME (in the
# volume); Settings → Brain runs their sign-in, or CLAUDE_CODE_OAUTH_TOKEN signs Claude Code in (docs/DEPLOY.md).
RUN npm install -g @anthropic-ai/claude-code @openai/codex
WORKDIR /app
COPY --from=build /app /app
# Behind a proxy loopback proves nothing: every client signs in (the first-run setup makes the account).
ENV NODE_ENV=production SYNAPSE_VAULT=/data/vault SYNAPSE_HOST=0.0.0.0 SYNAPSE_PORT=4317 SYNAPSE_TRUST_LOOPBACK=false HOME=/data/home
RUN mkdir -p /data && chown -R node:node /data /app && chmod +x /app/docker/entrypoint.sh
USER node
EXPOSE 4317
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]
