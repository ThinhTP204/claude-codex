// Types shared by the server (run natively by Node with type stripping) and the UI.
// Keep this file erasable-only (Node runs it with type stripping): no enums or namespaces.

export type Agent = 'claude' | 'codex' | 'antigravity';

export const AGENTS: Agent[] = ['claude', 'codex', 'antigravity'];

/** read = chỉ đọc, write = sửa file, exec = sửa file + chạy lệnh, full = bỏ qua mọi quyền */
export type Permission = 'read' | 'write' | 'exec' | 'full';

export interface RunConfig {
  agent: Agent;
  model: string;
  effort?: string;
  permission: Permission;
  /** Codex: service_tier="priority" */
  fast?: boolean;
  /** Claude: --fallback-model */
  fallbackModel?: string;
  /** Claude: --max-budget-usd */
  maxBudgetUsd?: number;
  /** Claude: --append-system-prompt, Codex: prepended to the prompt */
  systemPrompt?: string;
  addDirs?: string[];
  /** Claude: false => --strict-mcp-config (skip the user's MCP servers, cheaper) */
  useMcp?: boolean;
}

export interface Role {
  id: string;
  name: string;
  icon: string;
  description: string;
  config: RunConfig;
  /** Template used when this role runs inside a pipeline. Vars: {{task}}, {{prev}}, {{<Node label>}} */
  promptTemplate: string;
  /** Output ends with VERDICT: PASS|FAIL and the node gets pass/fail branches */
  verdict?: boolean;
}

export type Block =
  | { type: 'text'; id: string; text: string }
  | { type: 'thinking'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; input: string; output?: string; status: 'running' | 'done' | 'error' }
  | { type: 'error'; id: string; text: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd?: number;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  createdAt: number;
  /** user turns: what the human (or the pipeline) asked */
  text?: string;
  agent?: Agent;
  model?: string;
  effort?: string;
  permission?: Permission;
  roleName?: string;
  roleIcon?: string;
  /** set when the turn was produced by a pipeline node */
  nodeId?: string;
  nodeLabel?: string;
  blocks: Block[];
  status: 'running' | 'done' | 'error' | 'stopped';
  usage?: Usage;
  durationMs?: number;
}

export interface PNodeData {
  label: string;
  roleId?: string;
  config?: RunConfig;
  prompt?: string;
  approval?: boolean;
  verdict?: boolean;
  maxLoops?: number;
}

export interface PNode {
  id: string;
  type: 'task' | 'agent' | 'end';
  position: { x: number; y: number };
  data: PNodeData;
}

export interface PEdge {
  id: string;
  source: string;
  target: string;
  /** 'out' for normal nodes, 'pass' | 'fail' for verdict nodes */
  sourceHandle?: string | null;
}

export interface Pipeline {
  id: string;
  name: string;
  nodes: PNode[];
  edges: PEdge[];
}

export type NodeStatus = 'idle' | 'running' | 'awaiting' | 'done' | 'error' | 'stopped';

export interface NodeRunState {
  status: NodeStatus;
  output?: string;
  verdict?: 'pass' | 'fail';
  runs: number;
  turnId?: string;
  usage?: Usage;
  durationMs?: number;
  error?: string;
  /** agent did not print a VERDICT line, so the user has to decide */
  verdictMissing?: boolean;
  /** agent answered VERDICT: ASK, a question only the user can settle */
  needsInput?: boolean;
  /** fixing rounds are not converging: paused for the user instead of looping again (why) */
  stuck?: string;
  /** extra runs the user allowed after a pause */
  extra?: number;
}

export interface PipelineRun {
  id: string;
  pipeline: Pipeline;
  task: string;
  status: 'running' | 'awaiting' | 'done' | 'error' | 'stopped';
  current?: string;
  /** node executed right before `current`, used for {{prev}} */
  prevNode?: string;
  /** nodes waiting to execute (sequential fan-out) */
  queue: string[];
  nodes: Record<string, NodeRunState>;
  startedAt: number;
  endedAt?: number;
}

