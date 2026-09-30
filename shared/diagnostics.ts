/** One problem reported by a project's own checker (tsc, eslint, biome, ruff). */
export interface Diagnostic {
  /** project-relative, forward slashes */
  file: string;
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
  code?: string;
}

export interface CheckTool {
  name: string;
  /** folder it ran in (project-relative, "" = project) */
  dir: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  tools: CheckTool[];
  /** files the run was limited to (undefined = whole project) */
  files?: string[];
  at: number;
}
