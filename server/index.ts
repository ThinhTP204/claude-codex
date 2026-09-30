import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Agent, Pipeline, Role, RunConfig, ServerMessage } from '../shared/types.ts';
import { getCatalog, getHealth } from './catalog.ts';
import { consumeCodexReset, getUsage } from './usage.ts';
import { listSlash } from './commands.ts';
import { cancelPending, runNow, setAuto, startAutoContinue, userActed } from './autocontinue.ts';
import { detectCheckers, runChecks } from './diagnostics.ts';
import { createPath, deletePath, renamePath, revealPath } from './fileops.ts';
import { APP_ROOT, applyUpdate, checkUpdate, updateStatus } from './update.ts';
import { spawn } from 'node:child_process';
import { GitError, gitBranches, gitCheckout, gitCommit, gitDiffForMessage, gitDiscard, gitFetch, gitInfo, gitInit, gitLog, gitPull, gitPush, gitStage, gitUnstage } from './git.ts';
import { createTerm, killTerm, listTerms, resizeTerm, setTermBroadcast, writeTerm } from './terminals.ts';
import { startRun } from './runner.ts';
import {
  createConv,
  deleteConv,
  executeTurn,
  getConv,
  isRunning,
  anyRunning,
  listConvs,
  renameConv,
  setBroadcast,
  stopConv,
} from './conversations.ts';
import { approve, rerun, startPipeline, stopPipeline } from './pipeline.ts';
import { deletePipeline, getPipelines, getRoles, savePipeline, saveRoles, DEFAULT_ROLES } from './roles.ts';
import { browseDirs, clearStatusCache, projectRepos, resolveFileRef, safeJoin, forgetProject, setWorkspaceFolders, workspaceFolders, gitHead, gitStatus, listDir, openProject, pickFolder, readFile, recentProjects, watchProject, writeFile } from './projects.ts';
import { ATTACH_DIR, realpathSafe } from './store.ts';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** Changes whenever the UI is rebuilt: an open window reloads itself after an update. */
const buildId = () => {
  try {
    return String(Math.round(fs.statSync(path.join(DIST, 'index.html')).mtimeMs));
  } catch {
    return '';
  }
};

