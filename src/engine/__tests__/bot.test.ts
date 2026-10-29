import { describe, expect, it } from 'vitest';
import { continentTiles } from '../../shared/board';
import type { GameState, Seat } from '../../shared/types';
import { apply, createGame } from '../engine';
import { botAction, botSeats, drawAccuracy, playBotGame, reserve, seededRand } from '../bot';
import { arrive, edit, full, newGame } from './helpers';
import { BOT_ACCURACY } from '../../shared/economy';

const BOTS = [true, true, true, true];
const atQuestion = (seat: Seat = 0, tile = 2) => {
  let s = arrive(newGame(1, BOTS), seat, tile);
  s = apply(s, { type: 'timeout' }, full); // 문화 카드
  expect(s.turn.step).toBe('question');
  return s;
};

describe('RNG·정답률', () => {
  it('시드 RNG 는 결정적이다', () => {
    const a = seededRand(9), b = seededRand(9);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it.each([40, 60, 80] as const)('정답률은 놀이 시간 %i분 범위(BOT_ACCURACY)에서 균일 추출(PRD §4.5 U2)', (m) => {
    const [lo, hi] = BOT_ACCURACY[m];
    expect(hi - lo).toBeCloseTo(0.1, 10); // 폭 0.10 고정
    const r = seededRand(3);
    const xs = Array.from({ length: 2000 }, () => drawAccuracy(r, m));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(lo);
    expect(Math.max(...xs)).toBeLessThan(hi);
    expect(Math.min(...xs)).toBeLessThan(lo + 0.01);
    expect(Math.max(...xs)).toBeGreaterThan(hi - 0.01);
    const mean = xs.reduce((x, y) => x + y, 0) / xs.length;
    expect(Math.abs(mean - (lo + hi) / 2)).toBeLessThan(0.005);
  });

  it('범위는 PRD §4.5 조정 창 안, 짧은 판일수록 높다', () => {
    const win = { 40: [0.58, 0.72], 60: [0.52, 0.68], 80: [0.48, 0.65] } as const;
    expect(Object.keys(BOT_ACCURACY).map(Number)).toEqual([40, 60, 80]); // U3: 20 키 없음
    for (const m of [40, 60, 80] as const) {
      expect(BOT_ACCURACY[m][0]).toBeGreaterThanOrEqual(win[m][0]);
      expect(BOT_ACCURACY[m][1]).toBeLessThanOrEqual(win[m][1]);
    }
    expect(BOT_ACCURACY[40]).toEqual([0.6, 0.7]); // S1·S2 기준선
    expect(BOT_ACCURACY[40][0]).toBeGreaterThan(BOT_ACCURACY[60][0]);
    expect(BOT_ACCURACY[80][0]).toBeLessThan(BOT_ACCURACY[60][0]);
  });

  it('65% 봇은 문항·참/거짓을 약 65% 맞힌다(같은 값)', () => {
    const s = atQuestion();
    const r = seededRand(5);
    let q = 0, tf = 0;
    const N = 3000;
    const tfState = edit(s, (d) => { d.turn.step = 'tf'; d.turn.tf = { stmtId: 'x', answer: true, answers: [] }; });
    for (let i = 0; i < N; i++) {
      const a = botAction(s, 0, full, r, 0.65);
      if (a?.type === 'answer' && a.choice === s.turn.question!.answer) q++;
      const t = botAction(tfState, 1, full, r, 0.65);
      if (t?.type === 'tfAnswer' && t.value === true) tf++;
    }
    expect(Math.abs(q / N - 0.65)).toBeLessThan(0.03);
    expect(Math.abs(tf / N - 0.65)).toBeLessThan(0.03);
  });

  it('주사위 게이지를 쓰지 않는다', () => {
    expect(botAction(newGame(1, BOTS), 0, full, seededRand(1), 0.65)).toEqual({ type: 'roll', seat: 0 });
  });
});

describe('0% 봇', () => {
  it('문항(4지선다·참/거짓 형식)·관전 참/거짓·미션 전부 오답이고 무응답이 아니다', () => {
    const s = atQuestion();
    const tfFormat = edit(s, (d) => { d.turn.question = { ...d.turn.question!, format: 'tf', answer: false }; });
    const spect = edit(s, (d) => { d.turn.step = 'tf'; d.turn.tf = { stmtId: 'x', answer: false, answers: [] }; });
    const mission = edit(s, (d) => { d.turn.step = 'mission'; d.turn.missionId = full.missions[0].id; });
    const r = seededRand(7);
    for (let i = 0; i < 200; i++) {
      const a = botAction(s, 0, full, r, 0);
      expect(a?.type).toBe('answer');
      expect(a?.type === 'answer' && a.choice !== null && a.choice !== s.turn.question!.answer).toBe(true);
      expect(botAction(tfFormat, 0, full, r, 0)).toMatchObject({ type: 'answer', choice: true });
      expect(botAction(spect, 1, full, r, 0)).toMatchObject({ type: 'tfAnswer', value: true });
      expect(botAction(mission, 0, full, r, 0)).toMatchObject({ type: 'missionAnswer', answer: {} });
    }
  });

  it('구매·건설·인수·통행료 결정은 65% 봇과 같은 정책', () => {
    const base = arrive(newGame(1, BOTS), 0, 2);
    const states: GameState[] = [
      edit(base, (d) => { d.turn.step = 'action'; d.turn.correct = false; }),
      edit(base, (d) => { d.turn.step = 'action'; d.turn.correct = false; d.players[0].coin = 230; }),
      edit(base, (d) => { d.turn.step = 'action'; d.turn.correct = true; d.tiles[2].owner = 0; }),
      edit(base, (d) => { d.turn.step = 'takeover'; d.turn.correct = true; d.tiles[2].owner = 1; d.tiles[1].owner = 0; d.tiles[4].owner = 0; d.turn.takeoverCost = 440; }),
      edit(base, (d) => { d.turn.step = 'toll'; d.tiles[2].owner = 1; d.players[0].items = ['tollFree']; }),
    ];
    for (const s of states) {
      expect(botAction(s, 0, full, seededRand(2), 0)).toEqual(botAction(s, 0, full, seededRand(2), 0.65));
    }
  });
});

describe('행동 정책 (§4.5)', () => {
  const action = (f: (d: GameState) => void) =>
    botAction(edit(arrive(newGame(1, BOTS), 0, 2), (d) => { d.turn.step = 'action'; d.turn.correct = false; f(d); }), 0, full, seededRand(1), 0.65);

  it('땅: 코인 ≥ 가격 + 예비금(보드 최고 통행료)이면 산다', () => {
    // 타일 23(미국 760) 랜드마크 = 통행료 4560 이 보드 최고
    const withLandmark = (d: GameState) => { d.tiles[23] = { owner: 1, level: 4, festivalTarget: false }; };
    expect(reserve(edit(newGame(), withLandmark), 0)).toBe(4560);
    expect(action((d) => { withLandmark(d); d.players[0].coin = 230 + 4560; })).toEqual({ type: 'buy', seat: 0 });
    expect(action((d) => { withLandmark(d); d.players[0].coin = 230 + 4559; })).toEqual({ type: 'pass', seat: 0 });
    expect(reserve(edit(newGame(), withLandmark), 1)).toBe(0); // 내 땅은 예비금에 안 넣는다
  });

  it('인수: 코인 ≥ 인수비 + 예비금이면 한다 — 그 대륙에 내 땅이 없어도(PRD §4.5, 2026-10-28 U3)', () => {
    const asia = continentTiles('asia');
    const at = (mine: number, coin: number) => botAction(edit(arrive(newGame(1, BOTS), 0, 2), (d) => {
      d.turn.step = 'takeover'; d.turn.correct = true; d.turn.takeoverCost = 440;
      d.tiles[2].owner = 1;
      asia.filter((i) => i !== 2).slice(0, mine).forEach((i) => { d.tiles[i].owner = 0; });
      d.players[0].coin = coin;
    }), 0, full, seededRand(1), 0.65);
    expect(at(1, 5000)?.type).toBe('takeover');
    expect(at(0, 5000)?.type).toBe('takeover'); // U3: 옛 '대륙에 내 땅 ≥ 1칸' 조건 삭제
    expect(at(0, 439)?.type).toBe('pass');
    expect(at(1, 439)?.type).toBe('pass');
    // 예비금(보드 최고 통행료)도 남겨야 한다
    const withReserve = (coin: number) => botAction(edit(arrive(newGame(1, BOTS), 0, 2), (d) => {
      d.turn.step = 'takeover'; d.turn.correct = true; d.turn.takeoverCost = 440;
      d.tiles[2].owner = 1; d.tiles[23] = { owner: 1, level: 4, festivalTarget: false };
      d.players[0].coin = coin;
    }), 0, full, seededRand(1), 0.65);
    expect(withReserve(440 + 4560)?.type).toBe('takeover');
    expect(withReserve(440 + 4559)?.type).toBe('pass');
  });

  it('통행료 면제는 최고 통행료 때만 쓴다', () => {
    const toll = (tile: number) => botAction(edit(arrive(newGame(1, BOTS), 0, 2), (d) => {
      d.turn.step = 'toll'; d.turn.tile = tile; d.turn.correct = false; d.players[0].items = ['tollFree'];
      d.tiles[2] = { owner: 1, level: 0, festivalTarget: false };
      d.tiles[26] = { owner: 2, level: 4, festivalTarget: false };
    }), 0, full, seededRand(1), 0.65);
    expect(toll(26)).toEqual({ type: 'payToll', seat: 0, item: 'tollFree' });
    expect(toll(2)).toEqual({ type: 'payToll', seat: 0, item: null });
  });

  it('botSeats: 관전 참/거짓은 도착자 아닌 미응답 봇, 해설 단계는 없음', () => {
    const s = atQuestion();
    expect(botSeats(s)).toEqual([0]);
    expect(botSeats(edit(s, (d) => { d.turn.step = 'explanation'; }))).toEqual([]);
    expect(botSeats(edit(s, (d) => { d.turn.step = 'tf'; d.turn.tf = { stmtId: 'x', answer: true, answers: [{ seat: 2, value: true }] }; }))).toEqual([1, 3]);
  });
});

describe('playBotGame', () => {
  const game = (seed: number, f?: (d: GameState) => void, timeoutP = 0.05) => {
    const r = seededRand(seed);
    let state = createGame({ seed, bots: BOTS, settings: { totalMinutes: 40, touristQuiz: false } });
    if (f) state = edit(state, f);
    return playBotGame({ state, content: full, rand: r, accuracy: [0, 0.65, 0.65, 0.65], turnMs: 56_000, timeoutP });
  };

  it('같은 시드면 같은 결과, 놀이 시간 끝까지 돈다(멈춤 없음)', () => {
    const a = game(11), b = game(11);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.state.phase).toBe('finished');
    expect(a.state.log.filter((e) => e.ev === 'clock' && e.kind === 'pause')).toEqual([]);
    expect(a.state.log.filter((e) => e.ev === 'clock').at(-1)).toMatchObject({ kind: 'end' });
  });

  it('파산 집계는 놀이 시간 절반 시점 값', () => {
    // 3번 자리를 처음부터 파산시켜 둔다 → 절반 시점에 1명 이상
    const r = game(4, (d) => { d.players[3].bankrupt = true; d.players[3].coin = 0; });
    expect(r.bankruptHalf).toBeGreaterThanOrEqual(1);
    expect(r.state.players.filter((p) => p.bankrupt).length).toBeGreaterThanOrEqual(1);
  });

  it('전부 무응답(timeout)이어도 끝난다', () => {
    expect(game(5, undefined, 1).state.phase).toBe('finished');
  });

  it('0% 봇 자리는 무응답 없이 늘 오답을 낸다', () => {
    const { state } = game(6, undefined, 1);
    const zero = state.log.filter((e) => e.ev === 'answer' && e.seat === 0);
    expect(zero.length).toBeGreaterThan(0);
    expect(zero.every((e) => e.ev === 'answer' && e.choice !== null && !e.correct)).toBe(true);
  });
});
