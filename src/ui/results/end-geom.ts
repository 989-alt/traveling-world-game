// U12 엔딩(DESIGN §19.2) 배치 수치. 스테이지 1366×768, 사진 묶음은 그룹 좌표(그룹 상자 (46,36,820,690), −3° 회전).
// 여권 그림 안 틀 위치는 키잉한 WebP(assets/webp/END-passport-*.webp)의 뚫린 칸을 잰 값(%, 트림 상자 기준).
// 생성본마다 비율·틀 자리가 조금씩 달라(펼친 여권 3 은 가로 1.23) 그림마다 따로 둔다.
import { poseOf } from '../../assets/manifest';

export const GROUP = { x: 46, y: 36, w: 820, h: 690, rot: -3 } as const;
/** 사진 창(틀 안) — END-photo-frame 을 9 조각으로 맞춘 자리 */
export const WINDOW = { x: 20, y: 20, w: 780, h: 520 } as const;
// 2026-10-31 시안 대조 보정(U12 구현): §19.2 의 키 250 은 승인 시안(MOCK-end-C2 사진 창 높이의 ≈ 70%)보다 작아 사진이 비어 보였다.
// 키 296(1위 몸 310, +5%) · 발 y 516(1위 +14) · 간격 180 으로 키운다(머리 위 y 220, 창 위변 20 · 아래변 540 안, 로제트 574 와 교차 0)
export const FOOT_Y = 516;
/** 1위 한 걸음 앞 */
export const FIRST_STEP = 14;
export const BODY = 296;
export const BODY_FIRST = 310;
export const SLOT_GAP = 180;
export const ROSETTE_Y = 574;
export const TAPE_Y = 622;
export const TITLE_Y = 664;
/** 사진 속 랜드마크: 뒤 언덕 윗면(사진 배경 y 38%)에 기단, 1위 트로피와 3위 머리 사이 뒤로 보이게 */
export const LANDMARK = { x: 470, base: 252, h: 226 } as const;
/** 랜드마크 x: 4명이면 1위·3위 사이 뒤, 3명이면 1위·3위 사이, 2명이면 오른쪽 빈 풀밭(트로피에 가리지 않게) */
export const landmarkX = (count: number) => (count >= 4 ? LANDMARK.x : count === 3 ? 500 : 690);

/** 슬롯 순서 = 2위·1위·3위·4위(단상 읽기). 인원이 적으면 같은 간격으로 가운데 정렬. 반환 = 순위 인덱스(0 = 1위)별 발 x */
export function footXs(count: number): number[] {
  const order = [1, 0, 2, 3].filter((r) => r < count);
  const xs: number[] = [];
  order.forEach((r, i) => { xs[r] = 410 + (i - (order.length - 1) / 2) * SLOT_GAP; });
  return xs;
}

/** 포즈 그림 상자(정사각, 발 앵커 = 아래 가운데)와 목 메달 중심. 키 = 몸(발~정수리), P20 은 트로피가 트림 위에 들어가 상자가 커진다 */
export function figure(charId: number, first: boolean, fx: number, fy: number) {
  const pose = poseOf(`char.${charId}.${first ? 'p20' : 'p21'}`);
  const body = first ? BODY_FIRST : BODY;
  const trim = body / pose.body;
  const side = trim / pose.h;
  return {
    side, body, trim,
    left: fx - side / 2, top: fy - side,
    head: fy - body,
    chest: { x: fx + (pose.chest[0] - 0.5) * trim, y: fy - trim + pose.chest[1] * trim },
    /** 트로피 가운데(P20 트림 위 12%) */
    trophy: { x: fx, y: fy - trim + 0.12 * trim },
  };
}

/** 회전 뒤 스테이지 좌표(색종이가 사진 윗변에 걸리는 자리) */
export function toStage(gx: number, gy: number) {
  const cx = GROUP.w / 2, cy = GROUP.h / 2, a = (GROUP.rot * Math.PI) / 180;
  const dx = gx - cx, dy = gy - cy;
  return { x: GROUP.x + cx + dx * Math.cos(a) - dy * Math.sin(a), y: GROUP.y + cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

type Box = [number, number, number, number]; // x, y, w, h (%)
/** 펼친 여권(자리 1~4): a = 가로÷세로, p = 초상 틀, s = 스티커 틀 3(왼→오), lines = 줄 선 영역 윗변(%) */
export const OPEN: Record<number, { a: number; p: Box; s: [Box, Box, Box] }> = {
  1: { a: 0.975, p: [11.69, 13.2, 30.56, 30.3], s: [[54.36, 54.8, 9.74, 11.8], [67.38, 54.8, 10.15, 11.8], [81.23, 54.8, 10.05, 11.8]] },
  2: { a: 0.948, p: [12.87, 13.1, 28.8, 28.7], s: [[53.16, 51.8, 10.55, 12.4], [67.19, 51.8, 10.34, 12.4], [80.91, 51.8, 10.34, 12.4]] },
  3: { a: 1.2285, p: [11.5, 11.67, 28.6, 33.42], s: [[54.5, 52.46, 10.1, 12.53], [68.2, 52.33, 10.2, 12.65], [82.3, 52.33, 10.2, 12.65]] },
  4: { a: 0.952, p: [12.18, 12.8, 29.83, 28.8], s: [[53.57, 51.3, 10.29, 11.2], [67.65, 51.1, 10.29, 11.4], [81.72, 50.9, 10.71, 11.6]] },
};
/** 닫힌 여권(자리 1~4): a = 가로÷세로, w = 표지 창 */
export const CLOSED: Record<number, { a: number; w: Box }> = {
  1: { a: 1.693, w: [53.44, 23.81, 31.87, 48.15] },
  2: { a: 1.111, w: [55.94, 23.61, 31.56, 49.31] },
  3: { a: 1.119, w: [56.56, 24.13, 30.94, 49.3] },
  4: { a: 1.693, w: [54.69, 21.69, 32.19, 52.38] },
};
/** 펼친 여권 자리: 오른쪽 띠 x 892~1352, 세로 50~540 가운데 */
export const BOOK = { x: 892, w: 460, top: 50, bottom: 540 } as const;
/** 닫힌 여권 3: 왼쪽 x, 회전(부채꼴), 아랫변 y 공통 */
export const CLOSED_SLOTS = [{ x: 893, rot: -6 }, { x: 1036, rot: 0 }, { x: 1180, rot: 6 }] as const;
export const CLOSED_W = 164;
export const CLOSED_BOTTOM = 748;

/** 도장 안 나라 이름(2~4자 기준). 긴 이름은 흔히 쓰는 줄임으로 */
const SHORT: Record<string, string> = { sa: '사우디', cd: '콩고' };
export const stampName = (country: string, full: string) => SHORT[country] ?? full;
