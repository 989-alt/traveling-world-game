// 블록 놓기·순서 맞히기 공용: 블록을 칸에 끌어다 놓는다(Pointer Events: 마우스·터치패드·터치 공용).
// 탭(살짝 눌렀다 떼기)·키보드로는 "블록 고르기 → 칸 고르기". 틀린 자리 판정은 하지 않는다(서버 몫).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { LabelArt } from './art';
import { drawScale, place, slotOf, snapTo, takeOut, type Slots } from './logic';
import { spotPct } from './map-spots';

export interface BlockDef { id: number; label: string }
export interface SlotDef {
  label: string; // 칸 이름(오른쪽 글자 · 순서 번호)
  mark?: string; // 지도 자리 표시(㉠)
  at?: [number, number]; // 지도 자리(경도·위도) — 있으면 지도 위에 놓는다
  zone?: string;
}
export type PlacementLayout = 'spots' | 'rows' | 'order';

export interface PlacementProps {
  blocks: BlockDef[]; // 트레이 순서(섞인 순서)
  slots: SlotDef[];
  value: Slots;
  onChange: (s: Slots) => void;
  layout: PlacementLayout;
  disabled?: boolean;
  /** 칸 뒤에 깔 그림(세계 지도) */
  backdrop?: ComponentChildren;
  /** 블록을 그림 퍼즐 조각으로(이름 + 그림). 순서 맞히기처럼 긴 문장은 글자 조각 */
  art?: boolean;
  /** 실패 해설: 칸마다 정답 블록 id. 잘못 놓인·남은 블록은 흐리게 */
  answer?: number[];
  /** 실패 해설: 정답 블록 이름 칩을 칸 위에 얹는다(블록 놓기). 순서 맞히기는 아래 한 줄로 따로 보여 준다 */
  keyChips?: boolean;
}

const TAP = 6; // 이만큼 안 움직이고 떼면 탭

interface Drag { id: number; dx: number; dy: number; settling: boolean }

