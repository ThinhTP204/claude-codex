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
import { createTerm, killTerm, listTerms, resizeTerm, setTermBroadcast, writeTerm } from './terminals.ts';
import { startRun } from './runner.ts';
import {
  createConv,
  deleteConv,
  executeTurn,
  getConv,
  isRunning,
  listConvs,
  renameConv,
  setBroadcast,
  stopConv,
} from './conversations.ts';
import { approve, rerun, startPipeline, stopPipeline } from './pipeline.ts';
import { deletePipeline, getPipelines, getRoles, savePipeline, saveRoles, DEFAULT_ROLES } from './roles.ts';
import { browseDirs, forgetProject, gitHead, gitStatus, listDir, openProject, pickFolder, readFile, recentProjects, watchProject, writeFile } from './projects.ts';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

async function body<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return (s ? JSON.parse(s) : {}) as T;
}

export function start(opts: StartOptions): Promise<http.Server> {
  const token = opts.token || crypto.randomBytes(24).toString('hex');
  const clients = new Set<WebSocket>();
  const unwatch = new Map<WebSocket, () => void>();
  let idleTimer: NodeJS.Timeout | undefined;

  const send = (msg: ServerMessage) => {
    const s = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === 1) c.send(s);
  };
  setBroadcast(send);
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
      return { path: picked.path ? openProject(picked.path) : null, error: picked.error };
    }
    if (m === 'GET' && p === '/browse') return browseDirs(q('dir') || undefined, q('hidden') === '1');
    if (m === 'GET' && p === '/env') return { platform: process.platform, home: os.homedir(), sep: path.sep };
    if (m === 'POST' && p === '/projects/forget') return forgetProject((await body<{ path: string }>(req)).path);
    if (m === 'POST' && p === '/projects/open') return { path: openProject((await body<{ path: string }>(req)).path) };
    if (m === 'GET' && p === '/fs/list') return listDir(project(), q('dir'));
    if (m === 'GET' && p === '/fs/read') {
      const f = readFile(project(), q('path'));
      return { ...f, head: q('head') === '1' ? await gitHead(project(), q('path')) : undefined };
    }
    if (m === 'PUT' && p === '/fs/write') {
      const b = await body<{ path: string; content: string }>(req);
      writeFile(project(), b.path, b.content);
      return { ok: true };
    }
    if (m === 'GET' && p === '/git/status') return gitStatus(project());

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
    if (m === 'POST' && (mm = /^\/conversations\/([^/]+)\/(send|stop|run|approve|rerun|run-stop)$/.exec(p))) {
      const c = conv(mm[1]);
      const b = await body<any>(req);
      switch (mm[2]) {
        case 'send':
          if (isRunning(c.id) || c.run?.status === 'running') throw new HttpError(409, 'Đang có tác vụ chạy, hãy đợi hoặc bấm dừng.');
          void executeTurn(c, { prompt: b.text, config: b.config, roleName: b.roleName, roleIcon: b.roleIcon }).catch((e) => console.error(e));
          return { ok: true, id: c.id };
        case 'stop':
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
        if (msg.type === 'watch' && typeof msg.project === 'string' && fs.existsSync(msg.project)) {
          unwatch.get(ws)?.();
          unwatch.set(
            ws,
            watchProject(msg.project, (paths) => send({ type: 'fs', root: msg.project, paths })),
          );
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
      // `localhost` may resolve to IPv6 first: answer there too (loopback only, never the network)
      const v6 = http.createServer((req, res) => server.emit('request', req, res));
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
