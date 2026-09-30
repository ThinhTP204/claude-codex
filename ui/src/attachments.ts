import { TOKEN } from './api.ts';

/** Something attached to a chat message: an uploaded file (absolute path) or a project file reference. */
export interface Attachment {
  id: string;
  name: string;
  /** absolute path of an uploaded file, or a project-relative path for files dragged from the Explorer */
  path?: string;
  image?: boolean;
  /** local preview while uploading */
  preview?: string;
  uploading?: boolean;
}

/** Drag payload used by the Explorer. */
export const REF_MIME = 'application/x-agentdesk-ref';

const MARK = '📎 Đính kèm:';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
export const isImage = (name: string) => IMAGE_RE.test(name);

export async function uploadFile(file: File): Promise<string> {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name || 'paste.png')}`, {
    method: 'POST',
    headers: { 'x-agentdesk-token': TOKEN, 'content-type': 'application/octet-stream' },
    body: file,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data.path as string;
}

/** Message text sent to the agent: attachments go in a plain list the agent can open by path. */
export function withAttachments(text: string, atts: Attachment[]): string {
  const paths = atts.filter((a) => a.path).map((a) => `- ${a.path}`);
  if (!paths.length) return text;
  return `${text.trim() || 'Xem các file đính kèm.'}\n\n${MARK}\n${paths.join('\n')}`;
}

/** Split a sent message back into its text and attachment paths (for display). */
export function splitAttachments(text: string): { text: string; paths: string[] } {
  const i = text.lastIndexOf(`\n\n${MARK}\n`);
  if (i < 0) return { text, paths: [] };
  const paths = text
    .slice(i + MARK.length + 3)
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean);
  return { text: text.slice(0, i), paths };
}

export const attachmentUrl = (path: string) => `/api/attachment?path=${encodeURIComponent(path)}&token=${encodeURIComponent(TOKEN)}`;

/** "/…/attachments/2026-09-30/ab12cd-shot.png" → "shot.png" */
export const displayName = (path: string) => (path.split(/[\\/]/).pop() || path).replace(/^[0-9a-f]{6}-/, '');