export function Placement({ blocks, slots, value, onChange, layout, disabled, backdrop, art, answer, keyChips }: PlacementProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [snap, setSnap] = useState<number | null>(null); // 방금 칸에 앉은 블록(딸깍 튕김)
  useEffect(() => { if (snap === null) return; const h = setTimeout(() => setSnap(null), 320); return () => clearTimeout(h); }, [snap]);
  const [sel, setSel] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; k: number; moved: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const label = (id: number) => blocks.find((b) => b.id === id)!.label;

  const put = (id: number, slot: number) => { onChange(place(value, id, slot)); setSel(null); setSnap(id); };

  const onDown = (e: PointerEvent, id: number) => {
    if (disabled || e.button > 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, k: drawScale(root.current!), moved: false }; // k: Stage 배율(화면 px → transform px)
    setDrag({ id, dx: 0, dy: 0, settling: false });
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || !drag) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > TAP) s.moved = true;
    if (s.moved) setDrag({ ...drag, dx: dx / s.k, dy: dy / s.k }); // translate 는 배율 안쪽 px: 나눠야 손가락을 그대로 따라간다
  };
  const onUp = (e: PointerEvent, id: number) => {
    const s = start.current;
    start.current = null;
    if (!s || !drag) return;
    if (!s.moved) { // 탭: 고르기 / 이미 골라 둔 블록이 있으면 이 블록이 앉은 칸에 놓기
      setDrag(null);
      const at = slotOf(value, id);
      if (sel !== null && sel !== id && at >= 0) put(sel, at);
      else setSel(sel === id ? null : id);
      return;
    }
    const rects = [...root.current!.querySelectorAll<HTMLElement>('[data-slot]')]
      .sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot))
      .map((el) => el.getBoundingClientRect());
    const hit = snapTo(e.clientX, e.clientY, rects);
    if (hit >= 0) { setDrag(null); put(id, hit); return; }
    const t = root.current!.querySelector('.pl-tray')!.getBoundingClientRect();
    if (slotOf(value, id) >= 0 && e.clientX >= t.left && e.clientX <= t.right && e.clientY >= t.top && e.clientY <= t.bottom) {
      setDrag(null); onChange(takeOut(value, id)); return; // 트레이로 내려놓기 = 칸에서 빼기
    }
    // 칸 밖: 원위치로 되돌아간다(transform 만 움직임)
    setDrag({ id, dx: 0, dy: 0, settling: true });
    setTimeout(() => setDrag(null), 260);
  };
  const onCancel = () => { start.current = null; setDrag(null); };
  const onKey = (e: MouseEvent, id: number) => { if (e.detail === 0) setSel(sel === id ? null : id); }; // 키보드 Enter·Space

  const chip = (id: number, miss = false) => {
    const d = drag?.id === id ? drag : null;
    return (
      <button type="button" key={id} class={`blk${art ? ' blk--art' : ''}${sel === id ? ' is-sel' : ''}${d && !d.settling ? ' is-drag' : ''}${d?.settling ? ' is-back' : ''}${snap === id ? ' is-snap' : ''}${miss ? ' is-miss' : ''}`}
        data-block={id} disabled={disabled} data-tone={id % 5}
        style={d ? { transform: `translate(${d.dx}px, ${d.dy}px)` } : undefined}
        onPointerDown={(e) => onDown(e, id)} onPointerMove={onMove} onPointerUp={(e) => onUp(e, id)} onPointerCancel={onCancel}
        onClick={(e) => onKey(e, id)}>
        {art && <LabelArt label={label(id)} class="blk-pic" />}
        <span class="blk-name">{label(id)}</span>
      </button>
    );
  };

  const tray = blocks.filter((b) => slotOf(value, b.id) < 0).map((b) => chip(b.id, !!answer));
  const slotEl = (s: SlotDef, i: number) => {
    const at = s.at ? spotPct(...s.at) : null;
    const who = value[i];
    const key = answer?.[i];
    const ok = key !== undefined && key >= 0 && who === key;
    return (
      <div key={i} class={`slot slot--${layout}${who !== null ? ' is-full' : ''}${ok ? ' is-ok' : ''}`} data-slot={i} data-zone={s.zone}
        style={at ? { left: `${at.x}%`, top: `${Math.min(Math.max(at.y, 9), 91)}%` } : undefined}
        role="group" aria-label={`${s.label} 칸${who !== null ? `: ${label(who)}` : ''}`}
        onClick={() => { if (sel !== null && !disabled && who === null) put(sel, i); }}>
        {who !== null ? chip(who, key !== undefined && !ok) : <span class="slot-mark">{layout === 'order' ? i + 1 : (s.mark ?? '')}</span>}
        {ok && <i class="slot-ok" aria-hidden="true">✓</i>}
        {keyChips && key !== undefined && key >= 0 && !ok && <span class="slot-key" data-key={key}>{label(key)}</span>}
        {layout === 'rows' && <span class="slot-label">{s.label}</span>}
      </div>
    );
  };

  return (
    <div ref={root} class={`pl pl--${layout}${disabled ? ' is-locked' : ''}${answer ? ' is-reveal' : ''}`} data-sel={sel ?? ''}>
      <div class="pl-board">{backdrop}{slots.map(slotEl)}</div>
      {/* 첫 사용 손 힌트: 아무것도 안 놓았을 때 트레이 첫 조각 위에서 위로 끄는 시늉 */}
      {!disabled && value.every((v) => v === null) && drag === null && sel === null && <i class="mp-hand pl-hand" aria-hidden="true" />}
      <div class="pl-tray" data-empty={tray.length === 0 ? '1' : '0'}
        onClick={() => { if (sel !== null && !disabled && slotOf(value, sel) >= 0) { onChange(takeOut(value, sel)); setSel(null); } }}>{tray}</div>
    </div>
  );
}
