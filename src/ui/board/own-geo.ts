// 땅 주인·건물 표시 C2 「앞 모서리 발코니 미니어처」(DESIGN §17.2·§17.2.1) — 순수 계산.
// 칸 상자(124) 좌표로 정하고 스테이지 px 로 옮긴다. 윗면 가운데(공터 = 말 자리)에는 아무것도 세우지 않는다:
// 뒤 두 모서리 기둥 + 밧줄 삼각기 7, 뒤오른쪽 기둥 바깥 세로 깃발(길이 = 단계), 4단계 금별, 앞오른쪽 절벽 발코니 위 건물 미니어처(≤ 22).
import { COLS, TILE_BOX, type Box, type Pt, type TileGeo } from './geometry';

/** 칸 상자 좌표(124 기준). U8-impl 수정 1회차(조율자 리뷰 "시안보다 너무 옅다"): 시안 MOCK-own-C2 크롭을 상자 124 로 재서
 *  삼각기 ≈ 12×13 · 깃발 천 ≈ 16 · 기둥 3 + 꼭지 — 그 무게로 키우고 남색 외곽선을 둘렀다. 풍경 가림 목표 ≤ 7% 보다 '한눈에 보임' 우선(조율자 판정) */
export const OWN = {
  /** 뒤 기둥 2(코드 3px 나무 + 남색 테, 금 꼭지) x · 위아래 */
  posts: [9, 115] as const,
  postY: [1, 28] as const,
  /** 밧줄 양 끝 높이 · 가운데 처짐 */
  ropeY: 3,
  sag: 3,
  /** 삼각기 7, 각 폭 13 · 높이 14(사용자 '시안만큼 굵게', 밧줄을 거의 빈틈없이 덮는다) */
  pennants: 7,
  pennant: { w: 13, h: 14 },
  /** 세로 깃발: 천 폭 16, 천 가운데 x = 121(땅덩이 오른쪽 끝 119 — 천 절반 이상이 칸 밖 여백·틈으로), 막대 y 1 */
  flag: { clothW: 16, cx: 121, top: 1, boxH: 50 },
  /** 단계별 깃발 길이(1~4단계 24·32·40·48, 땅만 산 0단계 = 24). 4단계 48 = 그림 전체(상자 50 의 95.7%) */
  flagLen: [24, 24, 32, 40, 48] as const,
  /** 4단계 금별 13: 깃발을 건 막대 끝(천 가운데 위) */
  star: { cx: 121, top: 0, s: 13 },
  /** 앞오른쪽 절벽 발코니(테 = 자리색) 24×16(정사각 그림의 투명 위아래를 잘라 cover), 가운데 (112, 102) → x 100~124 · y 94~110 */
  balcony: { cx: 112, cy: 102, w: 24, h: 16 },
  /** 발코니 위 건물 미니어처 ≤ 22: 바닥 = 발코니 바닥판(y 101), 윗변 y 81 — 흰 스티커 테(1px)·안티에일리어싱까지 풍경(y < 79) 밖 */
  building: { cx: 112, bottom: 101, s: 20 },
} as const;

/** FLAG-tall-1~4 그림(256 정사각, 막대 포함) 안에서 천이 차지하는 폭 비율(키잉 뒤 실측) — 천 폭을 12 로 맞추려고 자리마다 가로로 늘이고 줄인다 */
export const FLAG_CLOTH = [0.27, 0.43, 0.32, 0.47] as const;

/** 칸 그림 속 이름표 실측 자리(§17.2 칸 해부 x 26~98 · y 83~105) — 소유 표시 가림 검사용 */
export const PLATE_TRUE = { x: 26, y: 83, w: 72, h: 22 } as const;
/** 풍경(윗면 + 위로 솟은 경관) = 상자 y 0~79 */
export const SCENERY_BOTTOM = 79;

export interface OwnGeo {
  posts: { x: number; y0: number; y1: number }[];
  rope: { a: Pt; c: Pt; b: Pt };
  pennants: Box[];
  flag: Box;
  /** 이 단계에서 보이는 깃발 길이(px) — 그림 상자 위에서부터 */
  flagLen: number;
  star: Box | null;
  balcony: Box | null;
  building: Box | null;
}

const S = TILE_BOX / 124; // 정사영 · 상자 124 고정(U5) → 1

/** 칸 g · 주인 자리 seat(0~3) · 단계 level(0~4) → 스테이지 px 상자들 */
export function ownGeo(g: TileGeo, seat: number, level: number): OwnGeo {
  const o = g.img;
  const P = (x: number, y: number): Pt => ({ x: o.x + x * S, y: o.y + y * S });
  const B = (x: number, y: number, w: number, h: number): Box => ({ x: o.x + x * S, y: o.y + y * S, w: w * S, h: h * S });
  const [x0, x1] = OWN.posts;
  const ropeAt = (t: number) => ({ x: x0 + (x1 - x0) * t, y: OWN.ropeY + 4 * OWN.sag * t * (1 - t) });
  const pennants = Array.from({ length: OWN.pennants }, (_, i) => {
    const r = ropeAt((i + 1) / (OWN.pennants + 1));
    return B(r.x - OWN.pennant.w / 2, r.y - 0.5, OWN.pennant.w, OWN.pennant.h);
  });
  const fw = OWN.flag.clothW / FLAG_CLOTH[seat];
  // 오른쪽 끝 열(col 10)은 바깥 오른쪽이 스테이지 밖(1366) — 깃발·별을 뒤왼쪽 기둥 바깥(광장 쪽)으로 거울처럼 옮긴다
  const mirror = g.col === COLS - 1;
  const fx = mirror ? TILE_BOX - OWN.flag.cx : OWN.flag.cx, sx = mirror ? TILE_BOX - OWN.star.cx : OWN.star.cx;
  const built = level >= 1;
  const { building: b, balcony: c, star } = OWN;
  return {
    posts: OWN.posts.map((x) => ({ x: o.x + x * S, y0: o.y + OWN.postY[0] * S, y1: o.y + OWN.postY[1] * S })),
    rope: { a: P(x0, OWN.ropeY), c: P((x0 + x1) / 2, OWN.ropeY + 2 * OWN.sag), b: P(x1, OWN.ropeY) },
    pennants,
    flag: B(fx - fw / 2, OWN.flag.top, fw, OWN.flag.boxH),
    flagLen: OWN.flagLen[Math.max(0, Math.min(4, level))] * S,
    star: level >= 4 ? B(sx - star.s / 2, star.top, star.s, star.s) : null,
    balcony: built ? B(c.cx - c.w / 2, c.cy - c.h / 2, c.w, c.h) : null,
    building: built ? B(b.cx - b.s / 2, b.bottom - b.s, b.s, b.s) : null,
  };
}

/** 깃발 clip-path(그림 상자 비율): 길이 len 에서 V 꼬리(깊이 4px)를 새로 내어 자른다. 4단계(그림 끝까지)는 자르지 않는다 */
export function flagClip(len: number, boxH: number = OWN.flag.boxH): string {
  if (len >= OWN.flagLen[4]) return 'none';
  const y = ((OWN.flag.top + len - OWN.flag.top) / boxH) * 100 + 2; // 그림 위 여백(2%) 아래부터 len
  const v = (4 / boxH) * 100;
  return `polygon(0 0, 100% 0, 100% ${y.toFixed(2)}%, 50% ${(y - v).toFixed(2)}%, 0 ${y.toFixed(2)}%)`;
}
