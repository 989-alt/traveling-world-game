import { describe, expect, it } from 'vitest';
import { createGame } from '../../engine/engine';
import type { PublicGame } from '../../shared/protocol';
import type { LogEvent } from '../../shared/types';
import { josa, nickName } from '../nick';
import { noticesFrom, seatViews, stepView } from '../view';

const pub = (): PublicGame => {
  const { rngSeed: _a, rngState: _b, log: _c, ...g } = createGame({ seed: 3 });
  return { ...g, turn: { ...g.turn, question: null, tf: null, mission: null } };
};

describe('stepView', () => {
  it('문화 카드: 마지막 culture_card 의 첫 방문 여부', () => {
    const g = pub();
    g.turn.step = 'culture';
    g.turn.tile = 2;
    const log: LogEvent[] = [{ ev: 'culture_card', seat: 0, country: 'th', firstVisit: false, badgeShown: false }];
    expect(stepView(g, log, 0)).toEqual({ kind: 'culture', tile: 2, firstVisit: false });
  });
  it('미션 뒤 참/거짓은 미션 패널이, 나라 칸 참/거짓은 해설 카드가', () => {
    const g = pub();
    g.turn.step = 'tf';
    expect(stepView(g, [], 1).kind).toBe('tf');
    g.turn.missionId = 'm-1';
    expect(stepView(g, [], 1).kind).toBe('mission');
  });
  it('무인도 탈출 패널은 내 차례 roll 에서만', () => {
    const g = pub();
    g.players[0].islandTurns = 2;
    expect(stepView(g, [], 0).kind).toBe('island');
    expect(stepView(g, [], 1).kind).toBe('none');
  });
});

describe('noticesFrom', () => {
  it('이벤트·통행료·랜드마크 컷씬, 탈출·관광지는 뺀다, 인수 단계로 이어지는 통행료도 뺀다', () => {
    const g = pub();
    const fresh: LogEvent[] = [
      { ev: 'event', seat: 0, kind: 'island', payload: {} },
      { ev: 'event', seat: 0, kind: 'island', payload: { escape: 'coin' } },
      { ev: 'event', seat: 0, kind: 'tourist', payload: { tile: 9 } },
      { ev: 'toll', payer: 0, owner: 1, tile: 5, base: 84, multiplier: 1, discounted: false, paid: 84 },
      { ev: 'build', seat: 1, tile: 22, level: 3, cost: 1 },
      { ev: 'build', seat: 1, tile: 22, level: 4, cost: 1 },
    ];
    expect(noticesFrom(fresh, g).map((n) => n.kind)).toEqual(['event', 'toll', 'cutscene']);
    g.turn.step = 'takeover';
    g.turn.tile = 5;
    expect(noticesFrom(fresh, g).map((n) => n.kind)).toEqual(['event', 'cutscene']);
  });
});

describe('seatViews·별명', () => {
  it('빈자리는 로봇(에셋 7), 사람은 charId+1', () => {
    const v = seatViews({ seats: [
      { taken: true, isBot: false, connected: true, nick: [0, 0], charId: 2 },
      { taken: false, isBot: false, connected: false, nick: [0, 0], charId: 0 },
      { taken: true, isBot: true, connected: false, nick: [1, 2], charId: 5 },
      { taken: false, isBot: false, connected: false, nick: [0, 0], charId: 0 },
    ] } as never);
    expect(v.map((x) => x.charId)).toEqual([3, 7, 6, 7]);
    expect(v[2]).toMatchObject({ name: nickName([1, 2]), isBot: true });
  });
  it('별명은 7자 이하, 받침에 맞는 조사', () => {
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) expect(nickName([a, b]).length).toBeLessThanOrEqual(7);
    expect(josa('수달', '이', '가')).toBe('수달이');
    expect(josa('판다', '이', '가')).toBe('판다가');
  });
});
