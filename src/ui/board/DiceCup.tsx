// 주사위 B — 나무 컵 + 금테 쟁반(DESIGN §17.1). 옛 유리 구슬 버튼(DiceButton) 대체. 규칙(2d6·같은 눈·게이지 ±15%p)은 그대로.
// 누르는 동안 컵이 흔들리고 쟁반 테(게이지 호)가 0→1→0 을 오간다. 떼면 뗀 위치(0~1)만 보낸다 — 편향은 서버 몫(PRD §4).
// 쏟기 → 두 주사위가 2번 튕기며 면이 바뀐다 → 서버 눈(d1·d2)으로 멈춤 → 합 숫자 팝(같은 눈이면 "더블!") → +1830 이동 시작.
// 시각은 Board 가 준 RollShow(t0·서버 눈 도착)로 정한다(dice-show.ts rollTimes) — 보드의 이동 시작 늦춤과 같은 값.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Pic } from '../../assets/AssetImg';
import { audio } from '../../audio/engine';
import { DICE } from '../../shared/timing';
import { bouncePath, CUP, CUP_BOX, rollTimes, type RollShow } from './dice-show';

export const GAUGE_PERIOD_MS = 1200;

/** 누른 시간 → 게이지 위치 0~1 (삼각파). */
export function gaugeAt(ms: number, period = GAUGE_PERIOD_MS): number {
  const t = (((ms % period) + period) % period) / period;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/** 컵 상태: 대기 / 누름(흔들림) / 봇 흔들기 / 기울임 / 쏟음(튕김) / 멈춤 / 합 팝 / 끝(이동 시작) */
export type CupPhase = 'idle' | 'press' | 'shake' | 'tilt' | 'pour' | 'stop' | 'pop' | 'done';

const FACES = [1, 2, 3, 4, 5, 6] as const;
/** 공중 회전(왼쪽 +, 오른쪽 −: 같은 눈이라도 둘로 읽히게). 끝각은 바로 선 면(360 배수) */
const SPIN = [720, -360] as const;
const rnd = () => 1 + Math.floor(Math.random() * 6);

export interface DiceCupProps {
  /** 내 차례에 굴릴 수 있음(대기·이동 끝) */
  enabled: boolean;
  /** 남의 차례·관전 대기: 컵 정지 · 옅게 */
  dim: boolean;
  /** 지금 보여 줄 굴림(없으면 대기) */
  show: RollShow | null;
  /** 움직임을 줄인 기기: 이동이 끝날 때까지 HUD 숫자를 붙잡는다 */
  holdSum?: boolean;
  onPressStart?: () => void;
  onRelease: (gauge: number) => void;
  onCancel?: () => void;
  /** 굴림 연출이 다 끝나 컵이 대기로 돌아옴(id = 그 굴림) */
  onDone?: (id: number) => void;
}

export function DiceCup(p: DiceCupProps) {
  const root = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGEllipseElement>(null);
  const edge = useRef<SVGEllipseElement>(null);
  const dieEls = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const pressAt = useRef<number | null>(null);
  const gaugeAnim = useRef<Animation[]>([]);
  const [phase, setPhase] = useState<CupPhase>('idle');
  const [gauge, setGauge] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const swap = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const bounced = useRef(-1); // 튕김을 시작한 굴림 id(같은 굴림에 서버 눈이 늦게 와도 다시 튕기지 않는다)
  const show = p.show;

  // ── 누름 ──
  const setArc = (g: number) => { for (const el of [arc.current, edge.current]) if (el) el.style.strokeDashoffset = String(100 - g * 100); };
  const start = () => {
    if (!p.enabled || pressAt.current !== null || phase !== 'idle') return;
    pressAt.current = performance.now();
    setGauge(0);
    setPhase('press');
    gaugeAnim.current = [arc.current, edge.current].flatMap((el) => el ? [el.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }, { strokeDashoffset: 100 }], { duration: GAUGE_PERIOD_MS, iterations: Infinity })] : []);
    p.onPressStart?.();
  };
  const finish = (send: boolean) => {
    if (pressAt.current === null) return;
    const g = gaugeAt(performance.now() - pressAt.current);
    pressAt.current = null;
    gaugeAnim.current.forEach((a) => a.cancel());
    gaugeAnim.current = [];
    if (send) {
      setGauge(g);
      setArc(g);
      p.onRelease(g); // Board 가 곧바로 show(t0 = 지금)를 준다
    } else {
      setGauge(null);
      setArc(0);
      setPhase('idle');
      p.onCancel?.();
    }
  };
  // 누른 채로 차례가 끝나거나(enabled=false) 초점을 잃으면 그 누름은 버린다(굴리지 않음)
  useEffect(() => { if (!p.enabled) finish(false); }, [p.enabled]);

  // ── 굴림 타임라인 ──
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const stopSwap = () => { clearInterval(swap.current); swap.current = undefined; };
  useEffect(() => () => { clear(); stopSwap(); }, []);
  const face = (i: number, n: number) => { const el = dieEls[i].current; if (el) el.dataset.face = String(n); };
  /** 주사위가 쟁반 위에 나와 있음(쏟은 지 +120 부터 이동 시작까지) */
  const out = (on: boolean) => dieEls.forEach((r) => { if (!r.current) return; if (on) r.current.dataset.out = '1'; else delete r.current.dataset.out; });

  useEffect(() => {
    clear();
    if (!show) {
      stopSwap();
      out(false);
      if (pressAt.current === null) { setPhase('idle'); setGauge(null); }
      return;
    }
    const now = performance.now();
    const at = (t: number, f: () => void) => { if (t <= now) f(); else timers.current.push(setTimeout(f, t - now)); };
    const times = rollTimes(show);
    if (show.reduced) {
      // 움직임 줄임: 뗌 즉시 쏟은 정지 그림 + (눈이 오면) 멈춘 눈 + 숫자, 이동 시작 뒤에도 착지까지 숫자 유지(holdSum)
      setPhase('pour');
      if (times) {
        face(0, show.d1!); face(1, show.d2!);
        out(true);
        setPhase('pop');
        at(times.end, () => setPhase('done'));
      }
      return;
    }
    if (bounced.current !== show.id) out(false);
    if (show.shakeFrom !== undefined && now < show.t0) setPhase('shake'); // 봇: 누름 없이 흔들기 600
    at(show.t0, () => { setPhase('tilt'); audio.playSfx('dice'); });
    at(show.t0 + DICE.tilt, () => setPhase('pour'));
    if (bounced.current !== show.id) {
      at(show.t0 + DICE.pour, () => {
        if (bounced.current === show.id) return;
        bounced.current = show.id;
        dieEls.forEach((r, i) => {
          r.current?.getAnimations().forEach((a) => a.cancel());
          r.current?.animate(bouncePath(CUP.mouth, CUP.dice[i], SPIN[i]), { duration: DICE.bounce[0] + DICE.bounce[1], fill: 'backwards' });
        });
        stopSwap();
        face(0, rnd()); face(1, rnd());
        out(true);
        swap.current = setInterval(() => { face(0, rnd()); face(1, rnd()); }, 60); // 공중 회전 = 면 교체
      });
    }
    if (times) {
      at(times.stop, () => {
        stopSwap();
        face(0, show.d1!); face(1, show.d2!); // 서버 눈으로 고정
        setPhase('stop');
      });
      at(times.pop, () => setPhase('pop'));
      at(times.end, () => setPhase('done'));
    }
  }, [show]);

  // 끝(이동 시작) → 컵이 서고 숫자·주사위가 사라진 뒤 대기. 움직임 줄임은 착지까지 숫자를 붙잡는다
  useEffect(() => {
    if (phase !== 'done' || (show?.reduced && p.holdSum)) return;
    const id = show?.id;
    const h = setTimeout(() => { setPhase('idle'); setGauge(null); setArc(0); out(false); if (id !== undefined) p.onDone?.(id); }, show?.reduced ? 0 : 200);
    return () => clearTimeout(h);
  }, [phase, p.holdSum]);

  const sum = show?.d1 !== undefined ? show.d1 + show.d2! : null;
  const double = show?.d1 !== undefined && show.d1 === show.d2;
  const showSum = sum !== null && (phase === 'pop' || (phase === 'done' && !!show?.reduced));
  const cls = ['dice', p.enabled && phase === 'idle' ? 'is-ready' : '', p.dim && phase === 'idle' ? 'is-dim' : '', show?.reduced ? 'is-reduced' : ''].filter(Boolean).join(' ');
  const sx = (b: { x: number; y: number; w: number; h: number }) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
  const sq = (cx: number, bottom: number, s: number) => ({ left: `${cx - s / 2}px`, top: `${bottom - s}px`, width: `${s}px`, height: `${s}px` });
  const pourAt = { position: 'absolute' as const, left: `${CUP.mouth.x - CUP.pourMouth.fx * CUP.pourS}px`, top: `${CUP.mouth.y - CUP.pourMouth.fy * CUP.pourS}px`, width: `${CUP.pourS}px`, height: `${CUP.pourS}px` };

  return (
    <div class={cls} ref={root} data-phase={phase} data-seat={show?.seat ?? ''} data-d1={show?.d1 ?? ''} data-d2={show?.d2 ?? ''}
      data-gauge={gauge === null ? '' : gauge.toFixed(3)} style={{ width: `${CUP_BOX.w}px`, height: `${CUP_BOX.h}px` }}>
      {/* 쟁반 + 정적 그림자 + 테 위 게이지 호(SVG stroke-dashoffset, 타이머와 같은 방식) */}
      <span class="dice-tray-shadow" aria-hidden="true" style={sx({ x: CUP.tray.x + 10, y: CUP.tray.y + 30, w: CUP.tray.w - 20, h: CUP.tray.h - 14 })} />
      <Pic k="dice.tray" class="dice-tray" fallback={<span class="dice-tray dice-tray--css" style={sx(CUP.tray)} />} eager />
      <svg class={`dice-gauge${gauge !== null ? ' is-on' : ''}${phase === 'pop' || phase === 'done' ? ' is-fade' : ''}`} style={sx(CUP.tray)}
        viewBox={`0 0 ${CUP.tray.w} ${CUP.tray.h}`} aria-hidden="true">
        <defs>
          <linearGradient id="dice-gauge-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="var(--dice-gauge-start)" />
            <stop offset="1" stop-color="var(--dice-gauge-end)" />
          </linearGradient>
        </defs>
        <ellipse ref={edge} class="dice-gauge-edge" cx="100" cy="44" rx="94" ry="41" pathLength={100} transform="rotate(180 100 44)" />
        <ellipse ref={arc} class="dice-gauge-arc" cx="100" cy="44" rx="94" ry="41" pathLength={100} transform="rotate(180 100 44)" />
      </svg>

      {/* 컵 3장(서 있음·기울임·쏟음)을 겹쳐 opacity 로 바꾼다(깜빡임 0). 바닥 중앙 앵커 */}
      <span class="dice-cup-box" style={{ left: `${CUP.foot.x}px`, top: `${CUP.foot.y}px` }}>
        <Pic k="dice.cup.stand" class="dice-cup dice-cup--stand" fallback={<span class="dice-cup dice-cup--stand dice-cup--css" />} eager />
        <Pic k="dice.cup.tilt" class="dice-cup dice-cup--tilt" eager />
      </span>
      <span class="dice-pour-box" style={pourAt}>
        <Pic k="dice.cup.pour" class="dice-cup dice-cup--pour" fallback={<span class="dice-cup dice-cup--pour dice-cup--css" />} eager />
      </span>

      {/* 주사위 2: 왼쪽 = 첫 눈, 오른쪽 = 둘째 눈. 면 6장을 겹쳐 data-face 로 하나만 보인다 */}
      {CUP.dice.map((c, i) => (
        <div key={i} ref={dieEls[i]} class={`dice-die${phase === 'stop' ? ' is-land' : ''}`} data-i={i} style={sq(c.x, c.y + CUP.die / 2, CUP.die)}>
          <span class="dice-die-shadow" aria-hidden="true" />
          {FACES.map((n) => (
            <Pic key={n} k={`dice.face.${n}`} class={`dice-face dice-face--${n}`} eager
              fallback={<span class={`dice-face dice-face--${n} dice-face--css`} data-n={n}>{Array.from({ length: n }, (_, j) => <i key={j} />)}</span>} />
          ))}
          {phase === 'stop' && <span class="dice-spark" aria-hidden="true"><i /><i /><i /></span>}
        </div>
      ))}

      {/* 합 숫자(Jua 64 금 + 남색 외곽) + 버스트 128, 같은 눈 칩 */}
      {showSum && (
        <span class="dice-sum" role="status" aria-label={`주사위 ${show!.d1}과 ${show!.d2}, 합 ${sum}${double ? ', 더블' : ''}`}
          style={{ left: `${CUP.sum.x}px`, top: `${CUP.sum.y}px` }}>
          <Pic k="dice.burst" class="dice-burst" />
          <b class="dice-sum-n">{sum}</b>
        </span>
      )}
      {showSum && double && (
        <span class="dice-double" style={sx({ x: CUP.chip.x - CUP.chip.w / 2, y: CUP.chip.y - CUP.chip.h / 2, w: CUP.chip.w, h: CUP.chip.h })}>
          더블!<span class="dice-double-spark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        </span>
      )}

      <button
        type="button"
        class="dice-btn"
        disabled={!p.enabled || phase !== 'idle' && phase !== 'press'}
        aria-label="주사위 굴리기: 컵을 누르고 있다가 원하는 곳에서 떼요"
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start(); }}
        onPointerUp={(e) => {
          // 포인터 이탈 = 누름 취소(DESIGN §17.1.2). 포인터를 잡고 있어 밖에서 떼도 여기로 오므로 자리를 본다.
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          finish(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
        }}
        onPointerCancel={() => finish(false)}
        onLostPointerCapture={() => finish(false)}
        onBlur={() => finish(false)}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') finish(true); }}
      />
    </div>
  );
}
