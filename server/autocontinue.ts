// "Tự tiếp tục": resume a conversation (or pipeline) that stopped because the agent ran out of quota
// or hit a transient error, and optionally check it at fixed times of day. One scheduler serves
// both, so a session never gets two automatic continues for the same stop.
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Agent, AutoContinue, Conversation, RunConfig, Turn } from '../shared/types.ts';
import { executeTurn, getConv, isRunning, publish, saveConv, setTurnEndHook } from './conversations.ts';
import { rerun } from './pipeline.ts';
import { startRun, type RunResult } from './runner.ts';
import { getUsage } from './usage.ts';
import { dataFile, readJson, uid, writeJson } from './store.ts';

/** conversations with auto-continue on: id → project path */
const REG_FILE = dataFile('auto-continue.json');
const reg: Record<string, string> = readJson(REG_FILE, {});
const saveReg = () => writeJson(REG_FILE, reg);

export const autoDefaults = (): AutoContinue => ({ enabled: false, maxTries: 5, tries: 0, schedule: [], prime: false, log: [] });

const QUOTA = /usage limit|limit reached|hit your (usage )?limit|rate.?limit|\b429\b|quota|too many requests|out of (credits|usage)|resets? (at|in)\b/i;
const TRANSIENT = /overloaded|\b52[0-9]\b|\b50[234]\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|timed? ?out|socket hang up|fetch failed|temporarily unavailable|internal server error|api error: 5/i;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const AGENT: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };

function note(c: Conversation, text: string) {
  c.auto!.log = [...c.auto!.log, { at: Date.now(), text }].slice(-20);
}

function commit(c: Conversation) {
  saveConv(c, true);
  publish(c);
  syncAwake();
}

/** Reset time written in the error ("…|1759230000", "resets 3am", "resets at 14:30"). */
function resetFromText(text: string): number | undefined {
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return undefined;
  let h = Number(m[1]) % 24;
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, Number(m[2] || 0), 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** When this agent's quota comes back: the error text first, then the Usage numbers. */
async function quotaBack(agent: Agent, text: string): Promise<{ at: number; weekly: boolean }> {
  const fromText = resetFromText(text);
  // recent numbers are fine (cached a minute); never hold the booking up for long
  const usage = await Promise.race([getUsage(false).catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), 10_000))]);
  const windows = usage?.[agent]?.windows || [];
  const week = windows.find((w) => /^Tuần/.test(w.label) && w.usedPercent >= 100 && w.resetsAt);
  if (week) return { at: week.resetsAt!, weekly: true };
  if (fromText) return { at: fromText, weekly: false };
  // the fullest window with a known reset time is the one blocking us
  const full = windows.filter((w) => w.resetsAt).sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (full?.resetsAt && full.resetsAt > Date.now()) return { at: full.resetsAt, weekly: /^Tuần/.test(full.label) };
  return { at: Date.now() + 30 * 60_000, weekly: false };
}

/** bumped on every cancel / manual message / toggle: a booking that finishes later is dropped */
const epoch = new Map<string, number>();
const bump = (id: string) => epoch.set(id, (epoch.get(id) || 0) + 1);

