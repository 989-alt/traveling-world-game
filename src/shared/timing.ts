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

// ── 화면 연출 시간(PRD §4.3 U10, DESIGN §18.5). 단일 출처 — tokens.json·UI 는 이 값을 쓴다 ──
/** 알림 카드(이벤트: 세계여행·무인도·축제·남극·기후·한국 탐험·기금·독점) 한 장. 한 번 열리면 끝까지 보인다 */
export const EVENT_MS = 3200;
/** 통행료 알림 한 장 */
export const TOLL_MS = 3000;
/** 참/거짓 결과(정답 + 누가 맞혔는지). 엔진 tfResult 단계 길이(STEP_MS.tfResult 와 같은 값 — timing.test 가 묶는다) */
export const TF_RESULT_MS = 2000;
/** 봇이 칸을 고르면 그 칸이 반짝이는 시간(이동·지정은 그 뒤). 서버가 다음 마감·봇 행동에 더한다 */
export const PICK_BOT_FLASH_MS = 1000;
/** 주사위 컵 누름 상한: 누른 채 이만큼 지나면 그 순간 게이지 값으로 저절로 뗀다 */
export const PRESS_MAX_MS = 2900;
/** 고르기 간판이 내려오는 시간 */
export const PICK_SIGN_MS = 200;

/** 이 로그가 띄우는 알림 카드 시간(없으면 0). 관광지 도착(문화 카드가 대신함)·무인도 탈출은 알림 없음.
 *  통행료: 바로 인수 단계로 넘어가면 행동 패널이 같은 문구를 보여 주므로 알림 없음(takeoverNext). state/view noticesFrom 과 같은 규칙 */
export function noticeMs(e: LogEvent, takeoverNext = false): number {
  if (e.ev === 'event') return e.kind === 'tourist' || (e.kind === 'island' && 'escape' in e.payload) ? 0 : EVENT_MS;
  if (e.ev === 'toll') return takeoverNext ? 0 : TOLL_MS;
  return 0;
}

/** 새 로그 묶음의 화면 연출 합 — 주사위(굴림마다 DICE_SHOW_MS) + 이동 + 알림 카드(이벤트 EVENT_MS · 통행료 TOLL_MS, 차례로 한 장씩).
 *  서버가 다음 단계 마감·봇 행동에 더한다(카드·문항은 연출·알림이 끝난 뒤 뜬다).
 *  next = 이 로그 묶음 뒤의 단계(인수 단계로 바로 가는 통행료는 알림이 없다) */
export const movesShowMs = (events: readonly LogEvent[], next?: { step: string; tile: number | null }) =>
  events.reduce((ms, e) => {
    if (e.ev === 'move') return ms + moveShowMs(e.from, e.to);
    if (e.ev === 'dice') return ms + DICE_SHOW_MS;
    return ms + noticeMs(e, e.ev === 'toll' && next?.step === 'takeover' && next.tile === e.tile);
  }, 0);
