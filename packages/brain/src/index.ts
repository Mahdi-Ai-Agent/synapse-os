export * from './types';
export { BRAIN_MODES, SKILL_PREFIX, MODE_HINT, WEB_HINT, hasUrl, scopeHint, type BrainMode } from './modes';
export { replyLanguage, replyLanguageLine, replyReminder, type ReplyLanguage } from './language';
export { sanitizeEnv, claudeEnv, HEADLESS_CLAUDE_DEFAULTS } from './env';
export { readSignInOutput, plainTerminalText, redactSecrets, lastSignInLines, type SignInReading } from './sign-in';
export { createStreamJsonParser, summarizeToolUse, clip } from './stream-json';
export { createCodexJsonlParser } from './codex-jsonl';
export { ClaudeCliEngine, resolveClaudeBin, claudeAccount, LOGIN_FIX, INSTALL_FIX } from './engines/claude-cli';
export { CodexCliEngine, resolveCodexBin, buildCodexArgs, buildCodexPrompt, parseCodexCatalog, CODEX_INSTALL_FIX, CODEX_LOGIN_FIX, CODEX_MODELS, CODEX_EFFORTS } from './engines/codex-cli';
export { chatgptAppCodexPaths, claudeAppCliPaths, compareVersions, sourceOf, type CliSource } from './engines/desktop-apps';
export { ApiEngine, maskKey, mergeModels, type ApiEngineSpec } from './engines/api-engine';
export { createAnthropicApiEngine, ANTHROPIC_KEY_FIX, ANTHROPIC_KEY_REJECTED_FIX } from './engines/anthropic-api';
export { createOpenAiEngine, createOpenRouterEngine, OPENAI_KEY_FIX, OPENROUTER_KEY_FIX, OPENAI_MODELS, OPENROUTER_MODELS, OPENAI_EFFORTS } from './engines/openai-compatible';
export { loadAgentLayer, expandSkillPrompt, buildSystemPrompt, rulesForPath, rulesIndex, splitFrontmatter, type AgentLayer, type AgentRule, type AgentSkill, type SystemPrompt } from './agent-layer';
export { VaultTools, VAULT_TOOL_DEFINITIONS, READ_DENY, WRITE_ALLOW, type ToolDefinition, type ToolOutcome } from './tools/vault-tools';
export { runToolLoop, SessionStore, TOOL_NOTES, type ChatProvider, type ChatMessage, type CompleteRequest, type ProviderTurn, type ToolCall, type ToolResultMessage, type ToolLoopOptions } from './tool-loop';
export { AnthropicProvider, ANTHROPIC_MODELS, ANTHROPIC_EFFORTS, listAnthropicModels, verifyAnthropicKey, toAnthropicMessages } from './providers/anthropic';
export { OpenAiCompatibleProvider, listOpenAiCompatibleModels, verifyOpenAiCompatibleKey, toOpenAiMessages, sseData } from './providers/openai-compatible';
export { priceOf, costFor, type ModelPrice } from './pricing';
export { matchesGlob, globToRegExp } from './glob';

import { createAnthropicApiEngine } from './engines/anthropic-api';
import { ClaudeCliEngine } from './engines/claude-cli';
import { CodexCliEngine } from './engines/codex-cli';
import { createOpenAiEngine, createOpenRouterEngine } from './engines/openai-compatible';
import type { BrainEngine, EngineId, KeyLookup } from './types';

export interface CreateEnginesOptions {
  /** Reads API keys the user saved in the app (settings); the environment is consulted after it. */
  keys?: KeyLookup;
}

/** All engines known to this build, in display order. Spec: docs/BRAIN-ENGINES.md. */
export function createEngines(opts: CreateEnginesOptions = {}): Map<EngineId, BrainEngine> {
  const list: BrainEngine[] = [
    new ClaudeCliEngine(),
    new CodexCliEngine(),
    createAnthropicApiEngine(opts.keys),
    createOpenAiEngine(opts.keys),
    createOpenRouterEngine(opts.keys),
  ];
  const m = new Map<EngineId, BrainEngine>();
  for (const e of list) m.set(e.id, e);
  return m;
}
