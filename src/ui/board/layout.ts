// 한 칸 위 캐릭터·건물·깃발 배치 (PRD §12.1, tokens board.character-anchor, DESIGN §16.1 R5d).
// 규칙을 violations() 로 적고, place() 는 그 규칙을 통과하는 가장 큰 캐릭터 키(≤ 44px 토큰 상한)를 찾는다.
import { CHAR, insetOf, type Box, type Pt, type TileGeo } from './geometry';

export type { Box } from './geometry';
export interface Placement {
  /** 발 앵커(스프라이트 바닥 중앙), 스테이지 px */
  feet: Pt[];
  /** 캐릭터 스프라이트 키 */
  h: number;
  building: Box | null;
}

const FACE = 0.4; // 얼굴 상자 = 스프라이트 위 40%
// 건물(§16.1 R5d): 폭 ≤ 36·높이 ≤ 26. 공터(지름 30)가 캐릭터보다 좁아 공터 뒤 한가운데에 두면 혼자 선 사람의 얼굴과
// 늘 겹친다(PRD §12.1 얼굴·건물 규칙 위반) → 공터 오른쪽 뒤, 혼자 선 사람 스프라이트 바로 옆에 둔다.
const BUILDING = { w: 32, h: 26, gap: 0.5, back: 4 };
const EPS = 0.75; // 반올림 여유

export const spriteW = (h: number) => (h * CHAR.w) / CHAR.h;
export const spriteBox = (f: Pt, h: number): Box => ({ x: f.x - spriteW(h) / 2, y: f.y - h, w: spriteW(h), h });
export const faceBox = (f: Pt, h: number): Box => ({ ...spriteBox(f, h), h: h * FACE });
export const overlaps = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;

/** 규칙 위반 목록(빈 배열 = 통과). e2e 는 같은 규칙을 DOM 상자로 다시 잰다. */
export function violations(g: TileGeo, feet: Pt[], h: number, building: Box | null): string[] {
  const v: string[] = [];
  const n = feet.length;
  feet.forEach((f, i) => {
    if (insetOf(g.top, f) < 0.1 * g.topW) v.push(`#${i} 발이 가장자리 10% 안쪽이 아님`);
    const d = Math.hypot(f.x - g.anchor.x, f.y - g.anchor.y);
    if (d > (n === 1 ? 0.05 : 0.15) * g.topW) v.push(`#${i} 중앙점에서 ${d.toFixed(1)}px`);
  });
  const front = (j: number, i: number) => feet[j].y > feet[i].y || (feet[j].y === feet[i].y && j > i);
  for (let i = 0; i < n; i++) {
    const fi = faceBox(feet[i], h);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (j > i && overlaps(fi, faceBox(feet[j], h))) v.push(`#${i}·#${j} 얼굴 겹침`);
      if (front(j, i) && overlaps(fi, spriteBox(feet[j], h))) v.push(`#${i} 얼굴을 #${j} 가 가림`);
    }
    if (building) {
      if (overlaps(fi, building)) v.push(`#${i} 얼굴·건물 겹침`);
      if (overlaps(spriteBox(feet[i], h), { ...building, h: building.h / 2 })) v.push(`#${i} 가 건물 위 50% 가림`);
    }
  }
  return v;
}

/** n 명 배열(중앙점 기준 오프셋) 후보. 앞(아래)·뒤(위) 줄을 0.4h 이상 벌리거나, 같은 줄은 스프라이트 폭 이상 벌린다. */
function patterns(n: number, h: number): Pt[][] {
  const a = spriteW(h) / 2 + EPS; // 같은 줄 반 간격
  const b = (h * FACE) / 2 + EPS; // 앞뒤 줄 반 간격
  switch (n) {
    case 1: return [[{ x: 0, y: 0 }]];
    case 2: return [
      [{ x: -a, y: 0 }, { x: a, y: 0 }], // 좌우 (tokens: 2명 좌우)
      [{ x: -a / 2, y: -b }, { x: a / 2, y: b }], // 대각
    ];
    case 3: return [
      [{ x: 0, y: -b }, { x: -a, y: b }, { x: a, y: b }], // 삼각
      [{ x: -a, y: -b }, { x: 0, y: b }, { x: a, y: -b }],
    ];
    default: return [
      [{ x: -a, y: -b }, { x: a, y: -b }, { x: -a, y: b }, { x: a, y: b }], // 마름모(2×2)
      [{ x: 0, y: -2 * b }, { x: -a, y: 0 }, { x: a, y: 0 }, { x: 0, y: 2 * b }],
    ];
  }
}

/** 칸의 캐릭터 키 상한 = 토큰 44 (정사영: 모든 칸 같은 크기) */
export const maxH = (g: TileGeo) => CHAR.h * g.scale;

/** 칸마다 고정된 건물 상자: 공터 오른쪽 뒤(혼자 선 44px 사람 스프라이트 바로 오른쪽, 발 선보다 4px 뒤). 사람이 와도 안 움직인다. */
export function buildingBox(g: TileGeo): Box {
  const left = g.anchor.x + spriteW(maxH(g)) / 2 + BUILDING.gap;
  return { x: left, y: g.anchor.y - BUILDING.back - BUILDING.h, w: BUILDING.w, h: BUILDING.h };
}

/** 소유 깃발 발(깃대 밑) — 윗면 왼쪽 위 안쪽 6px(§7). 깃발 그림은 이 점 위로 선다 */
export const FLAG = 24;
export function flagFoot(g: TileGeo): Pt {
  const xs = g.top.map((p) => p.x), ys = g.top.map((p) => p.y);
  return { x: Math.min(...xs) + 6, y: Math.min(...ys) + 6 + FLAG };
}

const cache = new Map<string, Placement>();

/** n 명(1~4)과 건물 유무로 배치를 구한다. 결과는 칸·인원·건물 조합마다 고정(캐시). */
export function place(g: TileGeo, n: number, hasBuilding: boolean): Placement {
  const key = `${g.index}:${n}:${hasBuilding}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const building = hasBuilding ? buildingBox(g) : null;
  // 건물이 있으면 무리를 왼쪽으로 조금 비켜 본다(반지름 15% 규칙 안에서)
  const shifts = building && n > 1 ? [0, -0.02, -0.04, -0.06, -0.08, -0.1, -0.12].map((f) => f * g.topW) : [0];
  for (let h = Math.floor(maxH(g) * 2) / 2; h >= 12; h -= 0.5) {
    for (const pat of patterns(Math.min(n, 4), h)) {
      for (const dx of shifts) {
        const feet = pat.slice(0, n).map((o) => ({ x: g.anchor.x + o.x + dx, y: g.anchor.y + o.y }));
        if (violations(g, feet, h, building).length === 0) {
          const p = { feet, h, building };
          cache.set(key, p);
          return p;
        }
      }
    }
  }
  throw new Error(`배치 불가: 칸 ${g.index}, ${n}명, 건물 ${hasBuilding}`);
}