/** "Tự tiếp tục": resume a conversation / pipeline stopped by quota or a transient error. */
export interface AutoContinue {
  enabled: boolean;
  /** automatic continues allowed before giving up (reset when the user sends a message) */
  maxTries: number;
  tries: number;
  /** "HH:MM" local times at which the session is checked */
  schedule: string[];
  /** at a scheduled time with nothing to continue, send a tiny message so the 5-hour window starts */
  prime: boolean;
  /** the one upcoming automatic continue */
  pending?: { at: number; kind: 'quota' | 'weekly' | 'error' | 'schedule'; reason: string };
  /** recent automatic actions, newest last */
  log: { at: number; text: string }[];
}

export interface Conversation {
  id: string;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** native CLI session ids so each provider resumes its own context */
  sessions: Partial<Record<Agent, string>>;
  /** number of turns each provider has already seen (for cross-agent context hand-off) */
  seen: Partial<Record<Agent, number>>;
  turns: Turn[];
  run?: PipelineRun;
  /** where the conversation came from */
  source: 'app' | 'claude' | 'codex';
  /** for imported sessions: turn count at import time (unchanged => safe to re-import) */
  importedCount?: number;
  auto?: AutoContinue;
  /** git branch of the project when the last turn started */
  branch?: string;
  /** same task given to several agents at once, each in its own git worktree */
  fanouts?: Fanout[];
  /** set on the hidden conversation of one fan-out attempt */
  parentId?: string;
}

export interface FanoutAttempt {
  id: string;
  config: RunConfig;
  /** hidden conversation running in the worktree */
  convId: string;
  /** worktree folder (the agent's working directory) */
  path: string;
  branch: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  startedAt: number;
  durationMs?: number;
  /** what changed compared with the starting point */
  stat?: { files: number; additions: number; deletions: number };
  /** the agent's final answer */
  answer?: string;
  error?: string;
  usage?: Usage;
}

export interface Fanout {
  id: string;
  /** user turn that started it (the panel is shown right after it) */
  turnId: string;
  task: string;
  /** commit the worktrees start from (HEAD, or a snapshot of uncommitted changes) */
  base: string;
  /** the project's branch at that time */
  baseBranch?: string;
  /** git repo root, and the project's folder inside it ("" = the root) */
  repo: string;
  prefix: string;
  startedAt: number;
  status: 'running' | 'ready' | 'merged' | 'discarded';
  attempts: FanoutAttempt[];
  /** attempt whose changes were applied */
  chosen?: string;
}

export interface FanoutFile {
  path: string;
  /** A added, M modified, D deleted, R renamed */
  status: string;
  additions: number;
  deletions: number;
}

/** What a session is doing, as shown in the sidebar. */
export type SessionStatus = 'running' | 'awaiting' | 'done' | 'error' | 'stopped';

/** One agent at work in a session: the chat's current turn, or a pipeline step. */
export interface SessionLane {
  id: string;
  /** a pipeline step, or one of several agents running the same task in parallel */
  kind: 'step' | 'agent';
  agent: Agent;
  model?: string;
  /** pipeline step name */
  label?: string;
  status: NodeStatus;
  /** what it is doing right now, e.g. "Đang sửa Sidebar.tsx" */
  activity?: string;
  /** start of its last answer (when it is not running) */
  text?: string;
  startedAt?: number;
  durationMs?: number;
  /** when it last finished */
  endedAt?: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  agents: Agent[];
  models: string[];
  source: 'app' | 'claude' | 'codex';
  running?: boolean;
  runStatus?: PipelineRun['status'];
  status?: SessionStatus;
  branch?: string;
  /** agents / pipeline steps, for the expandable sidebar row */
  lanes?: SessionLane[];
  /** an automatic continue is scheduled at this time */
  autoAt?: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort?: string;
  fast?: boolean;
  description?: string;
  /** lowest CLI version that can run this model */
  minCli?: string;
}

