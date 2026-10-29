// 주사위 버튼 + 게이지 (DESIGN §4.2·§16.4: 광장 가운데 받침 위 빛나는 금색 유리 구슬 속 주사위). 누르는 동안 게이지 표시가 0→1→0 을 오가고, 뗀 위치(0~1)만 보낸다.
// 편향(±15%p)은 서버 몫이다(PRD §4). 게이지 표시는 rotate(transform) 하나로 움직인다.
import { useEffect, useRef } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';

export const GAUGE_PERIOD_MS = 1200;
const SPAN_DEG = 300; // 게이지 호 길이
const START_DEG = -150;

/** 누른 시간 → 게이지 위치 0~1 (삼각파). */
export function gaugeAt(ms: number, period = GAUGE_PERIOD_MS): number {
  const t = (((ms % period) + period) % period) / period;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

const rot = (g: number) => `rotate(${START_DEG + g * SPAN_DEG}deg)`;

export function DiceButton(p: { enabled: boolean; onPressStart?: () => void; onRelease: (gauge: number) => void; onCancel?: () => void }) {
  const knob = useRef<HTMLSpanElement>(null);
  const t0 = useRef<number | null>(null);
  const anim = useRef<Animation | null>(null);

  const start = () => {
    if (!p.enabled || t0.current !== null) return;
    t0.current = performance.now();
    anim.current = knob.current!.animate([{ transform: rot(0) }, { transform: rot(1) }, { transform: rot(0) }], { duration: GAUGE_PERIOD_MS, iterations: Infinity });
    p.onPressStart?.();
  };
  const finish = (send: boolean) => {
    if (t0.current === null) return;
    const g = gaugeAt(performance.now() - t0.current);
    t0.current = null;
    anim.current?.cancel();
    if (knob.current) knob.current.style.transform = rot(g);
    if (send) p.onRelease(g);
    else p.onCancel?.();
  };

  // 누른 채로 차례가 끝나거나(enabled=false) 초점을 잃으면 그 누름은 버린다(굴리지 않음)
  useEffect(() => { if (!p.enabled) finish(false); }, [p.enabled]);

  return (
    <div class={`dice${p.enabled ? ' is-ready' : ''}`}>
      <span class="dice-halo" aria-hidden="true" />
      {p.enabled && <span class="dice-gauge" aria-hidden="true"><span class="dice-knob" ref={knob} style={{ transform: rot(0) }} /></span>}
      <button
        type="button"
        class="dice-btn"
        disabled={!p.enabled}
        aria-label="주사위 굴리기: 누르고 있다가 원하는 곳에서 떼요"
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start(); }}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onBlur={() => finish(false)}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') finish(true); }}
      >
        <AssetImg k="ui.dice" class="dice-icon" />
      </button>
    </div>
  );
}
