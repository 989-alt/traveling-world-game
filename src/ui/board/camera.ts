// 줌 카메라 (PRD §12.4, DESIGN §16.6). board-world 하나에만 translate(tx,ty) scale(s) 를 건다 — HUD 는 안 커진다.
// 순수 계산(클램프·변환 문자열)과 단계 기계(useCamera)를 둔다. 시간·배율은 shared/timing.ts.
import { useEffect, useRef, useState } from 'preact/hooks';
import { HOP_MS, ZOOM_HOLD_MS, ZOOM_IN_MS, ZOOM_OUT_MS, ZOOM_SCALE } from '../../shared/timing';
import { STAGE, type Pt } from './geometry';

/** 시간·배율은 shared/timing 한 곳에서(서버 도착 단계 마감 늦춤과 같은 값). tokens.css 의 --board-zoom* 는 같은 값의 사본이고 board.test 가 맞춰 본다 */
export const ZOOM = {
  scale: ZOOM_SCALE,
  inMs: ZOOM_IN_MS,
  holdMs: ZOOM_HOLD_MS,
  outMs: ZOOM_OUT_MS,
  hopMs: HOP_MS,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 초점 f(스테이지 px)를 화면 가운데에 두는 이동량. world 가 스테이지 밖을 드러내지 않게 클램프:
 *  tx ∈ [W(1−s), 0], ty ∈ [H(1−s), 0] (§16.6) */
export function camShift(s: number, f: Pt): { tx: number; ty: number } {
  if (s <= 1) return { tx: 0, ty: 0 };
  return {
    tx: clamp(STAGE.w / 2 - f.x * s, STAGE.w * (1 - s), 0),
    ty: clamp(STAGE.h / 2 - f.y * s, STAGE.h * (1 - s), 0),
  };
}

/** 줌 상태에서 world 가 덮는 스테이지 영역(스테이지 px). 클램프가 맞으면 늘 (0,0)~(W,H) 를 다 덮는다 */
export function worldCover(s: number, f: Pt) {
  const { tx, ty } = camShift(s, f);
  return { left: tx, top: ty, right: tx + STAGE.w * s, bottom: ty + STAGE.h * s };
}

/** 이동량은 정수 px 로(반 픽셀 이동은 합성 레이어를 한 번 더 보간해 흐려진다) */
export const camTransform = (s: number, f: Pt) => {
  const { tx, ty } = camShift(s, f);
  return `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${s})`;
};

export type CamPhase = 'idle' | 'in' | 'follow' | 'hold' | 'out';
export interface CamView {
  phase: CamPhase;
  /** world 의 transform·transition(인라인 스타일) */
  style: Record<string, string>;
  /** 줌이 걸려 있음(in~out 끝까지): 주사위 숨김·대기 모션 정지·오버레이 늦춤 */
  active: boolean;
}

/**
 * 단계 기계: idle → in(400ms, 첫 홉과 함께) → follow(홉마다 320ms 로 초점 갱신) → hold(착지 + 300ms) → out(600ms) → idle.
 * focus 는 이동자 발 앵커(렌더마다 Board 가 넘김). moving = 이동자가 아직 홉 중. enabled=false(reduced-motion·탭 숨김·재접속)면 줌 0.
 */
export function useCamera({ focus, moving, enabled, onActive, holdMs = ZOOM.holdMs }: { focus: Pt | null; moving: boolean; enabled: boolean; onActive?: (on: boolean) => void; holdMs?: number }): CamView {
  const [phase, setPhase] = useState<CamPhase>('idle');
  const last = useRef<Pt | null>(null);
  const inAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const after = (ms: number, f: () => void) => { clearTimeout(timer.current); timer.current = setTimeout(f, ms); };
  useEffect(() => () => clearTimeout(timer.current), []);

  // 이동 시작 → in, 이동 중 → follow, 끝 → hold → out → idle
  useEffect(() => {
    if (!enabled) { clearTimeout(timer.current); setPhase('idle'); return; }
    if (moving && focus) {
      if (phase === 'idle' || phase === 'out') { inAt.current = performance.now(); setPhase('in'); after(ZOOM.inMs, () => setPhase('follow')); }
      else if (phase === 'hold') { clearTimeout(timer.current); setPhase('follow'); }
      return;
    }
    if (!moving && (phase === 'in' || phase === 'follow')) {
      // 1홉·순간 이동(세계여행)은 in 이 끝나기 전에 착지한다 → in 을 마저 보이고 그 뒤부터 머문다
      const rest = phase === 'in' ? Math.max(0, ZOOM.inMs - (performance.now() - inAt.current)) : 0;
      setPhase('hold');
      after(rest + holdMs, () => {
        setPhase('out');
        after(ZOOM.outMs, () => setPhase('idle'));
      });
    }
  }, [moving, enabled, !!focus, phase]);

  const active = phase !== 'idle';
  const cb = useRef(onActive);
  cb.current = onActive;
  useEffect(() => { cb.current?.(active); }, [active]);
  useEffect(() => () => cb.current?.(false), []);

  if (focus) last.current = focus;
  const f = last.current ?? { x: STAGE.w / 2, y: STAGE.h / 2 };
  if (phase === 'idle') return { phase, active, style: {} };
  if (phase === 'out') {
    return { phase, active, style: { transform: camTransform(1, f), transition: `transform ${ZOOM.outMs}ms var(--ease-standard)` } };
  }
  const ms = phase === 'in' ? ZOOM.inMs : ZOOM.hopMs;
  const ease = phase === 'in' ? 'var(--ease-standard)' : 'linear';
  return { phase, active, style: { transform: camTransform(ZOOM.scale, f), transition: `transform ${ms}ms ${ease}` } };
}
