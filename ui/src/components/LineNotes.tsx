import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageSquarePlus, Pencil, Send, Trash2 } from 'lucide-react';
import { addNote, editNote, removeNote, sendNotes, useStore, type LineNote } from '../store.ts';

// Review comments on code lines (Source Control diff or a plain file), sent to an agent in one go.
// Each comment is a Monaco view zone under its lines; the card inside is its own React root so that
// Monaco, which listens on its whole DOM, never sees the clicks and keys typed into it.

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

type Editor = any; // monaco.editor.ICodeEditor (Monaco is loaded lazily)
type Monaco = any;

interface Target {
  file: string;
  root?: string;
  side: LineNote['side'];
}

const rangeOf = (ed: Editor, line: number): [number, number] => {
  const sel = ed.getSelection();
  if (sel && !sel.isEmpty() && sel.startLineNumber <= line && line <= sel.endLineNumber) {
    // a selection ending at column 1 does not really include that last line
    const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
    return [sel.startLineNumber, end];
  }
  return [line, line];
};

/** Hooks one Monaco editor (or one side of a diff) up to the comments of `file`. */
export function LineNotes({ editor, monaco, file, root, side }: Target & { editor?: Editor; monaco?: Monaco }) {
  const all = useStore((s) => s.notes);
  const notes = useMemo(() => all.filter((n) => n.file === file && n.root === root && n.side === side), [all, file, root, side]);
  const notesKey = notes.map((n) => `${n.id}:${n.line}:${n.endLine}:${n.text}`).join('|');
  const [draft, setDraft] = useState<{ line: number; endLine: number }>();

  // "+" in the gutter of the hovered line, click it (or right-click → "Nhận xét cho agent")
  useEffect(() => {
    if (!editor || !monaco) return;
    editor.updateOptions({ glyphMargin: true });
    const hover = editor.createDecorationsCollection();
    const open = (line: number) => {
      const [a, b] = rangeOf(editor, line);
      setDraft({ line: a, endLine: b });
    };
    const subs = [
      editor.onMouseMove((e: any) => {
        const ln = e.target.position?.lineNumber;
        hover.set(ln ? [{ range: new monaco.Range(ln, 1, ln, 1), options: { glyphMarginClassName: 'note-add' } }] : []);
      }),
      editor.onMouseLeave(() => hover.clear()),
      editor.onMouseDown((e: any) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) open(e.target.position.lineNumber);
      }),
      editor.addAction({
        id: 'agentdesk.lineNote',
        label: 'Nhận xét cho agent',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0,
        run: (ed: Editor) => open(ed.getPosition()?.lineNumber ?? 1),
      }),
    ];
    return () => {
      try {
        subs.forEach((d) => d.dispose());
        hover.clear();
      } catch {
        /* editor already disposed */
      }
    };
  }, [editor, monaco]);

  // commented lines stay marked
  useEffect(() => {
    if (!editor || !monaco) return;
    const c = editor.createDecorationsCollection(
      notes.map((n) => ({ range: new monaco.Range(n.line, 1, n.endLine, 1), options: { isWholeLine: true, className: 'note-line', glyphMarginClassName: 'note-glyph' } })),
    );
    return () => {
      try {
        c.clear();
      } catch {
        /* editor already disposed */
      }
    };
  }, [editor, monaco, notesKey]);

  // one zone per comment, plus the one being written
  useEffect(() => {
    if (!editor?.getModel()) return;
    const lineCount = editor.getModel()?.getLineCount() ?? 1;
    const items: { key: string; after: number; render: (onHeight: (h: number) => void) => React.ReactNode }[] = notes.map((n) => ({
      key: n.id,
      after: Math.min(n.endLine, lineCount),
      render: (onHeight) => <NoteCard note={n} onHeight={onHeight} />,
    }));
    if (draft) {
      items.push({
        key: 'draft',
        after: Math.min(draft.endLine, lineCount),
        render: (onHeight) => (
          <DraftCard
            label={draft.line === draft.endLine ? `dòng ${draft.line}` : `dòng ${draft.line}–${draft.endLine}`}
            onHeight={onHeight}
            onCancel={() => setDraft(undefined)}
            onSave={(text) => {
              const model = editor.getModel();
              const code = [];
              for (let l = draft.line; l <= Math.min(draft.endLine, lineCount); l++) code.push(model.getLineContent(l));
              addNote({ file, root, side, line: draft.line, endLine: draft.endLine, code: code.join('\n'), text });
              setDraft(undefined);
            }}
          />
        ),
      });
    }
    const made: { zone: any; id: string; root: Root }[] = [];
    editor.changeViewZones((acc: any) => {
      for (const it of items) {
        const node = document.createElement('div');
        node.className = 'note-zone';
        // keep Monaco (listening higher up) from turning these into editor clicks / keystrokes
        for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu', 'pointerdown']) node.addEventListener(ev, (e) => e.stopPropagation());
        const zone = { afterLineNumber: it.after, heightInPx: 84, domNode: node };
        const id = acc.addZone(zone);
        const r = createRoot(node);
        r.render(
          it.render((h) => {
            if (Math.abs(zone.heightInPx - h) < 1) return;
            zone.heightInPx = h;
            editor.changeViewZones((a: any) => a.layoutZone(id));
          }),
        );
        made.push({ zone, id, root: r });
      }
    });
    return () => {
      try {
        editor.changeViewZones((acc: any) => made.forEach((m) => acc.removeZone(m.id)));
      } catch {
        /* editor already disposed */
      }
      // unmounting inside React's own commit would warn
      setTimeout(() => made.forEach((m) => m.root.unmount()));
    };
  }, [editor, notesKey, draft]);

  return null;
}

