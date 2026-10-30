// 이동 연출 시간(PRD §12.4, DESIGN §15.6 board.zoom·§16.6). 화면(카메라·홉)과 서버(도착 단계 마감 늦춤)가 같은 값을 쓴다 — 한 곳에서만 정한다.
import { BOARD_SIZE } from './board';
import type { LogEvent } from './types';

export const ZOOM_SCALE = 1.8;
/** 줌 들어가기·착지 뒤 머묾·복귀 */
export const ZOOM_IN_MS = 400;
export const ZOOM_HOLD_MS = 300;
export const ZOOM_OUT_MS = 600;
/** 홉 한 번(포물선) 길이와 홉 사이 간격(홉 + 여유) */
export const HOP_MS = 320;
export const HOP_GAP_MS = 340;
/** 주사위 최대 눈. 이보다 먼 이동은 순간 이동(세계여행·무인도 등) */
export const MAX_HOP = 12;

/** 이동 한 번의 화면 연출 시간: 줌 in 과 함께 홉 → 마지막 착지 + 머묾 → 복귀. 순간 이동은 in 을 다 보이고 머문다 */
export function moveShowMs(from: number, to: number, boardSize = BOARD_SIZE): number {
  const d = (to - from + boardSize) % boardSize;
  if (d === 0) return 0;
  // 착지(홉 끝) 시각과 줌 in 끝 중 늦은 쪽부터 머문다(camera.ts useCamera 와 같은 규칙)
  const travel = Math.max(ZOOM_IN_MS, d > MAX_HOP ? HOP_GAP_MS : d * HOP_GAP_MS);
  return travel + ZOOM_HOLD_MS + ZOOM_OUT_MS;
}

/** 주사위 B 나무 컵(DESIGN §17.1.2): 뗌(쏟기 시작) → 이동 시작. 쏟기 200 · 튕김 2회 660(+120 부터) · 멈춤 150 · 합 팝 900.
 *  움직임을 줄인 기기는 멈춘 눈 + 합만 900ms. 봇 턴은 그 앞에 컵 흔들기 600ms(화면만 — 봇 다음 행동까지 1~2초 여유가 있다) */
export const DICE = {
  tilt: 80, pour: 120, bounce: [330, 330], settle: 150, popAt: 930, chipAt: 1100, total: 1830, reduced: 900, botShake: 600,
} as const;
export const DICE_SHOW_MS = DICE.total;
export const DICE_SHOW_MS_REDUCED = DICE.reduced;
/** 쏟은 뒤 눈이 멈추는 시각(+120 에 나와 튕김 2회) */
export const DICE_STOP_MS = DICE.pour + DICE.bounce[0] + DICE.bounce[1];

/** 새 로그 묶음의 화면 연출 합 — 주사위(굴림마다 DICE_SHOW_MS) + 이동. 서버가 다음 단계 마감·봇 행동에 더한다(카드·문항은 연출이 끝난 뒤 뜬다) */
export const movesShowMs = (events: readonly LogEvent[]) =>
  events.reduce((ms, e) => (e.ev === 'move' ? ms + moveShowMs(e.from, e.to) : e.ev === 'dice' ? ms + DICE_SHOW_MS : ms), 0);
