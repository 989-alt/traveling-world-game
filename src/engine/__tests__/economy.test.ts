import { describe, expect, it } from 'vitest';
import { assetsOf, buildCost, landPrice, takeoverCost, tollQuote } from '../pay';
import { edit, newGame } from './helpers';
import { DISCOUNT, TAKEOVER_RATE } from '../../shared/economy';

// 타이(2) 땅값 230, 사우디아라비아(5) 340, 이집트(16) 550 (30칸, 2026-10-26)
const owned = (tile: number, level: 0 | 1 | 2 | 3 | 4, owner: 0 | 1 = 1) =>
  edit(newGame(), (d) => { d.tiles[tile] = { owner, level, festivalTarget: false }; });

describe('지불액 식 하나 (PRD §4.4)', () => {
  it('땅값 = 기준 × (정답 ? d : 1)', () => {
    expect(landPrice(2, false)).toBe(230);
    expect(landPrice(2, true)).toBe(230 * DISCOUNT);
  });

  it('건설비는 그 단계만, 인수비 = (땅값+건설비 합)×TAKEOVER_RATE', () => {
    expect([1, 2, 3, 4].map((l) => buildCost(16, l))).toEqual([550, 825, 1100, 1650]);
    expect(takeoverCost(owned(16, 2), 16)).toBe((550 + 550 + 825) * TAKEOVER_RATE);
  });

  it('통행료 = 기준 × 배율 × (정답 ? d : 1)', () => {
    const s = owned(16, 1);
    expect(tollQuote(s, 16, false, null)).toMatchObject({ base: 440, multiplier: 1, discounted: false, paid: 440 });
    expect(tollQuote(s, 16, true, null)).toMatchObject({ base: 440, multiplier: 1, discounted: true, paid: 220, climateCut: 0 });
  });

  it('축제×2 + 정답 d + 절반 아이템 → 기준×2×0.5, 아이템 미사용', () => {
    const s = edit(owned(16, 1), (d) => { d.tiles[16].festivalTarget = true; });
    const q = tollQuote(s, 16, true, 'tollHalf');
    expect(q).toMatchObject({ base: 440, multiplier: 2, discounted: true, paid: 440, itemUsed: false });
  });

  it('면제 아이템이 더 유리하면 아이템 하나만 (정답 할인과 중첩 안 함)', () => {
    const q = tollQuote(owned(16, 1), 16, true, 'tollFree');
    expect(q).toMatchObject({ paid: 0, discounted: false, itemUsed: true });
    const h = tollQuote(owned(16, 1), 16, false, 'tollHalf');
    expect(h).toMatchObject({ paid: 220, discounted: false, itemUsed: true });
  });

  it('기후 위기 ×0.5 는 정답 할인과 중첩', () => {
    const s = edit(owned(16, 1), (d) => { d.climateEvent = { continent: 'africa', turnsLeft: 2, bySeat: 0 }; });
    expect(tollQuote(s, 16, true, null)).toMatchObject({ multiplier: 0.5, paid: 110, climateCut: 110 }); // 깎인 차액 = 은행 기금 적립분
    expect(tollQuote(s, 16, true, 'tollFree')).toMatchObject({ paid: 0, climateCut: 0 });
    // 다른 대륙은 그대로
    const asia = edit(owned(5, 0), (d) => { d.climateEvent = { continent: 'africa', turnsLeft: 2, bySeat: 0 }; });
    expect(tollQuote(asia, 5, false, null)).toMatchObject({ multiplier: 1, climateCut: 0 });
  });

  it('막판 남은 5분 ×1.5, 모든 길이 같음(2026-10-28 U3: 20분 판 3분 삭제)', () => {
    const s = edit(owned(16, 1), (d) => { d.clock.remainingMs = 5 * 60_000; });
    expect(tollQuote(s, 16, false, null)).toMatchObject({ multiplier: 1.5, paid: 660 });
    const notLast = edit(owned(16, 1), (d) => { d.clock.remainingMs = 5 * 60_000 + 1; });
    expect(tollQuote(notLast, 16, false, null).multiplier).toBe(1);
    for (const m of [40, 60, 80] as const) {
      const at = (ms: number) => edit(owned(16, 1), (d) => { d.settings.totalMinutes = m; d.clock.remainingMs = ms; });
      expect(tollQuote(at(5 * 60_000), 16, false, null).multiplier).toBe(1.5);
      expect(tollQuote(at(5 * 60_000 + 1), 16, false, null).multiplier).toBe(1);
    }
  });

  it('관광지(호주 하나): 고정 통행료, 쌍 배율 없음', () => {
    const one = owned(7, 0);
    expect(tollQuote(one, 7, false, null)).toMatchObject({ base: 300, multiplier: 1, paid: 300 });
    const more = edit(one, (d) => { d.tiles[1] = { owner: 1, level: 0, festivalTarget: false }; });
    expect(tollQuote(more, 7, false, null)).toMatchObject({ multiplier: 1, paid: 300 });
  });

  it('자산 = 코인 + 땅값 + 건설비', () => {
    const s = owned(16, 2);
    expect(assetsOf(s, 1)).toBe(5000 + 550 + 550 + 825);
    expect(assetsOf(s, 0)).toBe(5000);
  });
});
