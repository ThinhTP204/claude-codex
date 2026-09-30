#!/usr/bin/env node
// AgentDesk launcher: `agentdesk [project-dir] [--port N] [--no-open] [--keep]`
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 23 || (major === 23 && minor < 6)) {
  console.error(`AgentDesk cần Node >= 23.6 (đang dùng ${process.versions.node}).`);
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Packaged app: the in-app updater drops newer app code in ~/.agentdesk/app/<version>/ (the
// installed .app / .exe stays untouched). Run that copy when it is newer than the bundled one.
if (process.env.AGENTDESK_PACKAGED === '1' && !process.env.AGENTDESK_PAYLOAD) {
  const home = process.env.AGENTDESK_HOME || path.join(os.homedir(), '.agentdesk');
  const version = (dir) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  };
  const newer = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  let payload;
  try {
    payload = path.join(home, 'app', fs.readFileSync(path.join(home, 'app', 'current'), 'utf8').trim());
  } catch {
    /* never updated */
  }
  if (payload && fs.existsSync(path.join(payload, 'bin', 'agentdesk.js')) && newer(version(payload), version(ROOT))) {
    process.env.AGENTDESK_PAYLOAD = payload;
    await import(pathToFileURL(path.join(payload, 'bin', 'agentdesk.js')).href);
    await new Promise(() => {}); // that copy runs the app; don't start a second one below
  }
}

// Opened from Finder / the Dock (packaged AgentDesk.app): macOS hands GUI apps a bare PATH, so
// claude / codex / git installed with Homebrew, nvm, npm -g… would not be found. Borrow the PATH
// the user's login shell builds, plus the usual install locations.
if (process.env.AGENTDESK_PACKAGED === '1' && process.platform !== 'win32') {
  const home = os.homedir();
  const shell = process.env.SHELL || '/bin/zsh';
  const r = spawnSync(shell, ['-ilc', 'printf "__AGENTDESK_PATH__%s__AGENTDESK_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 8000 });
  const fromShell = /__AGENTDESK_PATH__(.*?)__AGENTDESK_PATH__/.exec(r.stdout || '')?.[1] || '';
  const usual = ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`, `${home}/.npm-global/bin`, `${home}/.bun/bin`, `${home}/.volta/bin`, `${home}/.cargo/bin`];
  process.env.PATH = [...new Set([...fromShell.split(':'), ...(process.env.PATH || '').split(':'), ...usual])].filter(Boolean).join(':');
}
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
  // npx is npx.cmd on Windows, which needs a shell
  const r = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
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

/** Start a detached process; a missing program must never crash AgentDesk. */
function launch(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: false });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

const firstExisting = (paths) => paths.find((p) => p && fs.existsSync(p));

/** Chromium-based browsers that support --app (a window without tabs / address bar) */
function appBrowsers() {
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Vivaldi', 'Arc']
      .filter((app) => fs.existsSync(`/Applications/${app}.app`) || fs.existsSync(path.join(os.homedir(), 'Applications', `${app}.app`)))
      .map((app) => ({ name: app, cmd: 'open', pre: ['-na', app, '--args'] }));
  }
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [
      { name: 'Microsoft Edge', paths: [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`] },
      { name: 'Google Chrome', paths: [`${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${local}\\Google\\Chrome\\Application\\chrome.exe`] },
      { name: 'Brave', paths: [`${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${local}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`] },
    ];
    return candidates.map((c) => ({ name: c.name, cmd: firstExisting(c.paths), pre: [] })).filter((c) => c.cmd);
  }
  return ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
    .filter((bin) => spawnSync('which', [bin]).status === 0)
    .map((bin) => ({ name: bin, cmd: bin, pre: [] }));
}

async function openBrowserWindow(url) {
  const profile = path.join(DATA, 'chrome-profile');
  for (const b of appBrowsers()) {
    const ok = await launch(b.cmd, [...b.pre, `--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1500,940', '--no-first-run', '--no-default-browser-check']);
    if (ok) return b.name;
  }
  // last resort: the default browser, as a normal tab (rundll32 avoids cmd.exe mangling "&" in the URL)
  const fallback =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  if (await launch(fallback[0], fallback[1])) return 'trình duyệt mặc định';
  return null;
}

const noOpen = flag('--no-open');
const native = !noOpen && !flag('--browser') ? nativeWindowBin() : null;

async function onReady(url) {
  const full = project ? `${url}&project=${encodeURIComponent(project)}` : url;
  if (noOpen) {
    console.log(`AgentDesk đang chạy: ${full}`);
  } else if (native) {
    const win = spawn(native, [full], { stdio: 'ignore' });
    win.on('error', () => console.log(`Không mở được cửa sổ native. Mở link này bằng trình duyệt:\n  ${full}`));
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
    const via = await openBrowserWindow(full);
    if (via) console.log(`AgentDesk đã mở (${via}). Đóng cửa sổ hoặc Ctrl+C để tắt.`);
    else console.log(`Không tự mở được cửa sổ. Mở link này bằng trình duyệt:\n  ${full}`);
  }
}

// A fixed port keeps the page origin stable, so layout/settings in localStorage survive restarts.
const wanted = Number(opt('--port') || 4545);
// Restarted by the in-app updater: the old window reconnects to us, and we quit once it is closed.
const relaunched = process.env.AGENTDESK_RELAUNCH === '1';
const common = {
  token: process.env.AGENTDESK_TOKEN,
  // AgentDesk.app normally stops us on quit; if the window dies without that, quit once nobody is connected
  exitWhenIdle: relaunched || process.env.AGENTDESK_HOST === 'mac-app' || (!native && !noOpen && !flag('--keep')),
  onReady,
};
for (let attempt = 0; ; attempt++) {
  try {
    await start({ ...common, port: wanted });
    break;
  } catch (e) {
    // the previous instance is still letting go of the port
    if (e.code === 'EADDRINUSE' && relaunched && attempt < 40) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    if (e.code !== 'EADDRINUSE' || opt('--port')) throw e;
    await start({ ...common, port: 0 });
    break;
  }
}
