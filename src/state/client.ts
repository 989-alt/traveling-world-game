// 화면 ↔ 서버 사이 하나뿐인 연결 관리자. 상태는 reduce() 로만 바뀌고, 자리 정보는 기기에 저장해 끊겨도 돌아온다.
import { useEffect, useState } from 'preact/hooks';
import { RoomSocket, roomUrl, type RoomSocketOpts } from '../net/socket';
import { PIN_TRY_MS, type ClientAct, type ClientMsg, type ServerMsg } from '../shared/protocol';
import type { Seat } from '../shared/types';
import { loadSeat, saveSeat, type SavedSeat } from './seat-store';
import { initialState, reduce, type ClientState } from './store';

type Make = RoomSocketOpts['make'];

export class GameClient {
  state: ClientState = initialState();
  private sock: RoomSocket | null = null;
  private listeners = new Set<(s: ClientState) => void>();
  private rejoin: { seat: Seat; pin: string } | null = null;
  private hello: number | null = null;
  /** 자동 복귀(이 기기에 저장된 자리)로 들어왔는지 — PIN 이 틀리면('pin') 저장을 지운다 */
  private fromSaved = false;
  /** 'locked' 뒤 같은 PIN 을 다시 보낼 타이머 */
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private make?: Make, private urlOf: (code: string) => string = roomUrl) {}

  subscribe(f: (s: ClientState) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private set(s: ClientState) { this.state = s; this.listeners.forEach((f) => f(s)); }

  /** 이 기기에 남은 자리가 있으면 그 방으로 바로 돌아간다 */
  resumeSaved(): boolean {
    const v = loadSeat();
    if (!v) return false;
    this.fromSaved = true;
    this.open(v.roomCode, { seat: v.seatNo, pin: v.seatPin });
    return true;
  }

  /** 방 코드로 들어가 구경부터 한다(로비면 캐릭터를 고르고, 이미 시작했으면 자리 PIN 을 넣는다) */
  open(code: string, rejoin: { seat: Seat; pin: string } | null = null) {
    this.close();
    this.rejoin = rejoin;
    this.hello = null;
    this.set({ ...initialState(code), conn: 'connecting' });
    this.sock = new RoomSocket({
      url: this.urlOf(code),
      make: this.make,
      greet: () => (this.rejoin ? { t: 'rejoin', ...this.rejoin } : this.hello !== null ? { t: 'hello', charId: this.hello } : null),
      onStatus: (conn) => this.set({ ...this.state, conn }),
      onMsg: (m) => this.onMsg(m),
    });
  }

  close() {
    clearTimeout(this.retry);
    this.sock?.close();
    this.sock = null;
  }

  /** 처음 보는 기기: 방으로 돌아가지 않고 입장 화면으로 */
  leave() {
    this.close();
    saveSeat(null);
    this.rejoin = null;
    this.set(initialState());
  }

  private onMsg(m: ServerMsg) {
    const s = reduce(this.state, m);
    if (m.t === 'welcome') {
      this.rejoin = { seat: m.seat, pin: m.pin };
      this.hello = null;
      this.fromSaved = false;
      saveSeat({ roomCode: s.code!, seatNo: m.seat, seatPin: m.pin } satisfies SavedSeat);
    }
    if (m.t === 'error' && m.code === 'pin') {
      // 틀린 PIN: 다시 이을 때 또 보내지 않는다. 저장된 자리였으면 지우고 PIN 입력 화면으로
      if (this.fromSaved) saveSeat(null);
      this.rejoin = null;
      this.fromSaved = false;
    }
    if (m.t === 'error' && m.code === 'locked' && this.rejoin) {
      // 잠긴 자리라 PIN 을 확인하지 않은 거부: 저장은 남기고 서버 비교 간격 뒤 같은 PIN 을 다시 보낸다
      clearTimeout(this.retry);
      this.retry = setTimeout(() => { if (this.rejoin) this.send({ t: 'rejoin', ...this.rejoin }); }, PIN_TRY_MS);
    }
    this.set(s);
    if (s.needSync) this.send({ t: 'sync' });
  }

  send(m: ClientMsg) {
    if (m.t !== 'sync' && this.state.error) this.set({ ...this.state, error: null });
    return this.sock?.send(m) ?? false;
  }
  act(a: ClientAct) { return this.send({ t: 'act', a }); }

  join(charId: number) {
    this.hello = charId;
    this.send({ t: 'hello', charId });
  }

  claim(seat: Seat, pin: string) {
    this.rejoin = { seat, pin };
    this.send({ t: 'rejoin', seat, pin });
  }

  /** 탭이 다시 보이면 서버 상태를 다시 받는다 */
  resync() { this.send({ t: 'sync' }); }
}

export function useClient(c: GameClient) {
  const [s, setS] = useState(c.state);
  useEffect(() => c.subscribe(setS), [c]);
  return s;
}