/** A turn ended: if it failed in a way that waiting fixes, book the next continue. */
async function onTurnEnd(c: Conversation, turn: Turn, result: RunResult) {
  const a = c.auto;
  if (!a?.enabled || result.ok || result.stopped) return;
  const mark = { epoch: epoch.get(c.id) || 0, turns: c.turns.length };
  // the conversation moved on (new turn, cancel, turned off) while we were looking up the reset time
  const stale = () => !c.auto?.enabled || (epoch.get(c.id) || 0) !== mark.epoch || c.turns.length !== mark.turns;
  const text = `${result.error || ''}\n${result.finalText || ''}`;
  const quota = QUOTA.test(text);
  if (!quota && !TRANSIENT.test(text)) {
    note(c, 'Dừng vì lỗi khác (không phải hết quota hay lỗi tạm thời), không tự tiếp tục.');
    return commit(c);
  }
  if (a.tries >= a.maxTries) {
    note(c, `Đã tự tiếp tục ${a.tries}/${a.maxTries} lần, dừng lại chờ bạn.`);
    a.pending = undefined;
    return commit(c);
  }
  const agent = turn.agent || 'claude';
  if (quota) {
    const back = await quotaBack(agent, text);
    if (stale()) return;
    const at = back.at + 90_000; // a little after the reset
    a.pending = back.weekly
      ? { at, kind: 'weekly', reason: `Hết quota tuần của ${AGENT[agent]}, chờ tới lúc reset` }
      : { at, kind: 'quota', reason: `Hết quota ${AGENT[agent]}, chờ quota hồi` };
    note(c, `${a.pending.reason}: tự tiếp tục lúc ${clock(at)}.`);
  } else {
    const wait = Math.min(30, 2 * 2 ** a.tries) * 60_000;
    a.pending = { at: Date.now() + wait, kind: 'error', reason: 'Lỗi tạm thời (mạng / máy chủ quá tải), thử lại' };
    note(c, `${a.pending.reason} lúc ${clock(a.pending.at)}.`);
  }
  commit(c);
}

/** The session stopped midway and can be continued. */
function paused(c: Conversation): boolean {
  if (c.auto?.pending) return true;
  if (c.run && (c.run.status === 'error' || c.run.status === 'stopped')) return true;
  const last = [...c.turns].reverse().find((t) => t.role === 'assistant');
  return !!last && last.status === 'error';
}

/** Send "continue" (or resume the pipeline step). */
function fire(c: Conversation, why: string) {
  const a = c.auto!;
  if (isRunning(c.id) || c.run?.status === 'running') return; // busy: try again next tick
  if (a.tries >= a.maxTries) {
    a.pending = undefined;
    note(c, `Đã tự tiếp tục ${a.tries}/${a.maxTries} lần, dừng lại chờ bạn.`);
    return commit(c);
  }
  a.tries++;
  a.pending = undefined;
  const n = `${a.tries}/${a.maxTries}`;
  if (c.run && (c.run.status === 'error' || c.run.status === 'stopped') && c.run.current) {
    const step = c.run.pipeline.nodes.find((x) => x.id === c.run!.current)?.data.label || 'bước đang dở';
    note(c, `${why}: chạy tiếp pipeline từ bước ${step} (lần ${n}).`);
    c.turns.push({ id: uid('t_'), role: 'user', createdAt: Date.now(), text: `🤖 Tự tiếp tục pipeline từ bước "${step}" (lần ${n}) · ${why}`, blocks: [], status: 'done' });
    commit(c);
    try {
      rerun(c, {});
    } catch (e) {
      note(c, `Không chạy tiếp được: ${(e as Error).message}`);
      commit(c);
    }
    return;
  }
  const last = [...c.turns].reverse().find((t) => t.role === 'assistant' && t.agent);
  if (!last) return;
  const config: RunConfig = { agent: last.agent!, model: last.model || '', effort: last.effort, permission: last.permission || 'write' };
  note(c, `${why}: gửi "continue" cho ${AGENT[config.agent]} (lần ${n}).`);
  commit(c);
  void executeTurn(c, { prompt: 'continue', display: `🤖 Tự tiếp tục (lần ${n}) · ${why}\ncontinue`, config, roleName: last.roleName, roleIcon: last.roleIcon }).catch((e) =>
    console.error('[auto-continue]', e),
  );
}

/** A tiny message so the agent's 5-hour window starts now (reset lands earlier in the day). */
function prime(c: Conversation) {
  const last = [...c.turns].reverse().find((t) => t.role === 'assistant' && t.agent);
  const agent = last?.agent || 'claude';
  const cfg: RunConfig = agent === 'claude' ? { agent, model: 'haiku', effort: 'low', permission: 'read' } : { agent, model: last?.model || '', permission: 'read' };
  startRun(cfg, 'Reply with just: ok', os.tmpdir(), undefined, { onSession() {}, onDelta() {}, onBlock() {} });
  note(c, `Mồi quota ${AGENT[agent]} lúc ${hhmm(new Date())} (không có việc dở).`);
  commit(c);
}

const firedAt = new Map<string, string>();

