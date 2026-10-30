import { describe, expect, it } from 'vitest';
import { apply, createGame, holdsReveal, stepMs } from '../engine';
import { botSeats } from '../bot';
import { ANTARCTIC_TILE, BOARD, continentTiles, CONTINENTS, monopolyNeedsBuilding, TRAVEL_TILE } from '../../shared/board';
import type { GameState, Seat } from '../../shared/types';
import { KOREA_BONUS, SALARY, STEP_MS, TAKEOVER_RATE } from '../../shared/economy';
import { TF_RESULT_MS } from '../../shared/timing';
import { answerAndSkip, arrive, edit, evs, full, landAndAnswer, last, newGame, run, sample, withDice } from './helpers';

const T = { type: 'timeout' } as const;
const own = (s: GameState, tile: number, owner: Seat, level: 0 | 1 | 2 | 3 | 4 = 0) =>
  edit(s, (d) => { d.tiles[tile] = { owner, level, festivalTarget: false }; });
/** 지금 턴이 끝날 때까지 timeout */
const settle = (s: GameState) => {
  const seat = s.turn.seat;
  for (let i = 0; i < 50 && s.phase === 'playing' && !(s.turn.step === 'roll' && (s.turn.seat !== seat || i > 0)); i++) s = apply(s, T, full);
  return s;
};

