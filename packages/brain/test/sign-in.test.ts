import { describe, expect, it } from 'vitest';
import { lastSignInLines, plainTerminalText, readSignInOutput, redactSecrets } from '../src/sign-in';
import type { SignInSpec } from '../src/types';

const claude: SignInSpec = { flow: 'paste-code', login: [], logout: [], hosts: ['claude.com', 'claude.ai', 'anthropic.com'] };
const codex: SignInSpec = { flow: 'device-code', login: [], logout: [], hosts: ['openai.com', 'chatgpt.com'] };
const LINK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&state=abc';

describe('readSignInOutput', () => {
  it('finds the Claude link in an OSC 8 hyperlink and sees the paste prompt', () => {
    const raw = `\x1b[2mOpening browser to sign in…\x1b[22m\r\nIf the browser didn't open, visit: \x1b]8;;${LINK}\x07${LINK.slice(0, 30)}\x1b]8;;\x07\r\nPaste code here if prompted > `;
    const r = readSignInOutput(raw, claude);
    expect(r.url).toBe(LINK);
    expect(r.needsPaste).toBe(true);
    expect(r.code).toBeNull();
    expect(r.error).toBeNull();
  });

  it('never returns a link to another host', () => {
    expect(readSignInOutput('visit: https://evil.example/claude.com/login\nPaste code here >', claude).url).toBeNull();
    expect(readSignInOutput('visit: http://claude.com/plain-http', claude).url).toBeNull();
  });

  it('reads the device link and code', () => {
    const raw = '\x1b[1mFollow these steps\x1b[0m\n1. Open this link in your browser\n   https://auth.openai.com/codex/device\n2. Enter this one-time code\n   ABCD-EF123\n';
    const r = readSignInOutput(raw, codex);
    expect(r.url).toBe('https://auth.openai.com/codex/device');
    expect(r.code).toBe('ABCD-EF123');
    expect(r.needsPaste).toBe(false);
  });

  it('reports the last error line, without secrets', () => {
    const r = readSignInOutput('Paste code here >\nLogin failed: invalid code sk-ant-oat01-abcdefghijklmnopqrstuvwxyz\n', claude);
    expect(r.error).toContain('Login failed');
    expect(r.error).not.toContain('sk-ant-oat01');
  });
});

describe('terminal text', () => {
  it('drops escape sequences and keeps the words', () => {
    expect(plainTerminalText('\x1b[31mred\x1b[0m\r\nnext')).toBe('red\nnext');
  });
  it('redacts keys and tokens', () => {
    expect(redactSecrets('key sk-proj-ABCDEFGHIJKLMNOP end')).toBe('key [redacted] end');
    expect(redactSecrets('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc end')).toBe('jwt [redacted] end');
  });
  it('keeps the last useful lines', () => {
    expect(lastSignInLines('Opening…\nvisit: https://claude.com/x\nPaste code here >\nnetwork unreachable\n')).toBe('Opening… · network unreachable');
  });
});
