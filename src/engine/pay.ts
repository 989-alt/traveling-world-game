// 지불액 식 하나 (PRD §4.4): 통행료 = 기준×배율×(정답?d:1), 땅값 = 기준×(정답?d:1), 인수비 = 기준.
import { BOARD } from '../shared/board';
import {
  BUILD_RATE, CLIMATE_MULT, DISCOUNT, FESTIVAL_MULT, LAST_MINUTES_MS, LAST_MINUTES_MULT,
  TAKEOVER_RATE, TOLL_HALF_ITEM, TOLL_RATE,
} from '../shared/economy';
import type { GameState } from '../shared/types';

const price = (tile: number) => BOARD[tile].price ?? 0;

export const landPrice = (tile: number, correct: boolean) => Math.round(price(tile) * (correct ? DISCOUNT : 1));
/** 그 단계 하나의 건설비 */
export const buildCost = (tile: number, level: number) => Math.round(price(tile) * BUILD_RATE[level]);
/** 땅값 + 세운 건물 건설비 합 */
export function tileValue(tile: number, level: number): number {
  let v = price(tile);
  for (let l = 1; l <= level; l++) v += buildCost(tile, l);
  return v;
}
export const takeoverCost = (s: GameState, tile: number) => tileValue(tile, s.tiles[tile].level) * TAKEOVER_RATE;

/** 막판(마지막 5분, 모든 길이 같음): 통행료 ×1.5 */
export const isLastMinutes = (s: Pick<GameState, 'clock'>) => s.clock.remainingMs <= LAST_MINUTES_MS;

export function tollQuote(s: GameState, tile: number, correct: boolean, item: 'tollFree' | 'tollHalf' | null) {
  const t = BOARD[tile];
  const st = s.tiles[tile];
  const base = t.tollFixed ?? Math.round(price(tile) * TOLL_RATE[st.level]);
  let multiplier = 1;
  if (st.festivalTarget) multiplier *= FESTIVAL_MULT;
  if (isLastMinutes(s)) multiplier *= LAST_MINUTES_MULT;
  // 관광지 쌍 배율은 없어졌다(호주 하나, 2026-10-26)
  const climate = s.climateEvent?.continent === t.continent;
  if (climate) multiplier *= CLIMATE_MULT;
  // 아이템과 정답 할인은 중첩 안 함 — 유리한 쪽 하나. 같으면 아이템을 아낀다
  const quiz = correct ? DISCOUNT : 1;
  const itemFactor = item === 'tollFree' ? 0 : item === 'tollHalf' ? TOLL_HALF_ITEM : 1;
  const itemUsed = itemFactor < quiz;
  const factor = itemUsed ? itemFactor : quiz;
  const paid = Math.round(base * multiplier * factor);
  return {
    base,
    multiplier,
    discounted: correct && !itemUsed,
    itemUsed,
    paid,
    /** 기후 위기로 땅 주인이 못 받은 차액 → 은행 기금 적립(§3.6). 기후 위기 아니면 0 */
    climateCut: climate ? Math.round((base * multiplier * factor) / CLIMATE_MULT) - paid : 0,
  };
}

export function assetsOf(s: GameState, seat: number): number {
  let v = s.players[seat].coin;
  s.tiles.forEach((t, i) => { if (t.owner === seat) v += tileValue(i, t.level); });
  return v;
}
