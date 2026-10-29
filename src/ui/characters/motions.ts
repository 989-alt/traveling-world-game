// 보드 캐릭터 모션 표 (PRD §12.2 ↔ DESIGN §13 포즈 + 트윈). transform·opacity 와 포즈 교체만.
import { hasAsset } from '../../assets/manifest';
import { CHAR } from '../board/geometry';
import type { LogEvent, Seat } from '../../shared/types';

export type Tier = 'A' | 'B' | 'C';
export type MotionId =
  | 'rest' | 'stretch' | 'look' | 'yawn' | 'wave' // A 혼자 대기(귀퉁이 캐릭터만, U5)
  | 'smileCoin' | 'surprised' | 'shrug' | 'upset' | 'clap' // B 남의 행동에 반응
  | 'expect' | 'hop' | 'cheer' | 'scratch' | 'coinFlip' | 'cry' | 'flag' | 'hammer' | 'drift' | 'collapse'; // C 내 턴

export interface Motion {
  tier: Tier;
  pose: number; // P01~P18
  /** ms. Infinity = stop() 할 때까지 */
  ms: number;
  /** .bc-motion 에 거는 WAAPI 키프레임(transform 만). 없으면 포즈만 바꾼다 */
  frames?: Keyframe[];
  /** 키프레임 한 바퀴 ms(없으면 ms 전체) · 반복 수 */
  cycle?: number;
  iterations?: number;
  /** 손 위 동전이 튀는 모션 */
  coin?: boolean;
}

const t = (...xs: string[]): Keyframe[] => xs.map((transform) => ({ transform }));

