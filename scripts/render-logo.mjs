#!/usr/bin/env node
// Render docs/logo.svg into the app icons (run after changing the logo, commit the results):
//   native/AgentDesk.png  1024px macOS icon (tile inset on Apple's grid, with shadow) → .icns in package-mac.sh
//   native/AgentDesk.ico  16–256px full-bleed Windows icon
// Needs a Chromium: CHROME=/path/to/chrome, or Playwright's headless shell in ~/Library/Caches/ms-playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svg = fs.readFileSync(path.join(root, 'docs/logo.svg'), 'utf8');

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  for (const d of fs.existsSync(cache) ? fs.readdirSync(cache).sort().reverse() : []) {
    for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
      const p = path.join(cache, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (fs.existsSync(p)) return p;
  throw new Error('Không tìm thấy Chromium, đặt biến CHROME=/đường/dẫn/chrome');
}

const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-logo-'));

function shot(size, body) {
  const html = path.join(tmp, `${size}.html`);
  const out = path.join(tmp, `${size}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent">${body}</body></html>`);
  execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size},${size}`, '--default-background-color=00000000', `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' });
  return fs.readFileSync(out);
}

const sized = (px) => svg.replace(/width="256" height="256"/, `width="${px}" height="${px}"`);

// macOS: 824px tile centred on a 1024 canvas, soft shadow underneath (Apple icon grid)
fs.writeFileSync(
  path.join(root, 'native/AgentDesk.png'),
  shot(1024, `<div style="width:1024px;height:1024px;display:grid;place-items:center"><div style="width:824px;height:824px;filter:drop-shadow(0 12px 22px rgba(0,0,0,.35))">${sized(824)}</div></div>`),
);

// Windows: PNG-compressed ICO with one full-bleed frame per size
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => shot(s, sized(s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s >= 256 ? 0 : s, e);
  head.writeUInt8(s >= 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4); // colour planes
  head.writeUInt16LE(32, e + 6); // bits per pixel
  head.writeUInt32LE(pngs[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(root, 'native/AgentDesk.ico'), Buffer.concat([head, ...pngs]));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ native/AgentDesk.png, native/AgentDesk.ico');
