import { useSyncExternalStore } from 'react';
import type { Block, Catalog, Conversation, ConversationSummary, Health, Pipeline, Role, RunConfig, ServerMessage, TermInfo, UsageReport } from '../../shared/types.ts';
import { disposeTerm, ensureTerm, setLinkHandler, writeTerm } from './terminals.ts';
import { api, connectWs, qs, TOKEN, URL_PROJECT, wsSend } from './api.ts';

export type Tab =
  | { id: string; kind: 'chat' }
  | { id: string; kind: 'flow' }
  | { id: string; kind: 'preview'; url: string }
  | { id: string; kind: 'file'; path: string };

export interface State {
  project?: string;
  recent: string[];
  catalog?: Catalog;
  health?: Health;
  roles: Role[];
  pipelines: Pipeline[];
  convList: ConversationSummary[];
  convId?: string;
  conv?: Conversation;
  /** streaming text not yet committed as a block, keyed by turn id */
  drafts: Record<string, string>;
  tabs: Tab[];
  activeTab: string;
  composer: RunConfig;
  roleId?: string;
  git: { branch?: string; files: Record<string, string> };
  /** bumps whenever files change on disk */
  fsVersion: number;
  /** paths touched recently (highlighted in the explorer) */
  touched: Record<string, number>;
  toast?: { text: string; kind: 'error' | 'info' };
  showRoles: boolean;
  noToken: boolean;
  convLoading: boolean;
  usage?: UsageReport;
  usageLoading: boolean;
  /** bottom Terminal panel */
  termOpen: boolean;
  terms: TermInfo[];
  activeTerm?: string;
  /** local URL printed in a terminal (dev server), offered as a Preview */
  devUrl?: string;
  /** text pushed into the chat composer ("send to agent") */
  composerInsert?: { text: string; n: number };
}

const LS = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`agentdesk:${k}`);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`agentdesk:${k}`, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};
export { LS };

let state: State = {
  recent: [],
  roles: [],
  pipelines: [],
  convList: [],
  drafts: {},
  tabs: [
    { id: 'chat', kind: 'chat' },
    { id: 'flow', kind: 'flow' },
  ],
  activeTab: 'chat',
  composer: LS.get<RunConfig>('composer', { agent: 'claude', model: 'sonnet', effort: 'medium', permission: 'write' }),
  roleId: LS.get<string | undefined>('roleId', undefined),
  git: { files: {} },
  fsVersion: 0,
  touched: {},
  showRoles: false,
  noToken: !TOKEN,
  convLoading: false,
  usageLoading: false,
  termOpen: LS.get('termOpen', false),
  terms: [],
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'error' | 'info' = 'error'): void {
  setState({ toast: { text, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: undefined }), 5000);
}

export async function safe<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    toast((e as Error).message);
    return undefined;
  }
}

// ---------------- actions ----------------

export async function refreshList(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const list = await safe(api<ConversationSummary[]>('GET', `/conversations${qs({ project })}`));
  if (list && project === state.project) setState({ convList: list });
}

export async function refreshGit(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const g = await api<State['git']>('GET', `/git/status${qs({ project })}`).catch(() => ({ files: {} }));
  if (project === state.project) setState({ git: g });
}

export async function openProject(path: string): Promise<void> {
  const r = await safe(api<{ path: string }>('POST', '/projects/open', { path }));
  if (!r) return;
  LS.set('project', r.path);
  setState((s) => ({
    project: r.path,
    recent: [r.path, ...s.recent.filter((x) => x !== r.path)],
    convId: undefined,
    conv: undefined,
    convList: [],
    tabs: s.tabs.filter((t) => t.kind !== 'file' && t.kind !== 'preview'),
    terms: [],
    activeTerm: undefined,
    devUrl: undefined,
    activeTab: 'chat',
    touched: {},
  }));
  wsSend({ type: 'watch', project: r.path });
  void refreshList();
  void refreshGit();
  void loadTerms();
  const last = LS.get<string | undefined>(`conv:${r.path}`, undefined);
  if (last) void openConv(last);
}

