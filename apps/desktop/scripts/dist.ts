/**
 * Builds Synapse.app for Apple silicon and its DMG (docs/DEPLOY.md "On a Mac"): stages the app with the web UI built
 * anew, renders the icon and packs it with electron-builder, ad-hoc signed (there is no Apple developer certificate;
 * a DMG built on this Mac opens on it as it is).
 *   pnpm mac:dmg   → apps/desktop/release/Synapse-<version>-arm64.dmg (and release/mac-arm64/Synapse.app)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Arch, build, Platform } from 'electron-builder';
import { renderIcns } from './icon';
import { DESKTOP, STAGE, stageApp } from './stage';

if (process.platform !== 'darwin') throw new Error('mac:dmg builds the Mac app; run it on a Mac');
const require = createRequire(import.meta.url);
const electronDir = path.dirname(require.resolve('electron/package.json'));
const electronVersion = (JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf8')) as { version: string }).version;
// Electron's package fetches its binary only when asked to.
if (!existsSync(path.join(electronDir, 'dist', 'Electron.app'))) execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });

await stageApp({ web: true });
const buildDir = path.join(DESKTOP, 'build');
const icon = path.join(buildDir, 'icon.icns');
await renderIcns(icon);
const release = path.join(DESKTOP, 'release');
rmSync(release, { recursive: true, force: true });

const files = await build({
  projectDir: DESKTOP,
  targets: Platform.MAC.createTarget(['dmg'], Arch.arm64),
  config: {
    appId: 'app.synapse.desktop',
    productName: 'Synapse',
    copyright: 'MIT License',
    electronVersion,
    electronDist: path.join(electronDir, 'dist'),
    directories: { app: STAGE, output: release, buildResources: buildDir },
    // Everything the app needs is bundled: no node_modules go in.
    files: ['main.cjs', 'preload.cjs', 'start.html', 'lock.html', 'package.json', '!node_modules/**/*'],
    // The server reads its files with plain fs, so they stay outside the asar archive.
    extraResources: [
      { from: path.join(STAGE, 'server'), to: 'server' },
      { from: path.join(STAGE, 'web'), to: 'web' },
      { from: path.join(STAGE, 'template'), to: 'template' },
    ],
    asar: true,
    // The unpacked Electron copied in carries Electron's own demo app; Synapse.app runs only its app.asar.
    afterPack: async (ctx) => { await rm(path.join(ctx.appOutDir, 'Synapse.app', 'Contents', 'Resources', 'default_app.asar'), { force: true }); },
    // The installed app cannot be started as plain Node or with an inspector, so nothing else running as the owner
    // can borrow its Keychain access (the Touch ID key). A test build (SYNAPSE_DESKTOP_TEST_BUILD=1) keeps the
    // inspector for the scratch-data checks in .claude/rules/desktop.md.
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: process.env['SYNAPSE_DESKTOP_TEST_BUILD'] === '1',
    },
    npmRebuild: false,
    nodeGypRebuild: false,
    publish: null,
    mac: {
      icon,
      category: 'public.app-category.productivity',
      identity: '-',
      timestamp: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
      darkModeSupport: true,
      minimumSystemVersion: '12.0',
    },
    dmg: { title: 'Synapse', artifactName: 'Synapse-${version}-${arch}.${ext}', writeUpdateInfo: false },
  },
});
console.log(files.filter((f) => f.endsWith('.dmg')).join('\n'));
