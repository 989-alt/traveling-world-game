// 이동 연출 시간(shared/timing): 화면 카메라·홉과 서버 도착 단계 마감 늦춤이 같은 값을 쓴다(R4 T-E 수정 1).
import { describe, expect, it } from 'vitest';
import {
  DICE, DICE_SHOW_MS, DICE_SHOW_MS_REDUCED, DICE_STOP_MS, EVENT_MS, HOP_GAP_MS, MAX_HOP, moveShowMs, movesShowMs, PICK_BOT_FLASH_MS, PICK_SIGN_MS,
  PRESS_MAX_MS, TF_RESULT_MS, TOLL_MS, ZOOM_HOLD_MS, ZOOM_IN_MS, ZOOM_OUT_MS,
} from '../../shared/timing';
import { ANTARCTIC_TILE } from '../../shared/board';
import { STEP_MS } from '../../shared/economy';
import type { GameState, LogEvent } from '../../shared/types';
import { apply } from '../engine';
import { arrive, full, newGame, withDice } from './helpers';

describe('이동 연출 시간', () => {
  it('= max(줌 in, 홉 수 × 홉 간격) + 착지 머묾 + 복귀. 순간 이동(> 12칸)은 줌 in 을 다 보이고 머문다', () => {
    expect([ZOOM_IN_MS, ZOOM_HOLD_MS, ZOOM_OUT_MS, HOP_GAP_MS, MAX_HOP]).toEqual([400, 300, 600, 340, 12]);
    expect(moveShowMs(0, 0)).toBe(0);
    expect(moveShowMs(0, 1)).toBe(400 + 900); // 1홉 340 < 줌 in 400
    expect(moveShowMs(0, 2)).toBe(680 + 900);
    expect(moveShowMs(0, 12)).toBe(12 * 340 + 900);
    expect(moveShowMs(28, 4)).toBe(6 * 340 + 900); // 출발 칸을 넘어도 칸 수로
    expect(moveShowMs(25, 10)).toBe(400 + 900); // 15칸 = 순간 이동
  });
  it('엔진 이동 로그로 센다: 주사위 2+3 → 5홉', () => {
    const g0 = withDice(newGame(), 2, 3);
    const g1 = apply(g0, { type: 'roll', seat: 0 }, full);
    const fresh = g1.log.slice(g0.log.length);
    expect(fresh.some((e) => e.ev === 'move')).toBe(true);
    expect(movesShowMs(fresh)).toBe(1830 + 5 * 340 + 900); // U8 주사위 B: 뗌 → 이동 시작 1830(§17.1.2) + 이동
    expect(movesShowMs([])).toBe(0);
  });
  it('주사위 B 타임라인(§17.1.2): 쏟기 80+120 · 튕김 330×2 → 멈춤 +780 · 합 팝 +930 · 이동 +1830, reduced 900', () => {
    expect(DICE_STOP_MS).toBe(780);
    expect([DICE.popAt, DICE.chipAt, DICE_SHOW_MS, DICE_SHOW_MS_REDUCED, DICE.botShake]).toEqual([930, 1100, 1830, 900, 600]);
    expect(movesShowMs([{ ev: 'dice', seat: 1, d1: 2, d2: 3 }])).toBe(1830); // 무인도에서 못 나감(이동 없음)도 주사위 연출은 본다
  });
});

describe('U10 알림 카드 시간(PRD §4.3): movesShowMs 가 event·toll 도 센다', () => {
  const ev = (kind: string, payload: Record<string, unknown> = {}) => ({ ev: 'event', seat: 0, kind, payload }) as LogEvent;
  const toll = { ev: 'toll', payer: 0, owner: 1, tile: 16, base: 440, multiplier: 1, discounted: false, paid: 440 } as LogEvent;
  it('값: EVENT 3200 · TOLL 3000 · TF_RESULT 2000 · 봇 반짝 1000 · 누름 상한 2900 · 간판 200', () => {
    expect([EVENT_MS, TOLL_MS, TF_RESULT_MS, PICK_BOT_FLASH_MS, PRESS_MAX_MS, PICK_SIGN_MS]).toEqual([3200, 3000, 2000, 1000, 2900, 200]);
    expect(STEP_MS.tfResult).toBe(TF_RESULT_MS);
  });
  it('알림 2장 연속(남극 탐험 → 기후 사건) = 3.2 × 2 + 이동', () => {
    const move = { ev: 'move', seat: 0, from: 3, to: 8, via: 'dice' } as LogEvent;
    expect(movesShowMs([ev('antarctic'), ev('climate')])).toBe(6400);
    expect(movesShowMs([move, ev('antarctic'), ev('climate')])).toBe(6400 + moveShowMs(3, 8));
  });
  it('통행료 3.0. 바로 인수 단계(같은 칸)로 가면 알림 없음. 관광지 도착·무인도 탈출은 알림 없음', () => {
    expect(movesShowMs([toll])).toBe(TOLL_MS);
    expect(movesShowMs([toll], { step: 'takeover', tile: 16 })).toBe(0);
    expect(movesShowMs([toll], { step: 'roll', tile: null })).toBe(TOLL_MS);
    expect(movesShowMs([ev('tourist', { tile: 7 }), ev('island', { escape: 'coin' })])).toBe(0);
    expect(movesShowMs([ev('island'), ev('travel'), ev('festival', { fund: 0 }), ev('korea'), ev('fund')])).toBe(5 * EVENT_MS);
  });
  it('엔진: 남극 참/거짓 결과가 닫히면 남극·기후 알림 2장이 새 로그로 나온다', () => {
    let s = arrive(newGame(), 0, ANTARCTIC_TILE);
    expect(s.turn.step).toBe('question');
    s = answerAndSkipTo(s);
    expect(s.turn.step).toBe('tfResult');
    const before = s.log.length;
    s = apply(s, { type: 'timeout' }, full);
    expect(s.turn).toMatchObject({ seat: 1, step: 'roll' });
    const fresh = s.log.slice(before);
    expect(fresh.filter((e) => e.ev === 'event').map((e) => (e as { kind: string }).kind)).toEqual(['antarctic', 'climate']);
    expect(movesShowMs(fresh, { step: s.turn.step, tile: s.turn.tile })).toBe(2 * EVENT_MS);
  });
});

/** 문항 오답 → 해설 timeout → 참/거짓 timeout (결과 단계에서 멈춤) */
function answerAndSkipTo(s: GameState): GameState {
  const q = s.turn.question!;
  s = apply(s, { type: 'answer', seat: s.turn.seat, choice: q.format === 'tf' ? !q.answer : ((q.answer as number) + 1) % 4, ms: 1000 }, full);
  s = apply(s, { type: 'timeout' }, full);
  return apply(s, { type: 'timeout' }, full);
}
