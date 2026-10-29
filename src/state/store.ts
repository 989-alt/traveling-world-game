// 클라이언트 상태 = 서버가 보낸 것 그대로 + 이어 붙인 로그. 로컬 추측은 없다: 화면은 이 값만 그린다.
import { stepKey, type ErrorCode, type ServerMsg } from '../shared/protocol';
import type { LogEvent, Seat } from '../shared/types';

export type RoomMsg = Extract<ServerMsg, { t: 'state' }>;
export type RoomView = Omit<RoomMsg, 't' | 'log' | 'logFrom' | 'now'>;
export type Conn = 'idle' | 'connecting' | 'open' | 'retrying' | 'replaced';

export interface ClientState {
  conn: Conn;
  code: string | null;
  seat: Seat | null;
  pin: string | null;
  room: RoomView | null;
  log: LogEvent[];
  /** 마지막 메시지로 새로 붙은 로그(전체 다시 받기면 빈 배열). 컷씬·이벤트 카드는 이것만 본다 */
  fresh: LogEvent[];
  /** 메시지를 받을 때마다 +1 (같은 내용이 다시 와도 효과가 다시 돌지 않게 fresh 와 짝으로 쓴다) */
  seq: number;
  /** 마지막 메시지가 전체 다시 받기(logFrom 0)였다 → 쌓인 알림은 버린다 */
  resynced: boolean;
  pins: { seat: Seat; pin: string }[] | null;
  error: ErrorCode | null;
  /** 로그에 구멍이 났다 → sync 를 보내야 함 */
  needSync: boolean;
  /** 서버 시계 − 기기 시계(ms) 추정. 마감 표시에만 쓴다 */
  skew: number;
  /** 마지막 state 를 받은 이 기기 시각. 놀이 시계 간판이 다음 상태까지 1초씩 줄여 보이는 기준(표시만) */
  clockAt: number;
}

export const initialState = (code: string | null = null): ClientState => ({
  conn: 'idle', code, seat: null, pin: null, room: null, log: [], fresh: [], seq: 0, resynced: false, pins: null, error: null, needSync: false, skew: 0, clockAt: 0,
});

export const stepKeyOf = (r: RoomView | null, logLen: number) =>
  r?.game && r.phase === 'playing' ? stepKey(r.game.turn.seat, r.game.turn.step, logLen) : r?.phase ?? '';

export function reduce(s: ClientState, msg: ServerMsg, now = Date.now()): ClientState {
  switch (msg.t) {
    case 'welcome': return { ...s, seat: msg.seat, pin: msg.pin, error: null };
    case 'pins': return { ...s, pins: msg.pins };
    case 'error': return { ...s, error: msg.code };
    case 'state': {
      const { t: _t, log: chunk, logFrom, now: serverNow, ...room } = msg;
      let log: LogEvent[];
      let fresh: LogEvent[] = [];
      let needSync = false;
      if (logFrom === 0) log = chunk; // 전체 다시 받기: 지난 일은 다시 재생하지 않는다
      else if (logFrom <= s.log.length) {
        log = [...s.log.slice(0, logFrom), ...chunk];
        fresh = chunk.slice(s.log.length - logFrom);
      } else { log = s.log; needSync = true; } // 구멍: 붙이지 않고 다시 받는다
      // 시계 차이: 서버가 실어 보낸 현재 시각으로 매 메시지(전체 다시 받기·증분 모두) 다시 잰다.
      // stepAt(단계 시작 시각)은 '지금'이 아니므로 쓰지 않는다. now 가 없는 옛 서버면 이전 값 유지
      const skew = typeof serverNow === 'number' && Number.isFinite(serverNow) ? serverNow - now : s.skew;
      return { ...s, code: room.code, room, log, fresh, seq: s.seq + 1, resynced: logFrom === 0, needSync, skew, clockAt: now };
    }
    default: return s; // 모르는 메시지(새 서버 판 등)는 무시
  }
}

/** 이 기기 시계로 본 마감 */
export const localDeadline = (s: ClientState) => (s.room?.deadlineAt ? s.room.deadlineAt - s.skew : null);
