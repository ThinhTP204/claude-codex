import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Role } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { safe, saveRoles, setState, useStore } from '../store.ts';
import { ConfigPicker } from './ConfigPicker.tsx';
import { AgentIcon, Field, Toggle, cx, inputCls, modelLabel } from './ui.tsx';

export function RolesDialog() {
  const roles = useStore((s) => s.roles);
  const catalog = useStore((s) => s.catalog);
  const [draft, setDraft] = useState<Role[]>(roles);
  const [sel, setSel] = useState<string | undefined>(roles[0]?.id);
  useEffect(() => setDraft(roles), [roles]);

  const close = () => setState({ showRoles: false });
  const role = draft.find((r) => r.id === sel);
  const update = (patch: Partial<Role>) => setDraft((d) => d.map((r) => (r.id === sel ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(roles);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex h-[min(680px,90vh)] w-[min(980px,95vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <div>
            <div className="font-semibold">Vai trò & model</div>
            <div className="text-[12px] text-muted">Mỗi vai trò gắn sẵn agent, model, effort, quyền và prompt mẫu. Chọn vai trò ở ô chat hoặc kéo vào pipeline.</div>
          </div>
          <button type="button" onClick={close} className="ml-auto rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-60 shrink-0 overflow-y-auto border-r border-line p-2">
            {draft.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSel(r.id)}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left', sel === r.id ? 'bg-active' : 'hover:bg-hover')}
              >
                <span className="text-base">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{r.name}</span>
                  <span className="flex items-center gap-1 text-[11.5px] text-muted">
                    <AgentIcon agent={r.config.agent} size={11} /> {modelLabel(catalog, r.config.agent, r.config.model)} · {r.config.effort}
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const id = `role_${Date.now().toString(36)}`;
                setDraft((d) => [
                  ...d,
                  { id, name: 'Vai trò mới', icon: '✨', description: '', config: { agent: 'claude', model: 'sonnet', effort: 'medium', permission: 'read' }, promptTemplate: '{{task}}' },
                ]);
                setSel(id);
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-muted hover:bg-hover hover:text-fg"
            >
              <Plus size={14} /> Thêm vai trò
            </button>
          </div>
          {role ? (
            <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
              <div className="flex gap-2">
                <Field label="Icon">
                  <input className={cx(inputCls, 'w-14 text-center text-base')} value={role.icon} onChange={(e) => update({ icon: e.target.value })} />
                </Field>
                <div className="flex-1">
                  <Field label="Tên">
                    <input className={inputCls} value={role.name} onChange={(e) => update({ name: e.target.value })} />
                  </Field>
                </div>
              </div>
              <Field label="Mô tả">
                <input className={inputCls} value={role.description} onChange={(e) => update({ description: e.target.value })} />
              </Field>
              <Field label="Agent · Model · Effort · Quyền mặc định">
                <div className="rounded-lg border border-line p-1.5">
                  <ConfigPicker value={role.config} onChange={(config) => update({ config })} placement="bottom-start" />
                </div>
              </Field>
              <Field label="Prompt mẫu (khi chạy trong pipeline)" hint="Biến: {{task}}, {{prev}}, {{Tên bước}}">
                <textarea className={cx(inputCls, 'h-44 resize-y font-mono text-[12px]')} value={role.promptTemplate} onChange={(e) => update({ promptTemplate: e.target.value })} />
              </Field>
              <Toggle checked={!!role.verdict} onChange={(verdict) => update({ verdict })} label="Chấm đạt/chưa đạt (có nhánh pass/fail trong pipeline)" />
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setDraft((d) => d.filter((r) => r.id !== sel));
                    setSel(draft.find((r) => r.id !== sel)?.id);
                  }}
                  className="inline-flex items-center gap-1.5 text-[13px] text-err hover:underline"
                >
                  <Trash2 size={13} /> Xoá vai trò
                </button>
              </div>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center text-muted">Chọn một vai trò</div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Khôi phục các vai trò mặc định?')) return;
              const r = await safe(api<Role[]>('POST', '/roles/reset'));
              if (r) setState({ roles: r });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg"
          >
            <RotateCcw size={13} /> Mặc định
          </button>
          <button type="button" onClick={close} className="ml-auto rounded-lg px-3 py-1.5 text-[13px] hover:bg-hover">
            Đóng
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={async () => {
              await saveRoles(draft);
              close();
            }}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
