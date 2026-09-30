const params = new URLSearchParams(location.search);
const fromUrl = params.get('token');
if (fromUrl) sessionStorage.setItem('agentdesk-token', fromUrl);
export const TOKEN = fromUrl || sessionStorage.getItem('agentdesk-token') || '';
export const URL_PROJECT = params.get('project');
if (fromUrl || URL_PROJECT) history.replaceState(null, '', location.pathname);

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { 'x-agentdesk-token': TOKEN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data as T;
}

export const qs = (o: Record<string, string | undefined>) =>
  '?' + Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');

export function connectWs(onMessage: (msg: any) => void, onOpen: () => void): void {
  let retry = 0;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${TOKEN}`);
    (window as any).__ws = ws;
    ws.onopen = () => {
      retry = 0;
      onOpen();
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => setTimeout(open, Math.min(5000, 300 * 2 ** retry++));
  };
  open();
}

export function wsSend(msg: unknown): void {
  const ws: WebSocket | undefined = (window as any).__ws;
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}