/** Only when started through a bin/agentdesk.js (repo, packaged app or updated copy) can we start ourselves again. */
const canRelaunch = () => {
  try {
    return path.basename(fs.realpathSync(process.argv[1] || '')) === 'agentdesk.js';
  } catch {
    return false;
  }
};
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface StartOptions {
  port: number;
  token?: string;
  /** exit when the last window closes */
  exitWhenIdle?: boolean;
  onReady?: (url: string) => void;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

const MAX_UPLOAD = 30 * 1024 * 1024;

/** Save a file dropped/pasted into the chat under ATTACH_DIR/<date>/ and return its absolute path. */
async function saveUpload(req: http.IncomingMessage, name: string): Promise<{ path: string; name: string; size: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_UPLOAD) throw new HttpError(413, 'File quá lớn (tối đa 30MB)');
    chunks.push(c as Buffer);
  }
  const clean = (path.basename(name || 'file').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(-120) || 'file').trim();
  const dir = path.join(ATTACH_DIR, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${crypto.randomBytes(3).toString('hex')}-${clean}`);
  fs.writeFileSync(file, Buffer.concat(chunks));
  return { path: file, name: clean, size };
}

async function body<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return (s ? JSON.parse(s) : {}) as T;
}

/** Draft a commit message from the current diff with the cheapest model of the chosen agent. */
async function suggestCommitMessage(root: string, agent: Agent): Promise<string> {
  const diff = await gitDiffForMessage(root);
  if (!diff.trim()) throw new HttpError(400, 'Không có thay đổi nào để viết message');
  const codexModels = getCatalog().codex;
  const cfg: RunConfig =
    agent === 'claude'
      ? { agent, model: 'haiku', effort: 'low', permission: 'read' }
      : agent === 'antigravity'
        ? { agent, model: '', effort: 'low', permission: 'read' }
      : { agent, model: codexModels.find((m) => m.id === 'gpt-5.5')?.id || codexModels[codexModels.length - 1]?.id || 'gpt-5.5', effort: 'low', permission: 'read' };
  const prompt =
    'Write a git commit message for the diff below. Conventional Commits style (feat/fix/refactor/docs/chore…), ' +
    'subject line under 72 chars, then an optional short bullet list body. Match the language of existing code comments (English is fine). ' +
    'Reply with ONLY the commit message, no code fences, no explanation.\n\n' +
    diff;
  const h = startRun(cfg, prompt, os.tmpdir(), undefined, { onSession() {}, onDelta() {}, onBlock() {} });
  const r = await h.promise;
  if (!r.ok) throw new HttpError(500, r.error || 'Không tạo được message');
  return r.finalText.replace(/^```\w*\n?|\n?```$/g, '').trim();
}

export function start(opts: StartOptions): Promise<http.Server> {
  const token = opts.token || crypto.randomBytes(24).toString('hex');
  let listenPort = opts.port;
  let v6server: http.Server | undefined;

  /** Start a fresh AgentDesk on the same port + token (open windows reconnect by themselves), then quit. */
  const relaunch = () => {
    // AgentDesk.app owns its server: exit with 75 and let the window start the (new) code again
    if (process.env.AGENTDESK_HOST === 'mac-app') {
      for (const c of clients) c.terminate();
      server.close();
      v6server?.close();
      setTimeout(() => process.exit(75), 200);
      return;
    }
    // the entry the user started (bundled launcher → picks the newest downloaded copy)
    const launcher = fs.realpathSync(process.argv[1]);
    const argv = process.argv.slice(2);
    const keep = argv.filter((a, i) => a !== '--no-open' && a !== '--port' && argv[i - 1] !== '--port');
    const child = spawn(process.execPath, [launcher, ...keep, '--no-open', '--port', String(listenPort)], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, AGENTDESK_TOKEN: token, AGENTDESK_RELAUNCH: '1' },
    });
    child.unref();
    for (const c of clients) c.terminate();
    server.close();
    v6server?.close();
    setTimeout(() => process.exit(0), 300);
  };
  const clients = new Set<WebSocket>();
  const unwatch = new Map<WebSocket, () => void>();
  let idleTimer: NodeJS.Timeout | undefined;

  const send = (msg: ServerMessage) => {
    const s = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === 1) c.send(s);
  };
  setBroadcast(send);
  startAutoContinue();
  setTermBroadcast(send);

  const allowedHost = (h?: string) => !!h && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);

  function authorized(req: http.IncomingMessage, url: URL): boolean {
    const t = req.headers['x-agentdesk-token'] || url.searchParams.get('token');
    return t === token && allowedHost(req.headers.host);
  }

  async function api(req: http.IncomingMessage, url: URL): Promise<unknown> {
    const m = req.method || 'GET';
    const p = url.pathname.replace(/^\/api/, '');
    const q = (k: string) => url.searchParams.get(k) || '';
    const project = () => {
      const r = q('project');
      if (!r || !fs.existsSync(r)) throw new HttpError(400, 'Thiếu hoặc sai project');
      return r;
    };
    const conv = (id: string) => {
      const c = getConv(decodeURIComponent(id), q('project') || undefined);
      if (!c) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện');
      return c;
    };
    let mm: RegExpExecArray | null;

    // ---- catalog / health ----
    if (m === 'GET' && p === '/catalog') return getCatalog();
    if (m === 'GET' && p === '/health') return getHealth(q('force') === '1');
    if (m === 'POST' && p === '/health/test') {
      const cfg = await body<RunConfig>(req);
      const h = startRun({ ...cfg, permission: 'read', useMcp: false }, 'Reply with just: pong', process.env.HOME || '/', undefined, {
        onSession() {},
        onDelta() {},
        onBlock() {},
      });
      const r = await h.promise;
      return { ok: r.ok && /pong/i.test(r.finalText), text: r.finalText, error: r.error, durationMs: r.durationMs, usage: r.usage };
    }

    // ---- source control ----
    if (p.startsWith('/git/') && p !== '/git/status') {
      const root = project();
      const b = m === 'POST' ? await body<any>(req) : {};
      const done = async (out?: unknown) => {
        clearStatusCache();
        return { ok: true, out, info: await gitInfo(root) };
      };
      try {
        switch (`${m} ${p}`) {
          case 'GET /git/info':
            return gitInfo(root);
          case 'GET /git/branches':
            return gitBranches(root);
          case 'GET /git/log':
            return gitLog(root, Number(q('limit')) || 30);
          case 'POST /git/init':
            return done(await gitInit(root));
          case 'POST /git/checkout':
            return done(await gitCheckout(root, b));
          case 'POST /git/stage':
            return done(await gitStage(root, b.paths || []));
          case 'POST /git/unstage':
            return done(await gitUnstage(root, b.paths || []));
          case 'POST /git/discard':
            return done(await gitDiscard(root, b.paths || []));
          case 'POST /git/commit':
            return done(await gitCommit(root, b));
          case 'POST /git/push':
            return done(await gitPush(root));
          case 'POST /git/pull':
            return done(await gitPull(root));
          case 'POST /git/fetch':
            return done(await gitFetch(root));
          case 'POST /git/suggest-message':
            return { message: await suggestCommitMessage(root, b.agent === 'codex' || b.agent === 'antigravity' ? b.agent : 'claude') };
        }
      } catch (e) {
        throw new HttpError(e instanceof GitError ? 400 : 500, (e as Error).message);
      }
    }

    // ---- terminals (keystrokes and resizes go over the websocket) ----
    if (m === 'GET' && p === '/terms') return listTerms(project());
    if (m === 'POST' && p === '/terms') {
      const b = await body<{ cols: number; rows: number }>(req);
      return createTerm(project(), b.cols, b.rows);
    }
    if (m === 'DELETE' && (mm = /^\/terms\/([^/]+)$/.exec(p))) {
      killTerm(mm[1]);
      return { ok: true };
    }

    // ---- usage limits ----
    if (m === 'GET' && p === '/usage') return getUsage(q('force') === '1');
    if (m === 'POST' && p === '/usage/codex/reset') return consumeCodexReset((await body<{ creditId?: string }>(req)).creditId);

    // ---- roles / pipelines ----
    if (m === 'GET' && p === '/roles') return getRoles();
    if (m === 'PUT' && p === '/roles') {
      saveRoles(await body<Role[]>(req));
      return getRoles();
    }
    if (m === 'GET' && p === '/roles/defaults') return DEFAULT_ROLES;
    if (m === 'POST' && p === '/roles/reset') {
      saveRoles(DEFAULT_ROLES);
      return getRoles();
    }
    if (m === 'GET' && p === '/pipelines') return getPipelines();
    if (m === 'PUT' && p === '/pipelines') return savePipeline(await body<Pipeline>(req));
    if (m === 'DELETE' && (mm = /^\/pipelines\/(.+)$/.exec(p))) return deletePipeline(decodeURIComponent(mm[1]));

    // ---- projects & files ----
    if (m === 'GET' && p === '/projects') return recentProjects();
    if (m === 'POST' && p === '/projects/pick') {
      const picked = await pickFolder();
      // ?open=0: just choose a folder (e.g. to add to the workspace), don't make it the project
      const chosen = picked.path ? (q('open') === '0' ? realpathSafe(picked.path) : openProject(picked.path)) : null;
      return { path: chosen, error: picked.error };
    }
    if (m === 'POST' && p === '/upload') return saveUpload(req, q('name') || 'file');
    if (m === 'GET' && p === '/commands') return listSlash(project(), q('agent') || 'claude');
    if (m === 'GET' && p === '/workspace') return workspaceFolders(project());
    if (m === 'PUT' && p === '/workspace') return setWorkspaceFolders(project(), (await body<{ folders: string[] }>(req)).folders || []);
    if (m === 'GET' && p === '/browse') return browseDirs(q('dir') || undefined, q('hidden') === '1');
    if (m === 'GET' && p === '/env') return { platform: process.platform, home: os.homedir(), sep: path.sep, build: buildId() };
    // ---- self-update (git installs) ----
    if (m === 'GET' && p === '/update/check') return { ...(await checkUpdate(q('force') === '1')), canRestart: canRelaunch(), busy: anyRunning() };
    if (m === 'GET' && p === '/update/status') return updateStatus();
    if (m === 'POST' && p === '/update/download') {
      // packaged app: open the release page in the default browser
      const u = (await checkUpdate()).downloadUrl;
      if (!u) throw new HttpError(400, 'Không có bản mới để tải');
      const [cmd, args] = process.platform === 'darwin' ? ['open', [u]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', u]] : ['xdg-open', [u]];
      spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return { ok: true };
    }
    if (m === 'POST' && p === '/update/apply') {
      if (anyRunning()) throw new HttpError(409, 'Đang có agent chạy. Đợi chạy xong (hoặc bấm dừng) rồi cập nhật.');
      await applyUpdate(canRelaunch() ? relaunch : () => undefined);
      return { ok: true };
    }
    if (m === 'POST' && p === '/projects/forget') return forgetProject((await body<{ path: string }>(req)).path);
    if (m === 'POST' && p === '/projects/open') return { path: openProject((await body<{ path: string }>(req)).path) };
    if (m === 'GET' && p === '/fs/list') return listDir(project(), q('dir'));
    if (m === 'GET' && p === '/fs/resolve') return resolveFileRef(project(), q('ref'));
    if (m === 'GET' && p === '/fs/read') {
      const f = readFile(project(), q('path'));
      return { ...f, head: q('head') === '1' ? await gitHead(project(), q('path')) : undefined };
    }
    if (m === 'PUT' && p === '/fs/write') {
      const b = await body<{ path: string; content: string }>(req);
      writeFile(project(), b.path, b.content);
      return { ok: true };
    }
    if (m === 'POST' && p === '/fs/delete') return deletePath(project(), (await body<{ path: string }>(req)).path).then(() => ({ ok: true }));
    if (m === 'POST' && p === '/fs/rename') {
      const b = await body<{ from: string; to: string }>(req);
      renamePath(project(), b.from, b.to);
      return { ok: true };
    }
    if (m === 'POST' && p === '/fs/create') {
      const b = await body<{ path: string; dir?: boolean }>(req);
      createPath(project(), b.path, !!b.dir);
      return { ok: true };
    }
    if (m === 'POST' && p === '/fs/reveal') return revealPath(project(), (await body<{ path: string }>(req)).path).then(() => ({ ok: true }));
    if (m === 'GET' && p === '/checks') return detectCheckers(project());
    if (m === 'POST' && p === '/checks/run') return runChecks(project(), (await body<{ files?: string[] }>(req)).files);
    if (m === 'GET' && p === '/git/status') return gitStatus(project());
    if (m === 'GET' && p === '/git/repos') return projectRepos(project());

    // ---- conversations ----
    if (m === 'GET' && p === '/conversations') return listConvs(project());
    if (m === 'POST' && p === '/conversations') return createConv(project());
    if ((mm = /^\/conversations\/([^/]+)$/.exec(p))) {
      if (m === 'GET') return conv(mm[1]);
      if (m === 'PATCH') return renameConv(conv(mm[1]).id, (await body<{ title: string }>(req)).title);
      if (m === 'DELETE') {
        deleteConv(conv(mm[1]).id);
        return { ok: true };
      }
    }
    // ---- auto-continue ("Tự tiếp tục") ----
    if ((mm = /^\/conversations\/([^/]+)\/auto(?:\/(run-now|cancel))?$/.exec(p))) {
      const c = conv(mm[1]);
      if (m === 'PUT' && !mm[2]) return setAuto(c, await body(req));
      if (m === 'POST' && mm[2] === 'run-now') return runNow(c), { ok: true };
      if (m === 'POST' && mm[2] === 'cancel') return cancelPending(c), { ok: true };
    }
    if (m === 'POST' && (mm = /^\/conversations\/([^/]+)\/(send|stop|run|approve|rerun|run-stop)$/.exec(p))) {
      const c = conv(mm[1]);
      const b = await body<any>(req);
      switch (mm[2]) {
        case 'send':
          if (isRunning(c.id) || c.run?.status === 'running') throw new HttpError(409, 'Đang có tác vụ chạy, hãy đợi hoặc bấm dừng.');
          userActed(c);
          void executeTurn(c, { prompt: b.text, config: b.config, roleName: b.roleName, roleIcon: b.roleIcon }).catch((e) => console.error(e));
          return { ok: true, id: c.id };
        case 'stop':
          userActed(c);
          if (c.run?.status === 'running') stopPipeline(c);
          else stopConv(c.id);
          return { ok: true };
        case 'run':
          startPipeline(c, b.pipeline as Pipeline, String(b.task || ''));
          return { ok: true };
        case 'approve':
          approve(c, b);
          return { ok: true };
        case 'rerun':
          rerun(c, b);
          return { ok: true };
        case 'run-stop':
          stopPipeline(c);
          return { ok: true };
      }
    }
    throw new HttpError(404, `Không có API ${m} ${p}`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!allowedHost(req.headers.host)) {
      res.writeHead(403).end('Forbidden host');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req, url)) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Sai token. Hãy mở app bằng lệnh agentdesk.' }));
        return;
      }
      // raw bytes for <img>/<embed>: chat attachments, or a file inside an open project (image preview)
      if (url.pathname === '/api/attachment' || url.pathname === '/api/fs/raw') {
        let f = '';
        try {
          if (url.pathname === '/api/attachment') {
            f = path.resolve(url.searchParams.get('path') || '');
            if (!f.startsWith(ATTACH_DIR + path.sep)) f = '';
          } else {
            const root = url.searchParams.get('project') || '';
            if (root && fs.existsSync(root)) f = safeJoin(root, url.searchParams.get('path') || '');
          }
        } catch {
          f = '';
        }
        if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
        fs.createReadStream(f).pipe(res);
        return;
      }
      try {
        const data = await api(req, url);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data ?? null));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }
    // static UI
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(500).end('Chưa build UI. Chạy: npm run build');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'max-age=31536000, immutable',
    });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const origin = req.headers.origin || '';
    const originOk = !origin || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
    if (url.pathname !== '/ws' || !authorized(req, url) || !originOk) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    clearTimeout(idleTimer);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'term:input') return writeTerm(msg.id, String(msg.data));
        if (msg.type === 'term:resize') return resizeTerm(msg.id, Number(msg.cols), Number(msg.rows));
        if (msg.type === 'watch') {
          // one window watches its project plus any extra workspace folders
          const roots = (Array.isArray(msg.projects) ? msg.projects : [msg.project]).filter((r: unknown): r is string => typeof r === 'string' && fs.existsSync(r));
          unwatch.get(ws)?.();
          const offs = roots.map((root: string) => watchProject(root, (paths) => send({ type: 'fs', root, paths })));
          unwatch.set(ws, () => offs.forEach((off: () => void) => off()));
        }
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      unwatch.get(ws)?.();
      unwatch.delete(ws);
      if (opts.exitWhenIdle && clients.size === 0) {
        // allow a reload / reconnect before quitting
        idleTimer = setTimeout(() => {
          if (clients.size === 0) {
            console.log('Cửa sổ đã đóng, tắt AgentDesk.');
            process.exit(0);
          }
        }, 8000);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      listenPort = port;
      // `localhost` may resolve to IPv6 first: answer there too (loopback only, never the network)
      const v6 = http.createServer((req, res) => server.emit('request', req, res));
      v6server = v6;
      v6.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
      const ready = (host: string) => {
        opts.onReady?.(`http://${host}:${port}/?token=${token}`);
        resolve(server);
      };
      // Serve the UI on "localhost" so the Preview tab (a localhost dev server) is same-site:
      // otherwise WebKit treats it as third-party and drops its cookies (login loops, blank pages).
      v6.once('listening', () => ready('localhost'));
      v6.once('error', (e: NodeJS.ErrnoException) => {
        // no IPv6 loopback: localhost falls back to 127.0.0.1, fine.
        // [::1]:port taken by another app: "localhost" could reach it, so stay on 127.0.0.1.
        ready(e.code === 'EADDRINUSE' ? '127.0.0.1' : 'localhost');
      });
      v6.listen(port, '::1');
    });
  });
}

export type { Agent };
