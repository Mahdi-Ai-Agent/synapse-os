import { ANTHROPIC_EFFORTS, ANTHROPIC_MODELS, AnthropicProvider, listAnthropicModels, verifyAnthropicKey } from '../providers/anthropic';
import type { KeyLookup } from '../types';
import { ApiEngine } from './api-engine';

export const ANTHROPIC_KEY_FIX = 'Add ANTHROPIC_API_KEY=sk-ant-… to the repo .env (copy .env.example) and restart the server, or paste the key under Settings → Brain engine → Anthropic API. Create keys in the Claude Platform console (platform.claude.com).';
export const ANTHROPIC_KEY_REJECTED_FIX = 'Anthropic rejected this key (401). Create a new key in the Claude Platform console (platform.claude.com) and update ANTHROPIC_API_KEY or the key saved in Settings.';

/** Claude Messages API with the in-app vault tool loop; billed to the user's API key. */
export function createAnthropicApiEngine(lookup?: KeyLookup): ApiEngine {
  return new ApiEngine(
    {
      id: 'anthropic-api',
      name: 'Anthropic API (API key)',
      keyEnv: 'ANTHROPIC_API_KEY',
      keyProvider: 'anthropic',
      models: ANTHROPIC_MODELS,
      efforts: ANTHROPIC_EFFORTS,
      missingKeyFix: ANTHROPIC_KEY_FIX,
      rejectedKeyFix: ANTHROPIC_KEY_REJECTED_FIX,
      makeProvider: (apiKey) => new AnthropicProvider({ apiKey }),
      verifyKey: (apiKey) => verifyAnthropicKey({ apiKey }),
      listModels: (apiKey) => listAnthropicModels({ apiKey }),
    },
    lookup,
  );
}
