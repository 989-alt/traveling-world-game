// 이동 연출 시간(shared/timing): 화면 카메라·홉과 서버 도착 단계 마감 늦춤이 같은 값을 쓴다(R4 T-E 수정 1).
import { describe, expect, it } from 'vitest';
import { DICE, DICE_SHOW_MS, DICE_SHOW_MS_REDUCED, DICE_STOP_MS, HOP_GAP_MS, MAX_HOP, moveShowMs, movesShowMs, ZOOM_HOLD_MS, ZOOM_IN_MS, ZOOM_OUT_MS } from '../../shared/timing';
import { apply } from '../engine';
import { full, newGame, withDice } from './helpers';

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
