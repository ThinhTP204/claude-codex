import { useSyncExternalStore } from 'react';
import type { CheckResult } from '../../shared/diagnostics.ts';
import type { Block, Catalog, Conversation, ConversationSummary, GitInfo, Health, Pipeline, Role, RunConfig, ServerMessage, TermInfo, UsageReport } from '../../shared/types.ts';
import { disposeTerm, ensureTerm, setLinkHandler, writeTerm } from './terminals.ts';
import { api, connectWs, qs, TOKEN, URL_PROJECT, wsSend } from './api.ts';

export type Tab =
  | { id: string; kind: 'chat' }
  | { id: string; kind: 'flow' }
  | { id: string; kind: 'preview'; url: string }
  /** root: a workspace folder other than the project (undefined = the project itself) */
  | { id: string; kind: 'file'; path: string; root?: string; diff?: boolean; line?: number; nonce?: number };

type GitStatus = { branch?: string; files: Record<string, string> };
export type RepoInfo = { path: string; rel: string; branch?: string; changes: number };

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
  git: GitStatus;
  /** extra folders in this project's workspace (VS Code multi-root) */
  folders: string[];
  /** git status of each extra folder */
  rootGit: Record<string, GitStatus>;
  /** git repos inside the project: itself (rel "") and/or nested ones, like VS Code finds them */
  repos: RepoInfo[];
  /** repo shown in Source Control (undefined = the project) */
  scmRoot?: string;
  /** what the in-app folder browser does with the chosen folder */
  folderBrowserMode: 'open' | 'add';
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
  /** Source Control panel */
  gitInfo?: GitInfo;
  /** why the Source Control repo could not be read (instead of spinning forever) */
  gitError?: string;
  gitBusy?: string;
  rightTab: 'files' | 'scm';
  /** in-app folder picker (default on Windows, fallback elsewhere) */
  showFolderBrowser: boolean;
  platform?: string;
  terms: TermInfo[];
  activeTerm?: string;
  /** local URL printed in a terminal (dev server), offered as a Preview */
  devUrl?: string;
  /** text pushed into the chat composer ("send to agent") */
  composerInsert?: { text: string; n: number };
  /** pipeline runs the user dismissed from the chat view */
  hiddenRuns: string[];
  /** "Problems": findings of the project's own checkers (tsc, eslint, biome, ruff) */
  problems?: CheckResult;
  checking: boolean;
  /** checkers detected per folder, known before anything runs */
  checkers: { dir: string; tools: string[] }[];
  /** what the bottom panel shows */
  bottomTab: 'terminal' | 'problems';
  /** newer AgentDesk on GitHub (git installs) */
  update?: UpdateInfo;
  showUpdate: boolean;
}