function useHeight(onHeight: (h: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight + 12);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

function DraftCard({ label, initial = '', onSave, onCancel, onHeight }: { label: string; initial?: string; onSave: (text: string) => void; onCancel: () => void; onHeight: (h: number) => void }) {
  const ref = useHeight(onHeight);
  const [text, setText] = useState(initial);
  const save = () => text.trim() && onSave(text.trim());
  return (
    <div ref={ref} className="note-card">
      <textarea
        autoFocus
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={`Nhận xét cho agent về ${label}…`}
        className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[11.5px] text-faint">{MOD}Enter để lưu · Esc để huỷ</span>
        <button type="button" onClick={onCancel} className="ml-auto rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-hover hover:text-fg">
          Huỷ
        </button>
        <button type="button" onClick={save} disabled={!text.trim()} className="rounded-md bg-accent px-2.5 py-0.5 text-[12.5px] font-medium text-white disabled:opacity-40">
          {initial ? 'Lưu' : 'Thêm nhận xét'}
        </button>
      </div>
    </div>
  );
}

function NoteCard({ note, onHeight }: { note: LineNote; onHeight: (h: number) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useHeight(onHeight);
  const total = useStore((s) => s.notes.length);
  if (editing)
    return (
      <div ref={ref}>
        <DraftCard
          label={`dòng ${note.line}`}
          initial={note.text}
          onHeight={() => {}}
          onCancel={() => setEditing(false)}
          onSave={(t) => {
            editNote(note.id, t);
            setEditing(false);
          }}
        />
      </div>
    );
  return (
    <div ref={ref} className="note-card group/note">
      <div className="flex items-start gap-2">
        <MessageSquarePlus size={14} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] text-fg">{note.text}</div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/note:opacity-100">
          <button type="button" title="Sửa" onClick={() => setEditing(true)} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <Pencil size={12} />
          </button>
          <button type="button" title="Xoá" onClick={() => removeNote(note.id)} className="rounded p-1 text-muted hover:bg-hover hover:text-err">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center pl-[22px] text-[11.5px] text-faint">
        {note.line === note.endLine ? `Dòng ${note.line}` : `Dòng ${note.line}–${note.endLine}`}
        <button type="button" onClick={sendNotes} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">
          <Send size={11} /> Gửi {total > 1 ? `${total} nhận xét` : 'nhận xét'} cho agent
        </button>
      </div>
    </div>
  );
}
