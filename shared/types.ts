// Types shared by the server (run natively by Node with type stripping) and the UI.
// Keep this file erasable-only: no enums, no namespaces, no runtime code.

export type Agent = 'claude' | 'codex';

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

export interface Conversation {
  id: string;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** native CLI session ids so each provider resumes its own context */
  sessions: Partial<Record<Agent, string>>;
  /** number of turns each provider has already seen (for cross-agent context hand-off) */
  seen: Record<Agent, number>;
  turns: Turn[];
  run?: PipelineRun;
  /** where the conversation came from */
  source: 'app' | 'claude' | 'codex';
  /** for imported sessions: turn count at import time (unchanged => safe to re-import) */
  importedCount?: number;
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
}

export interface ModelInfo {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort?: string;
  fast?: boolean;
  description?: string;
}

export interface Catalog {
  claude: ModelInfo[];
  codex: ModelInfo[];
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
}

/** Streaming events sent over the websocket */
export type TurnEvent =
  | { t: 'delta'; text: string }
  | { t: 'block'; block: Block };

export type ServerMessage =
  | { type: 'conv'; conv: Conversation }
  | { type: 'turn'; convId: string; turnId: string; ev: TurnEvent }
  | { type: 'list'; projectPath: string }
  | { type: 'fs'; root: string; paths: string[] };
