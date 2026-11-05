import { describe, expect, it } from 'vitest';
import {
  fitBounds, formatRecoveryKey, isAppUrl, isExternalUrl, mergePath, normalizeRecoveryKey, parseShellPath, passwordDue, recentStops, restartDelay, serverEnv,
  SHELL_PATH_MARK, windowStateOf,
} from '../src/shell';

describe('shell', () => {
  it("reads the login shell's PATH from between its marks, whatever the startup files print", () => {
    const out = `Welcome back!\n${SHELL_PATH_MARK}/Users/me/.npm-global/bin:/usr/bin:/bin${SHELL_PATH_MARK}\nbye`;
    expect(parseShellPath(out)).toBe('/Users/me/.npm-global/bin:/usr/bin:/bin');
    expect(parseShellPath('no marks here')).toBeNull();
    expect(parseShellPath(`${SHELL_PATH_MARK}  ${SHELL_PATH_MARK}`)).toBeNull();
  });

  it("puts the shell's PATH first and adds where Claude Code and Homebrew install, once each", () => {
    const merged = mergePath('/opt/homebrew/bin:/Users/me/bin::/usr/bin', '/usr/bin:/bin', '/Users/me').split(':');
    expect(merged.slice(0, 3)).toEqual(['/opt/homebrew/bin', '/Users/me/bin', '/usr/bin']);
    expect(merged).toContain('/Users/me/.npm-global/bin');
    expect(merged).toContain('/Users/me/.local/bin');
    expect(new Set(merged).size).toBe(merged.length);
    expect(merged).not.toContain('');
    expect(mergePath(null, undefined, '/h').split(':')[0]).toBe('/h/.npm-global/bin');
  });

  it("gives the server the Mac's sign-ins and this app's places, never another session's variables or a key", () => {
    const env = serverEnv({
      base: {
        HOME: '/Users/me', SHELL: '/bin/zsh', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
        ANTHROPIC_API_KEY: 'sk-test', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', SYNAPSE_HOST: '0.0.0.0', UNSET: undefined,
      },
      path: '/usr/bin:/bin', user: 'me', vault: '/data/vault', port: 4417, webDist: '/res/web', envFile: '/data/synapse.env',
    });
    expect(env).toMatchObject({
      HOME: '/Users/me', CLAUDE_CONFIG_DIR: '/Users/me/.claude-work', PATH: '/usr/bin:/bin', USER: 'me', LOGNAME: 'me',
      SYNAPSE_VAULT: '/data/vault', SYNAPSE_PORT: '4417', SYNAPSE_WEB_DIST: '/res/web', SYNAPSE_ENV_FILE: '/data/synapse.env', NODE_ENV: 'production',
    });
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_API_KEY', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'SYNAPSE_HOST', 'UNSET']) expect(env).not.toHaveProperty(k);
    expect(serverEnv({ base: { USER: 'owner' }, path: '', user: 'other', vault: '', port: 1, webDist: '', envFile: '' })['USER']).toBe('owner');
  });

  it('starts a stopped server again a few times, then gives up until asked', () => {
    expect([1, 2, 3, 4, 5].map(restartDelay)).toEqual([1000, 3000, 8000, null, null]);
    expect(recentStops([0, 50_000, 119_000, 125_000], 130_000)).toEqual([50_000, 119_000, 125_000]);
  });

  it("keeps the app's own pages in the window and sends the rest to the browser", () => {
    expect(isAppUrl('http://127.0.0.1:4417/', 4417)).toBe(true);
    expect(isAppUrl('http://localhost:4417/settings?x=1', 4417)).toBe(true);
    expect(isAppUrl('http://127.0.0.1:4317/', 4417)).toBe(false);
    expect(isAppUrl('https://127.0.0.1:4417/', 4417)).toBe(false);
    expect(isAppUrl('https://example.com/', 4417)).toBe(false);
    expect(isAppUrl('not a url', 4417)).toBe(false);
    expect(['https://a.b', 'http://a.b', 'mailto:x@y.z'].every(isExternalUrl)).toBe(true);
    expect(['file:///etc/hosts', 'javascript:alert(1)', 'wiki:Note'].some(isExternalUrl)).toBe(false);
  });

  it('opens the window where it was while that place is still on a screen', () => {
    expect(windowStateOf({ x: 10, y: 20, width: 1200, height: 800, maximized: true })).toEqual({ x: 10, y: 20, width: 1200, height: 800, maximized: true });
    expect(windowStateOf({ x: 10, y: 20, width: 1200 })).toBeNull();
    expect(windowStateOf('broken')).toBeNull();
    const screen = [{ x: 0, y: 25, width: 1440, height: 875 }];
    expect(fitBounds({ x: 100, y: 80, width: 500, height: 300, maximized: false }, screen, { width: 880, height: 600 }))
      .toEqual({ x: 100, y: 80, width: 880, height: 600, maximized: false });
    // Saved on a second screen that is no longer attached: open centred instead.
    expect(fitBounds({ x: 2000, y: 100, width: 1200, height: 800, maximized: false }, screen, { width: 880, height: 600 })).toBeNull();
    expect(fitBounds(null, screen, { width: 880, height: 600 })).toBeNull();
  });
});

describe('desktop protection helpers', () => {
  it('gives the protected server loopback, private sessions and a late first schedule check', () => {
    const env = serverEnv({ base: { SYNAPSE_HOST: '0.0.0.0' }, path: '/usr/bin', user: 'me', vault: '/v', port: 4417, webDist: '/w', envFile: '/e', protected: true });
    expect(env['SYNAPSE_HOST']).toBe('127.0.0.1');
    expect(env['SYNAPSE_PRIVATE_SESSIONS']).toBe('1');
    expect(Number(env['SYNAPSE_AUTOMATION_DELAY_MS'])).toBeGreaterThan(0);
    const plain = serverEnv({ base: {}, path: '/usr/bin', user: 'me', vault: '/v', port: 4417, webDist: '/w', envFile: '/e' });
    expect(plain['SYNAPSE_PRIVATE_SESSIONS']).toBeUndefined();
  });

  it('asks for the password again after two weeks of Touch ID', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(passwordDue(undefined, now)).toBe(false); // an older install: the clock starts at its next unlock
    expect(passwordDue('2026-11-10T10:00:00Z', now)).toBe(false);
    expect(passwordDue('2026-11-06T10:00:00Z', now)).toBe(true);
  });

  it('writes a recovery key a person can copy by hand and reads it back however it is typed', () => {
    const key = formatRecoveryKey(new Uint8Array(20).map((_, i) => i * 13));
    expect(key).toMatch(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    expect(key).not.toMatch(/[01OI]/);
    expect(normalizeRecoveryKey(key.toLowerCase().replace(/-/g, ' '))).toBe(key);
    expect(normalizeRecoveryKey('not a key')).toBeNull();
    expect(() => formatRecoveryKey(new Uint8Array(4))).toThrow();
  });
});
