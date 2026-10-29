import { describe, expect, it } from 'vitest';
import { createGame } from '../../engine/engine';
import type { ServerMsg } from '../../shared/protocol';
import type { LogEvent } from '../../shared/types';
import { initialState, localDeadline, reduce } from '../store';

const ev = (n: number): LogEvent => ({ ev: 'dice', seat: 0, d1: n, d2: n });
function stateMsg(logFrom: number, log: LogEvent[], patch: Partial<Extract<ServerMsg, { t: 'state' }>> = {}): ServerMsg {
  const { rngSeed: _a, rngState: _b, log: _c, ...g } = createGame({ seed: 1 });
  return {
    t: 'state', code: 'ABCDEF', phase: 'playing', settings: g.settings, hostSeat: 0,
    seats: [0, 1, 2, 3].map(() => ({ taken: true, isBot: false, connected: true, nick: [0, 0] as [number, number], charId: 0 })),
    game: { ...g, turn: { ...g.turn, question: null, tf: null, mission: null } }, deadlineAt: 100_000, stepAt: 80_000, now: 90_000, cards: [], logFrom, log, ...patch,
  } as ServerMsg;
}

describe('reduce', () => {
  it('logFrom 0 은 전체 교체, 새 로그(fresh)는 없음 — 지난 컷씬을 다시 틀지 않는다', () => {
    const s = reduce(initialState(), stateMsg(0, [ev(1), ev(2)]));
    expect(s.log).toHaveLength(2);
    expect(s.fresh).toEqual([]);
  });

  it('이어 붙이기: fresh 는 새로 붙은 것만, 겹치면 겹친 만큼 뺀다', () => {
    let s = reduce(initialState(), stateMsg(0, [ev(1)]));
    s = reduce(s, stateMsg(1, [ev(2), ev(3)]));
    expect(s.log.map((e) => (e as { d1: number }).d1)).toEqual([1, 2, 3]);
    expect(s.fresh).toHaveLength(2);
    s = reduce(s, stateMsg(2, [ev(3), ev(4)])); // 3 은 이미 있음
    expect(s.log).toHaveLength(4);
    expect(s.fresh.map((e) => (e as { d1: number }).d1)).toEqual([4]);
  });

  it('모르는 메시지는 상태를 그대로 둔다, 전체 다시 받기는 resynced', () => {
    const s0 = reduce(initialState(), stateMsg(0, [ev(1)]));
    expect(s0.resynced).toBe(true);
    expect(reduce(s0, { t: 'nope' } as unknown as ServerMsg)).toBe(s0);
    expect(reduce(s0, stateMsg(1, [ev(2)])).resynced).toBe(false);
  });

  it('구멍이 나면 붙이지 않고 needSync', () => {
    let s = reduce(initialState(), stateMsg(0, [ev(1)]));
    s = reduce(s, stateMsg(5, [ev(6)]));
    expect(s.log).toHaveLength(1);
    expect(s.needSync).toBe(true);
  });

  it('오류는 뒤따르는 상태 재전송에 지워지지 않는다', () => {
    let s = reduce(initialState(), { t: 'error', code: 'pin' });
    s = reduce(s, stateMsg(0, []));
    expect(s.error).toBe('pin');
    s = reduce(s, { t: 'welcome', seat: 2, pin: '0042' });
    expect(s.error).toBeNull();
    expect([s.seat, s.pin]).toEqual([2, '0042']);
  });

  // QA5-skew: 서버 now 로 매 메시지 시계 차이를 다시 잰다. 서버 시각 1 000 000 에 문항 시작(stepAt), 지금 서버 시각 1 000 700(0.7초 지남), 마감 1 020 000
  const SRV = { stepAt: 1_000_000, now: 1_000_700, deadlineAt: 1_020_000 };
  const question = (logFrom: number, log: LogEvent[]) => {
    const m = stateMsg(logFrom, log, SRV) as Extract<ServerMsg, { t: 'state' }>;
    m.game!.turn.step = 'question';
    return m;
  };

  for (const off of [60_000, -60_000, 0]) {
    it(`전체 다시 받기(logFrom 0, 새로고침·재접속)도 시계 차이를 잰다 — 기기 ${off >= 0 ? '+' : ''}${off / 1000}초`, () => {
      const device = SRV.now + off;
      const s = reduce(initialState(), question(0, [ev(1)]), device);
      expect(s.skew).toBe(0 - off);
      // 기기 시계로 본 남은 시간 = 서버 남은 시간(19.3초). stepAt 을 '지금'으로 보면 20초로 부풀었을 것
      expect(localDeadline(s)! - device).toBe(SRV.deadlineAt - SRV.now);
    });

    it(`증분 방송(단계 그대로)도 매번 다시 잰다 — 기기 ${off >= 0 ? '+' : ''}${off / 1000}초`, () => {
      let s = reduce(initialState(), question(0, [ev(1)]), SRV.now); // 처음엔 맞던 기기
      expect(s.skew).toBe(0);
      const m = question(1, [ev(2)]);
      m.now = SRV.now + 2_000; // 같은 단계 안의 다음 방송
      s = reduce(s, m, m.now + off); // 그사이 기기 시계가 off 만큼 틀어짐
      expect(s.skew).toBe(0 - off);
      expect(localDeadline(s)! - (m.now + off)).toBe(SRV.deadlineAt - m.now);
    });
  }

  it('구멍(needSync) 난 메시지도 now 는 믿을 수 있으므로 시계 차이를 잰다', () => {
    let s = reduce(initialState(), question(0, [ev(1)]), SRV.now);
    s = reduce(s, question(5, [ev(6)]), SRV.now - 60_000);
    expect(s.needSync).toBe(true);
    expect(s.skew).toBe(60_000);
  });

  it('stepAt 은 시계 차이에 안 쓴다(단계 시작 시각 ≠ 지금)', () => {
    const m = question(0, [ev(1)]);
    m.stepAt = SRV.now - 15_000; // 재접속: 문항이 15초 전에 시작됨
    const s = reduce(initialState(), m, SRV.now);
    expect(s.skew).toBe(0);
    expect(localDeadline(s)).toBe(SRV.deadlineAt);
  });

  it('now 가 없는 옛 서버 메시지는 이전 시계 차이를 유지하고, room 에 now 가 남지 않는다', () => {
    let s = reduce(initialState(), question(0, [ev(1)]), SRV.now - 5_000);
    expect(s.skew).toBe(5_000);
    const { now: _n, ...old } = question(1, [ev(2)]);
    s = reduce(s, old as ServerMsg, 0);
    expect(s.skew).toBe(5_000);
    expect('now' in s.room!).toBe(false);
  });
});
