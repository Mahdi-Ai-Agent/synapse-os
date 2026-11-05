import { describe, it, expect } from 'vitest';
import { privateHistory } from '../src/private-history';
describe('private conversation continuity', () => {
  it('includes prior user and assistant messages without duplicating the current input', () => {
    const result = privateHistory([{role:'user',text:'Remember the blue project',runId:'a'},{role:'brain',text:'Understood',runId:'a'},{role:'user',text:'Which project?',runId:'b'}], 'b');
    expect(result).toContain('blue project'); expect(result).toContain('"role":"assistant"'); expect(result).not.toContain('Which project?');
  });
  it('bounds context while keeping the most recent complete messages', () => {
    const result=privateHistory([{role:'user',text:'x'.repeat(500)},{role:'brain',text:'latest reply'}], 'next', 100);
    expect(result).toContain('latest reply'); expect(result).not.toContain('x'.repeat(500)); expect(result).toContain('complete conversation remains saved');
  });
});

describe('private conversation continuity, edges', () => {
  it('leaves out messages queued after the current run and failed replies', () => {
    const result = privateHistory([
      { role: 'user', text: 'first', runId: 'a' }, { role: 'brain', text: 'claude exited with code 1', runId: 'a', isError: true },
      { role: 'user', text: 'now', runId: 'b' }, { role: 'user', text: 'buy milk later', runId: 'c' },
    ], 'b');
    expect(result).toContain('first'); expect(result).not.toContain('exited'); expect(result).not.toContain('buy milk');
  });
  it('cuts a newest message longer than the budget instead of dropping everything', () => {
    const result = privateHistory([{ role: 'user', text: 'y'.repeat(1000) }, { role: 'user', text: 'now', runId: 'z' }], 'z', 500);
    expect(result).toContain('yyyy'); expect(result).toContain('complete conversation remains saved');
  });
});
