import { useState } from 'react';
import { Hourglass, Play, Plus, Repeat, X } from 'lucide-react';
import type { AutoContinue, Conversation } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { ensureConv, getState, safe, useStore } from '../store.ts';
import { Popover, Toggle, cx } from './ui.tsx';

const clock = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? clock(ms) : `${clock(ms)} ${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`;
};

const call = (c: Conversation, method: string, path: string, body?: unknown) =>
  safe(api(method, `/conversations/${encodeURIComponent(c.id)}/auto${path}${qs({ project: getState().project })}`, body));

/** Composer button: settings of "Tự tiếp tục" for this conversation. */
export function AutoContinueButton() {
  const conv = useStore((s) => s.conv);
  const a = conv?.auto;
  const on = !!a?.enabled;
  const [time, setTime] = useState('05:00');

  const update = async (patch: Partial<AutoContinue>) => {
    const c = conv ?? (await ensureConv()); // a new chat: create it so the setting has somewhere to live
    if (c) await call(c, 'PUT', '', { enabled: on, maxTries: a?.maxTries ?? 5, schedule: a?.schedule ?? [], prime: a?.prime ?? false, ...patch });
  };

  return (
    <Popover
      placement="top-start"
      width={340}
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          title="Tự tiếp tục khi agent dừng vì hết quota hoặc lỗi tạm thời"
          className={cx(
            'inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12.5px]',
            on ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-hover hover:text-fg',
            open && 'bg-hover',
          )}
        >
          {a?.pending ? <Hourglass size={14} /> : <Repeat size={14} />}
          {on && <span>{a?.pending ? clock(a.pending.at) : 'Tự tiếp tục'}</span>}
        </button>
      )}
    >
      {() => (
        <div className="max-h-[min(560px,70vh)] space-y-3 overflow-auto p-3 text-[13px]">
          <div>
            <Toggle checked={on} onChange={(enabled) => void update({ enabled })} label={<span className="font-medium">Tự tiếp tục</span>} />
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Agent hoặc pipeline dừng vì <b>hết quota</b> hay <b>lỗi tạm thời</b> thì app đợi quota hồi rồi tự gửi <code>continue</code>. Lỗi khác thì app không tự chạy.
            </p>
          </div>

          <label className="flex items-center justify-between gap-2">
            <span className="text-muted">Tự chạy tối đa</span>
            <select
              className="rounded-md border border-line bg-panel px-2 py-1 text-[12.5px]"
              value={a?.maxTries ?? 5}
              onChange={(e) => void update({ maxTries: Number(e.target.value) })}
            >
              {[3, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n} lần
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="mb-1 text-muted">Mốc giờ kiểm tra</div>
            <div className="flex flex-wrap gap-1.5">
              {(a?.schedule ?? []).map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[12px]">
                  {t}
                  <button type="button" title="Bỏ mốc này" onClick={() => void update({ schedule: (a?.schedule ?? []).filter((x) => x !== t) })} className="text-faint hover:text-err">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[12px]" />
                <button
                  type="button"
                  title="Thêm mốc giờ"
                  onClick={() => void update({ schedule: [...(a?.schedule ?? []), time] })}
                  className="grid h-6 w-6 place-items-center rounded-md border border-line hover:bg-hover"
                >
                  <Plus size={12} />
                </button>
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-faint">Đến giờ, việc còn dở sẽ chạy tiếp. Việc đã xong hoặc đang chờ duyệt thì bỏ qua.</p>
            <div className="mt-1.5">
              <Toggle
                checked={!!a?.prime}
                onChange={(prime) => void update({ prime })}
                label={<span className="text-[12.5px]">Bắt đầu chu kỳ quota ở các mốc</span>}
              />
              <p className="mt-0.5 text-[11.5px] leading-snug text-faint">Không có việc dở thì app gửi một tin ngắn để chu kỳ 5 giờ bắt đầu từ mốc đó. Quota sẽ hồi sớm hơn.</p>
            </div>
          </div>

          {!!a?.log.length && (
            <div className="border-t border-line pt-2">
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Gần đây</div>
              <ul className="max-h-32 space-y-0.5 overflow-auto text-[12px] text-muted">
                {[...a.log].reverse().slice(0, 8).map((l, i) => (
                  <li key={i}>
                    <span className="font-mono text-faint">{clock(l.at)}</span> {l.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] leading-snug text-faint">Cần để app mở. Trong lúc chờ, app giữ máy không ngủ.</p>
        </div>
      )}
    </Popover>
  );
}

/** Strip above the chat while an automatic continue is booked. */
export function AutoContinueBar({ conv }: { conv: Conversation }) {
  const a = conv.auto;
  if (!a?.enabled || !a.pending) return null;
  return (
    <div className={cx('flex items-center gap-2 border-b px-4 py-1.5 text-[12.5px]', a.pending.kind === 'weekly' ? 'border-warn/30 bg-warn/10' : 'border-accent/25 bg-accent/8')}>
      <Hourglass size={14} className={a.pending.kind === 'weekly' ? 'text-warn' : 'text-accent'} />
      <span className="min-w-0 truncate">
        <b>Tự tiếp tục lúc {when(a.pending.at)}</b>
        <span className="text-muted">
          {' '}
          (lần {a.tries + 1}/{a.maxTries}) · {a.pending.reason}
        </span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => void call(conv, 'POST', '/run-now')} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 hover:bg-hover">
          <Play size={11} /> Chạy ngay
        </button>
        <button type="button" onClick={() => void call(conv, 'POST', '/cancel')} className="rounded-md px-2 py-0.5 text-muted hover:bg-hover hover:text-err">
          Huỷ
        </button>
      </div>
    </div>
  );
}
