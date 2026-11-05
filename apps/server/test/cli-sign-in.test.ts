import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrainEngine, EngineProbe, SignInSpec } from '@synapse/brain';
import { CliSignIns, type SignInState } from '../src/cli-sign-in';

let dir = '';
let pasteCli = '';
let deviceCli = '';
const LINK = 'https://claude.com/cai/oauth/authorize?code=true&state=abc';

/** A stand-in for a vendor CLI: its sign-in prints a link and either waits for a code or for "the vendor". */
function fakeEngine(script: string, flow: SignInSpec['flow'], marker: string): BrainEngine {
  return {
    id: flow === 'paste-code' ? 'claude-cli' : 'codex-cli',
    name: 'Fake CLI',
    auth: 'cli-login',
    signIn: { flow, login: [script, marker], logout: [script, '--logout', marker], hosts: ['claude.com', 'openai.com'] },
    resolveBin: async () => process.execPath,
    probe: async (): Promise<EngineProbe> => ({ installed: true, loggedIn: existsSync(marker), checkedAt: new Date().toISOString() }),
    models: () => [],
    efforts: () => [],
    run: () => { throw new Error('not used'); },
  };
}

async function until(read: () => SignInState | null, ok: (s: SignInState) => boolean, ms = 8000): Promise<SignInState> {
  const end = Date.now() + ms;
  for (;;) {
    const s = read();
    if (s && ok(s)) return s;
    if (Date.now() > end) throw new Error(`timed out; last state ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-signin-'));
  pasteCli = path.join(dir, 'paste-cli.mjs');
  await fs.writeFile(pasteCli, `
import { writeFileSync, rmSync } from 'node:fs';
import readline from 'node:readline';
const marker = process.argv.at(-1);
if (process.argv.includes('--logout')) { rmSync(marker, { force: true }); process.exit(0); }
process.stdout.write('Opening browser to sign in…\\r\\nIf the browser didn\\'t open, visit: \\x1b]8;;${LINK}\\x07${LINK}\\x1b]8;;\\x07\\r\\nPaste code here if prompted > ');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (line.trim() === 'good#state') { writeFileSync(marker, 'yes'); process.stdout.write('\\r\\nLogin successful.\\r\\n'); process.exit(0); }
  process.stdout.write('\\r\\nLogin failed: invalid code ' + line.trim() + '\\r\\n'); process.exit(1);
});
`);
  deviceCli = path.join(dir, 'device-cli.mjs');
  await fs.writeFile(deviceCli, `
import { writeFileSync } from 'node:fs';
const marker = process.argv.at(-1);
process.stdout.write('1. Open this link in your browser\\n   https://auth.openai.com/codex/device\\n2. Enter this one-time code\\n   WXYZ-12345\\n');
setTimeout(() => { writeFileSync(marker, 'yes'); process.stdout.write('Successfully logged in\\n'); process.exit(0); }, 400);
`);
});

afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('signing a CLI in from the app', () => {
  it('shows the link, takes the pasted code and ends signed in', async () => {
    const signIns = new CliSignIns();
    const engine = fakeEngine(pasteCli, 'paste-code', path.join(dir, 'ok-1'));
    await signIns.start(engine);
    const waiting = await until(() => signIns.state('claude-cli'), (s) => s.needsPaste);
    expect(waiting).toMatchObject({ status: 'waiting', url: LINK, code: null });
    signIns.paste('claude-cli', 'good#state');
    const done = await until(() => signIns.state('claude-cli'), (s) => s.status === 'done' || s.status === 'failed');
    expect(done.status).toBe('done');
    expect(done.message).toBeNull();
    signIns.dispose();
  });

  it('fails on a wrong code without echoing it', async () => {
    const signIns = new CliSignIns();
    await signIns.start(fakeEngine(pasteCli, 'paste-code', path.join(dir, 'ok-2')));
    await until(() => signIns.state('claude-cli'), (s) => s.needsPaste);
    signIns.paste('claude-cli', 'wrong-code-XYZ');
    const end = await until(() => signIns.state('claude-cli'), (s) => s.status === 'done' || s.status === 'failed');
    expect(end.status).toBe('failed');
    expect(end.message).toContain('Login failed');
    expect(end.message).not.toContain('wrong-code-XYZ');
    expect(() => signIns.paste('claude-cli', 'again')).toThrow();
    signIns.dispose();
  });

  it('shows the device link and code and ends signed in when the vendor confirms', async () => {
    const signIns = new CliSignIns();
    await signIns.start(fakeEngine(deviceCli, 'device-code', path.join(dir, 'ok-3')));
    const seen = await until(() => signIns.state('codex-cli'), (s) => Boolean(s.code));
    expect(seen).toMatchObject({ url: 'https://auth.openai.com/codex/device', code: 'WXYZ-12345', needsPaste: false });
    const done = await until(() => signIns.state('codex-cli'), (s) => s.status === 'done' || s.status === 'failed');
    expect(done.status).toBe('done');
    signIns.dispose();
  });

  it('cancels a waiting sign-in and signs out', async () => {
    const signIns = new CliSignIns();
    const marker = path.join(dir, 'ok-4');
    const engine = fakeEngine(pasteCli, 'paste-code', marker);
    await signIns.start(engine);
    await until(() => signIns.state('claude-cli'), (s) => s.needsPaste);
    signIns.cancel('claude-cli');
    expect(signIns.state('claude-cli')?.status).toBe('cancelled');
    await fs.writeFile(marker, 'yes');
    const probe = await signIns.signOut(engine);
    expect(probe.loggedIn).toBe(false);
    signIns.dispose();
  });

  it('refuses an engine that has no sign-in', async () => {
    const signIns = new CliSignIns();
    const apiEngine = { ...fakeEngine(pasteCli, 'paste-code', path.join(dir, 'x')), signIn: undefined } as BrainEngine;
    await expect(signIns.start(apiEngine)).rejects.toThrow(/API key/);
  });
});
