import { describe, expect, it } from 'vitest';
import {
  ANTARCTIC_TILE, BOARD, CONTINENTS, FESTIVAL_TILE, ISLAND_TILE, MISSION_TILES, TOURIST_TILES, TRAVEL_TILE, continentTiles, countryLabel, countryNameOf,
} from '../../shared/board';

describe('board (PRD §4.1, 2026-10-26 30칸)', () => {
  it('30칸, index 일치', () => {
    expect(BOARD).toHaveLength(30);
    BOARD.forEach((t, i) => expect(t.index).toBe(i));
  });

  it('특수 칸 위치(기금·기후 위기 칸 없음)', () => {
    const at = (k: string) => BOARD.filter((t) => t.kind === k).map((t) => t.index);
    expect(at('start')).toEqual([0]);
    expect(at('mission')).toEqual([6, 20]);
    expect(at('tourist')).toEqual([7]);
    expect(at('antarctic')).toEqual([8]);
    expect(at('festival')).toEqual([9]);
    expect(at('island')).toEqual([10]);
    expect(at('travel')).toEqual([25]);
    expect(at('fund')).toEqual([]);
    expect(at('climate')).toEqual([]);
    expect([MISSION_TILES, TOURIST_TILES, ANTARCTIC_TILE, FESTIVAL_TILE, ISLAND_TILE, TRAVEL_TILE]).toEqual([[6, 20], [7], 8, 9, 10, 25]);
  });

  it('출발 = 한국 탐험 칸(소유·땅값 없음)', () => {
    expect(BOARD[0]).toMatchObject({ kind: 'start', country: 'kr' });
    expect('explore' in BOARD[0]).toBe(false);
    expect(countryLabel(BOARD[0])).toBe('한국');
    expect(countryNameOf('kr')).toBe('한국');
    expect(countryNameOf('aq')).toBe('남극');
    expect(BOARD[0].price).toBeUndefined();
    expect(BOARD.filter((t) => t.country === 'kr').map((t) => t.index)).toEqual([0]);
  });

  it('땅값 200 → 930 과 호주 고정 통행료', () => {
    const price = Object.fromEntries(BOARD.filter((t) => t.price).map((t) => [t.index, t.price]));
    expect(price).toEqual({
      1: 200, 2: 230, 3: 270, 4: 300, 5: 340, 7: 500, 11: 370, 12: 410, 13: 440, 14: 480, 15: 510,
      16: 550, 17: 580, 18: 620, 19: 650, 21: 690, 22: 720, 23: 760, 24: 790, 26: 830, 27: 860, 28: 900, 29: 930,
    });
    expect(BOARD[7]).toMatchObject({ kind: 'tourist', country: 'au', continent: 'oceania', tollFixed: 300 });
  });

  it('여행지 22개 중복 없음, 대륙별 5·5·4·4·4 연속 구간, 뺀 나라 없음', () => {
    const countries = BOARD.filter((t) => t.kind === 'country').map((t) => t.country);
    expect(new Set(countries).size).toBe(22);
    for (const gone of ['zm', 'pe', 'nz']) expect(BOARD.some((t) => t.country === gone)).toBe(false);
    expect(CONTINENTS.map((c) => continentTiles(c))).toEqual([
      [1, 2, 3, 4, 5], [11, 12, 13, 14, 15], [16, 17, 18, 19], [21, 22, 23, 24], [26, 27, 28, 29],
    ]);
  });
});
