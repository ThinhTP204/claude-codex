#!/usr/bin/env node
// AgentDesk launcher: `agentdesk [project-dir] [--port N] [--no-open] [--keep]`
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 23 || (major === 23 && minor < 6)) {
  console.error(`AgentDesk cần Node >= 23.6 (đang dùng ${process.versions.node}).`);
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--port'].includes(args[i - 1]));
const project = positional[0] ? path.resolve(positional[0]) : undefined;

if (flag('--help') || flag('-h')) {
  console.log(`Cách dùng: agentdesk [thư-mục-project] [--port 4545] [--no-open] [--browser] [--keep]

  --no-open   không tự mở cửa sổ, chỉ in URL
  --browser   mở bằng Chrome/Edge (--app) thay vì cửa sổ native
  --keep      không tự tắt khi đóng cửa sổ trình duyệt`);
  process.exit(0);
}

// Build the UI on first run (or after `git pull`)
const dist = path.join(ROOT, 'dist', 'index.html');
if (!fs.existsSync(dist)) {
  console.log('Đang build giao diện lần đầu…');
  const r = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const { start } = await import('../server/index.ts');

const DATA = process.env.AGENTDESK_HOME || path.join(os.homedir(), '.agentdesk');

/** Compile the native WKWebView window once (and again whenever its source changes). */
function nativeWindowBin() {
  if (process.platform !== 'darwin') return null;
  const src = path.join(ROOT, 'native', 'AgentDeskWindow.swift');
  // the binary name is what macOS shows in the menu bar
  const bin = path.join(DATA, 'bin', 'AgentDesk');
  const fresh = fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(src).mtimeMs;
  if (fresh) return bin;
  if (spawnSync('which', ['swiftc']).status !== 0) return null;
  console.log('Đang dựng cửa sổ native (chỉ lần đầu)…');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const r = spawnSync('swiftc', ['-O', src, '-o', bin], { stdio: 'inherit' });
  return r.status === 0 ? bin : null;
}

function openBrowserWindow(url) {
  const profile = path.join(DATA, 'chrome-profile');
  const browsers = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Vivaldi', 'Arc'];
  if (process.platform === 'darwin') {
    for (const app of browsers) {
      if (!fs.existsSync(`/Applications/${app}.app`) && !fs.existsSync(path.join(os.homedir(), 'Applications', `${app}.app`))) continue;
      spawn('open', ['-na', app, '--args', `--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1500,940', '--no-first-run', '--no-default-browser-check'], {
        stdio: 'ignore',
        detached: true,
      }).unref();
      return app;
    }
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return 'trình duyệt mặc định';
  }
  for (const bin of ['google-chrome', 'chromium', 'microsoft-edge']) {
    if (spawnSync('which', [bin]).status === 0) {
      spawn(bin, [`--app=${url}`, `--user-data-dir=${profile}`], { stdio: 'ignore', detached: true }).unref();
      return bin;
    }
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  return 'trình duyệt mặc định';
}

const noOpen = flag('--no-open');
const native = !noOpen && !flag('--browser') ? nativeWindowBin() : null;

function onReady(url) {
  const full = project ? `${url}&project=${encodeURIComponent(project)}` : url;
  if (noOpen) {
    console.log(`AgentDesk đang chạy: ${full}`);
  } else if (native) {
    const win = spawn(native, [full], { stdio: 'ignore' });
    const quit = () => {
      try {
        win.kill();
      } catch {}
      process.exit(0);
    };
    win.on('exit', () => process.exit(0)); // closing the window quits the app
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
    console.log('AgentDesk đã mở. Đóng cửa sổ hoặc Ctrl+C để tắt.');
  } else {
    const via = openBrowserWindow(full);
    console.log(`AgentDesk đã mở (${via}). Đóng cửa sổ hoặc Ctrl+C để tắt.`);
  }
}

// A fixed port keeps the page origin stable, so layout/settings in localStorage survive restarts.
const wanted = Number(opt('--port') || 4545);
const common = {
  token: process.env.AGENTDESK_TOKEN,
  exitWhenIdle: !native && !noOpen && !flag('--keep'),
  onReady,
};
try {
  await start({ ...common, port: wanted });
} catch (e) {
  if (e.code !== 'EADDRINUSE' || opt('--port')) throw e;
  await start({ ...common, port: 0 });
}
