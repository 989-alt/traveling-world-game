// 보드 기하 (DESIGN §7·§16·§16.8 R5d·§16.9 U5, PRD §12.1). 정사영 30칸 고리 + 세계 지도 광장. 원근·기울기 없음.
// 칸 상자·피치·광장·이정표 크기는 tokens.css 에서 읽는다(값 복사 없음). 컴포넌트는 TILES[n].top(윗면)·.anchor(공터 중심)만 쓴다.
import tokensCss from '../../styles/tokens.css?raw';
import { BOARD_SIZE, type Continent } from '../../shared/board';

const px = (name: string): number => {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*([\\d.]+)px`));
  if (!m) throw new Error(`tokens.css 에 --${name} 없음`);
  return Number(m[1]);
};

export const STAGE = { w: px('stage-w'), h: px('stage-h') };
export const CHAR = { w: px('character-w'), h: px('character-h') };
/** 칸 그림 상자(정사각) 한 변 124, 셀 피치 x 124.18 · y 110 (§16.9.1 U5 — 옛 128·128) */
export const TILE_BOX = px('tile-box');
export const PITCH = { x: px('tile-pitch-x'), y: px('tile-pitch-y') };
export const COLS = 11;
export const ROWS = 6;
/** 고리(5 × 110 + 124 = 674)를 스테이지 세로 가운데에: 위·아래 하늘 띠 47, 행 중심 y = 109 + 110r (§16.9.1) */
export const RING_TOP = (STAGE.h - ((ROWS - 1) * PITCH.y + TILE_BOX)) / 2;
/** 세로 이웃(같은 열) 땅덩이 교차 허용치: 위 칸 절벽 끝이 아래 칸 경관 꼭대기 뒤로 ≤ 10 (상자 0~97% = 0~120.3 → 10.3, 반올림 여유) */
export const V_OVERLAP_MAX = 10.5;

// ── 칸 그림(TILE-<n>d, 프레임 1:1) 안 비율 — §16.8 R5d 규격, 29장 128px 축소본 실측 ──
/** 땅덩이(경관 꼭대기 ~ 절벽 끝) = 상자 4~96% × 0~97%. 겹침 검사는 img 상자가 아니라 이것으로 */
export const LAND = { x0: 0.04, x1: 0.96, y0: 0, y1: 0.97 } as const;
/** 윗면(둥근 네모, 뒤 변 8% → 앞 변 62%) — 모서리를 깎은 8각형 */
export const ISLAND_TOP: readonly (readonly [number, number])[] = [
  [0.12, 0.08], [0.88, 0.08], [0.96, 0.16], [0.96, 0.54], [0.88, 0.62], [0.12, 0.62], [0.04, 0.54], [0.04, 0.16],
];
/** 공터(빈 땅) 중심 = 캐릭터 발 앵커. 공칭 (0.5, 0.35).
 *  2026-10-29 U5 재실측(매니페스트 실제 그림 30장 256px, 국소 분산이 낮은 공터 덩어리의 무게중심): 가로 0.47~0.53, 세로 0.37~0.47,
 *  가운데값 0.408·평균 0.411 → 0.41. 옛 0.37 은 공터 위쪽 끝에 가까워 캐릭터가 공터보다 북쪽에 서 보였다(사용자 피드백 6) */
export const CLEARING = { x: 0.5, y: 0.41 } as const;
/** 좌우 열 세로 다리 자리(가로 BRIDGE_INSET 0.34 = 상자 16%·84%)에서 칸 몸체(절벽)의 아래 끝 — 12장 알파 실측 104~105/128 */
export const BODY_BOTTOM_AT_BRIDGE = 0.82;

export type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner';
/** 이름표 가로 자리(그림 속 볼트 판) — 화면 중심 쪽으로 민다(§16.2) */
export type PlateSide = 'left' | 'center' | 'right';
export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface TileGeo {
  index: number;
  col: number;
  row: number;
  side: Side;
  plate: PlateSide;
  /** 셀 중심(스테이지 px) */
  center: Pt;
  /** 정사영이라 모든 칸 1 (옛 원근 배율 자리) */
  scale: 1;
  /** 칸 그림 상자 124×124 */
  img: Box;
  /** 쌓는 순서(z-index): 행이 아래일수록 앞(세로 이웃이 ≤ 10 겹친다, §16.9.1). 말·건물·깃발(z = y×10)보다는 아래 */
  z: number;
  /** 땅덩이 상자(그림 몸체) */
  land: Box;
  /** 윗면 다각형(스테이지 px) */
  top: Pt[];
  /** 공터 중심 = 발 앵커 */
  anchor: Pt;
  /** 윗면 폭 */
  topW: number;
}

/** 칸 번호 → 격자 (열, 행). 0 = 왼쪽 아래 모서리(출발·한국), 시계 방향(PRD §4.1, DESIGN §16.2). 행 0 = 위.
 *  아랫줄 0~10(c0→c10, r5), 오른쪽 열 11~14(r4→r1), 15 오른쪽 위, 윗줄 16~24(c9→c1), 25 왼쪽 위, 왼쪽 열 26~29(r1→r4) */
export function gridOf(i: number): [col: number, row: number, side: Side] {
  const B = ROWS - 1, R = COLS - 1;
  if (i === 0) return [0, B, 'corner'];
  if (i < R) return [i, B, 'bottom'];
  if (i === R) return [R, B, 'corner'];
  if (i < R + B) return [R, B - (i - R), 'right'];
  if (i === R + B) return [R, 0, 'corner'];
  if (i < 2 * R + B) return [R - (i - R - B), 0, 'top'];
  if (i === 2 * R + B) return [0, 0, 'corner'];
  return [0, i - (2 * R + B), 'left'];
}

/** 이름표는 모든 칸 가운데. 2026-10-27 사용자: 좌우 열을 안쪽으로 민 판(TILE-11~14d·26~29d)이 틀어져 보여 가운데판 TILE-<n>e 로 교체.
 *  (옛 규칙: 왼쪽 열 → 오른쪽, 오른쪽 열 → 왼쪽.) 인자는 칸 그림을 다시 나눌 때를 위해 남긴다 */
export const plateSide = (_col: number, _row: number): PlateSide => 'center';

export const cellCenter = (c: number, r: number): Pt => ({ x: PITCH.x / 2 + PITCH.x * c, y: RING_TOP + TILE_BOX / 2 + PITCH.y * r });
/** 칸 쌓는 순서: 행 r → 10 + 2r. 그 사이 홀수(11 + 2r)는 r 행의 다리 */
export const tileZ = (row: number) => 10 + 2 * row;

function tileGeo(index: number): TileGeo {
  const [col, row, side] = gridOf(index);
  const center = cellCenter(col, row);
  const S = TILE_BOX;
  const img = { x: center.x - S / 2, y: center.y - S / 2, w: S, h: S };
  const at = (fx: number, fy: number): Pt => ({ x: img.x + fx * S, y: img.y + fy * S });
  const top = ISLAND_TOP.map(([fx, fy]) => at(fx, fy));
  const xs = top.map((p) => p.x);
  return {
    index, col, row, side, plate: plateSide(col, row), center, scale: 1, img, z: tileZ(row),
    land: { x: img.x + LAND.x0 * S, y: img.y + LAND.y0 * S, w: (LAND.x1 - LAND.x0) * S, h: (LAND.y1 - LAND.y0) * S },
    top, anchor: at(CLEARING.x, CLEARING.y), topW: Math.max(...xs) - Math.min(...xs),
  };
}

export const TILES: readonly TileGeo[] = Array.from({ length: BOARD_SIZE }, (_, i) => tileGeo(i));

// ── 광장(세계 지도 섬) · 이정표 · 다리 (§16.4) ──
export const PLAZA: Box = { x: px('plaza-x'), y: px('plaza-y'), w: px('plaza-w'), h: px('plaza-h') };
/** 광장 그림을 까는 상자 = PLAZA + 번짐(그림 가장자리 투명 여백·절벽 밑 물보라).
 *  U5: PLAZA-U5.webp 1944×698 = 이 상자 1120×402 × 1.7357 — 윗면(지도) y 183~515, 앞 절벽 515~585(key-assets plazaU5) */
export const PLAZA_ART: Box = { x: PLAZA.x - 20, y: PLAZA.y - 6, w: PLAZA.w + 40, h: PLAZA.h + 12 };

/** 광장 네 귀 돌 단(PLAZA-U5 그림 실측, 스테이지 px): 중심·크기. 자리 1·2 위, 3·4 아래(패널과 같은 순서).
 *  §16.9.2 표의 (240,300)·(1126,300)·(240,490)·(1126,490) 는 생성 전 추정 — 생성본(PLAZA 와 같은 구도)의 단은 테에 붙어
 *  위 단 (270,234)·(1101,234) 80×48, 아래 단 (213,457)·(1153,457) 95×47 이다. 캐릭터는 그림 속 단 위에 선다 */
export const CORNER_PADS: readonly { c: Pt; w: number; h: number }[] = [
  { c: { x: 270, y: 234 }, w: 80, h: 48 },
  { c: { x: 1101, y: 234 }, w: 80, h: 48 },
  { c: { x: 213, y: 457 }, w: 95, h: 47 },
  { c: { x: 1153, y: 457 }, w: 95, h: 47 },
];
/** 귀퉁이 전신 캐릭터 키(§16.9.2, 말과 같은 포즈 파일) */
export const CORNER_H = px('character-corner-h');
/** 귀퉁이 캐릭터 발(스프라이트 바닥 중앙): 단 앞쪽 절반. 위 단은 윗줄 칸 이름표(상자 67~85% = y 130~152) 아래로 머리를 두려고 단 중심 +16 */
export const CORNER_FEET: readonly Pt[] = [
  { x: 270, y: 250 }, { x: 1101, y: 250 }, { x: 213, y: 472 }, { x: 1153, y: 472 },
];

/** 이정표 그림(UI-signpost: 판 + 짧은 기둥, 256×171) 안 비율. 판 바깥 테·안쪽 면·볼트·발(돌받침 밑) */
export const SIGN_ART = {
  aspect: 171 / 256,
  board: { x0: 0.06, x1: 0.94, y0: 0.192, y1: 0.562 },
  face: { x0: 0.084, x1: 0.917, y0: 0.24, y1: 0.52 },
  bolt: { x: 0.105, y: 0.38 },
  foot: 0.925,
} as const;
const SIGN_W = px('signpost-w');

export interface SignGeo {
  continent: Continent;
  name: string;
  /** 발(돌받침 밑 가운데) */
  foot: Pt;
  /** 그림 상자 */
  img: Box;
  /** 나무 판(바깥 테) 상자 — 교차 검사용 */
  board: Box;
  /** 대륙색 면 상자 */
  face: Box;
}

function signGeo(continent: Continent, name: string, foot: Pt): SignGeo {
  const w = SIGN_W, h = w * SIGN_ART.aspect;
  const img = { x: foot.x - w / 2, y: foot.y - SIGN_ART.foot * h, w, h };
  const part = (r: { x0: number; x1: number; y0: number; y1: number }): Box =>
    ({ x: img.x + r.x0 * w, y: img.y + r.y0 * h, w: (r.x1 - r.x0) * w, h: (r.y1 - r.y0) * h });
  return { continent, name, foot, img, board: part(SIGN_ART.board), face: part(SIGN_ART.face) };
}

/** 광장 테 이정표 5 — 발 좌표 §16.4(판 중심 = 발 − 40) */
export const SIGNPOSTS: readonly SignGeo[] = [
  // U5 §16.9.2: 아시아 판 y 471 · 유럽 판 y 329 · 위 테 판 y 195. 남아메리카는 아래 귀퉁이 캐릭터(x 178~248 · y 376~472)를 비켜 판 y 320(구간 26~29 안)
  signGeo('asia', '아시아', { x: 560, y: 511 }),
  signGeo('europe', '유럽', { x: 1191, y: 369 }),
  signGeo('africa', '아프리카', { x: 993, y: 235 }),
  signGeo('namerica', '북아메리카', { x: 373, y: 235 }),
  signGeo('samerica', '남아메리카', { x: 175, y: 360 }),
];

export interface BridgeGeo { from: number; to: number; dir: 'h' | 'v'; box: Box; /** 위(앞이 아닌) 행 칸 바로 위 */ z: number }
const BR = { w: px('bridge-w'), h: px('bridge-h') };
/** 가로 다리 높이 = 윗면 가운데쯤(상자 42%), 세로 다리 = 고리 안쪽 가장자리(절벽이 좁아지는 쪽) */
const BRIDGE_Y = 0.42;
const BRIDGE_INSET = 0.34;
/** 세로 다리 위 끝(윗칸 상자 비율, 테 62~71% 아래 절벽)·아래 끝(아랫칸 상자 비율, 윗면 뒤 변 8% 안쪽).
 *  U5: 세로 피치 110 이라 아래 칸 경관이 위 칸 절벽 끝 10px 를 덮는다 — 다리는 위 칸 위·아래 칸 아래(z), 대부분 아래 칸 경관 뒤로 숨는다 */
export const BRIDGE_V = { from: 0.76, to: 0.14 } as const;

function bridgeGeo(i: number): BridgeGeo {
  const a = TILES[i], b = TILES[(i + 1) % TILES.length];
  if (a.row === b.row) {
    const x = (a.center.x + b.center.x) / 2, y = a.img.y + BRIDGE_Y * TILE_BOX;
    return { from: a.index, to: b.index, dir: 'h', box: { x: x - BR.w / 2, y: y - BR.h / 2, w: BR.w, h: BR.h }, z: tileZ(a.row) + 1 };
  }
  const inward = a.col === 0 ? 1 : -1; // 왼쪽 열 → 오른쪽(광장 쪽), 오른쪽 열 → 왼쪽
  const x = a.center.x + inward * BRIDGE_INSET * TILE_BOX;
  // 가로 다리(26)를 세로 틈 가운데에 두면 양 끝이 허공에 뜬다(사용자 피드백 7). 윗칸 절벽(상자 76%)에서 아랫칸 윗면 안(상자 14%)까지 내려 양쪽 땅에 걸친다
  const [up, down] = a.row < b.row ? [a, b] : [b, a];
  const y0 = up.img.y + BRIDGE_V.from * TILE_BOX, y1 = down.img.y + BRIDGE_V.to * TILE_BOX;
  return { from: a.index, to: b.index, dir: 'v', box: { x: x - BR.h / 2, y: y0, w: BR.h, h: y1 - y0 }, z: tileZ(up.row) + 1 };
}

/** 이웃 칸 쌍 30개(i → i+1, 29 → 0) */
export const BRIDGES: readonly BridgeGeo[] = TILES.map((_, i) => bridgeGeo(i));

// ── HUD 자리 (화면 레이어, 줌에 안 커짐) §16.4 ──
// U5 §16.9.2: 패널 200×48(초상 없음)은 귀퉁이 전신 캐릭터 바로 옆(광장 안쪽), 위 = 발 + 12(북아메리카·아프리카 이정표 기둥 y ≤ 235 아래), 아래 = 발 + 12.
// 캐릭터 몸 상자(폭 70)와 틈 4. 표의 (380,272)·(986,272)·(380,472)·(986,472) 는 추정 단 자리 기준이라 실측 단(CORNER_FEET)에 맞춰 옮겼다
export const HUD = {
  panels: [{ x: 409, y: 262 }, { x: 962, y: 262 }, { x: 352, y: 484 }, { x: 1014, y: 484 }],
  panel: { w: px('panel-w'), h: px('panel-h') },
  dice: { x: 683, y: 384 },
  diceD: px('dice-button-d') + 2 * px('dice-button-gauge-w'),
  timer: { x: 683, y: 235, w: 150, h: 44 },
  /** 매달린 간판(UI-sign-small) 규칙 · 멈춤 — 광장 뒤쪽 가운데, 타이머 양옆 (U5: 광장 윗변 189 + 46) */
  rules: { x: 573, y: 235, w: 44, h: 44 },
  save: { x: 793, y: 235, w: 44, h: 44 },
  /** 간판을 매단 밧줄 길이(간판 윗변 213 에서 위로) — 윗줄 칸 상자 아래(y 171)에서 멈춘다 */
  rope: 42,
} as const;

/** 칸 그림 속 이름표(볼트 판) 상자 — 가림 검사용. 상자 비율: 가로 17~83%(5자 판 66%), 세로 66~86%(1줄 18% + 여유), 2줄(사우디·콩고) 66~93% */
export function plateBox(g: TileGeo): Box {
  const two = g.index === 5 || g.index === 19;
  return { x: g.img.x + 0.17 * TILE_BOX, y: g.img.y + 0.66 * TILE_BOX, w: 0.66 * TILE_BOX, h: (two ? 0.27 : 0.2) * TILE_BOX };
}

/** 귀퉁이 전신 캐릭터 몸 상자(스프라이트 상자 = 키 96 × 폭 96·32/44) */
export function cornerBoxes(): { id: string; box: Box }[] {
  const w = (CORNER_H * CHAR.w) / CHAR.h;
  return CORNER_FEET.map((f, i) => ({ id: `corner${i + 1}`, box: { x: f.x - w / 2, y: f.y - CORNER_H, w, h: CORNER_H } }));
}

/** HUD·이정표 상자(교차 검사·e2e 공용) */
export function hudBoxes(): { id: string; box: Box }[] {
  const { panel, diceD, timer, rules, save } = HUD;
  const at = (c: { x: number; y: number; w: number; h: number }): Box => ({ x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h });
  return [
    ...HUD.panels.map((c, i) => ({ id: `panel${i + 1}`, box: { x: c.x - panel.w / 2, y: c.y - panel.h / 2, w: panel.w, h: panel.h } })),
    { id: 'dice', box: { x: HUD.dice.x - diceD / 2, y: HUD.dice.y - diceD / 2, w: diceD, h: diceD } },
    { id: 'timer', box: at(timer) },
    { id: 'rules', box: at(rules) },
    { id: 'save', box: at(save) },
    ...SIGNPOSTS.map((s) => ({ id: `sign-${s.continent}`, box: s.board })),
  ];
}

export const boxesHit = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;

// ── 다각형 도구 (볼록 다각형) ─────────────────────────────
export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const k = p.x * q.y - q.x * p.y;
    a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** 점에서 다각형 변까지의 최소 거리. 바깥이면 음수. */
export function insetOf(poly: Pt[], p: Pt): number {
  const c = centroid(poly);
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len; // 부호 있는 거리
    const dc = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
    min = Math.min(min, Math.sign(dc) * d);
  }
  return min;
}
