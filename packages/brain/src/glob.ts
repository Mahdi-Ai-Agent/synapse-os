const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Converts a path glob (`**`, `*`, `?`, `{a,b}`) into an anchored regular expression over `/`-separated paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) { re += `(?:${glob.slice(i + 1, end).split(',').map((s) => escapeRe(s.trim())).join('|')})`; i = end; } else re += '\\{';
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}

export function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function matchesGlob(relPath: string, glob: string): boolean {
  return globToRegExp(normalizeRel(glob)).test(normalizeRel(relPath));
}
