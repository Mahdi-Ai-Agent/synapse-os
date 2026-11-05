import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatgptAppCodexPaths, claudeAccount, claudeAppCliPaths, compareVersions, parseCodexCatalog, sourceOf } from '../src/index';

describe('desktop apps', () => {
  it('finds Codex inside the ChatGPT app, for every user and for this one', () => {
    const paths = chatgptAppCodexPaths();
    expect(paths[0]).toBe('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
    expect(paths[1]).toBe(path.join(os.homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'));
    expect(sourceOf(paths[0]!)).toBe('chatgpt-app');
    expect(sourceOf('/usr/local/bin/codex')).toBe('path');
  });

  it("lists the Claude app's Claude Code newest first", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-app-'));
    for (const [v, b] of [['2.1.295', 'aaa'], ['2.1.309', 'bbb'], ['2.1.30', 'ccc'], ['not-a-version', 'ddd']] as const) {
      const dir = path.join(root, v, b, 'claude.app', 'Contents', 'MacOS');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'claude'), '');
    }
    const found = await claudeAppCliPaths(root);
    expect(found.map((p) => path.relative(root, p).split(path.sep)[0])).toEqual(['2.1.309', '2.1.295', '2.1.30']);
    expect(await claudeAppCliPaths(path.join(root, 'missing'))).toEqual([]);
    expect(compareVersions('2.1.309', '2.1.30')).toBeGreaterThan(0);
    expect(compareVersions('2.1.3', '2.1.3')).toBe(0);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("says which account Claude Code is signed in to, never more", () => {
    expect(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.com', subscriptionType: 'max', orgId: 'x' })).toBe('owner@example.com · Max');
    expect(claudeAccount({ loggedIn: true, email: 'owner@example.com' })).toBe('owner@example.com');
    expect(claudeAccount({ loggedIn: true })).toBeUndefined();
  });

  it("reads Codex's own catalog: visible models, their efforts and the one each starts on", () => {
    const catalog = JSON.stringify({
      models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', default_reasoning_level: 'low', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }] },
        { slug: 'gpt-6-chat-thinking', display_name: 'Hidden', visibility: 'hide', supported_reasoning_levels: [{ effort: 'low' }] },
        { slug: 'gpt-6-luna', visibility: 'list' },
        { display_name: 'no slug', visibility: 'list' },
        'junk',
      ],
    });
    expect(parseCodexCatalog(catalog)).toEqual([
      { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'ultra'], defaultEffort: 'low' },
      { id: 'gpt-6-luna', label: 'gpt-6-luna' },
    ]);
    expect(parseCodexCatalog('[{"slug":"a","visibility":"list"}]')).toEqual([{ id: 'a', label: 'a' }]);
    expect(parseCodexCatalog('not json')).toEqual([]);
  });
});
