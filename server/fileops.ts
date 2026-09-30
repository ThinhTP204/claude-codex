// Explorer file operations (VS Code style). Deleting always goes to the OS trash, never rm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { safeJoin } from './projects.ts';
import { isWin } from './platform.ts';

const inside = (root: string, rel: string) => {
  const abs = safeJoin(root, rel);
  if (abs === root) throw new Error('Không thao tác trên chính thư mục project');
  return abs;
};

const exec = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<void>((resolve, reject) =>
    execFile(cmd, args, { timeout: 30_000, windowsHide: true, env: { ...process.env, ...env } }, (err, _o, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim())) : resolve(),
    ),
  );

/** Move to the Trash / Recycle Bin so the user can get it back. */
async function toTrash(abs: string): Promise<void> {
  if (process.platform === 'darwin') {
    if (fs.existsSync('/usr/bin/trash')) return exec('/usr/bin/trash', [abs]);
    // older macOS: move into ~/.Trash ourselves (no "Put Back", but recoverable)
    const bin = path.join(os.homedir(), '.Trash');
    let dest = path.join(bin, path.basename(abs));
    if (fs.existsSync(dest)) dest = path.join(bin, `${path.basename(abs)} ${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.renameSync(abs, dest);
    return;
  }
  if (isWin) {
    // path goes through an env var: no quoting games with PowerShell
    const script =
      "Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:AGENTDESK_TRASH; " +
      "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } " +
      "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }";
    return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { AGENTDESK_TRASH: abs });
  }
  return exec('gio', ['trash', abs]).catch(() => {
    throw new Error('Không tìm thấy thùng rác (cần lệnh `gio`). File chưa bị xoá.');
  });
}

export async function deletePath(root: string, rel: string): Promise<void> {
  const abs = inside(root, rel);
  if (!fs.existsSync(abs)) throw new Error('File không còn tồn tại');
  await toTrash(abs);
}

export function renamePath(root: string, from: string, to: string): void {
  const a = inside(root, from);
  const b = inside(root, to);
  if (fs.existsSync(b)) throw new Error(`"${to}" đã tồn tại`);
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(a, b);
}

export function createPath(root: string, rel: string, dir: boolean): void {
  const abs = inside(root, rel);
  if (fs.existsSync(abs)) throw new Error(`"${rel}" đã tồn tại`);
  if (dir) fs.mkdirSync(abs, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
  }
}

/** Show in Finder / Explorer / the file manager. */
export function revealPath(root: string, rel: string): Promise<void> {
  const abs = rel ? safeJoin(root, rel) : root;
  if (process.platform === 'darwin') return exec('open', ['-R', abs]);
  if (isWin) return exec('explorer.exe', [`/select,${abs}`]).catch(() => undefined);
  return exec('xdg-open', [path.dirname(abs)]);
}