async function tick() {
  const now = new Date();
  for (const [id, project] of Object.entries(reg)) {
    const c = getConv(id, project);
    if (!c?.auto?.enabled) {
      delete reg[id];
      saveReg();
      continue;
    }
    const a = c.auto;
    if (a.pending && Date.now() >= a.pending.at) {
      fire(c, a.pending.kind === 'error' ? 'Thử lại sau lỗi tạm thời' : 'Quota đã hồi');
      continue;
    }
    // scheduled check (once per HH:MM per day)
    const key = `${now.toDateString()} ${hhmm(now)}`;
    if (!a.schedule.includes(hhmm(now)) || firedAt.get(id) === key) continue;
    firedAt.set(id, key);
    if (paused(c)) {
      if (a.pending?.kind === 'weekly') {
        note(c, `Mốc ${hhmm(now)}: vẫn hết quota tuần, giữ lịch ${clock(a.pending.at)}.`);
        commit(c);
      } else fire(c, `Kiểm tra lúc ${hhmm(now)}`);
    } else if (a.prime) prime(c);
  }
}

// keep the Mac awake while something is booked (sleeping would miss it)
let awake: ChildProcess | undefined;
function syncAwake() {
  if (process.platform !== 'darwin') return;
  const need = Object.keys(reg).some((id) => getConv(id, reg[id])?.auto?.pending);
  if (need && !awake) {
    awake = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    awake.on('exit', () => (awake = undefined));
  } else if (!need && awake) {
    awake.kill();
    awake = undefined;
  }
}

/** Turn it on/off or change settings. */
export function setAuto(c: Conversation, patch: Partial<Pick<AutoContinue, 'enabled' | 'maxTries' | 'schedule' | 'prime'>>): AutoContinue {
  const was = c.auto?.enabled;
  if (patch.enabled === false) bump(c.id);
  c.auto = { ...autoDefaults(), ...c.auto, ...patch };
  c.auto.schedule = [...new Set((c.auto.schedule || []).filter((t) => /^\d{2}:\d{2}$/.test(t)))].sort();
  c.auto.maxTries = Math.max(1, Math.min(20, Math.round(c.auto.maxTries || 5)));
  if (c.auto.enabled) {
    reg[c.id] = c.projectPath;
    if (!was) {
      c.auto.tries = 0;
      note(c, 'Bật tự tiếp tục.');
      // turned on right after a quota stop: book it now
      const last = [...c.turns].reverse().find((t) => t.role === 'assistant');
      if (last?.status === 'error' && !c.auto.pending) {
        const text = last.blocks.filter((b) => b.type === 'error').map((b) => b.text).join('\n');
        void onTurnEnd(c, last, { ok: false, stopped: false, durationMs: 0, finalText: '', error: text } as RunResult);
      }
    }
  } else {
    delete reg[c.id];
    if (was) note(c, 'Tắt tự tiếp tục.');
    c.auto.pending = undefined;
  }
  saveReg();
  commit(c);
  return c.auto;
}

export function cancelPending(c: Conversation) {
  bump(c.id);
  if (!c.auto?.pending) return;
  c.auto.pending = undefined;
  note(c, 'Bạn đã huỷ lần tự tiếp tục đang chờ.');
  commit(c);
}

export function runNow(c: Conversation) {
  if (!c.auto) c.auto = autoDefaults();
  fire(c, 'Bạn bấm Chạy ngay');
}

/** The user took over (sent a message / stopped): start counting again, drop the booking. */
export function userActed(c: Conversation) {
  bump(c.id);
  if (!c.auto) return;
  c.auto.tries = 0;
  if (c.auto.pending) {
    c.auto.pending = undefined;
    note(c, 'Bạn đã tự gửi tin nhắn, bỏ lịch tự tiếp tục đang chờ.');
  }
}

let started = false;
export function startAutoContinue() {
  if (started) return;
  started = true;
  setTurnEndHook((c, turn, result) => void onTurnEnd(c, turn, result).catch((e) => console.error('[auto-continue]', e)));
  setInterval(() => void tick().catch((e) => console.error('[auto-continue]', e)), 20_000);
  syncAwake();
}