export interface Catalog {
  claude: ModelInfo[];
  codex: ModelInfo[];
  antigravity: ModelInfo[];
}

export interface AgentHealth {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  account?: string;
  error?: string;
}

export interface Health {
  claude: AgentHealth;
  codex: AgentHealth;
  antigravity: AgentHealth;
  checkedAt: number;
}

export interface FsEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  /** matched by .gitignore (shown dimmed, like VS Code) */
  ignored?: boolean;
}

// ---- usage limits ----

export interface UsageWindow {
  /** e.g. "5 giờ", "Tuần" */
  label: string;
  usedPercent: number;
  /** epoch ms, when known */
  resetsAt?: number;
  /** raw reset text when it could not be parsed */
  resetsText?: string;
}

export interface ResetCredit {
  id: string;
  title: string | null;
  description: string | null;
  status: string;
  grantedAt: number;
  expiresAt: number | null;
}

export interface AgentUsage {
  ok: boolean;
  error?: string;
  windows: UsageWindow[];
  plan?: string;
  /** Claude: the "what's contributing" breakdown printed by /usage */
  details?: string;
  /** Codex only: banked rate-limit resets */
  resetCredits?: ResetCredit[];
  limitReached?: boolean;
  fetchedAt: number;
}

export interface UsageReport {
  claude: AgentUsage;
  codex: AgentUsage;
  /** only when the `agy` CLI is installed */
  antigravity?: AgentUsage;
}

/** Streaming events sent over the websocket */
export type TurnEvent =
  | { t: 'delta'; text: string }
  | { t: 'block'; block: Block };

// ---- git (Source Control) ----

export interface GitFile {
  path: string;
  /** rename source */
  orig?: string;
  /** staged status: M A D R … (undefined = nothing staged) */
  index?: string;
  /** working-tree status: M D U(ntracked) … */
  work?: string;
  untracked?: boolean;
  conflict?: boolean;
}

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  detached?: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  remotes: string[];
  files: GitFile[];
  lastCommit?: { hash: string; subject: string };
}

export interface GitBranch {
  name: string;
  upstream?: string;
  current: boolean;
  ahead?: number;
  behind?: number;
  gone?: boolean;
  date?: string;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
}

/** An interactive shell in the Terminal panel */
export interface TermInfo {
  id: string;
  projectPath: string;
  title: string;
  alive: boolean;
  exitCode?: number;
  /** false = "basic" mode (Windows): no PTY, the UI echoes and edits the input line */
  pty: boolean;
  createdAt: number;
  /** terminals split side by side share a group (the id of the first one) */
  group: string;
  /** folder it was opened in, when not the project root */
  cwd?: string;
}

export interface TermProfiles {
  shells: { name: string; path: string; default?: boolean }[];
  /** package.json scripts, with the command for the project's package manager */
  scripts: { name: string; cmd: string; run: string }[];
}

export interface TermPort {
  port: number;
  pid: number;
  process: string;
  host: string;
  termId: string;
  termTitle: string;
}

export type ServerMessage =
  | { type: 'conv'; conv: Conversation }
  | { type: 'turn'; convId: string; turnId: string; ev: TurnEvent }
  | { type: 'list'; projectPath: string }
  /** live change of one sidebar row (activity of a running agent) */
  | { type: 'summary'; projectPath: string; summary: ConversationSummary }
  /** a session finished, failed or waits for the user (OS notification + unread marker) */
  | { type: 'session:event'; projectPath: string; convId: string; title: string; kind: 'done' | 'error' | 'awaiting'; text: string }
  | { type: 'fs'; root: string; paths: string[] }
  | { type: 'term:data'; id: string; data: string }
  | { type: 'term:exit'; id: string; code?: number }
  | { type: 'term:closed'; id: string }
  | { type: 'term:info'; term: TermInfo };
