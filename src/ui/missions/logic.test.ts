import { describe, expect, it } from 'vitest';
import missions from '../../data/missions.json';
import type { Mission } from '../../shared/content-types';
import {
  blocksAnswer, choiceAnswer, connectAnswer, elapsed, emptySlots, link,
  orderAnswer, place, shuffled, snapTo, SNAP, takeOut,
} from './logic';

const ms = missions as Mission[];
const MAX_ITEMS = 8; // 한 활동의 요소 수 상한
/** 이 활동의 요소 수(블록·항목·선택지) */
const itemCount = (m: Mission) => m.pairs?.length ?? m.steps?.length ?? m.options?.length ?? 0;
const pairsOf = (l: Parameters<typeof connectAnswer>[0]) => connectAnswer(l, 0).pairs;

describe('연결하기 link', () => {
  it('이미 이은 왼쪽을 다시 이으면 이전 선이 사라진다', () => {
    let l = link({}, 0, 2);
    l = link(l, 0, 1);
    expect(pairsOf(l)).toEqual([[0, 1]]);
  });
  it('이미 이은 오른쪽에 다른 왼쪽을 이으면 앞 선이 사라진다', () => {
    let l = link({}, 0, 2);
    l = link(l, 1, 2);
    expect(pairsOf(l)).toEqual([[1, 2]]);
  });
  it('다른 선은 그대로', () => {
    const l = link(link({}, 0, 0), 1, 1);
    expect(connectAnswer(l, 1234)).toEqual({ pairs: [[0, 0], [1, 1]], ms: 1234 });
  });
});

describe('블록 놓기 place', () => {
  it('빈 칸에 놓기 → 놓인 블록은 한 곳에만', () => {
    let s = place(emptySlots(3), 2, 0);
    s = place(s, 2, 1);
    expect(s).toEqual([null, 2, null]);
  });
  it('차 있는 칸에 놓으면 서로 바꿔 앉는다', () => {
    let s = place(place(emptySlots(3), 0, 0), 1, 1);
    s = place(s, 0, 1);
    expect(s).toEqual([1, 0, null]);
  });
  it('트레이에서 차 있는 칸에 놓으면 앞 블록은 트레이로', () => {
    const s = place(place(emptySlots(2), 0, 0), 1, 0);
    expect(s).toEqual([1, null]);
  });
  it('takeOut', () => expect(takeOut([0, 1, null], 1)).toEqual([0, null, null]));
  it('제출: 안 채운 칸은 뺀다(부분 정답은 서버가 실패로)', () => {
    expect(blocksAnswer([2, null, 0], 9)).toEqual({ pairs: [[2, 0], [0, 2]], ms: 9 });
    expect(orderAnswer([1, null, 0], 9)).toEqual({ steps: [1, 0], ms: 9 });
  });
});

describe('스냅', () => {
  const r = { left: 100, top: 100, right: 160, bottom: 160 };
  it('상자 안·SNAP 이내는 붙고, 멀면 -1(원위치)', () => {
    expect(snapTo(130, 130, [r])).toBe(0);
    expect(snapTo(160 + SNAP, 130, [r])).toBe(0);
    expect(snapTo(160 + SNAP + 1, 130, [r])).toBe(-1);
  });
  it('가장 가까운 칸을 고른다', () => {
    const r2 = { left: 200, top: 100, right: 260, bottom: 160 };
    expect(snapTo(185, 130, [r, r2])).toBe(1);
  });
  it('SNAP 은 24px 이상', () => expect(SNAP).toBeGreaterThanOrEqual(24));
});

describe('선택하기', () => {
  it('고른 번호를 정렬해 보낸다(모두 고름 = 집합)', () => expect(choiceAnswer([3, 0], 5)).toEqual({ selected: [0, 3], ms: 5 }));
});

describe('shuffled', () => {
  it('같은 시드 = 같은 순서, 순열이고 항등이 아니다', () => {
    for (const m of ms) {
      const n = itemCount(m);
      const a = shuffled(n, m.id);
      expect(shuffled(n, m.id)).toEqual(a);
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
      if (n > 1) expect(a.every((v, i) => v === i), m.id).toBe(false);
    }
  });
});

describe('시간', () => {
  it('걸린 시간은 0~duration', () => {
    expect(elapsed(10_000, 5_000, 6_000)).toBe(1_000);
    expect(elapsed(10_000, 5_000, 20_000)).toBe(5_000);
    expect(elapsed(10_000, 5_000, 0)).toBe(0);
  });
});

describe('실제 미션 40개', () => {
  it('요소 수 ≤ 8, 번호가 프로토콜 한도(12) 안', () => {
    for (const m of ms) {
      expect(itemCount(m), m.id).toBeGreaterThan(0);
      expect(itemCount(m), m.id).toBeLessThanOrEqual(MAX_ITEMS);
    }
  });
});
