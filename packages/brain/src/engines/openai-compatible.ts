import type { ModelPrice } from '../pricing';
import { priceOf } from '../pricing';
import { OpenAiCompatibleProvider, listOpenAiCompatibleModels, verifyOpenAiCompatibleKey } from '../providers/openai-compatible';
import type { KeyLookup, ModelOption } from '../types';
import { ApiEngine } from './api-engine';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const OPENAI_MODELS: ModelOption[] = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (balanced)' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra (most capable)' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (fast)' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna (efficient)' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
];
export const OPENROUTER_MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-5.5', label: 'Anthropic: Claude Sonnet 5.5' },
  { id: 'anthropic/claude-opus-5.5', label: 'Anthropic: Claude Opus 5.5' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Anthropic: Claude Haiku 5.5' },
  { id: 'openai/gpt-6.1-sol', label: 'OpenAI: GPT-6.1 Sol' },
  { id: 'openai/gpt-6-astra', label: 'OpenAI: GPT-6 Astra' },
  { id: 'openai/gpt-6-luna', label: 'OpenAI: GPT-6 Luna' },
  { id: 'google/gemini-4-argon', label: 'Google: Gemini 4 Argon' },
];
/** Chat Completions `reasoning_effort` / OpenRouter `reasoning.effort` values accepted by the current reasoning models. */
export const OPENAI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const OPENAI_KEY_FIX = 'Add OPENAI_API_KEY=sk-… to the repo .env (copy .env.example) and restart the server, or paste the key under Settings → Brain engine → OpenAI API. Create keys at platform.openai.com/api-keys.';
export const OPENAI_KEY_REJECTED_FIX = 'OpenAI rejected this key (401). Create a new key at platform.openai.com/api-keys and update OPENAI_API_KEY or the key saved in Settings.';
export const OPENROUTER_KEY_FIX = 'Add OPENROUTER_API_KEY=sk-or-… to the repo .env (copy .env.example) and restart the server, or paste the key under Settings → Brain engine → OpenRouter. Create keys at openrouter.ai/settings/keys.';
export const OPENROUTER_KEY_REJECTED_FIX = 'OpenRouter rejected this key (401). Create a new key at openrouter.ai/settings/keys and update OPENROUTER_API_KEY or the key saved in Settings.';

const OPENROUTER_HEADERS = { 'HTTP-Referer': 'https://github.com/synapse-brain/synapse', 'X-Title': 'Synapse' };

/** OpenAI Chat Completions with the in-app vault tool loop. */
export function createOpenAiEngine(lookup?: KeyLookup): ApiEngine {
  const base = { id: 'openai-api' as const, label: 'OpenAI', baseUrl: process.env['OPENAI_BASE_URL']?.trim() || OPENAI_BASE_URL };
  return new ApiEngine(
    {
      id: 'openai-api',
      name: 'OpenAI API (API key)',
      keyEnv: 'OPENAI_API_KEY',
      keyProvider: 'openai',
      models: OPENAI_MODELS,
      efforts: OPENAI_EFFORTS,
      missingKeyFix: OPENAI_KEY_FIX,
      rejectedKeyFix: OPENAI_KEY_REJECTED_FIX,
      makeProvider: (apiKey) => new OpenAiCompatibleProvider({ ...base, apiKey, effortParam: 'reasoning_effort', priceFor: (m) => priceOf('openai', m) }),
      verifyKey: (apiKey) => verifyOpenAiCompatibleKey({ ...base, apiKey }),
      listModels: async (apiKey) => (await listOpenAiCompatibleModels({ ...base, apiKey })).models,
    },
    lookup,
  );
}

/** OpenRouter (OpenAI-compatible) with the in-app vault tool loop; prices come from its model list, cost from its usage accounting. */
export function createOpenRouterEngine(lookup?: KeyLookup): ApiEngine {
  const base = { id: 'openrouter' as const, label: 'OpenRouter', baseUrl: OPENROUTER_BASE_URL, headers: OPENROUTER_HEADERS };
  const prices = new Map<string, ModelPrice>();
  return new ApiEngine(
    {
      id: 'openrouter',
      name: 'OpenRouter (API key)',
      keyEnv: 'OPENROUTER_API_KEY',
      keyProvider: 'openrouter',
      models: OPENROUTER_MODELS,
      efforts: OPENAI_EFFORTS,
      missingKeyFix: OPENROUTER_KEY_FIX,
      rejectedKeyFix: OPENROUTER_KEY_REJECTED_FIX,
      makeProvider: (apiKey) => new OpenAiCompatibleProvider({ ...base, apiKey, effortParam: 'reasoning', priceFor: (m) => prices.get(m) }),
      verifyKey: (apiKey) => verifyOpenAiCompatibleKey({ ...base, apiKey }),
      listModels: async (apiKey) => {
        const catalog = await listOpenAiCompatibleModels({ ...base, apiKey });
        for (const [id, price] of catalog.prices) prices.set(id, price);
        return catalog.models;
      },
    },
    lookup,
  );
}
