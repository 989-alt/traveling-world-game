// 문항 아래 막대(R4-final 리뷰 2): 출발·한국 칸은 땅값 0 이 아니라 한국 보너스를 보인다
import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/__tests__/helpers';
import { landPrice } from '../../engine/pay';
import { ANTARCTIC_TILE, START_TILE } from '../../shared/board';
import { ANTARCTIC_BONUS, KOREA_BONUS } from '../../shared/economy';
import { stakeLine } from './stake';

const won = (n: number) => n.toLocaleString('ko-KR');

describe('문항 막대 문구', () => {
  it('출발·한국: 정답 보너스(땅값 0 아님)', () => {
    const line = stakeLine(newGame(), 0, START_TILE);
    expect(line).toBe(`정답이면 보너스 ${won(KOREA_BONUS)}코인`);
    expect(line).not.toMatch(/땅값/);
  });
  it('남극: 같은 꼴의 탐험 보너스', () => {
    expect(stakeLine(newGame(), 0, ANTARCTIC_TILE)).toBe(`정답이면 보너스 ${won(ANTARCTIC_BONUS)}코인`);
  });
  it('빈 나라 땅: 땅값 → 정답 땅값', () => {
    expect(stakeLine(newGame(), 0, 1)).toBe(`땅값 ${won(landPrice(1, false))} → 정답이면 ${won(landPrice(1, true))}`);
  });
  it('남의 땅: 통행료', () => {
    expect(stakeLine((() => { const g = newGame(); g.tiles[1] = { ...g.tiles[1], owner: 2, level: 1 }; return g; })(), 0, 1)).toMatch(/^통행료 .+ → 정답이면 /);
  });
});
