// 서버 상태에서 화면을 고르는 순수 함수들. 단위 테스트 대상.
import type { PublicGame } from '../shared/protocol';
import { noticeMs } from '../shared/timing';
import type { LogEvent, Seat } from '../shared/types';
import { nickName } from './nick';
import type { RoomView } from './store';

export const BOT_CHAR = 7; // 에셋 캐릭터 7 = 로봇
export interface SeatView { seat: Seat; charId: number; name: string; isBot: boolean; taken: boolean; connected: boolean }

/** 자리 4개. 사람이 앉은 적 없는 자리는 로봇, 끊겨 봇이 된 자리는 자기 캐릭터·별명 그대로 */
export function seatViews(r: RoomView): SeatView[] {
  return r.seats.map((s, i) => {
    const seat = i as Seat;
    if (!s.taken) return { seat, charId: BOT_CHAR, name: `로봇 ${i + 1}`, isBot: true, taken: false, connected: false };
    return { seat, charId: s.charId + 1, name: nickName(s.nick), isBot: s.isBot, taken: true, connected: s.connected };
  });
}

export type StepView =
  | { kind: 'none' }
  | { kind: 'island' } // 내 차례인데 무인도: 탈출 고르기
  | { kind: 'travel' }
  | { kind: 'culture'; tile: number; firstVisit: boolean }
  | { kind: 'question' }
  | { kind: 'explanation' }
  | { kind: 'tf' }
  | { kind: 'toll' }
  | { kind: 'action' }
  | { kind: 'takeover' }
  | { kind: 'shield' }
  | { kind: 'mission' }
  | { kind: 'reward' }
  | { kind: 'pickTile' }
  | { kind: 'festival' };

/** 지금 단계가 띄울 오버레이. 누가 입력하는지는 화면이 seat 로 가른다 */
export function stepView(g: PublicGame, log: LogEvent[], me: Seat | null): StepView {
  const t = g.turn;
  if (g.phase !== 'playing') return { kind: 'none' };
  switch (t.step) {
    case 'roll': return t.seat === me && g.players[t.seat].islandTurns > 0 ? { kind: 'island' } : { kind: 'none' };
    case 'culture': {
      const cc = lastOf(log, 'culture_card');
      return { kind: 'culture', tile: t.tile ?? 0, firstVisit: cc?.firstVisit ?? true };
    }
    // tfResult(참/거짓 결과 2초, U10): 같은 창이 결과로 바뀐다(TfRow 결과 상태 · 미션은 같은 패널)
    case 'tf': case 'tfResult': return t.missionId ? { kind: 'mission' } : { kind: 'tf' };
    default: return { kind: t.step };
  }
}

export function lastOf<K extends LogEvent['ev']>(log: LogEvent[], ev: K): Extract<LogEvent, { ev: K }> | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].ev === ev) return log[i] as Extract<LogEvent, { ev: K }>;
  return undefined;
}

/** 순위: 파산 아님 → 자산(코인 + 땅·건물) 큰 순. 화면용 근사라 엔진의 assetsOf 를 그대로 쓴다 */
export function ranking(g: PublicGame, assets: (seat: number) => number): Seat[] {
  return g.players.map((_, i) => i as Seat).sort((a, b) =>
    Number(g.players[a].bankrupt) - Number(g.players[b].bankrupt) || assets(b) - assets(a) || a - b);
}

/** 떨어진 화면 알림: 새 로그에서 모두에게 잠깐 보여 줄 것(이벤트 카드·통행료 결과·랜드마크 컷씬) */
export type Notice =
  | { kind: 'event'; ev: Extract<LogEvent, { ev: 'event' }> }
  | { kind: 'toll'; ev: Extract<LogEvent, { ev: 'toll' }>; takeoverNext: boolean }
  /** t0: 재접속으로 이어 보는 컷씬의 서버 시작 시각(DESIGN §12.3). 새로 세운 것이면 없음 */
  | { kind: 'cutscene'; seat: Seat; tile: number; t0?: number };

/** 알림 규칙(어떤 로그가 알림을 띄우나·몇 초)은 서버와 같은 shared/timing noticeMs 한 곳(PRD §4.3 U10) — 서버가 마감에 더한 시간과 화면이 어긋나지 않게 */
export function noticesFrom(fresh: LogEvent[], g: PublicGame | null): Notice[] {
  const out: Notice[] = [];
  for (const e of fresh) {
    if (e.ev === 'event' && noticeMs(e) > 0) out.push({ kind: 'event', ev: e });
    // 인수 단계로 넘어가면 행동 패널이 같은 문구를 보여 주므로 알림은 안 띄운다(noticeMs = 0)
    if (e.ev === 'toll') {
      const takeoverNext = g?.turn.step === 'takeover' && g.turn.tile === e.tile;
      if (noticeMs(e, takeoverNext) > 0) out.push({ kind: 'toll', ev: e, takeoverNext });
    }
    if (e.ev === 'build' && e.level === 4) out.push({ kind: 'cutscene', seat: e.seat, tile: e.tile });
  }
  return out;
}

/** 알림 한 장이 보이는 시간(컷씬은 제 길이라 0 = 타이머 없음) */
export const noticeShowMs = (n: Notice): number => (n.kind === 'cutscene' ? 0 : n.kind === 'toll' ? noticeMs(n.ev, n.takeoverNext) : noticeMs(n.ev));
