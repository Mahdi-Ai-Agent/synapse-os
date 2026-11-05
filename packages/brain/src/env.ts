const DROP_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_', 'CLAUDE_PREVIEW_'];
const DROP_EXACT = new Set(['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT']);
/**
 * Kept although prefixed: the user's own Claude Code settings — the long-lived login token (`claude setup-token`,
 * docs/DEPLOY.md), the traffic switch, the enterprise backends and their auth, client certificates, output limits.
 */
const KEEP = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_SKIP_VERTEX_AUTH', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
]);

/**
 * What a headless Claude Code run does not need (the user's own values win, see `claudeEnv`): the update check,
 * telemetry, error reports and feature-flag fetches are network calls made before the first model call; on a slow or
 * filtered network they are waited on for nothing (docs/BRAIN-ENGINES.md `claude-cli` "Environment").
 */
export const HEADLESS_CLAUDE_DEFAULTS: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  DISABLE_BUG_COMMAND: '1',
};

/**
 * Environment for a spawned engine: drops host Claude Code session variables that leak state
 * into the child and slow its startup. `CLAUDE_CONFIG_DIR` and vendor API keys are kept.
 */
export function sanitizeEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (DROP_EXACT.has(k)) continue;
    if (!KEEP.has(k) && DROP_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
}

/** The sanitized environment plus the headless defaults for a spawned `claude`. */
export function claudeEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out = sanitizeEnv(base);
  for (const [k, v] of Object.entries(HEADLESS_CLAUDE_DEFAULTS)) if (out[k] === undefined) out[k] = v;
  return out;
}
