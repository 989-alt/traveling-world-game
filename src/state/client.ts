// 화면 ↔ 서버 사이 하나뿐인 연결 관리자. 상태는 reduce() 로만 바뀌고, 자리 정보는 기기에 저장해 끊겨도 돌아온다.
import { useEffect, useState } from 'preact/hooks';
import { RoomSocket, roomUrl, type RoomSocketOpts } from '../net/socket';
import { ENDED_CLOSE, PIN_TRY_MS, type ClientAct, type ClientMsg, type ServerMsg } from '../shared/protocol';
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
  /** 이 기기(방장)가 끝내기를 보냈다 → ended 를 받아도 안내 띠 없이 첫 화면(DESIGN §20.3) */
  private ending = false;
  /** 소켓 세대: 닫거나 떠난 소켓의 늦은 메시지·닫힘이 새 화면을 건드리지 않게 */
  private gen = 0;

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
    const gen = ++this.gen;
    const live = () => gen === this.gen;
    this.sock = new RoomSocket({
      url: this.urlOf(code),
      make: this.make,
      greet: () => (this.rejoin ? { t: 'rejoin', ...this.rejoin } : this.hello !== null ? { t: 'hello', charId: this.hello } : null),
      onStatus: (conn) => { if (live()) this.set({ ...this.state, conn }); },
      onMsg: (m) => { if (live()) this.onMsg(m); },
      // 4001 ended(메시지를 못 받았어도) · 4002 left: 다시 잇지 않고 첫 화면
      onFinal: (c) => { if (live()) this.finish(c === ENDED_CLOSE && !this.ending ? 'ended' : null); },
    });
  }

  close() {
    this.gen++;
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

  /** 방장: 게임 끝내기(U14). 서버가 ended 를 보내고 소켓을 4001 로 닫으면 첫 화면으로. 못 보냈으면 false */
  endGame(): boolean {
    this.ending = true;
    const ok = this.send({ t: 'end' });
    if (!ok) this.ending = false;
    return ok;
  }

  /** 학생: 게임 나가기(U14). 보내고 바로 첫 화면·저장 자리 삭제. 소켓은 서버가 4002 로 닫을 때까지(최대 3초) 두어 메시지가 닿게 한다 */
  leaveGame() {
    const sock = this.sock;
    this.sock = null;
    sock?.send({ t: 'leave' });
    if (sock) setTimeout(() => sock.close(), 3_000);
    this.finish(null);
  }

  /** 판에서 첫 화면으로: 다시 잇지 않고 저장 자리를 지운다(PRD §9.4). bye = 첫 화면 안내 띠 */
  private finish(bye: ClientState['bye']) {
    this.close();
    saveSeat(null);
    this.rejoin = null;
    this.hello = null;
    this.fromSaved = false;
    this.ending = false;
    this.set({ ...initialState(), bye });
  }

  /** 첫 화면 안내 띠를 내린다 */
  dismissBye() { if (this.state.bye) this.set({ ...this.state, bye: null }); }

  private onMsg(m: ServerMsg) {
    if (m.t === 'ended') { this.finish(this.ending ? null : 'ended'); return; }
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