export async function pickProject(): Promise<void> {
  const r = await safe(api<{ path: string | null }>('POST', '/projects/pick'));
  if (r?.path) await openProject(r.path);
}

export async function openConv(id: string): Promise<void> {
  const project = state.project;
  LS.set(`conv:${project}`, id);
  setState({ convId: id, convLoading: state.conv?.id !== id, activeTab: state.activeTab.startsWith('file:') ? 'chat' : state.activeTab });
  const c = await safe(api<Conversation>('GET', `/conversations/${encodeURIComponent(id)}${qs({ project })}`));
  if (state.convId === id) setState({ convLoading: false });
  if (c && state.convId === id) {
    setState({ conv: c, convId: c.id, drafts: {} });
    if (id !== c.id) void refreshList();
  }
}

/** Start a fresh chat. Nothing is created on disk until the first message is sent. */
export function newConv(): void {
  if (state.project) LS.set(`conv:${state.project}`, undefined);
  setState({ conv: undefined, convId: undefined, drafts: {}, activeTab: 'chat', convLoading: false });
}

/** conversation to send into: the open one, or a fresh one */
export async function ensureConv(): Promise<Conversation | undefined> {
  if (state.conv) return state.conv;
  if (!state.project) return;
  const c = await safe(api<Conversation>('POST', `/conversations${qs({ project: state.project })}`));
  if (c) {
    LS.set(`conv:${state.project}`, c.id);
    setState({ conv: c, convId: c.id, drafts: {} });
  }
  return c;
}

export function setComposer(cfg: RunConfig, roleId?: string): void {
  LS.set('composer', cfg);
  LS.set('roleId', roleId);
  setState({ composer: cfg, roleId });
}

export async function sendMessage(text: string): Promise<boolean> {
  const c = await ensureConv();
  if (!c) return false;
  const role = state.roles.find((r) => r.id === state.roleId);
  const ok = await safe(
    api('POST', `/conversations/${encodeURIComponent(c.id)}/send${qs({ project: state.project })}`, {
      text,
      config: state.composer,
      roleName: role?.name,
      roleIcon: role?.icon,
    }),
  );
  return !!ok;
}

export const convAction = (action: string, body: unknown = {}) =>
  state.conv ? safe(api('POST', `/conversations/${encodeURIComponent(state.conv.id)}/${action}${qs({ project: state.project })}`, body)) : Promise.resolve(undefined);

export async function saveRoles(roles: Role[]): Promise<void> {
  const r = await safe(api<Role[]>('PUT', '/roles', roles));
  if (r) setState({ roles: r });
}

export async function savePipeline(p: Pipeline): Promise<void> {
  const r = await safe(api<Pipeline[]>('PUT', '/pipelines', p));
  if (r) {
    setState({ pipelines: r });
    toast('Đã lưu pipeline', 'info');
  }
}

export async function deletePipeline(id: string): Promise<void> {
  const r = await safe(api<Pipeline[]>('DELETE', `/pipelines/${encodeURIComponent(id)}`));
  if (r) setState({ pipelines: r });
}

export async function refreshHealth(force = false): Promise<void> {
  const h = await api<Health>('GET', `/health${force ? '?force=1' : ''}`).catch(() => undefined);
  if (h) setState({ health: h });
}

