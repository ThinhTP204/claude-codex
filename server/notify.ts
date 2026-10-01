// OS notifications when a session finishes, fails or waits for the user, sent only while no
// AgentDesk window is in front (otherwise the window shows its own toast + unread marker).
import { spawn } from 'node:child_process';
import type { Conversation, ServerMessage } from '../shared/types.ts';

interface ClientView {
  /** window focused and visible */
  focused: boolean;
  /** user turned OS notifications on */
  notify: boolean;
}

const views = new Map<object, ClientView>();
export const setClientView = (client: object, v: ClientView) => views.set(client, v);
export const dropClient = (client: object) => views.delete(client);

let broadcast: (msg: ServerMessage) => void = () => {};
export const setNotifyBroadcast = (fn: typeof broadcast) => (broadcast = fn);

const KIND_TITLE = { done: 'Xong', error: 'Gặp lỗi', awaiting: 'Chờ bạn duyệt' } as const;

export function sessionEvent(c: Conversation, kind: keyof typeof KIND_TITLE, text: string): void {
  const body = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  broadcast({ type: 'session:event', projectPath: c.projectPath, convId: c.id, title: c.title, kind, text: body });
  const all = [...views.values()];
  if (!all.some((v) => v.notify) || all.some((v) => v.focused)) return;
  osNotify(`${KIND_TITLE[kind]}: ${c.title.slice(0, 80)}`, body || c.title);
}

function osNotify(title: string, body: string): void {
  // text never goes into the script itself: environment on Windows, arguments on macOS
  const env = { ...process.env, AD_TITLE: title, AD_BODY: body };
  const opts = { env, stdio: 'ignore' as const, windowsHide: true, detached: false };
  let child;
  if (process.platform === 'darwin') {
    // text as arguments: AppleScript reads argv as UTF-8 (environment variables come out as MacRoman)
    const script = ['on run argv', 'display notification (item 2 of argv) with title "AgentDesk" subtitle (item 1 of argv) sound name "Glass"', 'end run'];
    child = spawn('osascript', [...script.flatMap((l) => ['-e', l]), title, body], opts);
  } else if (process.platform === 'win32') {
    const ps = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
      '$e = [System.Security.SecurityElement]',
      '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
      '$x.LoadXml("<toast><visual><binding template=""ToastGeneric""><text>" + $e::Escape($env:AD_TITLE) + "</text><text>" + $e::Escape($env:AD_BODY) + "</text></binding></visual></toast>")',
      // PowerShell's own AppUserModelID: always registered, so the toast shows without an installer
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe").Show([Windows.UI.Notifications.ToastNotification]::new($x))',
    ].join('; ');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], opts);
  } else {
    child = spawn('notify-send', ['-a', 'AgentDesk', title, body], opts);
  }
  child.on('error', () => {});
}
