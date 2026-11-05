import { describe, expect, it } from 'vitest';
import { withRelatedLink } from '../src/lib/markdown';

describe('markdown helpers', () => {
  it('creates a Related section at the end when missing', () => {
    expect(withRelatedLink('Body text.\n', 'Sleep routine')).toBe('Body text.\n\n## Related\n- [[Sleep routine]]\n');
    expect(withRelatedLink('', 'A')).toBe('## Related\n- [[A]]\n');
  });

  it('appends to an existing Related section, before the next heading', () => {
    const body = 'Intro\n\n## Related\n- [[A]]\n\n## Notes\nmore\n';
    expect(withRelatedLink(body, 'B')).toBe('Intro\n\n## Related\n- [[A]]\n- [[B]]\n\n## Notes\nmore\n');
  });

  it('appends when Related is the last section', () => {
    expect(withRelatedLink('x\n\n## Related\n- [[A]]\n', 'B')).toBe('x\n\n## Related\n- [[A]]\n- [[B]]\n');
  });
});