// ---------------- terminal panel ----------------

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})(?:\/[^\s'"`)\]]*)?/i;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const tails: Record<string, string> = {};

/** Spot "Local: http://localhost:5173" style lines and offer a Preview. */
function detectUrl(id: string, data: string) {
  tails[id] = ((tails[id] || '') + data).slice(-2000);
  const m = URL_RE.exec(tails[id].replace(ANSI_RE, ''));
  if (!m) return;
  const url = m[0].replace(/\/\/(0\.0\.0\.0|127\.0\.0\.1|\[::1?\])/, '//localhost').replace(/[.,;:]+$/, '');
  tails[id] = '';
  if (url !== state.devUrl) {
    setState({ devUrl: url });
    ensurePreview(url, false);
  }
}

async function loadTerms(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const list = await api<(TermInfo & { buffer: string })[]>('GET', `/terms${qs({ project })}`).catch(() => []);
  if (project !== state.project) return;
  for (const t of list) ensureTerm(t.id, t.buffer, t.pty);
  setState({ terms: list.map(({ buffer: _b, ...t }) => t), activeTerm: list[list.length - 1]?.id });
}

export async function newTerm(): Promise<void> {
  if (!state.project) return;
  const t = await safe(api<TermInfo>('POST', `/terms${qs({ project: state.project })}`, { cols: 100, rows: 24 }));
  if (!t) return;
  ensureTerm(t.id, '', t.pty);
  setState((s) => ({ terms: [...s.terms, t], activeTerm: t.id, termOpen: true }));
  LS.set('termOpen', true);
}

export async function closeTerm(id: string): Promise<void> {
  await safe(api('DELETE', `/terms/${id}`));
}

export function toggleTermPanel(open = !state.termOpen): void {
  LS.set('termOpen', open);
  setState({ termOpen: open });
  if (open && !state.terms.length) void newTerm();
}

/** Add (or retarget) the Preview tab for a dev-server URL. */
export function ensurePreview(url: string, focus: boolean): void {
  setState((s) => {
    const has = s.tabs.some((t) => t.kind === 'preview');
    const tabs = has
      ? s.tabs.map((t) => (t.kind === 'preview' ? { ...t, url } : t))
      : [...s.tabs.slice(0, 2), { id: 'preview', kind: 'preview' as const, url }, ...s.tabs.slice(2)];
    return { tabs, activeTab: focus ? 'preview' : s.activeTab };
  });
}

// localhost links clicked inside the terminal open in the Preview tab
setLinkHandler((url) => (URL_RE.test(url) ? ensurePreview(url.replace(/\/\/(0\.0\.0\.0|127\.0\.0\.1|\[::1?\])/, '//localhost'), true) : window.open(url, '_blank')));

/** Put text into the chat composer and switch to the chat tab. */
export function insertIntoComposer(text: string): void {
  setState((s) => ({ composerInsert: { text, n: (s.composerInsert?.n || 0) + 1 }, activeTab: 'chat' }));
}

export async function refreshUsage(force = false): Promise<void> {
  setState({ usageLoading: true });
  const u = await api<UsageReport>('GET', `/usage${force ? '?force=1' : ''}`).catch(() => undefined);
  setState({ usageLoading: false, ...(u ? { usage: u } : {}) });
}

const RESET_OUTCOME: Record<string, string> = {
  reset: 'Đã reset giới hạn Codex (5 giờ + tuần).',
  nothingToReset: 'Không có gì để reset nên lượt reset không bị dùng.',
  noCredit: 'Không còn lượt reset nào.',
  alreadyRedeemed: 'Lượt reset này đã được dùng trước đó.',
};

export async function consumeCodexReset(creditId: string): Promise<void> {
  const r = await safe(api<{ outcome: string; codex: UsageReport['codex'] }>('POST', '/usage/codex/reset', { creditId }));
  if (!r) return;
  setState((s) => ({ usage: s.usage ? { ...s.usage, codex: r.codex } : s.usage }));
  toast(RESET_OUTCOME[r.outcome] || `Kết quả: ${r.outcome}`, r.outcome === 'reset' ? 'info' : 'error');
}

export function openFile(path: string): void {
  const id = `file:${path}`;
  setState((s) => ({
    tabs: s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, { id, kind: 'file', path }],
    activeTab: id,
  }));
}

export function closeTab(id: string): void {
  setState((s) => {
    const i = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    const activeTab = s.activeTab === id ? (tabs[i - 1] ?? tabs[0]).id : s.activeTab;
    return { tabs, activeTab };
  });
}

// ---------------- live updates ----------------

function upsert(blocks: Block[], b: Block): Block[] {
  const i = blocks.findIndex((x) => x.id === b.id);
  if (i < 0) return [...blocks, b];
  const next = blocks.slice();
  next[i] = b;
  return next;
}

let listTimer: ReturnType<typeof setTimeout> | undefined;
const runningConvs = new Set<string>();
let usageTimer: ReturnType<typeof setTimeout> | undefined;

/** Usage numbers move after every run: refresh once a conversation stops working. */
function trackRunning(c: Conversation): void {
  const busy = c.turns.some((t) => t.status === 'running') || c.run?.status === 'running';
  if (busy) runningConvs.add(c.id);
  else if (runningConvs.delete(c.id)) {
    clearTimeout(usageTimer);
    usageTimer = setTimeout(() => void refreshUsage(true), 3000);
  }
}
let gitTimer: ReturnType<typeof setTimeout> | undefined;

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'term:data':
      writeTerm(msg.id, msg.data);
      detectUrl(msg.id, msg.data);
      break;
    case 'term:exit':
      setState((s) => ({ terms: s.terms.map((t) => (t.id === msg.id ? { ...t, alive: false, exitCode: msg.code } : t)) }));
      break;
    case 'term:closed': {
      disposeTerm(msg.id);
      const terms = state.terms.filter((t) => t.id !== msg.id);
      setState({ terms, activeTerm: state.activeTerm === msg.id ? terms[terms.length - 1]?.id : state.activeTerm });
      break;
    }
    case 'conv':
      trackRunning(msg.conv);
      if (msg.conv.id === state.convId) {
        const drafts = { ...state.drafts };
        for (const t of msg.conv.turns) if (t.status !== 'running') delete drafts[t.id];
        setState({ conv: msg.conv, drafts });
      }
      break;
    case 'list':
      if (msg.projectPath === state.project) {
        clearTimeout(listTimer);
        listTimer = setTimeout(refreshList, 250);
      }
      break;
    case 'turn': {
      const c = state.conv;
      if (!c || c.id !== msg.convId) break;
      if (msg.ev.t === 'delta') {
        const text = msg.ev.text;
        setState((s) => ({ drafts: { ...s.drafts, [msg.turnId]: (s.drafts[msg.turnId] || '') + text } }));
      } else {
        const b = msg.ev.block;
        const turns = c.turns.map((t) => (t.id === msg.turnId ? { ...t, blocks: upsert(t.blocks, b) } : t));
        const drafts = { ...state.drafts };
        if (b.type === 'text' || b.type === 'tool') delete drafts[msg.turnId];
        setState({ conv: { ...c, turns }, drafts });
      }
      break;
    }
    case 'fs':
      if (msg.root === state.project) {
        const now = Date.now();
        const touched = { ...state.touched };
        for (const p of msg.paths) touched[p] = now;
        setState((s) => ({ fsVersion: s.fsVersion + 1, touched }));
        clearTimeout(gitTimer);
        gitTimer = setTimeout(refreshGit, 400);
      }
      break;
  }
}

export function boot(): void {
  if (!TOKEN) return;
  connectWs(onMessage, () => {
    if (state.project) wsSend({ type: 'watch', project: state.project });
    if (state.convId) void openConv(state.convId);
    void refreshList();
  });
  void (async () => {
    const [catalog, roles, pipelines, recent] = await Promise.all([
      safe(api<Catalog>('GET', '/catalog')),
      safe(api<Role[]>('GET', '/roles')),
      safe(api<Pipeline[]>('GET', '/pipelines')),
      safe(api<string[]>('GET', '/projects')),
    ]);
    setState({ catalog, roles: roles || [], pipelines: pipelines || [], recent: recent || [] });
    const start = URL_PROJECT || LS.get<string | undefined>('project', undefined) || recent?.[0];
    if (start) await openProject(start);
    void refreshHealth();
    void refreshUsage();
    setInterval(() => void refreshUsage(true), 5 * 60_000);
  })();
}
