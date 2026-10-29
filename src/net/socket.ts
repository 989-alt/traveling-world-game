// 방 소켓 하나. 끊기면 지수 백오프로 다시 잇고(첫 재시도 0.5초, 상한 10초), 이어지면 자리를 되찾는다(rejoin).
// 탭이 다시 보이면 sync 로 서버 상태를 통째로 다시 받는다 — 숨어 있던 동안의 일을 기기가 추측하지 않는다.
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { TotalMinutes } from '../shared/types';

export const BACKOFF_FIRST_MS = 500;
export const BACKOFF_MAX_MS = 10_000;
export const REPLACED = 4000;
/** n 번째(0부터) 재시도까지 기다릴 시간 */
export const backoff = (n: number) => Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** n);

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface RoomSocketOpts {
  url: string;
  /** 소켓이 열릴 때마다 먼저 보낼 메시지(자리 되찾기). null 이면 구경만 */
  greet: () => ClientMsg | null;
  onMsg: (m: ServerMsg) => void;
  onStatus: (s: 'connecting' | 'open' | 'retrying' | 'replaced') => void;
  make?: (url: string) => SocketLike;
  timers?: { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

export class RoomSocket {
  private ws: SocketLike | null = null;
  private tries = 0;
  private retry: unknown = null;
  private closed = false;
  private readonly make: (url: string) => SocketLike;
  private readonly timers: NonNullable<RoomSocketOpts['timers']>;

  constructor(private o: RoomSocketOpts) {
    this.make = o.make ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.timers = o.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as number) };
    this.open();
  }

  private open() {
    this.o.onStatus(this.tries ? 'retrying' : 'connecting');
    const ws = this.make(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.o.onStatus('open');
      const g = this.o.greet();
      if (g) this.send(g);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let m: ServerMsg;
      try { m = JSON.parse(e.data) as ServerMsg; } catch { return; } // 깨진 JSON 만 버린다
      if (!m || typeof m !== 'object') return;
      try { this.o.onMsg(m); } catch (err) { console.error('[net] 메시지 처리 실패', m.t, err); throw err; }
    };
    ws.onerror = () => { /* onclose 가 뒤따른다 */ };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      // 서버가 4000 으로 닫음 = 같은 자리에 다른 기기가 들어옴. 다시 이으면 서로 자리를 뺏으니 멈춘다
      if (e?.code === REPLACED) { this.closed = true; this.o.onStatus('replaced'); return; }
      this.o.onStatus('retrying');
      this.retry = this.timers.set(() => this.open(), backoff(this.tries++));
    };
  }

  send(m: ClientMsg): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  close() {
    this.closed = true;
    this.timers.clear(this.retry);
    this.ws?.close(1000);
    this.ws = null;
  }
}

export const roomUrl = (code: string, loc: Pick<Location, 'protocol' | 'host'> = location) =>
  `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/rooms/${code}/ws`;

export async function createRoom(settings: { totalMinutes: TotalMinutes }): Promise<string | null> {
  try {
    const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, touristQuiz: false }) });
    if (!res.ok) return null;
    return ((await res.json()) as { code: string }).code;
  } catch { return null; }
}
