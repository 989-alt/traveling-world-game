// 연결하기: 왼쪽 항목과 오른쪽 항목을 선으로 잇는다. 선은 SVG. 끌어서(Pointer Events)·탭 두 번으로 잇는다.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LabelArt } from './art';
import { drawScale, link, SNAP, snapTo, type Links, type Rect } from './logic';

export interface ConnectProps {
  left: { id: number; label: string }[];
  right: { id: number; label: string }[]; // 섞인 순서
  value: Links;
  onChange: (l: Links) => void;
  disabled?: boolean;
  /** 실패 해설: 정답 쌍 [왼쪽 id, 오른쪽 id]. 있으면 학생 선 중 틀린 것은 회색 점선, 정답 쌍은 초록 선으로 위에 겹친다 */
  answer?: [number, number][];
}

type End = { side: 'l' | 'r'; id: number };
interface Pt { x: number; y: number }
/** 빛나는 선 색(v3 04: 노랑·초록·하늘 …) */
const COLORS = ['--gold-shine', '--correct-bright', '--scroll-frame-light', '--answer-d-hi', '--answer-b-hi', '--seat-4'];
const TAP = 6;

export function Connect({ left, right, value, onChange, disabled, answer }: ConnectProps) {
  const box = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<Record<string, Pt>>({});
  const [from, setFrom] = useState<End | null>(null); // 끌고 있는 쪽
  const [at, setAt] = useState<Pt | null>(null);
  const [sel, setSel] = useState<End | null>(null); // 탭으로 골라 둔 쪽
  const moved = useRef(false);
  const origin = useRef<Pt>({ x: 0, y: 0 });

  const measure = () => {
    const b = box.current;
    if (!b) return;
    const o = b.getBoundingClientRect();
    const k = drawScale(b); // 화면 px → 상자 안(SVG) px. Stage 배율이 1 이 아니면(태블릿) 나눠야 선 끝이 항목에 닿는다
    const next: Record<string, Pt> = {};
    b.querySelectorAll<HTMLElement>('[data-end]').forEach((el) => {
      const r = el.getBoundingClientRect();
      next[el.dataset.end!] = { x: ((el.dataset.end!.startsWith('l') ? r.right : r.left) - o.left) / k, y: (r.top + r.height / 2 - o.top) / k };
    });
    setDots(next);
  };
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure); // 글꼴이 늦게 와서 높이가 바뀌어도 선이 따라간다
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const connect = (a: End, b: End) => {
    if (a.side === b.side) return;
    const l = a.side === 'l' ? a.id : b.id, r = a.side === 'r' ? a.id : b.id;
    onChange(link(value, l, r));
  };
  const rel = (e: PointerEvent): Pt => {
    const b = box.current!, o = b.getBoundingClientRect(), k = drawScale(b);
    return { x: (e.clientX - o.left) / k, y: (e.clientY - o.top) / k };
  };

  const down = (e: PointerEvent, end: End) => {
    if (disabled || e.button > 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moved.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    setFrom(end);
    setAt(rel(e));
  };
  const move = (e: PointerEvent) => {
    if (!from) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > TAP) moved.current = true;
    setAt(rel(e));
  };
  const up = (e: PointerEvent) => {
    const a = from;
    setFrom(null);
    setAt(null);
    if (!a) return;
    if (!moved.current) { // 탭
      if (sel && sel.side !== a.side) { connect(sel, a); setSel(null); } else setSel(sel && sel.side === a.side && sel.id === a.id ? null : a);
      return;
    }
    const other = a.side === 'l' ? 'r' : 'l';
    const els = [...box.current!.querySelectorAll<HTMLElement>(`[data-end^="${other}"]`)];
    const rects: Rect[] = els.map((el) => el.getBoundingClientRect());
    const hit = snapTo(e.clientX, e.clientY, rects, SNAP);
    if (hit >= 0) connect(a, { side: other, id: Number(els[hit].dataset.end!.slice(1)) });
  };
  const key = (e: MouseEvent, end: End) => { // 키보드 Enter·Space
    if (e.detail !== 0) return;
    if (sel && sel.side !== end.side) { connect(sel, end); setSel(null); } else setSel(sel && sel.side === end.side && sel.id === end.id ? null : end);
  };

  const rightOf = (l: number) => value[l];
  const leftOf = (r: number) => Number(Object.keys(value).find((l) => value[Number(l)] === r) ?? -1);
  const col = (i: number) => `var(${COLORS[i % COLORS.length]})`;
  const item = (side: 'l' | 'r', it: { id: number; label: string }) => {
    const linked = side === 'l' ? rightOf(it.id) !== undefined : leftOf(it.id) >= 0;
    const mine = (side === 'l' ? it.id : leftOf(it.id));
    return (
      <button type="button" key={`${side}${it.id}`} data-end={`${side}${it.id}`} disabled={disabled}
        class={`cn-item cn-item--${side}${linked ? ' is-linked' : ''}${sel?.side === side && sel.id === it.id ? ' is-sel' : ''}${from?.side === side && from.id === it.id ? ' is-from' : ''}`}
        style={linked ? { '--line': col(mine) } : undefined}
        onPointerDown={(e) => down(e, { side, id: it.id })} onPointerMove={move} onPointerUp={up}
        onPointerCancel={() => { setFrom(null); setAt(null); }} onClick={(e) => key(e, { side, id: it.id })}>
        <LabelArt label={it.label} class="cn-pic" />
        <span class="cn-label">{it.label}</span>
        <i class="cn-dot" />
      </button>
    );
  };

  // 물결 곡선(v3 04): 같은 높이끼리도 S 자로 출렁인다
  const path = (a: Pt, b: Pt) => { const m = (b.x - a.x) / 2, w = Math.sign(b.x - a.x) * 22; return `M${a.x} ${a.y}C${a.x + m} ${a.y + w} ${b.x - m} ${b.y - w} ${b.x} ${b.y}`; };
  return (
    <div ref={box} class={`cn${disabled ? ' is-locked' : ''}${answer ? ' is-reveal' : ''}`}>
      <svg class="cn-lines" aria-hidden="true">
        {Object.entries(value).map(([l, r]) => {
          const a = dots[`l${l}`], b = dots[`r${r}`];
          const wrong = !!answer && !answer.some(([x, y]) => x === Number(l) && y === r);
          return a && b ? (
            <g key={l} class={wrong ? 'cn-mine is-wrong' : 'cn-mine'} style={{ '--ln': col(Number(l)) }}>
              <path class="cn-line" d={path(a, b)} data-l={l} data-r={r} />
              <path class="cn-core" d={path(a, b)} />
            </g>
          ) : null;
        })}
        {/* 정답 쌍: 학생 선 위에 초록 빛 선 + 가운데 체크 */}
        {answer?.map(([l, r]) => {
          const a = dots[`l${l}`], b = dots[`r${r}`];
          return a && b ? (
            <g key={`k${l}`} class="cn-key">
              <path class="cn-line cn-line--key" d={path(a, b)} data-l={l} data-r={r} data-key="1" />
              <path class="cn-core" d={path(a, b)} />
              <circle class="cn-keydot" cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="13" />
              <path class="cn-keytick" d={`M${(a.x + b.x) / 2 - 6} ${(a.y + b.y) / 2}l4 4.5l8 -9`} />
            </g>
          ) : null;
        })}
        {from && at && dots[`${from.side}${from.id}`] && (
          <path class="cn-line cn-line--live" d={from.side === 'l' ? path(dots[`l${from.id}`], at) : path(at, dots[`r${from.id}`])} />
        )}
      </svg>
      <div class="cn-col">{left.map((it) => item('l', it))}</div>
      <div class="cn-col">{right.map((it) => item('r', it))}</div>
      {/* 첫 사용 손 힌트: 아직 하나도 안 이었을 때만, 왼쪽 첫 점 → 오른쪽으로 끄는 시늉 */}
      {!disabled && Object.keys(value).length === 0 && !from && left.length > 0 && dots[`l${left[0].id}`] && (
        <i class="mp-hand cn-hand" aria-hidden="true" style={{ left: `${dots[`l${left[0].id}`].x}px`, top: `${dots[`l${left[0].id}`].y}px` }} />
      )}
    </div>
  );
}