export interface UpdateInfo {
  supported: boolean;
  reason?: string;
  commit?: string;
  subject?: string;
  version?: string;
  date?: string;
  packaged?: boolean;
  downloadUrl?: string;
  payloadUrl?: string;
  latest?: string;
  behind: number;
  commits: { hash: string; subject: string; date: string }[];
  canRestart: boolean;
  busy: boolean;
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
  folders: [],
  rootGit: {},
  repos: [],
  folderBrowserMode: 'open',
  fsVersion: 0,
  touched: {},
  showRoles: false,
  noToken: !TOKEN,
  convLoading: false,
  usageLoading: false,
  termOpen: LS.get('termOpen', false),
  showFolderBrowser: false,
  hiddenRuns: LS.get<string[]>('hiddenRuns', []),
  rightTab: LS.get<'files' | 'scm'>('rightTab', 'files'),
  showUpdate: false,
  checking: false,
  checkers: [],
  bottomTab: LS.get<'terminal' | 'problems'>('bottomTab', 'terminal'),
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

/** Folder shown in Source Control. */
export const scmRootOf = (s: State): string | undefined => {
  if (s.scmRoot && (s.folders.includes(s.scmRoot) || s.repos.some((r) => r.path === s.scmRoot))) return s.scmRoot;
  // a parent folder that is not a repo itself: manage its first repo, like VS Code
  if (s.repos.length && !s.repos.some((r) => r.rel === '')) return s.repos[0].path;
  return s.project;
};

/** Key for per-file maps (touched…) that works across workspace folders. */
export const fileKey = (path: string, root?: string) => (root ? `${root}::${path}` : path);

export async function refreshGit(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const repos = await api<RepoInfo[]>('GET', `/git/repos${qs({ project })}`).catch(() => state.repos);
  if (project !== state.project) return;
  setState({ repos });
  const scm = scmRootOf(state)!;
  const status = (root: string) => api<GitStatus>('GET', `/git/status${qs({ project: root })}`).catch(() => ({ files: {} }));
  let gitError: string | undefined;
  const [g, info, ...extra] = await Promise.all([
    status(project),
    api<GitInfo>('GET', `/git/info${qs({ project: scm })}`).catch((e) => {
      gitError = (e as Error).message;
      return undefined;
    }),
    ...state.folders.map(status),
  ]);
  if (project !== state.project) return;
  const rootGit: Record<string, GitStatus> = {};
  state.folders.forEach((f, i) => (rootGit[f] = extra[i] || { files: {} }));
  setState({ git: g, rootGit, ...(scm === scmRootOf(state) ? { gitInfo: info, gitError } : {}) });
}

export function setScmRoot(root: string | undefined): void {
  setState({ scmRoot: root === state.project ? undefined : root, gitInfo: undefined });
  void refreshGit();
}

function watchAll(): void {
  if (state.project) wsSend({ type: 'watch', projects: [state.project, ...state.folders] });
}

async function loadWorkspace(project: string): Promise<void> {
  const folders = await api<string[]>('GET', `/workspace${qs({ project })}`).catch(() => []);
  if (project !== state.project) return;
  setState({ folders });
  watchAll();
  void refreshGit();
}

async function saveWorkspace(folders: string[]): Promise<void> {
  const project = state.project;
  if (!project) return;
  const r = await safe(api<string[]>('PUT', `/workspace${qs({ project })}`, { folders }));
  if (!r || project !== state.project) return;
  setState((s) => ({ folders: r, scmRoot: s.scmRoot && r.includes(s.scmRoot) ? s.scmRoot : undefined }));
  watchAll();
  void refreshGit();
}

/** Add a folder next to the project in the Explorer (and let agents reach it). */
export async function addWorkspaceFolder(path?: string): Promise<void> {
  if (!state.project) return;
  if (!path) {
    if (state.platform === 'win32') {
      setState({ showFolderBrowser: true, folderBrowserMode: 'add' });
      return;
    }
    const r = await safe(api<{ path: string | null; error?: string }>('POST', `/projects/pick${qs({ open: '0' })}`));
    if (r?.error) {
      toast(`Không mở được hộp thoại hệ thống (${r.error}), dùng trình chọn thư mục của AgentDesk.`, 'info');
      setState({ showFolderBrowser: true, folderBrowserMode: 'add' });
    }
    if (!r?.path) return;
    path = r.path;
  }
  if (path === state.project || state.folders.includes(path)) {
    toast('Thư mục này đã có trong workspace', 'info');
    return;
  }
  await saveWorkspace([...state.folders, path]);
}

export async function removeWorkspaceFolder(path: string): Promise<void> {
  setState((s) => ({ tabs: s.tabs.filter((t) => !(t.kind === 'file' && t.root === path)), activeTab: s.activeTab.startsWith(`file:${path}::`) ? 'chat' : s.activeTab }));
  await saveWorkspace(state.folders.filter((f) => f !== path));
}

export function setRightTab(tab: 'files' | 'scm'): void {
  LS.set('rightTab', tab);
  setState({ rightTab: tab });
}

const GIT_LABEL: Record<string, string> = {
  init: 'Đang khởi tạo git…',
  checkout: 'Đang đổi nhánh…',
  stage: 'Đang stage…',
  unstage: 'Đang bỏ stage…',
  discard: 'Đang huỷ thay đổi…',
  commit: 'Đang commit…',
  push: 'Đang push…',
  pull: 'Đang pull…',
  fetch: 'Đang fetch…',
};

/** Run a Source Control action; the server answers with the fresh repo state. */
export async function gitAction(action: string, body: unknown = {}): Promise<boolean> {
  const project = scmRootOf(state);
  if (!project || state.gitBusy) return false;
  setState({ gitBusy: GIT_LABEL[action] || action });
  try {
    const r = await api<{ info: GitInfo; out?: string }>('POST', `/git/${action}${qs({ project })}`, body);
    if (project === scmRootOf(state)) setState({ gitInfo: r.info });
    void refreshGit();
    return true;
  } catch (e) {
    toast((e as Error).message);
    void refreshGit();
    return false;
  } finally {
    setState({ gitBusy: undefined });
  }
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
    folders: [],
    rootGit: {},
    repos: [],
    problems: undefined,
    checkers: [],
    scmRoot: undefined,
    gitInfo: undefined,
  }));
  wsSend({ type: 'watch', project: r.path });
  void refreshList();
  void loadWorkspace(r.path);
  void loadCheckers();
  void loadTerms();
  const last = LS.get<string | undefined>(`conv:${r.path}`, undefined);
  if (last) void openConv(last);
}

