import { useEffect, useRef } from 'react';
import { Eraser, Globe, MessageSquarePlus, Plus, SquareTerminal, Trash2, X } from 'lucide-react';
import { closeTerm, ensurePreview, insertIntoComposer, newTerm, setState, toast, toggleTermPanel, useStore } from '../store.ts';
import { clearTerm, ensureTerm, fitTerm, focusTerm, retheme, termText } from '../terminals.ts';
import { useIsDark } from '../theme.ts';
import { cx } from './ui.tsx';

export function TerminalPanel() {
  const terms = useStore((s) => s.terms);
  const active = useStore((s) => s.activeTerm);
  const devUrl = useStore((s) => s.devUrl);
  const dark = useIsDark();
  const mount = useRef<HTMLDivElement>(null);
  const cur = terms.find((t) => t.id === active);

  // attach the active xterm to the panel
  useEffect(() => {
    const el = mount.current;
    if (!el || !active) return;
    const { host } = ensureTerm(active);
    el.replaceChildren(host);
    requestAnimationFrame(() => {
      fitTerm(active);
      focusTerm(active);
    });
  }, [active]);

  // keep the terminal sized to the panel
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const ro = new ResizeObserver(() => active && fitTerm(active));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  useEffect(() => {
    // wait for the CSS variables of the new theme to apply
    requestAnimationFrame(retheme);
  }, [dark]);

  const sendToAgent = () => {
    if (!active) return;
    const text = termText(active, 60);
    if (!text.trim()) return toast('Terminal chưa có output để gửi', 'info');
    insertIntoComposer(`Output từ terminal:\n\`\`\`\n${text}\n\`\`\`\n`);
  };

  return (
    <div className="flex h-full flex-col bg-term">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
        <span className="mr-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <SquareTerminal size={13} /> Terminal
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {terms.map((t) => (
            <div
              key={t.id}
              onClick={() => setState({ activeTerm: t.id })}
              className={cx(
                'group flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2',
                t.id === active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg',
              )}
            >
              <span className={cx('h-1.5 w-1.5 rounded-full', t.alive ? 'bg-ok' : 'bg-faint')} />
              {t.title}
              <button
                type="button"
                title="Đóng terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTerm(t.id);
                }}
                className="rounded opacity-0 hover:text-err group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" title="Terminal mới" onClick={() => void newTerm()} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <Plus size={14} />
          </button>
        </div>
        {devUrl && (
          <button
            type="button"
            onClick={() => ensurePreview(devUrl, true)}
            title="Mở trang đang chạy trong tab Preview"
            className="flex shrink-0 items-center gap-1 rounded-md border border-ok/40 px-2 py-0.5 text-ok hover:bg-ok/10"
          >
            <Globe size={12} /> {devUrl.replace(/^https?:\/\//, '')}
          </button>
        )}
        <button type="button" onClick={sendToAgent} title="Gửi đoạn đang chọn (hoặc 60 dòng cuối) vào ô chat" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-muted hover:bg-hover hover:text-fg">
          <MessageSquarePlus size={13} /> Gửi cho agent
        </button>
        <button type="button" onClick={() => active && clearTerm(active)} title="Xoá màn hình" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <Eraser size={13} />
        </button>
        <button type="button" onClick={() => active && void closeTerm(active)} title="Tắt terminal này" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-err">
          <Trash2 size={13} />
        </button>
        <button type="button" onClick={() => toggleTermPanel(false)} title="Ẩn panel (⌃`)" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={14} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 px-2 pt-1">
        <div ref={mount} className="h-full w-full" />
        {cur && !cur.alive && (
          <div className="absolute bottom-2 right-3 rounded-md bg-hover px-2 py-1 text-[11.5px] text-muted">
            Shell đã thoát{cur.exitCode !== undefined ? ` (mã ${cur.exitCode})` : ''}.{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => void newTerm()}>
              Mở terminal mới
            </button>
          </div>
        )}
        {!terms.length && (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-muted">
            <button type="button" onClick={() => void newTerm()} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:bg-hover">
              <Plus size={14} /> Mở terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