export const MOTIONS: Record<MotionId, Motion> = {
  rest: { tier: 'A', pose: 2, ms: 2000 },
  stretch: { tier: 'A', pose: 3, ms: 2000, frames: [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.06)', offset: 0.3 }, { transform: 'scaleY(1.06)', offset: 0.8 }, { transform: 'scaleY(1)' }] },
  look: { tier: 'A', pose: 4, ms: 1500, frames: [{ transform: 'scaleX(1)' }, { transform: 'scaleX(1)', offset: 0.5 }, { transform: 'scaleX(-1)', offset: 0.501 }, { transform: 'scaleX(-1)' }] },
  /** 손 흔들기(U5 §16.9.3): P05, scale 1→1.06→1 ×2, 1.5s */
  wave: { tier: 'A', pose: 5, ms: 1500, frames: t('scale(1)', 'scale(1.06)', 'scale(1)'), cycle: 750, iterations: 2 },
  yawn: { tier: 'A', pose: 3, ms: 2000, frames: [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.04)', offset: 0.6 }, { transform: 'scaleY(1.04)', offset: 0.8 }, { transform: 'scaleY(1)' }] },

  smileCoin: { tier: 'B', pose: 5, ms: 1500, coin: true, frames: t('scale(1)', 'scale(1.08)', 'scale(1)') },
  surprised: { tier: 'B', pose: 6, ms: 1000, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px) rotate(3deg)', offset: 0.1 }, { transform: 'translateY(0) rotate(-3deg)', offset: 0.2 }, { transform: 'rotate(3deg)', offset: 0.4 }, { transform: 'rotate(-3deg)', offset: 0.6 }, { transform: 'rotate(0)' }] },
  shrug: { tier: 'B', pose: 7, ms: 1500, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)', offset: 0.1 }, { transform: 'translateY(0)', offset: 0.2 }, { transform: 'translateY(-4px)', offset: 0.3 }, { transform: 'translateY(0)', offset: 0.4 }, { transform: 'translateY(0)' }] },
  upset: { tier: 'B', pose: 8, ms: 2000, frames: [{ transform: 'translateY(0) scaleY(1)' }, { transform: 'translateY(2px) scaleY(0.97)', offset: 0.5 }, { transform: 'translateY(0) scaleY(1)' }] },
  clap: { tier: 'B', pose: 9, ms: 2000, frames: t('scaleX(1)', 'scaleX(0.94)', 'scaleX(1)'), cycle: 180, iterations: 6 },

  expect: { tier: 'C', pose: 10, ms: Infinity, frames: t('scale(1)', 'scale(1.03)', 'scale(1)'), cycle: 400, iterations: Infinity },
  hop: { tier: 'C', pose: 11, ms: 320 },
  cheer: { tier: 'C', pose: 12, ms: 1500, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)', offset: 0.1 }, { transform: 'translateY(0)', offset: 0.2 }, { transform: 'translateY(-10px)', offset: 0.3 }, { transform: 'translateY(0)', offset: 0.4 }, { transform: 'translateY(0)' }] },
  scratch: { tier: 'C', pose: 13, ms: 1500, frames: t('rotate(0)', 'rotate(-3deg)', 'rotate(0)'), cycle: 500, iterations: 3 },
  coinFlip: { tier: 'C', pose: 5, ms: 1500, coin: true, frames: t('scale(1)', 'scale(1.05)', 'scale(1)') },
  cry: { tier: 'C', pose: 8, ms: 1500, frames: [{ transform: 'translateY(0) scaleY(1)' }, { transform: 'translateY(2px) scaleY(0.97)', offset: 0.5 }, { transform: 'translateY(0) scaleY(1)' }] },
  flag: { tier: 'C', pose: 14, ms: 2000, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(3px)', offset: 0.06 }, { transform: 'translateY(0)', offset: 0.125 }, { transform: 'translateY(3px)', offset: 0.19 }, { transform: 'translateY(0)', offset: 0.25 }, { transform: 'translateY(0)' }] },
  hammer: { tier: 'C', pose: 15, ms: 1000, frames: t('rotate(0)', 'rotate(-18deg)', 'rotate(0)'), cycle: 333, iterations: 3 },
  drift: { tier: 'C', pose: 16, ms: Infinity, frames: t('translateY(-2px)', 'translateY(2px)', 'translateY(-2px)'), cycle: 1800, iterations: Infinity },
  collapse: { tier: 'C', pose: 17, ms: 2000 },
};

export const IDLE_MOTIONS: MotionId[] = ['rest', 'stretch', 'look', 'wave'];

/** 판 위 말이 하는 모션(U5 §16.9.3: 이모션 0 — 자리 표시와 행동 결과만). 나머지(A 전부·B 전부·C 기대·환호·머리 긁기·동전 튕기기·울상)는 광장 귀퉁이 전신 캐릭터가 한다 */
export const TOKEN_MOTIONS: ReadonlySet<MotionId> = new Set<MotionId>(['hop', 'flag', 'hammer', 'drift', 'collapse']);
export const isTokenMotion = (m: MotionId) => TOKEN_MOTIONS.has(m);
export const RANK: Record<Tier, number> = { A: 1, B: 2, C: 3 };

/** 붐비는 칸(2명↑)에서 B·C 트윈의 위아래 움직임을 키의 3% 로 묶는다: 앞사람이 뒷사람 얼굴 상자를 넘지 않게.
 *  키프레임은 .bc-motion(캐릭터 배율 적용 전) 단위라 토큰 키(44) 기준 3% 가 화면에서도 그 캐릭터 키의 3% 다. */
export const CROWD_CAP = 0.03;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function crowdFrames(frames: Keyframe[]): Keyframe[] {
  const dy = CROWD_CAP * CHAR.h;
  return frames.map((f) => ({
    ...f,
    transform: String(f.transform)
      .replace(/translateY\((-?[\d.]+)px\)/g, (_, v) => `translateY(${clamp(+v, -dy, dy)}px)`)
      .replace(/scale(Y?)\(([\d.]+)\)/g, (_, y, v) => `scale${y}(${Math.min(+v, 1 + CROWD_CAP)})`)
      .replace(/rotate\((-?[\d.]+)deg\)/g, (_, v) => `rotate(${clamp(+v, -1, 1)}deg)`), // 머리가 옆으로 1° 이상 쏠리지 않게
  }));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 포즈 키. 매니페스트에 없는 포즈는 기본 포즈(P01)로 — 깨진 그림 0. */
export function poseKey(charId: number, pose: number): string {
  const k = `char.${charId}.p${pad(pose)}`;
  return hasAsset(k) ? k : `char.${charId}.p01`;
}

export interface MotionCue { seat: Seat; motion: MotionId }

/** 로그 이벤트 → 누가 어떤 모션을 하나 (PRD §12.2 B·C). prevOwners = 이 이벤트 전 칸 주인. 이동 홉·파산은 상태 변화로 따로 처리한다. */
export function cuesFor(ev: LogEvent, seats: Seat[], prevOwners: (Seat | null)[]): MotionCue[] {
  const others = (s: Seat) => seats.filter((x) => x !== s);
  switch (ev.ev) {
    case 'answer': return [{ seat: ev.seat, motion: ev.correct ? 'cheer' : 'scratch' }];
    case 'toll': return [
      { seat: ev.payer, motion: ev.discounted ? 'coinFlip' : 'cry' },
      { seat: ev.owner, motion: 'smileCoin' },
    ];
    case 'buy': return [{ seat: ev.seat, motion: 'flag' }];
    case 'build': return [
      { seat: ev.seat, motion: 'hammer' },
      ...(ev.level === 4 ? others(ev.seat).map((seat) => ({ seat, motion: 'clap' as const })) : []),
    ];
    case 'takeover': {
      const owner = prevOwners[ev.tile];
      if (owner === null || owner === undefined || owner === ev.seat) return [];
      return ev.shielded ? [{ seat: owner, motion: 'shrug' }] : [{ seat: owner, motion: 'upset' }, { seat: ev.seat, motion: 'flag' }];
    }
    case 'event': return ev.kind === 'island' ? others(ev.seat).map((seat) => ({ seat, motion: 'surprised' as const })) : [];
    default: return [];
  }
}
