#!/usr/bin/env node
// Render docs/logo.svg into the app icons (run after changing the logo, commit the results):
//   native/AgentDesk.png  1024px macOS icon (tile inset on Apple's grid, with shadow) → .icns in package-mac.sh
//   native/AgentDesk.ico  16–256px full-bleed Windows icon
//   ui/public/icon-*.png  raster icons for the app window / taskbar
// Needs a Chromium: CHROME=/path/to/chrome, or Playwright's headless shell in ~/Library/Caches/ms-playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

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

/** RGBA pixels of an 8-bit RGBA, non-interlaced PNG (what Chromium's screenshots are). */
function decodePng(buf) {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error('PNG RGBA 8-bit expected');
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, px };
}

/** A classic 32-bit DIB icon frame: Windows shows these at every size (PNG frames only reliably at 256). */
function bmpFrame(png) {
  const { w, h, px } = decodePng(png);
  const maskRow = Math.ceil(w / 32) * 4;
  const out = Buffer.alloc(40 + w * h * 4 + maskRow * h);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(w, 4);
  out.writeInt32LE(h * 2, 8); // colour + mask
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(w * h * 4 + maskRow * h, 20);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = 40 + ((h - 1 - y) * w + x) * 4; // bottom-up, BGRA
      out[d] = px[s + 2];
      out[d + 1] = px[s + 1];
      out[d + 2] = px[s];
      out[d + 3] = px[s + 3];
    }
  }
  return out; // AND mask stays 0: the alpha channel decides
}

// Windows: one full-bleed frame per size, BMP up to 128, PNG at 256
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = sizes.map((s) => {
  const png = shot(s, sized(s));
  return s >= 256 ? png : bmpFrame(png);
});
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
  head.writeUInt32LE(frames[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += frames[i].length;
});
fs.writeFileSync(path.join(root, 'native/AgentDesk.ico'), Buffer.concat([head, ...frames]));

// PNG icons for the app window (Edge/Chrome --app take the page's raster icon for the taskbar)
fs.mkdirSync(path.join(root, 'ui/public'), { recursive: true });
fs.writeFileSync(path.join(root, 'ui/public/icon-32.png'), shot(32, sized(32)));
fs.writeFileSync(path.join(root, 'ui/public/icon-192.png'), shot(192, sized(192)));
fs.writeFileSync(path.join(root, 'ui/public/icon-512.png'), shot(512, sized(512)));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ native/AgentDesk.png, native/AgentDesk.ico, ui/public/icon-*.png');
