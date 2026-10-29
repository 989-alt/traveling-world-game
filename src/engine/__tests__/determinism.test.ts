import { describe, expect, it } from 'vitest';
import { apply } from '../engine';
import type { Action, GameState, Seat } from '../../shared/types';
import { full, newGame } from './helpers';

/** 시드 고정 입력 생성기(엔진 RNG 와 별개). 같은 testSeed → 같은 입력 시퀀스 */
function play(seed: number, testSeed: number, maxSteps = 3000): GameState {
  let r = testSeed >>> 0;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let s = newGame(seed, [false, true, false, true]);
  for (let i = 0; i < maxSteps && s.phase !== 'finished'; i++) {
    if (s.phase === 'paused') { s = apply(s, { type: 'resume' }, full); continue; }
    const seat = s.turn.seat;
    const q = s.turn.question;
    const pick: Action[] = [{ type: 'timeout' }];
    switch (s.turn.step) {
      case 'roll': pick.push({ type: 'roll', seat, gauge: rnd() }); break;
      case 'question': pick.push({ type: 'answer', seat, choice: q!.format === 'tf' ? rnd() < 0.5 : Math.floor(rnd() * 4), ms: Math.floor(rnd() * 20000) }); break;
      case 'tf': for (const o of [0, 1, 2, 3] as Seat[]) if (o !== seat) pick.push({ type: 'tfAnswer', seat: o, value: rnd() < 0.5 }); break;
      case 'action': pick.push({ type: 'buy', seat }, { type: 'build', seat }); break;
      case 'takeover': pick.push({ type: 'takeover', seat }); break;
      case 'reward': pick.push({ type: 'chooseReward', seat, index: Math.floor(rnd() * 3) }); break;
      case 'travel': pick.push({ type: 'travel', seat, tile: Math.floor(rnd() * 40) }); break;
    }
    s = apply(s, pick[Math.floor(rnd() * pick.length)], full);
    if (i % 7 === 0) s = apply(s, { type: 'tick', ms: 20_000 }, full);
  }
  return s;
}

describe('determinism', () => {
  it('같은 seed + 같은 입력 → 같은 로그·상태 (JSON 동일)', () => {
    const a = play(42, 9);
    const b = play(42, 9);
    expect(a.log.length).toBeGreaterThan(200);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('seed 가 다르면 로그가 다르다', () => {
    expect(JSON.stringify(play(43, 9).log)).not.toBe(JSON.stringify(play(42, 9).log));
  });

  it('한 판이 끝까지 돈다 (놀이 시간 소진 또는 승리)', () => {
    const s = play(5, 3, 20000);
    expect(s.phase).toBe('finished');
    expect(s.log.at(-1)!.ev).toBe('result');
    for (const p of s.players) if (!p.bankrupt) expect(p.coin).toBeGreaterThanOrEqual(0);
  });
});
