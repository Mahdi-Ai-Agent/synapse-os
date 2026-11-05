import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repo's `.env` (documented in `.env.example`; gitignored) into `process.env` before the server
 * configures itself. Existing variables win. `SYNAPSE_ENV_FILE` points elsewhere.
 */
export function loadDotEnv(): string | null {
  const file = process.env['SYNAPSE_ENV_FILE'] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
  if (!existsSync(file)) return null;
  try { process.loadEnvFile(file); return file; } catch { return null; }
}
