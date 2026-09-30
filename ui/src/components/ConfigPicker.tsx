import { Gauge, Settings2, Shield, Zap } from 'lucide-react';
import type { Agent, RunConfig } from '../../../shared/types.ts';
import { useStore } from '../store.ts';
import { AGENT_NAME, AgentIcon, EFFORT_LABEL, Field, inputCls, PERMISSIONS, Popover, Select, Toggle, cx } from './ui.tsx';

export function ConfigPicker({
  value,
  onChange,
  placement = 'top-start',
  compact,
}: {
  value: RunConfig;
  onChange: (c: RunConfig) => void;
  placement?: 'bottom-start' | 'top-start';
  compact?: boolean;
}) {
  const catalog = useStore((s) => s.catalog);
  const models = catalog?.[value.agent] || [];
  const model = models.find((m) => m.id === value.model);
  const efforts = model?.efforts || [];

  const setAgent = (agent: Agent) => {
    if (agent === value.agent) return;
    const m = catalog?.[agent]?.[0];
    onChange({ ...value, agent, model: m?.id || '', effort: m?.defaultEffort, fast: false });
  };
  const setModel = (id: string) => {
    const m = models.find((x) => x.id === id);
    const effort = value.effort && m?.efforts.includes(value.effort) ? value.effort : m?.defaultEffort;
    onChange({ ...value, model: id, effort, fast: m?.fast ? value.fast : false });
  };
  const perm = PERMISSIONS.find((p) => p.id === value.permission);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5">
      <div className="mr-1 inline-flex rounded-lg bg-hover/70 p-0.5">
        {(['claude', 'codex'] as Agent[]).map((a) => (
          <button
            key={a}
            type="button"
            title={AGENT_NAME[a]}
            onClick={() => setAgent(a)}
            className={cx(
              'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors',
              value.agent === a ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            <AgentIcon agent={a} size={13} />
            {!compact && AGENT_NAME[a]}
          </button>
        ))}
      </div>

      <Select
        title="Model"
        placement={placement}
        value={value.model}
        onChange={setModel}
        width={300}
        options={models.map((m) => ({ value: m.id, label: m.label, hint: m.description?.slice(0, 80) }))}
        display={<span className="truncate font-medium text-fg">{model?.label || value.model || 'Chọn model'}</span>}
      />

      {efforts.length > 0 && (
        <Select
          title="Effort (mức suy nghĩ)"
          placement={placement}
          value={value.effort}
          onChange={(effort) => onChange({ ...value, effort })}
          width={180}
          options={efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] || e, hint: e === model?.defaultEffort ? 'mặc định' : undefined }))}
          display={
            <>
              <Gauge size={13} />
              <span>{EFFORT_LABEL[value.effort || ''] || value.effort || 'Effort'}</span>
            </>
          }
        />
      )}

      <Select
        title="Quyền"
        placement={placement}
        value={value.permission}
        onChange={(permission) => onChange({ ...value, permission })}
        width={280}
        options={PERMISSIONS.map((p) => ({ value: p.id, label: p.label, hint: p.desc }))}
        display={
          <>
            <Shield size={13} className={cx(value.permission === 'full' && 'text-err', value.permission === 'read' && 'text-ok')} />
            <span>{compact ? perm?.short : perm?.label}</span>
          </>
        }
      />

      <Popover
        placement={placement === 'top-start' ? 'top-end' : 'bottom-end'}
        width={330}
        trigger={(open, toggle) => (
          <button
            type="button"
            title="Tuỳ chọn nâng cao"
            onClick={toggle}
            className={cx('inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-muted hover:bg-hover hover:text-fg', open && 'bg-hover text-fg')}
          >
            <Settings2 size={14} />
            {value.fast && <Zap size={12} className="text-warn" />}
          </button>
        )}
      >
        {() => <Advanced value={value} onChange={onChange} fastAvailable={!!model?.fast} />}
      </Popover>
    </div>
  );
}

function Advanced({ value, onChange, fastAvailable }: { value: RunConfig; onChange: (c: RunConfig) => void; fastAvailable: boolean }) {
  const catalog = useStore((s) => s.catalog);
  const isClaude = value.agent === 'claude';
  return (
    <div className="space-y-3 p-2.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-faint">Tuỳ chọn {isClaude ? 'Claude' : 'Codex'}</div>
      {!isClaude && (
        <Toggle
          checked={!!value.fast}
          onChange={(fast) => onChange({ ...value, fast })}
          label={
            <span className={cx(!fastAvailable && 'opacity-50')}>
              Fast mode <span className="text-faint">(service tier priority)</span>
            </span>
          }
        />
      )}
      {isClaude && (
        <>
          <Toggle
            checked={!!value.useMcp}
            onChange={(useMcp) => onChange({ ...value, useMcp })}
            label={
              <span>
                Dùng MCP server của tôi <span className="text-faint">(tốn token hơn)</span>
              </span>
            }
          />
          <Field label="Model dự phòng" hint="Tự chuyển khi model chính quá tải">
            <select className={inputCls} value={value.fallbackModel || ''} onChange={(e) => onChange({ ...value, fallbackModel: e.target.value || undefined })}>
              <option value="">Không</option>
              {catalog?.claude
                .filter((m) => m.id !== value.model)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Giới hạn chi phí mỗi lượt (USD)" hint="--max-budget-usd, để trống = không giới hạn">
            <input
              className={inputCls}
              type="number"
              min={0}
              step={0.1}
              value={value.maxBudgetUsd ?? ''}
              onChange={(e) => onChange({ ...value, maxBudgetUsd: e.target.value ? Number(e.target.value) : undefined })}
            />
          </Field>
        </>
      )}
      <Field label="Chỉ dẫn thêm (system prompt)" hint={isClaude ? '--append-system-prompt' : 'Chèn vào đầu prompt'}>
        <textarea
          className={cx(inputCls, 'h-20 resize-y')}
          value={value.systemPrompt || ''}
          placeholder="VD: Luôn trả lời bằng tiếng Việt"
          onChange={(e) => onChange({ ...value, systemPrompt: e.target.value || undefined })}
        />
      </Field>
      <Field label="Thư mục bổ sung" hint="--add-dir, mỗi dòng một đường dẫn">
        <textarea
          className={cx(inputCls, 'h-14 resize-y font-mono text-xs')}
          value={(value.addDirs || []).join('\n')}
          onChange={(e) => {
            const dirs = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            onChange({ ...value, addDirs: dirs.length ? dirs : undefined });
          }}
        />
      </Field>
    </div>
  );
}
