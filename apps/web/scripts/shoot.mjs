// Full-resolution screenshots (and frame-rate probes) of the running web app through the Chrome DevTools Protocol.
// Usage: node apps/web/scripts/shoot.mjs <url> <outDir> '<spec json>' [--gpu]
//   spec: { width, height, dpr?, mobile?, settle?, shots: [{ name, input?, inputJs?, js?, wait?, shot? }] }; `input` is a
//   list of real mouse events (CDP Input.dispatchMouseEvent params, plus `delay` ms before each; `keyDown` / `keyUp` /
//   `char` events go to Input.dispatchKeyEvent) or `inputJs` returns
//   that list from the page; `js` runs in the page (async ok, its return value is printed), then <outDir>/<name>.png
//   is captured unless `shot: false`. --gpu renders on the Mac GPU (Metal) instead of
//   SwiftShader: use it for frame-rate numbers. The hidden browser pane of the desktop app runs no requestAnimationFrame.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const [, , url, outDir, specJson] = process.argv;
const gpu = process.argv.includes('--gpu');
if (!url || !outDir || !specJson) { console.error('usage: node apps/web/scripts/shoot.mjs <url> <outDir> <spec json> [--gpu]'); process.exit(2); }
const spec = JSON.parse(specJson);
const port = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(outDir, `.profile-${port}`);
mkdirSync(outDir, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', ...(gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--mute-audio', 'about:blank',
], { stdio: 'ignore' });
// A run that throws still closes its Chrome, so the next run's folder is free.
process.on('exit', () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  if (!target) await sleep(250);
}
if (!target) { chrome.kill(); throw new Error('chrome did not start'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const waiters = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  else if (m.method) for (const w of [...waiters]) if (w.method === m.method) { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const once = (method) => new Promise((res) => waiters.push({ method, res }));
const logs = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)); if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: spec.width, height: spec.height, deviceScaleFactor: spec.dpr ?? 1, mobile: Boolean(spec.mobile) });
if (spec.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url });
await loaded;
await sleep(spec.settle ?? 4000);
for (const shot of spec.shots) {
  let input = shot.input ?? [];
  if (shot.inputJs) {
    // Events computed in the page (e.g. from a node's screen position), then sent as real input.
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${shot.inputJs} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) logs.push(`shot ${shot.name} inputJs: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    else input = r.result?.value ?? [];
  }
  for (const ev of input) {
    const { delay = 16, ...params } = ev;
    await sleep(delay);
    if (params.type === 'keyDown' || params.type === 'keyUp' || params.type === 'char') await send('Input.dispatchKeyEvent', params);
    else await send('Input.dispatchMouseEvent', { button: 'none', clickCount: 0, ...params });
  }
  if (shot.js) {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${shot.js} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) logs.push(`shot ${shot.name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    else if (r.result?.value !== undefined) logs.push(`shot ${shot.name} -> ${JSON.stringify(r.result.value).slice(0, 1500)}`);
  }
  await sleep(shot.wait ?? 800);
  if (shot.shot === false) continue;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(outDir, `${shot.name}.png`), Buffer.from(data, 'base64'));
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
console.log('shots:', spec.shots.filter((s) => s.shot !== false).map((s) => s.name).join(', '));
ws.close(); chrome.kill();
await sleep(300);
// Chrome may still be writing its profile for a moment after the kill.
try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { console.log(`left ${profile}`); }
