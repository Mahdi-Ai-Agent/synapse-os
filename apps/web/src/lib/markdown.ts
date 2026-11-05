const RELATED_HEADING_RE = /^##\s+Related\s*$/im;

/** Returns the body with `- [[title]]` appended under `## Related` (the section is created at the end when missing). */
export function withRelatedLink(body: string, title: string): string {
  const line = `- [[${title}]]`;
  const m = RELATED_HEADING_RE.exec(body);
  if (!m) {
    const base = body.replace(/\s+$/, '');
    return `${base ? `${base}\n\n` : ''}## Related\n${line}\n`;
  }
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const nextHeading = /^#{1,6}\s/m.exec(rest.replace(/^\n/, ''));
  const sectionEnd = nextHeading ? start + (rest.startsWith('\n') ? 1 : 0) + nextHeading.index : body.length;
  const section = body.slice(start, sectionEnd).replace(/\s+$/, '');
  const after = body.slice(sectionEnd);
  return `${body.slice(0, start)}${section}\n${line}\n${after ? `\n${after.replace(/^\n+/, '')}` : ''}`;
}