describe('인수 4가지 경로 (§3.2)', () => {
  // 이집트(16) 땅값 550, 집(1) → 통행료 440, 인수비 (550+550)×TAKEOVER_RATE
  const COST = (550 + 550) * TAKEOVER_RATE;
  const base = own(newGame(), 16, 1, 1);

  it('정답 → 할인 통행료 → 인수 성공, 건물 승계, 그 턴 건설 없음', () => {
    let s = landAndAnswer(base, 0, 16, true);
    expect(last(s, 'toll')).toMatchObject({ payer: 0, owner: 1, paid: 220, discounted: true });
    expect(s.turn.step).toBe('takeover');
    s = apply(s, { type: 'takeover', seat: 0 }, full);
    expect(s.tiles[16]).toMatchObject({ owner: 0, level: 1 });
    expect(s.players[0].coin).toBe(5000 - 220 - COST);
    expect(s.players[1].coin).toBe(5000 + 220 + COST);
    expect(last(s, 'takeover')).toMatchObject({ seat: 0, tile: 16, correct: true, shielded: false, cost: COST });
    expect(evs(s, 'build')).toHaveLength(0);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('주인 방패 + 무응답(5초 timeout) → 자동 방어, 인수비 미지불, 소유 그대로', () => {
    let s = landAndAnswer(edit(base, (d) => { d.players[1].items = ['shield']; }), 0, 16, true);
    s = apply(s, { type: 'takeover', seat: 0 }, full);
    expect(s.turn.step).toBe('shield');
    s = apply(s, T, full);
    expect(s.tiles[16].owner).toBe(1);
    expect(s.players[0].coin).toBe(5000 - 220);
    expect(s.players[1].items).toEqual([]);
    expect(last(s, 'takeover')).toMatchObject({ shielded: true, cost: 0, correct: true });
  });

  it('주인 방패 + 쓰지 않음 → 인수 성공, 방패 보관', () => {
    let s = landAndAnswer(edit(base, (d) => { d.players[1].items = ['shield']; }), 0, 16, true);
    s = run(s, [{ type: 'takeover', seat: 0 }, { type: 'shield', seat: 1, use: false }]);
    expect(s.tiles[16].owner).toBe(0);
    expect(s.players[1].items).toEqual(['shield']);
    expect(last(s, 'takeover')).toMatchObject({ shielded: false, cost: COST });
  });

  it('오답 → 통행료 전액, 인수 단계 없음, takeover 입력 무시', () => {
    const s = landAndAnswer(base, 0, 16, false);
    expect(last(s, 'toll')).toMatchObject({ paid: 440, discounted: false });
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
    expect(apply(s, { type: 'takeover', seat: 0 }, full)).toBe(s);
  });
});

describe('랜드마크·관광지', () => {
  it('랜드마크는 정답이어도 인수 불가', () => {
    const s = landAndAnswer(own(newGame(), 16, 1, 4), 0, 16, true);
    expect(last(s, 'toll')).toMatchObject({ paid: 550 * 6 * 0.5, discounted: true });
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('U5: 호텔(3단계)도 정답이어도 인수 불가 — 할인 통행료만, takeover 입력 무시(봇 같음)', () => {
    const s = landAndAnswer(edit(own(newGame(), 16, 1, 3), (d) => { d.players[0].coin = 50_000; }), 0, 16, true);
    expect(last(s, 'toll')).toMatchObject({ paid: 550 * 2.8 * 0.5, discounted: true });
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
    expect(evs(s, 'takeover')).toHaveLength(0);
    expect(apply(s, { type: 'takeover', seat: 0 }, full)).toBe(s);
  });

  it('U5: 시장(2단계)까지는 정답이면 인수 단계', () => {
    const s = landAndAnswer(edit(own(newGame(), 16, 1, 2), (d) => { d.players[0].coin = 50_000; }), 0, 16, true);
    expect(s.turn.step).toBe('takeover');
  });

  it('관광지(호주 7): 문항 없음(touristQuiz=false), 고정 통행료, 인수 없음', () => {
    let s = arrive(own(newGame(), 7, 1), 0, 7);
    expect(s.settings.touristQuiz).toBe(false);
    s = apply(s, T, full); // 문화 카드
    expect(evs(s, 'question')).toHaveLength(0);
    expect(last(s, 'toll')).toMatchObject({ paid: 300, discounted: false });
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('관광지 쌍 배율 없음(호주 하나): 같은 주인이 다른 땅을 가져도 ×1', () => {
    let s = arrive(own(own(newGame(), 7, 1), 1, 1), 0, 7);
    s = apply(s, T, full);
    expect(last(s, 'toll')).toMatchObject({ base: 300, multiplier: 1, paid: 300 });
  });

  it('관광지 건물 불가', () => {
    let s = arrive(own(newGame(), 7, 0), 0, 7);
    s = apply(s, T, full);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
    expect(s.tiles[7].level).toBe(0);
  });
});

describe('문항 선택 (§3.3)', () => {
  it('방문 단계: 빈 땅 1~5번째 도착 → 1·2·3·4·4단계, 미공개는 초출+전체판, 공개는 복습+짧은판, 재출제 0', () => {
    let s = newGame();
    const seen: { cardId: string; qid: string; kind: string; variant: string }[] = [];
    for (let i = 0; i < 5; i++) {
      s = arrive(s, (i % 2) as Seat, 2, sample); // 누가 도착하든 센다
      s = apply(s, T, sample);
      const q = s.turn.question!;
      s = answerAndSkip(s, false, sample);
      seen.push({ cardId: q.cardId, qid: q.qid, kind: (last(s, 'question') as { kind: string }).kind, variant: (last(s, 'explanation') as { variant: string }).variant });
      if (s.turn.step === 'action') s = apply(s, { type: 'pass', seat: s.turn.seat }, sample);
    }
    expect(seen.map((x) => x.cardId)).toEqual(['th-1', 'th-2', 'th-3', 'th-4', 'th-4']);
    expect(seen.slice(0, 4).every((x) => x.kind === 'initial' && x.variant === 'full')).toBe(true);
    expect(seen[4]).toMatchObject({ kind: 'review', variant: 'short' });
    expect(new Set(seen.map((x) => x.qid)).size).toBe(5);
  });

  it('방문 단계 = max(건물 기준, 방문): 내 땅 집 + 2번째 방문 → 2, 내 땅 시장 + 2번째 → 3, 랜드마크는 늘 4', () => {
    const second = (owner: Seat | null, level: 0 | 1 | 2 | 3 | 4) => {
      let s = apply(arrive(newGame(), 1, 2, sample), T, sample); // 1번째 방문(1번 자리)
      s = answerAndSkip(s, false, sample);
      s = edit(s, (d) => { d.tiles[2] = { owner, level, festivalTarget: false }; });
      return apply(arrive(s, 0, 2, sample), T, sample).turn.question!.cardId;
    };
    expect(second(0, 1)).toBe('th-2');
    expect(second(0, 2)).toBe('th-3');
    expect(second(1, 4)).toBe('th-4');
    const first = apply(arrive(edit(newGame(), (d) => { d.tiles[2] = { owner: 1, level: 4, festivalTarget: false }; }), 0, 2, sample), T, sample);
    expect(first.turn.question!.cardId).toBe('th-4');
  });

  it('방문 단계 + 공개 카드: 2번째 방문인데 th-2 가 이미 공개 → 복습+짧은판, JSON 복원 뒤에도 같은 단계', () => {
    let s = apply(arrive(newGame(), 1, 2, sample), T, sample);
    s = answerAndSkip(s, false, sample);
    s = edit(s, (d) => { d.revealedCards.push('th-2'); d.usedQuestionIds.push('th-2-q1'); });
    s = JSON.parse(JSON.stringify(s)) as GameState;
    s = apply(arrive(s, 0, 2, sample), T, sample);
    expect(s.turn.question).toMatchObject({ cardId: 'th-2', variant: 'short', review: false });
    expect(last(s, 'question')).toMatchObject({ kind: 'review' });
  });

  it('복습 소진 + 참/거짓 남음 → 참/거짓 형식', () => {
    let s = edit(newGame(), (d) => { d.revealedCards = ['th-1']; d.usedQuestionIds = ['th-1-q1', 'th-1-q2', 'th-1-q3']; });
    s = apply(arrive(s, 0, 2, sample), T, sample);
    expect(s.turn.question).toMatchObject({ format: 'tf', cardId: 'th-1', variant: 'short', review: false });
  });

  it('복습 2개 소진 → 같은 여행지 다른 공개 카드 복습', () => {
    let s = edit(newGame(), (d) => {
      d.revealedCards = ['th-1', 'th-3'];
      d.usedQuestionIds = ['th-1-q1', 'th-1-q2', 'th-1-q3'];
    });
    s = apply(arrive(s, 0, 2, sample), T, sample);
    expect(s.turn.question).toMatchObject({ cardId: 'th-3', format: 'choice', variant: 'short' });
    expect(['th-3-q2', 'th-3-q3']).toContain(s.turn.question!.qid);
  });

  it.each([
    ['빈 땅', null, 0, 'th-1'],
    ['건물 없는 남의 땅', 1, 0, 'th-1'],
    ['내 땅(집) → 다음 단계', 0, 1, 'th-2'],
    ['남의 땅(시장) → 현재 단계', 1, 2, 'th-2'],
    ['랜드마크 → 4단계', 1, 4, 'th-4'],
    ['내 랜드마크 → 4단계', 0, 4, 'th-4'],
  ] as const)('%s', (_n, owner, level, card) => {
    let s = edit(newGame(), (d) => { d.tiles[2] = { owner, level, festivalTarget: false }; });
    s = apply(arrive(s, 0, 2, sample), T, sample);
    expect(s.turn.question!.cardId).toBe(card);
  });
});

describe('무응답', () => {
  it('문항 무응답 = 오답', () => {
    let s = apply(arrive(newGame(), 0, 2), T, full);
    s = apply(s, T, full);
    expect(last(s, 'answer')).toMatchObject({ seat: 0, choice: null, correct: false, ms: 20_000, isBot: false });
  });

  it('참/거짓은 도착자 제외 3명, 무응답 null·코인 0, 정답 +50, 봇 표시', () => {
    let s = arrive(newGame(1, [false, false, true, false]), 0, 2);
    s = run(s, [T, { type: 'answer', seat: 0, choice: 0, ms: 500 }, T]);
    expect(s.turn.step).toBe('tf');
    const ans = s.turn.tf!.answer;
    expect(apply(s, { type: 'tfAnswer', seat: 0, value: ans }, full)).toBe(s);
    s = run(s, [{ type: 'tfAnswer', seat: 1, value: ans }, { type: 'tfAnswer', seat: 2, value: !ans }]);
    expect(apply(s, { type: 'tfAnswer', seat: 1, value: !ans }, full)).toBe(s);
    s = apply(s, T, full);
    const tfa = evs(s, 'tf_answer');
    expect(tfa.map((e) => (e as { seat: number }).seat)).toEqual([1, 2, 3]);
    expect(tfa).toEqual([
      expect.objectContaining({ seat: 1, value: ans, correct: true, isBot: false }),
      expect.objectContaining({ seat: 2, value: !ans, correct: false, isBot: true }),
      expect.objectContaining({ seat: 3, value: null, correct: false }),
    ]);
    expect(s.players.map((p) => p.coin)).toEqual([5480, 5050, 5000, 5000]); // 0번은 출발 통과 월급
  });

  it('U10: 3명 모두 답해도 바로 닫지 않고 결과 2초(tfResult) 뒤 닫힌다', () => {
    let s = arrive(newGame(), 0, 2);
    s = run(s, [T, { type: 'answer', seat: 0, choice: 1, ms: 500 }, T]);
    s = run(s, [1, 2, 3].map((seat) => ({ type: 'tfAnswer', seat: seat as Seat, value: true })));
    expect(s.turn.step).toBe('tfResult');
    expect(stepMs(s)).toBe(TF_RESULT_MS);
    expect(s.turn.tf).not.toBeNull(); // 결과 표시용으로 남는다
    expect(evs(s, 'tf_answer')).toHaveLength(3); // 결과(누가 맞혔는지)·코인은 결과 단계가 열릴 때 이미 나온다
    expect(apply(s, { type: 'tfAnswer', seat: 1, value: false }, full)).toBe(s); // 결과 단계엔 답 없음
    s = apply(s, T, full);
    expect(s.turn.step).toBe('action');
    expect(s.turn.tf).toBeNull();
  });

  it('U10: 참/거짓 전원 무응답 → 6초 마감 → 결과 2초 → 닫힘(총 8초)', () => {
    let s = arrive(newGame(), 0, 2);
    s = run(s, [T, { type: 'answer', seat: 0, choice: 1, ms: 500 }, T]);
    expect(s.turn.step).toBe('tf');
    expect(stepMs(s)).toBe(STEP_MS.tf);
    s = apply(s, T, full);
    expect(s.turn.step).toBe('tfResult');
    expect(stepMs(s)).toBe(2000);
    expect(STEP_MS.tf + stepMs(s)).toBe(8000);
    expect(evs(s, 'tf_answer').map((e) => (e as { value: unknown }).value)).toEqual([null, null, null]);
    expect(botSeats(edit(s, (d) => { d.seats.forEach((x) => { x.isBot = true; }); }))).toEqual([]); // 봇도 기다린다
    s = apply(s, T, full);
    expect(s.turn.step).toBe('action');
  });
});

describe('주사위·무인도·세계여행', () => {
  it('3연속 더블 → 무인도', () => {
    let s = newGame();
    for (let i = 0; i < 3; i++) {
      expect(s.turn).toMatchObject({ seat: 0, step: 'roll' });
      s = apply(withDice(s, 1, 1), { type: 'roll', seat: 0 }, full);
      if (i < 2) s = settle(s);
    }
    expect(s.players[0]).toMatchObject({ pos: 10, islandTurns: 3, doubles: 0 });
    expect(s.turn.seat).toBe(1);
  });

  it('무인도 최대 3턴: 3번 못 나오면 다음 턴에 그냥 이동', () => {
    let s = edit(newGame(), (d) => { d.players[0].pos = 10; d.players[0].islandTurns = 3; });
    for (let i = 0; i < 3; i++) {
      s = edit(s, (d) => { d.turn.seat = 0; d.turn.step = 'roll'; });
      s = apply(withDice(s, 1, 2), { type: 'roll', seat: 0 }, full);
      expect(s.players[0].pos).toBe(10);
      expect(s.players[0].islandTurns).toBe(2 - i);
    }
    s = edit(s, (d) => { d.turn.seat = 0; d.turn.step = 'roll'; });
    s = apply(withDice(s, 1, 2), { type: 'roll', seat: 0 }, full);
    expect(s.players[0].pos).toBe(13);
  });

  it('무인도 더블 → 탈출 이동, 추가 굴림 없음', () => {
    let s = edit(newGame(), (d) => { d.players[0].pos = 10; d.players[0].islandTurns = 3; });
    s = settle(apply(withDice(s, 3, 3), { type: 'roll', seat: 0 }, full));
    expect(s.players[0]).toMatchObject({ pos: 16, islandTurns: 0 });
    expect(s.turn.seat).toBe(1);
  });

  it('무인도 코인 탈출 500', () => {
    const s = apply(edit(newGame(), (d) => { d.players[0].pos = 10; d.players[0].islandTurns = 2; }), { type: 'escape', seat: 0, method: 'coin' }, full);
    expect(s.players[0]).toMatchObject({ coin: 4500, islandTurns: 0 });
    expect(s.fund).toBe(500); // 탈출비 → 은행 기금 적립(§3.6)
    expect(s.turn.step).toBe('roll');
  });

  it('세계여행: 다음 턴 원하는 칸, 출발 통과 시 월급', () => {
    let s = arrive(newGame(), 0, TRAVEL_TILE);
    expect(s.players[0].travelPending).toBe(true);
    for (let i = 0; i < 200 && !(s.turn.seat === 0 && s.turn.step === 'travel'); i++) s = apply(s, T, full);
    expect(s.turn.step).toBe('travel');
    const coin = s.players[0].coin;
    s = apply(s, { type: 'travel', seat: 0, tile: 5 }, full);
    expect(last(s, 'move')).toMatchObject({ seat: 0, from: TRAVEL_TILE, to: 5, via: 'travel' });
    expect(s.players[0].coin).toBe(coin + SALARY);
    expect(s.turn.step).toBe('culture');
  });

  it('출발 통과 월급', () => {
    const s = arrive(edit(newGame(), () => {}), 0, 2);
    expect(s.players[0].coin).toBe(5000 + SALARY);
  });
});

describe('파산', () => {
  // 0번: 필리핀(1) 집 + 타이(2) 빈 땅. 1번: 이집트(16)
  const setup = (coin: number, level: 0 | 1 | 2 | 3 | 4) =>
    edit(own(own(own(newGame(), 1, 0, 1), 2, 0), 16, 1, level), (d) => { d.players[0].coin = coin; });

  it('건물부터 판다 — 건물 매각으로 충분하면 땅은 남는다', () => {
    const s = landAndAnswer(setup(400, 1), 0, 16, false);
    expect(last(s, 'toll')).toMatchObject({ paid: 440 });
    expect(s.tiles[1]).toMatchObject({ owner: 0, level: 0 });
    expect(s.tiles[2].owner).toBe(0);
    expect(s.players[0]).toMatchObject({ coin: 400 + 200 - 440, bankrupt: false });
    expect(evs(s, 'sold')).toEqual([{ ev: 'sold', seat: 0, tile: 1, levelBefore: 1 }]); // 팔린 칸만, 땅만 남은 칸도 기록
  });

  it('랜드마크를 팔면 sold levelBefore 4', () => {
    const s = landAndAnswer(edit(own(own(newGame(), 1, 0, 4), 16, 1), (d) => { d.players[0].coin = 0; }), 0, 16, false);
    expect(s.tiles[1]).toMatchObject({ owner: 0 });
    expect(s.tiles[1].level).toBeLessThan(4);
    expect(evs(s, 'sold')).toEqual([{ ev: 'sold', seat: 0, tile: 1, levelBefore: 4 }]);
  });

  it('다 팔아도 부족하면 파산, 땅은 빈 땅, 파산자는 턴 건너뜀', () => {
    let s = landAndAnswer(setup(100, 4), 0, 16, false);
    expect(s.players[0]).toMatchObject({ coin: 0, bankrupt: true });
    expect(s.players[1].coin).toBe(5000 + 100 + 200 + 200 + 230);
    expect([s.tiles[1].owner, s.tiles[2].owner]).toEqual([null, null]);
    expect(evs(s, 'sold').map((e) => e.ev === 'sold' && [e.tile, e.levelBefore])).toEqual([[1, 1], [2, 0]]);
    const seats: number[] = [];
    for (let i = 0; i < 300 && seats.length < 8; i++) {
      const before = s.turn.seat;
      s = apply(s, T, full);
      if (s.turn.seat !== before) seats.push(s.turn.seat);
    }
    expect(seats).not.toContain(0);
  });
});

describe('승리', () => {
  it('파산승: 나 빼고 전원 파산 → 즉시', () => {
    let s = edit(own(newGame(), 16, 1, 4), (d) => {
      d.players[0].coin = 0;
      d.players[2].bankrupt = true; d.players[2].coin = 0;
      d.players[3].bankrupt = true; d.players[3].coin = 0;
    });
    s = landAndAnswer(s, 0, 16, false);
    expect(s.phase).toBe('finished');
    expect(s.winner).toEqual({ seat: 1, kind: 'bankruptcy' });
    expect(last(s, 'result')).toMatchObject({ finalRanks: [1, 0, 2, 3] });
  });

  it.each(CONTINENTS)('독점승 %s: 그 대륙 여행지 전부(관광지 없이, 4칸 대륙은 건물 1개 이상) → 즉시', (cont) => {
    const tiles = continentTiles(cont);
    const target = tiles.at(-1)!;
    let s = newGame();
    for (const [k, t] of tiles.slice(0, -1).entries()) s = own(s, t, 0, k === 0 && monopolyNeedsBuilding(cont) ? 1 : 0);
    s = landAndAnswer(s, 0, target, true);
    s = apply(s, { type: 'buy', seat: 0 }, full);
    expect(s.winner).toEqual({ seat: 0, kind: 'monopoly' });
    expect(s.phase).toBe('finished');
  });

  it('북아메리카는 4칸으로 독점승', () => {
    expect(continentTiles('namerica')).toHaveLength(4);
  });

  it('㉒ 건물 조건은 4칸 대륙(아프리카·북아메리카·남아메리카)만, 5칸 대륙(아시아·유럽)은 땅만', () => {
    expect(CONTINENTS.filter(monopolyNeedsBuilding)).toEqual(['africa', 'namerica', 'samerica']);
  });

  it.each(['africa', 'namerica', 'samerica'] as const)('㉒ %s: 땅 4칸 전부여도 건물 0이면 독점 아님 → 그 대륙 칸에 건설하는 순간 독점승', (cont) => {
    const tiles = continentTiles(cont);
    let s = newGame();
    for (const t of tiles.slice(0, -1)) s = own(s, t, 0);
    s = apply(landAndAnswer(s, 0, tiles.at(-1)!, true), { type: 'buy', seat: 0 }, full);
    expect(tiles.every((t) => s.tiles[t].owner === 0)).toBe(true);
    expect(s.winner).toBeNull();
    expect(s.monopolies).toEqual([]);
    // 다음 차례에 자기 땅에 도착해 정답 → 건설 → 독점
    s = edit(s, (d) => { d.turn.seat = 0; });
    s = landAndAnswer(s, 0, tiles[0], true);
    expect(s.turn.step).toBe('action');
    s = apply(s, { type: 'build', seat: 0 }, full);
    expect(s.tiles[tiles[0]].level).toBe(1);
    expect(s.monopolies).toEqual([{ continent: cont, seat: 0 }]);
    expect(s.winner).toEqual({ seat: 0, kind: 'monopoly' });
    expect(s.phase).toBe('finished');
  });

  it('㉒ 인수한 칸의 건물(승계)도 건물 조건을 채운다', () => {
    const tiles = continentTiles('samerica');
    let s = newGame();
    for (const t of tiles.slice(0, -1)) s = own(s, t, 0);
    s = own(s, tiles.at(-1)!, 1, 1); // 집(인수비가 시작 코인 안)
    s = apply(landAndAnswer(s, 0, tiles.at(-1)!, true), { type: 'takeover', seat: 0 }, full);
    expect(s.winner).toEqual({ seat: 0, kind: 'monopoly' });
  });

  it('㉒ 건물이 다른 대륙에만 있으면 4칸 대륙 독점 아님', () => {
    const tiles = continentTiles('africa');
    let s = own(newGame(), 1, 0, 3); // 아시아 필리핀에 호텔
    for (const t of tiles.slice(0, -1)) s = own(s, t, 0);
    s = apply(landAndAnswer(s, 0, tiles.at(-1)!, true), { type: 'buy', seat: 0 }, full);
    expect(s.winner).toBeNull();
  });

  it('호주(관광지)만으로는 독점승 아님', () => {
    let s = arrive(newGame(), 0, 7);
    s = apply(apply(s, T, full), { type: 'buy', seat: 0 }, full);
    expect(s.tiles[7].owner).toBe(0);
    expect(s.winner).toBeNull();
    expect(s.monopolies).toEqual([]);
  });

  it('호주 + 대륙 한 칸 모자람 → 독점승 아님', () => {
    let s = own(newGame(), 7, 0);
    for (const t of continentTiles('namerica').slice(0, -2)) s = own(s, t, 0);
    s = apply(landAndAnswer(s, 0, 23, true), { type: 'buy', seat: 0 }, full);
    expect(s.winner).toBeNull();
    expect(evs(s, 'event').filter((e) => e.ev === 'event' && e.kind === 'monopoly')).toEqual([]);
  });

  it('독점 성립: event monopoly 로그 + monopolies[] 상태(영구), 그 뒤 독점승 결과', () => {
    let s = newGame();
    for (const t of continentTiles('africa').slice(0, -1)) s = own(s, t, 2, t === 16 ? 1 : 0); // 4칸 대륙: 건물 1개(㉒)
    s = edit(s, (d) => { d.turn.seat = 2; });
    s = apply(landAndAnswer(s, 2, 19, true), { type: 'buy', seat: 2 }, full);
    expect(s.monopolies).toEqual([{ continent: 'africa', seat: 2 }]);
    const i = s.log.findIndex((e) => e.ev === 'event' && e.kind === 'monopoly');
    expect(s.log[i]).toEqual({ ev: 'event', seat: 2, kind: 'monopoly', payload: { continent: 'africa' } });
    expect(i).toBeLessThan(s.log.findIndex((e) => e.ev === 'result')); // 독점 로그 → 결과
    expect(s.winner).toEqual({ seat: 2, kind: 'monopoly' });
    expect((JSON.parse(JSON.stringify(s)) as GameState).monopolies).toEqual(s.monopolies);
  });

  it('인수로도 독점 성립', () => {
    let s = newGame();
    for (const t of continentTiles('asia').slice(0, -1)) s = own(s, t, 0);
    s = own(s, 5, 1, 1);
    s = landAndAnswer(s, 0, 5, true);
    s = apply(s, { type: 'takeover', seat: 0 }, full);
    expect(s.monopolies).toEqual([{ continent: 'asia', seat: 0 }]);
    expect(s.winner).toEqual({ seat: 0, kind: 'monopoly' });
  });

  it('독점승자는 자산이 적어도 최종 1위(finalRanks[0]), 나머지는 자산순', () => {
    let s = newGame();
    for (const t of continentTiles('asia').slice(0, -1)) s = own(s, t, 0);
    s = edit(s, (d) => { d.players[1].coin = 7000; d.players[2].coin = 6000; });
    const target = continentTiles('asia').at(-1)!;
    s = landAndAnswer(s, 0, target, false);
    s = apply(s, { type: 'buy', seat: 0 }, full);
    expect(s.winner).toEqual({ seat: 0, kind: 'monopoly' });
    const r = last(s, 'result');
    expect(r && r.ev === 'result' && r.assets[1]).toBeGreaterThan(r && r.ev === 'result' ? r.assets[0] : 0);
    expect(r).toMatchObject({ finalRanks: [0, 1, 2, 3] });
  });

  it('자산승: 놀이 시간 끝 시 코인+땅값+건설비', () => {
    let s = edit(own(newGame(), 16, 2, 2), (d) => { d.clock.remainingMs = 1000; });
    s = apply(s, { type: 'tick', ms: 1000 }, full);
    expect(s.phase).toBe('finished');
    expect(s.winner).toEqual({ seat: 2, kind: 'assets' });
    expect(last(s, 'result')).toEqual({ ev: 'result', finalRanks: [2, 0, 1, 3], assets: [5000, 5000, 5000 + 550 + 550 + 825, 5000] });
    expect(last(s, 'clock')).toEqual({ ev: 'clock', kind: 'end', remainingMs: 0, by: 'timeout' });
  });
});

describe('놀이 시계 (2026-10-28 U1)', () => {
  it('놀이 시간 = settings.totalMinutes, 시작 로그 clock start', () => {
    for (const m of [40, 60, 80] as const) {
      const s = createGame({ seed: 1, settings: { totalMinutes: m } });
      expect(s.clock).toEqual({ remainingMs: m * 60_000, pauseBy: null });
      expect(s.log[0]).toEqual({ ev: 'clock', kind: 'start', remainingMs: m * 60_000, by: 'host' });
    }
  });

  it('0 이 되면 현재 턴을 마치고 바로 최종 결과(중간 정지 없음)', () => {
    let s = apply(arrive(newGame(), 0, 2), T, full); // 문항 단계
    s = apply(s, { type: 'tick', ms: 40 * 60_000 }, full);
    expect(s.phase).toBe('playing');
    s = answerAndSkip(s, true);
    s = apply(s, { type: 'pass', seat: 0 }, full);
    expect(s.phase).toBe('finished');
    expect(s.winner?.kind).toBe('assets');
    expect(last(s, 'clock')).toMatchObject({ kind: 'end', by: 'timeout' });
  });

  it('멈춤: 턴 중이면 그 턴을 마친 뒤 paused, 남은 시간 그대로 이어 하기', () => {
    let s = apply(arrive(newGame(), 0, 2), T, full); // 문항 단계
    s = apply(s, { type: 'tick', ms: 10 * 60_000 }, full);
    s = apply(s, { type: 'pause', by: 'host' }, full);
    expect(s.phase).toBe('playing');
    expect(s.clock.pauseBy).toBe('host');
    expect(apply(s, { type: 'pause', by: 'host' }, full)).toBe(s); // 두 번 눌러도 한 번
    s = answerAndSkip(s, true);
    s = apply(s, { type: 'pass', seat: 0 }, full);
    expect(s.phase).toBe('paused');
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
    expect(last(s, 'clock')).toEqual({ ev: 'clock', kind: 'pause', remainingMs: 30 * 60_000, by: 'host' });
    expect(apply(s, { type: 'roll', seat: 1 }, full)).toBe(s);
    expect(apply(s, { type: 'tick', ms: 60_000 }, full)).toBe(s); // 멈춘 동안 시계 안 줄어듦
    s = apply(s, { type: 'resume' }, full);
    expect(s.phase).toBe('playing');
    expect(s.clock).toEqual({ remainingMs: 30 * 60_000, pauseBy: null });
    expect(last(s, 'clock')).toEqual({ ev: 'clock', kind: 'resume', remainingMs: 30 * 60_000, by: 'host' });
    expect(s.revealedCards).toEqual(['th-1']);
  });

  it('멈춤: 턴 시작(굴리기 전)이면 바로, auto 도 같은 길', () => {
    const s = apply(newGame(), { type: 'pause', by: 'auto' }, full);
    expect(s.phase).toBe('paused');
    expect(last(s, 'clock')).toEqual({ ev: 'clock', kind: 'pause', remainingMs: 40 * 60_000, by: 'auto' });
  });

  it('멈춤 요청 중에 시간이 다 되면 끝이 먼저', () => {
    let s = apply(arrive(newGame(), 0, 2), T, full);
    s = apply(s, { type: 'pause', by: 'host' }, full);
    s = apply(s, { type: 'tick', ms: 40 * 60_000 }, full);
    s = answerAndSkip(s, true);
    s = apply(s, { type: 'pass', seat: 0 }, full);
    expect(s.phase).toBe('finished');
  });

  it('(U123 L1) 멈춘 채 남은 시간이 0 이면 이어 하기 = 바로 시간 끝(자산승), 멈춤에 갇히지 않는다', () => {
    let s = apply(newGame(), { type: 'pause', by: 'host' }, full);
    expect(s.phase).toBe('paused');
    s = JSON.parse(JSON.stringify(s)) as GameState;
    s.clock.remainingMs = 0; // 손으로 고친 저장본 등
    s = apply(s, { type: 'resume' }, full);
    expect(s.phase).toBe('finished');
    expect(s.winner?.kind).toBe('assets');
    expect(s.clock).toEqual({ remainingMs: 0, pauseBy: null });
    expect(last(s, 'clock')).toEqual({ ev: 'clock', kind: 'end', remainingMs: 0, by: 'timeout' });
    expect(s.log.some((e) => e.ev === 'clock' && e.kind === 'resume')).toBe(false);
    expect(last(s, 'result')).toBeTruthy();
    // 음수도 같은 길(0 으로 맞춘다)
    let n = JSON.parse(JSON.stringify(apply(newGame(), { type: 'pause', by: 'auto' }, full))) as GameState;
    n.clock.remainingMs = -5;
    n = apply(n, { type: 'resume' }, full);
    expect(n.phase).toBe('finished');
    expect(n.clock.remainingMs).toBe(0);
  });

  it('(U123 L2) 자동 멈춤 대기 중: 시계는 계속 줄고, 사람이 돌아오면(setConnected true) 취소. 방장 멈춤은 그대로', () => {
    let s = apply(arrive(newGame(), 0, 2), T, full); // 문항 단계(턴 중)
    s = apply(s, { type: 'setConnected', seat: 0, connected: false }, full);
    s = apply(s, { type: 'pause', by: 'auto' }, full);
    expect(s.phase).toBe('playing');
    expect(s.clock.pauseBy).toBe('auto');
    s = apply(s, { type: 'tick', ms: 30_000 }, full); // 대기 중에도 시계는 준다(멈춤은 턴을 마친 뒤)
    expect(s.clock.remainingMs).toBe(40 * 60_000 - 30_000);
    s = apply(s, { type: 'setConnected', seat: 0, connected: true }, full);
    expect(s.clock.pauseBy).toBeNull();
    s = answerAndSkip(s, true);
    s = apply(s, { type: 'pass', seat: 0 }, full);
    expect(s.phase).toBe('playing'); // 취소됐으니 턴 끝에 멈추지 않는다
    expect(s.log.some((e) => e.ev === 'clock' && e.kind === 'pause')).toBe(false);
    // 방장 멈춤 대기는 사람이 돌아와도 남는다
    let h = apply(arrive(newGame(), 0, 2), T, full);
    h = apply(h, { type: 'setConnected', seat: 1, connected: false }, full);
    h = apply(h, { type: 'pause', by: 'host' }, full);
    h = apply(h, { type: 'setConnected', seat: 1, connected: true }, full);
    expect(h.clock.pauseBy).toBe('host');
  });

  it('저장·복원: JSON 왕복 뒤 같은 입력 → 같은 결과', () => {
    const s = apply(arrive(newGame(), 0, 2), T, full);
    const back = JSON.parse(JSON.stringify(s)) as GameState;
    const a = run(s, [T, T, T, T, T, T]);
    const b = run(back, [T, T, T, T, T, T]);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('할인 이월 없음', () => {
  it('빈 땅 정답 후 안 사면 discount 가 턴 종료 시 사라지고 다음 도착 때 다시 문항', () => {
    let s = landAndAnswer(newGame(), 0, 2, true);
    expect(s.turn.discount).toBe(true);
    s = apply(s, { type: 'pass', seat: 0 }, full);
    expect(s.turn.discount).toBe(false);
    s = apply(arrive(s, 0, 2), T, full);
    expect(s.turn.step).toBe('question');
  });
});

describe('잘못된 입력', () => {
  it('남의 턴 seat 의 행동은 무시, 상태 불변', () => {
    const s = newGame();
    expect(apply(s, { type: 'roll', seat: 1 }, full)).toBe(s);
  });

  it('잘못된 단계의 행동은 무시', () => {
    const s = newGame();
    expect(apply(s, { type: 'buy', seat: 0 }, full)).toBe(s);
    expect(apply(s, { type: 'answer', seat: 0, choice: 0, ms: 1 }, full)).toBe(s);
  });

  it('연타: buy 두 번 → 코인 1회 차감', () => {
    let s = landAndAnswer(newGame(), 0, 2, false);
    s = run(s, [{ type: 'buy', seat: 0 }, { type: 'buy', seat: 0 }]);
    expect(s.players[0].coin).toBe(5000 + SALARY - 230);
    expect(evs(s, 'buy')).toHaveLength(1);
  });

  it('잘못된 선택지 번호는 무시', () => {
    const s = apply(arrive(newGame(), 0, 2), T, full);
    expect(apply(s, { type: 'answer', seat: 0, choice: 7, ms: 1 }, full)).toBe(s);
    expect(apply(s, { type: 'answer', seat: 0, choice: true, ms: 1 }, full)).toBe(s);
  });
});

describe('건설', () => {
  it('내 땅 정답 → 한 단계 건설, 오답 → 건설 없음', () => {
    let s = landAndAnswer(own(newGame(), 16, 0, 1), 0, 16, true);
    s = apply(s, { type: 'build', seat: 0 }, full);
    expect(s.tiles[16].level).toBe(2);
    expect(last(s, 'build')).toEqual({ ev: 'build', seat: 0, tile: 16, level: 2, cost: 825 });
    const w = landAndAnswer(own(newGame(), 16, 0, 1), 0, 16, false);
    expect(w.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('빈 땅 정답 → 반값 구매', () => {
    let s = landAndAnswer(newGame(), 0, 16, true);
    s = apply(s, { type: 'buy', seat: 0 }, full);
    expect(last(s, 'buy')).toEqual({ ev: 'buy', seat: 0, tile: 16, price: 275, discounted: true });
  });

  it('통행료 아이템 단계: 절반 아이템 사용', () => {
    let s = landAndAnswer(edit(own(newGame(), 16, 1, 1), (d) => { d.players[0].items = ['tollHalf']; }), 0, 16, false);
    expect(s.turn.step).toBe('toll');
    s = apply(s, { type: 'payToll', seat: 0, item: 'tollHalf' }, full);
    expect(last(s, 'toll')).toMatchObject({ paid: 220, discounted: false });
    expect(s.players[0].items).toEqual([]);
  });
});

describe('특수 칸', () => {
  it('미션 성공 → 관전 참/거짓 → 보상 선택', () => {
    let s = arrive(newGame(), 0, 6);
    expect(s.turn.step).toBe('mission');
    const m = full.missions.find((x) => x.id === s.turn.missionId)!;
    const answer = m.type === 'connect' ? { pairs: m.pairs } : { steps: m.steps };
    s = apply(s, { type: 'missionAnswer', seat: 0, answer, ms: 9000 }, full);
    expect(last(s, 'mission')).toMatchObject({ seat: 0, missionId: m.id, type: m.type, success: true, ms: 9000, analytic: m.analytic });
    expect(s.turn.tf).toMatchObject({ stmtId: `${m.id}-tf` });
    expect(last(s, 'tf')).toBeUndefined(); // tf 이벤트(mTag)는 닫힐 때 남긴다: 답하는 동안 로그로 정답이 새지 않게
    s = apply(s, T, full);
    expect(last(s, 'tf')).toMatchObject({ cardId: m.id, stmtId: `${m.id}-tf`, mTag: m.spectatorTf.mTags[0] ?? null });
    expect(s.log.findIndex((e) => e.ev === 'tf')).toBeLessThan(s.log.findIndex((e) => e.ev === 'tf_answer'));
    expect(s.turn.step).toBe('tfResult');
    s = apply(s, T, full);
    expect(s.turn.step).toBe('reward');
    expect(s.turn.rewardOptions.length).toBeGreaterThanOrEqual(2);
    expect(s.turn.rewardOptions.length).toBeLessThanOrEqual(3);
  });

  it('미션 실패 → 보상 없음', () => {
    let s = arrive(newGame(), 0, 20);
    s = run(s, [{ type: 'missionAnswer', seat: 0, answer: {}, ms: 1 }, T, T]); // tf 6초 → 결과 2초
    expect(last(s, 'mission')).toMatchObject({ success: false });
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('QA4-reveal: 미션 실패 tf 는 관전 3명이 다 답해도 응답만 저장, timeout 에 닫힌다(정답·해설 6초 창)', () => {
    let s = arrive(newGame(), 0, 20);
    s = apply(s, { type: 'missionAnswer', seat: 0, answer: {}, ms: 1 }, full);
    expect(s.turn).toMatchObject({ step: 'tf', missionSuccess: false });
    expect(holdsReveal(s)).toBe(true);
    const ans = s.turn.tf!.answer;
    s = run(s, [1, 2, 3].map((seat) => ({ type: 'tfAnswer', seat: seat as Seat, value: seat === 2 ? !ans : ans })));
    expect(s.turn.step).toBe('tf'); // 아직 열려 있음
    expect(s.turn.tf!.answers).toHaveLength(3);
    expect(evs(s, 'tf_answer')).toHaveLength(0);
    expect(apply(s, { type: 'tfAnswer', seat: 1, value: ans }, full)).toBe(s); // 두 번 답하기는 여전히 거부
    s = apply(s, T, full);
    expect(evs(s, 'tf_answer').map((e) => (e as { value: unknown }).value)).toEqual([ans, !ans, ans]);
    expect(s.players.map((p) => p.coin).slice(1)).toEqual([5050, 5000, 5050]);
    expect(s.turn).toMatchObject({ seat: 0, step: 'tfResult' });
    expect(holdsReveal(s)).toBe(false);
    s = apply(s, T, full);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('QA4-reveal: 미션 성공 tf 는 기존대로 다 답하면 닫힌다(reveal 없음) — U10: 결과 2초 뒤', () => {
    let s = arrive(newGame(), 0, 6);
    const m = full.missions.find((x) => x.id === s.turn.missionId)!;
    const answer = m.type === 'connect' ? { pairs: m.pairs } : { steps: m.steps };
    s = apply(s, { type: 'missionAnswer', seat: 0, answer, ms: 9000 }, full);
    expect(holdsReveal(s)).toBe(false);
    s = run(s, [1, 2, 3].map((seat) => ({ type: 'tfAnswer', seat: seat as Seat, value: true })));
    expect(s.turn.step).toBe('tfResult');
    s = apply(s, T, full);
    expect(s.turn.step).toBe('reward');
    expect(evs(s, 'tf_answer')).toHaveLength(3);
  });

  it('기금 칸 없음: 은행 기금 = 무인도 탈출비 + 기후 위기 감면액 → 축제 도착자가 받음', () => {
    let s = apply(edit(newGame(), (d) => { d.players[0].pos = 10; d.players[0].islandTurns = 2; }), { type: 'escape', seat: 0, method: 'coin' }, full);
    expect(s.fund).toBe(500);
    // 1번이 기후 위기 대륙(아프리카)의 2번 땅 이집트(집)에 도착 → 통행료 절반, 깎인 절반은 기금으로
    s = edit(own(s, 16, 2, 1), (d) => { d.climateEvent = { continent: 'africa', turnsLeft: 2, bySeat: 3 }; });
    s = landAndAnswer(s, 1, 16, false);
    expect(last(s, 'toll')).toMatchObject({ payer: 1, owner: 2, multiplier: 0.5, paid: 220 });
    expect(s.players[2].coin).toBe(5000 + 220);
    expect(s.fund).toBe(500 + 220);
    s = arrive(own(s, 12, 3), 3, 9);
    expect(last(s, 'event')).toMatchObject({ kind: 'festival', payload: { fund: 720 } });
    expect(s.turn.step).toBe('festival');
    s = apply(s, { type: 'pickFestival', seat: 3, tile: 12 }, full);
    expect(s.tiles[12].festivalTarget).toBe(true);
    expect(s.players[3].coin).toBe(5000 + 720);
    expect(s.fund).toBe(0);
  });

  it('기후 위기 감면액: 다 못 내고 파산하면 실제로 낸 비율만큼만 기금에 쌓인다(없던 코인 안 생김)', () => {
    // 이집트(16) 집 통행료 440 → 기후 위기 절반 220, 감면 220. 1번은 코인 110 뿐(땅 없음) → 110 내고 파산
    let s = edit(own(newGame(), 16, 2, 1), (d) => { d.climateEvent = { continent: 'africa', turnsLeft: 2, bySeat: 3 }; d.players[1].coin = 110; });
    const total = (x: typeof s) => x.fund + x.players.reduce((a, p) => a + p.coin, 0);
    const before = total(s);
    s = landAndAnswer(s, 1, 16, false);
    expect(last(s, 'toll')).toMatchObject({ payer: 1, multiplier: 0.5, paid: 110 });
    expect(s.players[1].bankrupt).toBe(true);
    expect(s.fund).toBe(110); // 220 × 110/220
    expect(total(s)).toBe(before + 110); // 은행이 더한 몫 = 실제로 낸 비율의 감면(220 다 아님)
  });

  it.each([true, false])('남극 도착 → 탐험 뒤 기후 위기 (정답 %s 무관)', (correct) => {
    let s = arrive(newGame(), 0, ANTARCTIC_TILE);
    expect(s.climateEvent).toBeNull();
    s = answerAndSkip(s, correct);
    expect(s.climateEvent).toMatchObject({ turnsLeft: 2, bySeat: 0 });
    expect(CONTINENTS).toContain(s.climateEvent!.continent);
    const evts = evs(s, 'event').map((e) => e.ev === 'event' && e.kind);
    expect(evts.slice(-2)).toEqual(['antarctic', 'climate']); // 탐험 결과 → 기후 위기 순
    expect(last(s, 'event')).toMatchObject({ kind: 'climate', payload: { continent: s.climateEvent!.continent } });
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('남극: 문항 → 정답 시 보너스 + 보관 보상', () => {
    let s = arrive(newGame(), 0, ANTARCTIC_TILE);
    expect(s.turn.question!.cardId).toBe('aq-s1');
    s = answerAndSkip(s, true);
    expect(s.players[0].coin).toBe(5000 + 300);
    expect(s.players[0].items).toHaveLength(1);
  });
});

describe('출발·한국 탐험 (§3.6, 2026-10-26)', () => {
  it('도착: 월급 + 문화 카드(한국) → 한국 카드 문항 → 해설 → 참/거짓 → 정답이면 보너스(아이템 없음), 소유·건설 없음', () => {
    let s = arrive(newGame(), 0, 0);
    expect(s.players[0].coin).toBe(5000 + SALARY);
    expect(last(s, 'culture_card')).toMatchObject({ seat: 0, country: 'kr', firstVisit: true });
    expect(s.turn.step).toBe('culture');
    s = apply(s, T, full);
    // 출발 칸 도착 = 월급 = 바퀴 1 → 바퀴 하한 2단계(§3.3 QA6, 한국도 같다)
    expect(s.players[0].laps).toBe(1);
    expect(s.turn.question).toMatchObject({ cardId: 'kr-2', country: 'kr', variant: 'full' });
    s = answerAndSkip(s, true);
    expect(last(s, 'explanation')).toMatchObject({ cardId: 'kr-2' });
    expect(evs(s, 'tf_answer')).toHaveLength(3);
    expect(last(s, 'event')).toEqual({ ev: 'event', seat: 0, kind: 'korea', payload: { correct: true, bonus: KOREA_BONUS } });
    expect(last(s, 'stamp')).toMatchObject({ seat: 0, country: 'kr', level: 2 });
    expect(s.players[0].coin).toBe(5000 + SALARY + KOREA_BONUS);
    expect(s.players[0].items).toEqual([]);
    expect(s.tiles[0]).toEqual({ owner: null, level: 0, festivalTarget: false });
    expect(evs(s, 'buy').concat(evs(s, 'toll'))).toEqual([]);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('오답이면 보너스 없음, 다음 차례', () => {
    const s = landAndAnswer(newGame(), 0, 0, false);
    expect(last(s, 'event')).toMatchObject({ kind: 'korea', payload: { correct: false, bonus: 0 } });
    expect(s.players[0].coin).toBe(5000 + SALARY);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('방문 단계만(건물 없음) + 바퀴 하한: 누구든 도착할 때마다 2·2·3·4·4단계, 지나가기만 하면 안 센다', () => {
    let s = newGame();
    const cards: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = arrive(s, (i % 2) as Seat, 2); // 출발을 지나가기만
      s = settle(apply(s, T, full));
      if (s.turn.step === 'action') s = apply(s, { type: 'pass', seat: s.turn.seat }, full);
      s = apply(arrive(s, ((i + 1) % 2) as Seat, 0), T, full);
      cards.push(s.turn.question!.cardId);
      s = answerAndSkip(s, false);
    }
    expect(cards).toEqual(['kr-2', 'kr-2', 'kr-3', 'kr-4', 'kr-4']); // 출발 도착은 늘 바퀴 ≥ 1 → 하한 2(§3.3 QA6)
  });

  it('미션 보상 "출발로" 로 도착해도 같은 탐험', () => {
    let s = edit(arrive(newGame(), 0, 20), (d) => { d.turn.step = 'reward'; d.turn.rewardOptions = ['toStart']; });
    const coin = s.players[0].coin;
    s = apply(s, { type: 'chooseReward', seat: 0, index: 0 }, full);
    expect(s.players[0].coin).toBe(coin + SALARY);
    expect(last(s, 'culture_card')).toMatchObject({ country: 'kr' });
    expect(s.turn.step).toBe('culture');
  });

  it('출발 칸에서는 buy 입력을 받지 않는다: 탐험 각 단계(자기 차례)와 action 단계를 강제해도 거부', () => {
    let s = arrive(newGame(), 0, 0);
    const steps: string[] = [];
    const tryBuy = () => {
      expect(s.turn).toMatchObject({ seat: 0, tile: 0 });
      steps.push(s.turn.step);
      expect(apply(s, { type: 'buy', seat: 0 }, full)).toBe(s);
    };
    tryBuy(); // culture
    s = apply(s, T, full);
    tryBuy(); // question
    const q = s.turn.question!;
    s = apply(s, { type: 'answer', seat: 0, choice: q.answer as number, ms: 1 }, full);
    tryBuy(); // explanation
    s = apply(s, T, full);
    tryBuy(); // tf
    expect(steps).toEqual(['culture', 'question', 'explanation', 'tf']);
    // 구조가 바뀌어 action 단계가 열려도 출발 칸은 살 수 없다
    const forced = edit(s, (d) => { d.turn.step = 'action'; d.turn.correct = true; d.turn.tf = null; });
    expect(apply(forced, { type: 'buy', seat: 0 }, full)).toBe(forced);
    s = apply(s, T, full);
    expect(s.tiles[0].owner).toBeNull();
    expect(evs(s, 'buy')).toEqual([]);
  });

  it('세계여행으로 출발 칸(0)을 고르면: 월급 1번 + 같은 한국 탐험 흐름', () => {
    let s = arrive(newGame(), 0, TRAVEL_TILE);
    for (let i = 0; i < 200 && !(s.turn.seat === 0 && s.turn.step === 'travel'); i++) s = apply(s, T, full);
    expect(s.turn.step).toBe('travel');
    const coin = s.players[0].coin;
    s = apply(s, { type: 'travel', seat: 0, tile: 0 }, full);
    expect(last(s, 'move')).toMatchObject({ seat: 0, from: TRAVEL_TILE, to: 0, via: 'travel' });
    expect(s.players[0].coin).toBe(coin + SALARY); // 도착도 출발 통과: 월급 한 번
    expect(last(s, 'culture_card')).toMatchObject({ seat: 0, country: 'kr' });
    expect(s.turn).toMatchObject({ seat: 0, step: 'culture', tile: 0 });
    s = apply(s, T, full);
    expect(s.turn.question).toMatchObject({ cardId: 'kr-2', country: 'kr' }); // 바퀴 하한(§3.3 QA6)
    s = answerAndSkip(s, true);
    expect(last(s, 'event')).toMatchObject({ kind: 'korea', payload: { correct: true, bonus: KOREA_BONUS } });
    expect(s.players[0].coin).toBe(coin + SALARY + KOREA_BONUS);
    expect(s.tiles[0].owner).toBeNull();
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
  });
});

describe('문항 소진: 빌림 → 전부 쓴 뒤에만 복습 재출제 (2026-10-16 사용자)', () => {
  const thIds = [1, 2, 3, 4].flatMap((l) => [`th-${l}-q1`, `th-${l}-q2`, `th-${l}-q3`, `th-${l}-t1`, `th-${l}-t2`]);
  /** 타이(빈 땅) 도착 → 오답 → 해설 → 관전 timeout → pass */
  const visit = (s: GameState, out: { reviews: number }) => {
    s = apply(arrive(s, 0, 2), T, full);
    if (s.turn.question!.review) out.reviews++;
    s = answerAndSkip(s, false);
    return s.turn.step === 'action' ? apply(s, { type: 'pass', seat: 0 }, full) : s;
  };

  it('관전·도착 대체로 카드 문장을 다 써도 qid·stmtId 합집합에 중복 없음, 나라 20개를 다 쓴 뒤에야 복습', () => {
    let s = newGame();
    const out = { reviews: 0 };
    const allIds: string[] = [];
    const tfReviews: string[] = [];
    while (out.reviews === 0) {
      const before = s.log.length;
      s = visit(s, out);
      for (const e of s.log.slice(before)) {
        if (e.ev === 'question' && !e.review) allIds.push(e.qid);
        if (e.ev === 'tf' && !e.review) allIds.push(e.stmtId);
        if (e.ev === 'tf' && e.review) { expect(allIds).toContain(e.stmtId); tfReviews.push(e.stmtId); } // 다시 낸 관전 문장은 이미 낸 것
      }
      expect(allIds.length).toBeLessThanOrEqual(20);
    }
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(new Set(allIds)).toEqual(new Set(thIds));
    expect(tfReviews.length).toBeGreaterThan(0); // 문장이 먼저 바닥나도 관전 참/거짓은 건너뛰지 않았다
  });

  it('다음 단계 카드에서 빌린다', () => {
    let s = edit(newGame(), (d) => { d.revealedCards = ['th-1']; d.usedQuestionIds = ['th-1-q1', 'th-1-q2', 'th-1-q3']; d.usedTfIds = ['th-1-t1', 'th-1-t2']; });
    s = apply(arrive(s, 0, 2), T, full);
    expect(s.turn.question).toMatchObject({ qid: 'th-2-q1', cardId: 'th-2', variant: 'full', review: false });
    s = run(s, [{ type: 'answer', seat: 0, choice: 0, ms: 1 }, T]);
    expect(last(s, 'explanation')).toMatchObject({ qid: 'th-2-q1', cardId: 'th-2', variant: 'full' });
  });

  it('모든 단계를 돌며 빌린다 (4단계 다음은 1단계)', () => {
    const allBut = (keep: string) => edit(newGame(), (d) => {
      d.revealedCards = ['th-1', 'th-2', 'th-3', 'th-4'];
      d.usedQuestionIds = thIds.filter((x) => x !== keep && !x.includes('-t'));
      d.usedTfIds = thIds.filter((x) => x !== keep && x.includes('-t'));
    });
    let s = apply(arrive(allBut('th-4-q2'), 0, 2), T, full); // 빈 땅(1단계)
    expect(s.turn.question).toMatchObject({ qid: 'th-4-q2', review: false });
    s = edit(allBut('th-1-t2'), (d) => { d.tiles[2] = { owner: 1, level: 4, festivalTarget: false }; });
    s = apply(arrive(s, 0, 2), T, full); // 랜드마크(4단계) → 1단계로 돌아가 참/거짓 형식
    expect(s.turn.question).toMatchObject({ qid: 'th-1-t2', format: 'tf', review: false });
  });

  it('전부 쓴 뒤: 가장 오래전 문항을 review:true 로, 해설은 그대로, 관전 참/거짓도 가장 오래전 문장을 review:true 로', () => {
    let s = edit(newGame(), (d) => {
      d.revealedCards = ['th-1', 'th-2', 'th-3', 'th-4'];
      d.usedQuestionIds = thIds.filter((x) => !x.includes('-t'));
      d.usedTfIds = thIds.filter((x) => x.includes('-t'));
    });
    s = apply(arrive(s, 0, 2), T, full);
    expect(s.turn.question).toMatchObject({ qid: 'th-1-q1', review: true, variant: 'short' });
    expect(last(s, 'question')).toMatchObject({ qid: 'th-1-q1', review: true });
    s = run(s, [{ type: 'answer', seat: 0, choice: 0, ms: 1 }, T]);
    expect(last(s, 'explanation')).toMatchObject({ qid: 'th-1-q1', cardId: 'th-1' });
    expect(s.turn.step).toBe('tf'); // 새 관전 문장이 없어도 건너뛰지 않는다
    expect(s.turn.tf).toMatchObject({ stmtId: 'th-1-t1', review: true }); // 가장 오래전 문장
    s = apply(s, T, full);
    expect(last(s, 'tf')).toMatchObject({ stmtId: 'th-1-t1', review: true });
    expect(s.usedTfIds.at(-1)).toBe('th-1-t1'); // 다시 낸 것은 맨 뒤로
    s = apply(apply(arrive(apply(s, { type: 'pass', seat: 0 }, full), 0, 2), T, full), T, full);
    expect(last(s, 'question')).toMatchObject({ qid: 'th-1-q2', review: true }); // th-1-q1 은 뒤로 갔다
    s = run(s, [T, T]);
    expect(last(s, 'tf')).toMatchObject({ stmtId: 'th-1-t2', review: true }); // 그다음 오래된 문장
  });
});

describe('fix round 1 minors', () => {
  it('힌트로 지운 선택지는 답으로 받지 않는다', () => {
    let s = apply(arrive(edit(newGame(), (d) => { d.players[0].items = ['hint']; }), 0, 2), T, full);
    s = apply(s, { type: 'useHint', seat: 0 }, full);
    const gone = s.turn.question!.hintRemoved;
    expect(gone).toHaveLength(2);
    expect(apply(s, { type: 'answer', seat: 0, choice: gone[0], ms: 1 }, full)).toBe(s);
  });

  it('travel 시작 단계에서 tick 이 0 이 되면 바로 끝(최종 결과)', () => {
    const s = edit(newGame(), (d) => { d.turn.step = 'travel'; d.players[0].travelPending = true; });
    expect(apply(s, { type: 'tick', ms: 40 * 60_000 }, full).phase).toBe('finished');
  });

  it('setConnected 값이 같으면 같은 참조', () => {
    const s = newGame();
    expect(apply(s, { type: 'setConnected', seat: 1, connected: true }, full)).toBe(s);
  });

  it('파산한 자리는 관전 참/거짓에 답할 수 없고, 남은 2명이 답하면 닫힌다', () => {
    let s = apply(arrive(edit(newGame(), (d) => { d.players[3].bankrupt = true; }), 0, 2), T, full);
    s = run(s, [{ type: 'answer', seat: 0, choice: 0, ms: 1 }, T]);
    expect(s.turn.step).toBe('tf');
    expect(apply(s, { type: 'tfAnswer', seat: 3, value: true }, full)).toBe(s);
    s = run(s, [{ type: 'tfAnswer', seat: 1, value: true }, { type: 'tfAnswer', seat: 2, value: true }]);
    expect(s.turn.step).toBe('tfResult');
    s = apply(s, T, full);
    expect(s.turn.step).toBe('action');
    expect(evs(s, 'tf_answer').map((e) => (e as { value: unknown }).value).at(-1)).toBeNull();
  });
});

describe('바퀴 하한 (§3.3, 2026-10-29 QA6)', () => {
  // 태국(2) 은 출발 바로 뒤라 주사위로 가면 출발을 지난다. 이집트(16) 는 판 가운데
  const roll = (s: GameState, seat: Seat, from: number, d1: number, d2: number) =>
    apply(withDice(edit(s, (d) => { d.players[seat].pos = from; d.turn.seat = seat; d.turn.step = 'roll'; }), d1, d2), { type: 'roll', seat }, sample);

  it('출발 통과 = laps +1(월급과 같이), 출발 안 지나면 그대로. 새 판은 0', () => {
    expect(newGame().players.map((p) => p.laps)).toEqual([0, 0, 0, 0]);
    let s = roll(newGame(), 0, 11, 2, 3);
    expect(s.players[0].laps).toBe(0);
    s = roll(newGame(), 0, 27, 2, 3); // 27 → 2: 출발 통과
    expect(s.players[0]).toMatchObject({ laps: 1, coin: 5000 + SALARY });
  });

  it('첫 바퀴 빈 땅 → 1단계, 월급 받은 뒤 같은 빈 땅 첫 도착 → 2단계. 3·4단계는 하한으로 안 오른다', () => {
    const first = apply(roll(newGame(), 0, 11, 2, 3), T, sample); // 16, 첫 바퀴
    expect(first.turn.question!.cardId).toBe('eg-1');
    const lapped = apply(roll(edit(newGame(), (d) => { d.players[0].laps = 3; }), 0, 11, 2, 3), T, sample);
    expect(lapped.turn.question!.cardId).toBe('eg-2');
    const crossed = apply(roll(newGame(), 0, 27, 2, 3), T, sample); // 출발을 지나 태국 첫 도착
    expect(crossed.turn.question!.cardId).toBe('th-2');
  });

  it('max(건물, 방문, 하한): 남의 호텔 → 3, 랜드마크 → 4 그대로', () => {
    const at = (level: 0 | 1 | 2 | 3 | 4) => apply(roll(edit(own(newGame(), 16, 1, level), (d) => { d.players[0].laps = 1; }), 0, 11, 2, 3), T, sample).turn.question!.cardId;
    expect(at(0)).toBe('eg-2');
    expect(at(3)).toBe('eg-3');
    expect(at(4)).toBe('eg-4');
  });

  it('옛 저장본(laps 없음)은 0 으로 본다: 1단계, 출발 통과하면 1 부터 센다', () => {
    const old = edit(newGame(), (d) => { for (const p of d.players) delete (p as Partial<typeof p>).laps; });
    expect(apply(roll(old, 0, 11, 2, 3), T, sample).turn.question!.cardId).toBe('eg-1');
    expect(roll(old, 0, 27, 2, 3).players[0].laps).toBe(1);
  });
});

describe('미션 활동 고르기: 안 만난 대번호 우선 (§3.5, 2026-10-29 QA6)', () => {
  const missionAt = (s: GameState) => arrive(s, 0, 6).turn.missionId;
  const withTopics = (s: GameState, topics: string[]) =>
    edit(s, (d) => { d.log.push({ ev: 'tf', cardId: 'x', stmtId: 'x', mTag: null, topics, review: false } as never); });

  it('대번호 8 을 이미 만났으면 7 을 가진 m-2, 7 을 만났으면 8 을 가진 m-1 (시드 여럿)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(missionAt(withTopics(newGame(seed), ['8.1']))).toBe('m-2');
      expect(missionAt(withTopics(newGame(seed), ['7.2']))).toBe('m-1');
    }
  });

  it('도착 문항·참/거짓·미션 topics 를 모두 센다', () => {
    const met = (ev: object) => missionAt(edit(newGame(5), (d) => { d.log.push(ev as never); }));
    expect(met({ ev: 'question', seat: 1, qid: 'q', country: 'th', level: 2, kind: 'initial', topics: ['8.3'], mTags: [], review: false })).toBe('m-2');
    expect(met({ ev: 'mission', seat: 1, missionId: 'z', type: 'connect', topics: ['7.1'], mTags: [], analytic: false, success: true, ms: 1 })).toBe('m-1');
  });

  it('둘 다 만났으면 안 쓴 활동 전체, 안 쓴 게 없으면 전체에서(재출제 허용)', () => {
    const both = withTopics(newGame(3), ['7.1', '8.1']);
    expect(['m-1', 'm-2']).toContain(missionAt(both));
    expect(missionAt(edit(both, (d) => { d.usedMissionIds = ['m-1']; }))).toBe('m-2');
    expect(['m-1', 'm-2']).toContain(missionAt(edit(both, (d) => { d.usedMissionIds = ['m-1', 'm-2']; })));
    // 안 쓴 활동이 이미 만난 대번호뿐이면 그것을 낸다(쓴 활동으로 돌아가지 않는다)
    expect(missionAt(edit(withTopics(newGame(3), ['8.1']), (d) => { d.usedMissionIds = ['m-2']; }))).toBe('m-1');
  });
});

describe('U10 보드에서 칸 고르기(PRD §3.6.1) · 단계 시간(§4.3)', () => {
  const atTravel = () => edit(newGame(), (d) => { d.turn.step = 'travel'; d.players[0].pos = TRAVEL_TILE; d.players[0].travelPending = true; });
  const atPick = (step: 'pickTile' | 'festival') => edit(own(own(newGame(), 2, 0), 12, 0), (d) => { d.turn.step = step; d.turn.tile = step === 'festival' ? 9 : 6; d.players[0].pos = step === 'festival' ? 9 : 6; });
  const P = (tile: number | null, seat: Seat = 0) => ({ type: 'pickPreview', seat, tile }) as const;

  it('세계여행: 선택 미리보기는 옮길 수 있고, 마감에 그 칸으로 확정(via travel)', () => {
    let s = atTravel();
    s = apply(s, P(5), full);
    expect(s.turn.preview).toBe(5);
    s = apply(s, P(14), full); // 다른 칸 = 선택 옮김
    expect(s.turn.preview).toBe(14);
    expect(evs(s, 'move')).toHaveLength(0); // 확정 아님
    s = apply(s, T, full);
    expect(last(s, 'move')).toMatchObject({ seat: 0, from: TRAVEL_TILE, to: 14, via: 'travel' });
    expect(s.players[0].travelPending).toBe(false);
    expect(s.turn.preview).toBeUndefined();
  });

  it('세계여행: 미리보기가 없으면(또는 해제했으면) 마감에 travelPending=false 로 주사위 단계(현행)', () => {
    for (const s0 of [atTravel(), apply(apply(atTravel(), P(5), full), P(null), full)]) {
      const s = apply(s0, T, full);
      expect(s.turn).toMatchObject({ seat: 0, step: 'roll' });
      expect(s.players[0].travelPending).toBe(false);
      expect(evs(s, 'move')).toHaveLength(0);
    }
  });

  it('고를 수 없는 칸·남의 차례·고르기 아닌 단계의 미리보기는 거부(같은 참조)', () => {
    const s = atTravel();
    expect(apply(s, P(TRAVEL_TILE), full)).toBe(s); // 세계여행 칸 자신
    expect(apply(s, P(30), full)).toBe(s);
    expect(apply(s, P(5, 1), full)).toBe(s); // 고르는 사람이 아님
    expect(apply(s, P(null), full)).toBe(s); // 이미 선택 없음
    const p = atPick('pickTile');
    expect(apply(p, P(3), full)).toBe(p); // 내 땅 아님(옅은 칸)
    const roll = newGame();
    expect(apply(roll, P(5), full)).toBe(roll);
    const once = apply(s, P(5), full);
    expect(apply(once, P(5), full)).toBe(once); // 같은 칸 다시 = 바뀐 것 없음(확정은 travel 액션)
  });

  it('내 땅으로: 마감에 미리보기 칸으로 이동(via mission), 없으면 이동 없이 차례 끝', () => {
    let s = apply(atPick('pickTile'), P(12), full);
    expect(s.turn.preview).toBe(12);
    s = apply(s, T, full);
    expect(last(s, 'move')).toMatchObject({ seat: 0, from: 6, to: 12, via: 'mission' });
    expect(s.turn.preview).toBeUndefined();
    const none = apply(atPick('pickTile'), T, full);
    expect(evs(none, 'move')).toHaveLength(0);
    expect(none.turn).toMatchObject({ seat: 1, step: 'roll' });
  });

  it('세계 축제: 마감에 미리보기 칸을 지정, 없으면 지정 없음', () => {
    const s = apply(apply(atPick('festival'), P(2), full), T, full);
    expect(s.tiles[2].festivalTarget).toBe(true);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
    const none = apply(atPick('festival'), T, full);
    expect(none.tiles.some((t) => t.festivalTarget)).toBe(false);
  });

  it('확정(travel 액션)은 미리보기와 무관하게 누른 칸으로, 미리보기는 지워진다', () => {
    const s = apply(apply(atTravel(), P(5), full), { type: 'travel', seat: 0, tile: 7 }, full);
    expect(last(s, 'move')).toMatchObject({ to: 7, via: 'travel' });
    expect(s.turn.preview).toBeUndefined();
  });

  it('단계 시간: 고르기 3종 15초, 문화 카드 첫 방문 5초 · 다시 온 나라 3초, 참/거짓 결과 2초', () => {
    expect(stepMs(atTravel())).toBe(15_000);
    expect(stepMs(atPick('pickTile'))).toBe(15_000);
    expect(stepMs(atPick('festival'))).toBe(15_000);
    const first = arrive(newGame(), 0, 2);
    expect(first.turn.step).toBe('culture');
    expect(last(first, 'culture_card')).toMatchObject({ firstVisit: true });
    expect(stepMs(first)).toBe(5_000);
    expect(apply(first, { type: 'ack', seat: 0 }, full)).toBe(first); // 첫 방문은 넘길 수 없다
    const again = arrive(edit(newGame(), (d) => { d.seenCountries = [BOARD[2].country!]; }), 0, 2);
    expect(last(again, 'culture_card')).toMatchObject({ firstVisit: false });
    expect(stepMs(again)).toBe(3_000);
    expect(STEP_MS.tfResult).toBe(TF_RESULT_MS);
  });
});
