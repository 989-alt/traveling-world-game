// 주사위 B 나무 컵(DESIGN §17.1) — 순수 계산: 굴림 한 번의 타임라인·HUD 상자 안 자리. 화면(DiceCup)과 보드(이동 시작 늦춤)가 같은 값을 쓴다.
import { DICE, DICE_STOP_MS } from '../../shared/timing';
import type { Seat } from '../../shared/types';
import { HUD } from './geometry';

/** 굴림 한 번의 화면 연출 */
export interface RollShow {
  id: number;
  seat: Seat;
  /** 쏟기 시작(= 뗀 순간, performance.now 기준). 봇은 흔들기 600 뒤 */
  t0: number;
  /** 봇: 컵 흔들기 시작(누름 없이 600ms) */
  shakeFrom?: number;
  /** 서버 눈(왼쪽 = 첫 눈, 오른쪽 = 둘째 눈). 내가 굴린 직후엔 아직 없다 */
  d1?: number;
  d2?: number;
  /** 서버 눈이 온 시각 */
  gotAt?: number;
  /** 내가 뗀 굴림(서버 눈을 기다리는 중일 수 있음) */
  mine: boolean;
  reduced: boolean;
}

export interface RollTimes {
  /** 눈이 멈춤(서버 눈으로 고정) */
  stop: number;
  /** 합 숫자 팝 */
  pop: number;
  /** 같은 눈 칩 */
  chip: number;
  /** 이동 시작(HUD 숫자 → 말 머리 칩) */
  end: number;
}

/** 서버 눈이 있어야 정해진다. 늦게 오면(뗀 뒤 780ms 넘어) 그 순간 멈추고 나머지는 같은 간격 */
export function rollTimes(r: Pick<RollShow, 't0' | 'gotAt' | 'reduced'>): RollTimes | null {
  if (r.gotAt === undefined) return null;
  if (r.reduced) {
    const stop = Math.max(r.t0, r.gotAt);
    return { stop, pop: stop, chip: stop, end: stop + DICE.reduced };
  }
  const stop = Math.max(r.t0 + DICE_STOP_MS, r.gotAt);
  const pop = stop + (DICE.popAt - DICE_STOP_MS);
  return { stop, pop, chip: stop + (DICE.chipAt - DICE_STOP_MS), end: stop + (DICE.total - DICE_STOP_MS) };
}

/** 내가 뗐는데 서버 눈이 이만큼 안 오면(거부·끊김) 컵을 대기로 되돌린다 */
export const ROLL_GIVE_UP_MS = 4000;

// ── 자리(§17.1.1, 스테이지 1366×768) — HUD 상자 (583,282) 200×166 안 좌표로 바꿔 쓴다 ──
export const CUP_BOX = HUD.dice;
const L = (x: number, y: number) => ({ x: x - CUP_BOX.x, y: y - CUP_BOX.y });
export const CUP = {
  /** 쟁반 타원 200×96, 중심 (683,400) */
  tray: { ...L(583, 352), w: 200, h: 96 },
  /** 컵 바닥 중앙 앵커 (683,392) — 서 있음 높이 110 */
  foot: L(683, 392),
  standH: 110,
  /** 기울임 상자 ≈ 120 */
  tiltS: 120,
  /** 쏟음: 누운 통, 입구 끝 (640,372). 그림(512 정사각) 안 입구 중심 비율(키잉 뒤 실측) */
  mouth: L(640, 372),
  pourS: 124,
  pourMouth: { fx: 0.2, fy: 0.6 },
  /** 주사위 60 두 개, 중심 (655,418)·(723,418) */
  die: 60,
  dice: [L(655, 418), L(723, 418)],
  /** 합 숫자 64 + 버스트 128, 중심 (689,352) */
  sum: L(689, 352),
  burst: 128,
  /** 같은 눈 칩 72×24, 중심 (745,322) */
  chip: { ...L(745, 322), w: 72, h: 24 },
} as const;

/** 튕김 2회 경로(입 → 자리): 첫 착지 = 가로 75%, 정점 −40 · −16(§17.1.2). 상대 이동량(px)과 회전 */
export function bouncePath(from: { x: number; y: number }, to: { x: number; y: number }, spin: number) {
  const dx = from.x - to.x, dy = from.y - to.y;
  const land1 = { x: dx * 0.25, y: 0 };
  const peak1 = { x: dx * 0.62, y: Math.min(dy, 0) - 40 };
  const peak2 = { x: dx * 0.12, y: -16 };
  return [
    { offset: 0, transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(0.7)`, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
    { offset: 0.22, transform: `translate(${peak1.x}px, ${peak1.y}px) rotate(${spin * 0.3}deg) scale(0.9)`, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' },
    { offset: 0.5, transform: `translate(${land1.x}px, ${land1.y}px) rotate(${spin * 0.65}deg) scale(1)`, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
    { offset: 0.75, transform: `translate(${peak2.x}px, ${peak2.y}px) rotate(${spin * 0.85}deg) scale(1)`, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' },
    { offset: 1, transform: `translate(0px, 0px) rotate(${spin}deg) scale(1)` },
  ];
}
