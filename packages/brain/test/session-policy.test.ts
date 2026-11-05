import { describe, it, expect } from 'vitest';
import { cliSessionArgs } from '../src/session-policy';
import { buildCodexArgs } from '../src/engines/codex-cli';
describe('protected CLI sessions', () => {
  it('never resumes or persists an ephemeral run, including old saved session ids', () => {
    expect(cliSessionArgs('claude', { ephemeral: true, sessionId: 'old' })).toEqual(['--no-session-persistence']);
    const args = buildCodexArgs({ cwd: '/vault', ephemeral: true, sessionId: 'old' });
    expect(args).toContain('--ephemeral'); expect(args).not.toContain('resume'); expect(args).not.toContain('old');
  });
  it('keeps normal server sessions resumable', () => {
    expect(cliSessionArgs('claude', { sessionId: 'old' })).toEqual(['--resume', 'old']);
    expect(cliSessionArgs('codex', { sessionId: 'old' })).toEqual(['resume', 'old']);
  });
});
