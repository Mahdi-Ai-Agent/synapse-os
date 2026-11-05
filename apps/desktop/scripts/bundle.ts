/**
 * Stages the Mac app without packing it: `pnpm --filter @synapse/desktop start` runs it from `stage/` (pass --web to
 * build the web UI first). SYNAPSE_DESKTOP_DATA and SYNAPSE_DESKTOP_PORT point a test run at another folder and port.
 */
import { stageApp } from './stage';

await stageApp({ web: process.argv.includes('--web') });
