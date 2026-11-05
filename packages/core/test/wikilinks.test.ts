import { describe, expect, it } from 'vitest';
import { extractWikilinks, normalizeTitle, rewriteWikilinks, stripLinkBrackets } from '../src/wikilinks';
import { slugify } from '../src/ids';

describe('wikilinks', () => {
  it('extracts targets, aliases and subpaths, skipping code', () => {
    const refs = extractWikilinks('see [[سلامتی]] and [[Project X|the project]] and [[Note#Heading]] `[[not me]]`\n```\n[[nor me]]\n```');
    expect(refs.map((r) => r.target)).toEqual(['سلامتی', 'Project X', 'Note']);
    expect(refs[1]?.alias).toBe('the project');
    expect(refs[2]?.subpath).toBe('Heading');
  });

  it('normalizes titles case- and space-insensitively', () => {
    expect(normalizeTitle('  Synapse   App ')).toBe('synapse app');
    expect(normalizeTitle('سلامتی')).toBe('سلامتی');
  });

  it('strips link brackets from frontmatter values', () => {
    expect(stripLinkBrackets('[[Ali|علی]]')).toBe('Ali');
    expect(stripLinkBrackets(' plain ')).toBe('plain');
  });
});

describe('slugify', () => {
  it('keeps Persian, lowercases Latin, removes unsafe characters', () => {
    expect(slugify('تماس با دکتر رضایی')).toBe('تماس-با-دکتر-رضایی');
    expect(slugify('Synapse App: v1/launch?')).toBe('synapse-app-v1-launch');
    expect(slugify('   ')).toBe('untitled');
  });
});

describe('rewriteWikilinks', () => {
  it('rewrites matching targets with subpaths and aliases, in body and quoted frontmatter, skipping code', () => {
    const text = '---\nproject: "[[Old Title]]"\nlinks: ["[[old title]]", "[[Other]]"]\n---\nSee [[Old Title|the project]] and [[Old Title#Outcome]] and [[Other]].\n`[[Old Title]]` stays, so does\n```\n[[Old Title]]\n```\n';
    const r = rewriteWikilinks(text, 'Old Title', 'New Title');
    expect(r.count).toBe(4);
    expect(r.text).toContain('project: "[[New Title]]"');
    expect(r.text).toContain('links: ["[[New Title]]", "[[Other]]"]');
    expect(r.text).toContain('[[New Title|the project]] and [[New Title#Outcome]] and [[Other]]');
    expect(r.text).toContain('`[[Old Title]]` stays');
    expect(r.text).toContain('```\n[[Old Title]]\n```');
  });

  it('leaves unrelated text untouched', () => {
    const r = rewriteWikilinks('nothing here [[Else]]\n', 'Old', 'New');
    expect(r).toEqual({ text: 'nothing here [[Else]]\n', count: 0 });
  });
});