/** Choose a project folder: native dialog on macOS/Linux, AgentDesk's own browser on Windows. */
export async function pickProject(): Promise<void> {
  if (state.platform === 'win32') {
    setState({ showFolderBrowser: true });
    return;
  }
  const r = await safe(api<{ path: string | null; error?: string }>('POST', '/projects/pick'));
  if (r?.error) {
    toast(`Không mở được hộp thoại hệ thống (${r.error}), dùng trình chọn thư mục của AgentDesk.`, 'info');
    setState({ showFolderBrowser: true });
  }
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
  if (open && state.bottomTab === 'terminal' && !state.terms.length) void newTerm();
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

/** Hide a finished/stopped pipeline run from the chat (it stays in the Flow tab). */
export function hideRun(runId: string): void {
  const hiddenRuns = [...state.hiddenRuns.filter((x) => x !== runId), runId].slice(-50);
  LS.set('hiddenRuns', hiddenRuns);
  setState({ hiddenRuns });
}

/** Put text into the chat composer and switch to the chat tab. */
export function insertIntoComposer(text: string): void {
  setState((s) => ({ composerInsert: { text, n: (s.composerInsert?.n || 0) + 1 }, activeTab: 'chat' }));
}

export async function loadCheckers(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const c = await api<{ dir: string; tools: string[] }[]>('GET', `/checks${qs({ project })}`).catch(() => []);
  if (project !== state.project) return;
  setState({ checkers: c });
  // like VS Code: check once shortly after the project opens (later: on save / after agent runs)
  if (c.length && !state.problems) setTimeout(() => project === state.project && !state.problems && void runChecks(), 2500);
}

/** Run the project's checkers: everything, or only the per-file ones on `files` (after a save). */
export async function runChecks(files?: string[]): Promise<void> {
  const project = state.project;
  if (!project || (!files && state.checking)) return;
  if (!files) setState({ checking: true });
  const r = await api<CheckResult>('POST', `/checks/run${qs({ project })}`, { files }).catch((e) => {
    if (!files) toast((e as Error).message);
    return undefined;
  });
  if (project !== state.project) return;
  if (!files) return setState({ checking: false, ...(r ? { problems: r } : {}) });
  if (!r || !state.problems) return;
  // per-file run: replace what the per-file checkers said about those files, keep the rest (e.g. TypeScript)
  const redone = new Set(r.tools.map((t) => t.name.toLowerCase()));
  const keep = state.problems.diagnostics.filter((d) => !(files.includes(d.file) && redone.has(d.source === 'ts' ? 'typescript' : d.source)));
  setState({ problems: { ...state.problems, diagnostics: [...keep, ...r.diagnostics] } });
}

let fullCheckTimer: ReturnType<typeof setTimeout> | undefined;

/** After a save: lint that file now, and re-run whole-project checkers (TypeScript) once edits settle. */
export function checkAfterSave(file: string): void {
  if (!state.checkers.length) return;
  void runChecks([file]);
  if (state.problems && state.checkers.some((c) => c.tools.includes('TypeScript'))) {
    clearTimeout(fullCheckTimer);
    fullCheckTimer = setTimeout(() => void runChecks(), 1500);
  }
}

export function setBottomTab(tab: 'terminal' | 'problems'): void {
  LS.set('bottomTab', tab);
  LS.set('termOpen', true);
  setState({ bottomTab: tab, termOpen: true });
  if (tab === 'problems' && !state.problems) void runChecks();
  if (tab === 'terminal' && !state.terms.length) void newTerm();
}

export async function checkUpdate(force = false): Promise<UpdateInfo | undefined> {
  const u = await api<UpdateInfo>('GET', `/update/check${force ? '?force=1' : ''}`).catch(() => undefined);
  if (u) setState({ update: u });
  return u;
}

// UI build the page was loaded with: after an in-app update the server restarts with a new one
let loadedBuild: string | undefined;

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

export function openFile(path: string, opts: { diff?: boolean; line?: number; root?: string } = {}): void {
  const root = opts.root && opts.root !== state.project ? opts.root : undefined;
  const id = `file:${fileKey(path, root)}`;
  // nonce: jumping to the same line twice still scrolls
  const patch = { diff: opts.diff, line: opts.line, nonce: Date.now() };
  setState((s) => ({
    tabs: s.tabs.some((t) => t.id === id)
      ? s.tabs.map((t) => (t.id === id && t.kind === 'file' ? { ...t, ...patch } : t))
      : [...s.tabs, { id, kind: 'file', path, root, ...patch }],
    activeTab: id,
  }));
}

/** Open a file mentioned by an agent ("src/a.tsx:12", absolute path, or just "a.tsx"). */
export async function openFileRef(ref: string): Promise<void> {
  if (!state.project) return;
  // the project first, then the other workspace folders
  for (const root of [state.project, ...state.folders]) {
    const r = await api<{ path?: string; line?: number }>('GET', `/fs/resolve${qs({ project: root, ref })}`).catch(() => ({}) as { path?: string; line?: number });
    if (r.path) return openFile(r.path, { line: r.line, root });
  }
  toast(`Không tìm thấy file "${ref}" trong workspace`, 'info');
}

const closable = (t: Tab) => t.kind === 'file' || t.kind === 'preview';

/** Close several tabs at once (Chat and Flow always stay). */
export function closeTabs(which: 'all' | 'others' | 'right', id?: string): void {
  setState((s) => {
    const at = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t, i) => !closable(t) || (which === 'others' && t.id === id) || (which === 'right' && i <= at));
    const activeTab = tabs.some((t) => t.id === s.activeTab) ? s.activeTab : id && tabs.some((t) => t.id === id) ? id : 'chat';
    return { tabs, activeTab };
  });
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
    // the agent probably edited code: re-check if Problems were already in use
    if (state.problems) setTimeout(() => void runChecks(), 1500);
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
      if (msg.root === state.project || state.folders.includes(msg.root)) {
        const now = Date.now();
        const touched = { ...state.touched };
        const root = msg.root === state.project ? undefined : msg.root;
        for (const p of msg.paths) touched[fileKey(p, root)] = now;
        setState((s) => ({ fsVersion: s.fsVersion + 1, touched }));
        clearTimeout(gitTimer);
        // agents write files in bursts: refresh git once things settle, not after every save
        gitTimer = setTimeout(refreshGit, 1500);
      }
      break;
  }
}

export function boot(): void {
  if (!TOKEN) return;
  connectWs(onMessage, () => {
    // reconnected to a server running a newer UI (in-app update): load it
    void api<{ build: string }>('GET', '/env').then((e) => {
      if (loadedBuild && e.build && e.build !== loadedBuild) location.reload();
    });
    watchAll();
    if (state.convId) void openConv(state.convId);
    void refreshList();
  });
  void (async () => {
    void api<{ platform: string; build: string }>('GET', '/env')
      .then((e) => {
        loadedBuild ??= e.build;
        setState({ platform: e.platform });
      })
      .catch(() => {});
    // look for a newer version shortly after start, then every 6 hours
    setTimeout(() => void checkUpdate(), 8000);
    setInterval(() => document.visibilityState === 'visible' && void checkUpdate(), 6 * 3600_000);
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
    setInterval(() => document.visibilityState === 'visible' && void refreshUsage(true), 5 * 60_000);
    const vis = () => document.documentElement.classList.toggle('page-hidden', document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', vis);
    vis();
    window.addEventListener('focus', () => void refreshGit());
  })();
}
