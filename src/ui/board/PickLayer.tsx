// 보드에서 칸 직접 고르기(PRD §3.6.1, DESIGN §18 — U10). 세계여행 · 내 땅으로 · 세계 축제 공통. 옛 나라 이름 목록 창은 없다.
// 칸 모양(옅음·밝힘·선택 테·확정·봇 반짝)은 판 레이어의 칸에 Board 가 얹고, 여기는 화면 레이어(HUD)의 것만:
// 고르기 간판(주사위 자리) · 칸 누름 영역(칸 상자 124×124, 고를 수 있는 칸만) · 말풍선("여기로 갈래요").
// 고르기 단계에는 줌이 없으므로 HUD 좌표 = 판 좌표다.
import { useEffect, useRef } from 'preact/hooks';
import { BOARD } from '../../shared/board';
import type { Seat } from '../../shared/types';
import { josa } from '../../state/nick';
import { Timer } from '../missions/Timer';
import { bubbleGeo, PICK_BUBBLE, PICK_SIGN, pickSignBox, TILES } from './geometry';
import { HangSign } from './HangSign';
import '../../styles/pick.css';

export type PickKind = 'travel' | 'pickTile' | 'festival';

/** Game → Board: 지금 고르기 단계 */
export interface BoardPick {
  kind: PickKind;
  /** 고르는 사람(자리색 테) */
  seat: Seat;
  /** 내가 고른다(누름·키보드·말풍선). 아니면 관전(밝힘·미리보기만) */
  mine: boolean;
  /** 고르는 사람 별명(관전 간판 문구) */
  name: string;
  /** 고를 수 있는 칸(나머지는 옅음) */
  eligible: number[];
  /** 서버가 중계한 선택 표시 칸(turn.preview) — 관전자 화면의 자리색 테 */
  preview: number | null;
  deadline: number | null;
  total: number;
  /** 선택이 바뀔 때만(같은 칸 다시·호버 없음) 서버에 pickPreview */
  onPreview?: (tile: number | null) => void;
  /** 확정(한 번만) */
  onConfirm?: (tile: number) => void;
  /** 축제 "이번엔 안 고를래요" */
  onSkip?: () => void;
}

/** 칸 묶음 상태(판 레이어 data-pick): 옅음 · 밝힘 · 선택(미리보기) · 확정 · 봇 반짝 */
export type TilePick = 'dim' | 'lit' | 'sel' | 'confirm' | 'flash';
/** 상태별 들어올림(px, DESIGN §18.1) — 칸 위 말도 같이 올라 접지가 그대로다 */
export const PICK_LIFT: Record<TilePick, number> = { dim: 0, lit: 4, sel: 8, confirm: 8, flash: 8 };

const TITLE: Record<PickKind, string> = { travel: '세계여행', pickTile: '내 땅으로', festival: '세계 축제' };
const NOTE: Record<PickKind, string> = {
  travel: '가고 싶은 나라 칸을 눌러요',
  pickTile: '갈 내 땅을 눌러요',
  festival: '통행료를 두 배로 받을 내 땅을 눌러요',
};
/** 말풍선 단추: 세계여행·내 땅으로 = 그 칸으로 간다. 축제는 가지 않고 그 땅에 축제를 연다 */
const GO: Record<PickKind, string> = { travel: '여기로 갈래요', pickTile: '여기로 갈래요', festival: '여기로 할래요' };

export const pickNote = (p: Pick<BoardPick, 'kind' | 'mine' | 'name'>) =>
  p.mine ? NOTE[p.kind] : `${josa(p.name, '이', '가')} ${p.kind === 'travel' ? '갈 곳' : '땅'}을 고르고 있어요`;

/** 고리 순서로 다음·이전 고를 수 있는 칸(옅은 칸 건너뜀) */
export function stepTile(eligible: number[], from: number, dir: 1 | -1): number {
  const list = [...eligible].sort((a, b) => a - b);
  if (!list.length) return from;
  const i = list.indexOf(from);
  if (i < 0) return dir > 0 ? (list.find((t) => t > from) ?? list[0]) : ([...list].reverse().find((t) => t < from) ?? list[list.length - 1]);
  return list[(i + dir + list.length) % list.length];
}

const box = (b: { x: number; y: number; w: number; h: number }) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

export function PickLayer({ pick, sel, conf, rover, setRover, onSelect, onConfirm, onClear, onSkip }: {
  pick: BoardPick;
  /** 내 선택(관전이면 서버 미리보기) */
  sel: number | null;
  /** 확정한 칸(그 뒤 칸·단추 disabled) */
  conf: number | null;
  /** 키보드 초점이 머무는 칸(Tab 으로 들어오는 칸) */
  rover: number;
  setRover: (t: number) => void;
  onSelect: (t: number, viaKey: boolean) => void;
  onConfirm: (t: number) => void;
  onClear: () => void;
  /** 축제 "이번엔 안 고를래요"(Board 가 한 번만 보내고 잠근다) */
  onSkip: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const hits = useRef(new Map<number, HTMLButtonElement>());
  const go = useRef<HTMLButtonElement>(null);
  const wantGo = useRef(false);
  const done = conf !== null;
  const festival = pick.kind === 'festival';
  const sign = pickSignBox(festival && pick.mine);
  // 고르기 시작: 초점을 간판 제목에(안내는 aria-live). 관전자는 초점을 옮기지 않는다
  useEffect(() => { if (pick.mine) title.current?.focus({ preventScroll: true }); }, [pick.kind, pick.seat, pick.mine]);
  // Enter 로 고르면 말풍선 단추로 초점(두 번째 Enter = 확정)
  useEffect(() => { if (wantGo.current && sel !== null) { wantGo.current = false; go.current?.focus({ preventScroll: true }); } }, [sel]);
  // Esc = 선택 해제(§18.4): 마우스로 고른 뒤 초점이 칸·단추 밖(body 등)에 있어도. 칸·단추 위 Esc 는 그쪽이 먼저 처리(preventDefault)
  const clearRef = useRef(onClear);
  clearRef.current = onClear;
  useEffect(() => {
    if (!pick.mine) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) clearRef.current(); };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [pick.mine]);

  const pressTile = (t: number, viaKey: boolean) => {
    if (done || !pick.mine) return;
    if (sel === t) { onConfirm(t); return; }
    wantGo.current = viaKey;
    setRover(t);
    onSelect(t, viaKey);
  };
  const onKey = (t: number) => (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      const n = stepTile(pick.eligible, t, dir);
      setRover(n);
      hits.current.get(n)?.focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClear();
    }
    // Enter·Space 는 단추 기본 동작(click, detail 0 = 키보드)으로 pressTile
  };

  // 확정하면 말풍선은 100ms 로 사라진다(§18.1) — 그동안 누를 수 없음
  const bub = sel !== null && pick.mine ? sel : null;
  const name = bub !== null ? BOARD[bub].name : '';
  const geo = bub !== null ? bubbleGeo(bub, name.length > 6 ? PICK_BUBBLE.wMax : PICK_BUBBLE.w) : null;

  return (
    <>
      <HangSign at={{ x: sign.x + sign.w / 2, y: sign.y + sign.h / 2, w: sign.w, h: sign.h }} rope={PICK_SIGN.rope}
        class={`pick-sign${done ? ' is-done' : ''}`}>
        <div class="hang-plate pick-plate" data-kind={pick.kind} data-mine={pick.mine ? '1' : '0'}>
          <div class="pick-row">
            <h2 class="pick-title" ref={title} tabIndex={-1}>{TITLE[pick.kind]}</h2>
            <div class="pick-timer"><Timer deadlineAt={pick.deadline ?? 0} totalMs={pick.total} /></div>
          </div>
          <p class="pick-note" aria-live="polite">{pickNote(pick)}</p>
          {festival && pick.mine && (
            <button type="button" class="pick-skip" disabled={done} onClick={() => !done && onSkip()}>이번엔 안 고를래요</button>
          )}
        </div>
      </HangSign>

      {pick.mine && (
        <div class="pick-hits" role="group" aria-label={`${TITLE[pick.kind]}: 고를 수 있는 칸`}>
          {pick.eligible.map((t) => (
            <button key={t} type="button" class={`pick-hit${sel === t ? ' is-sel' : ''}`} data-tile={t} style={{ ...box(TILES[t].img), '--seat': `var(--seat-${pick.seat + 1})` }}
              ref={(el) => { if (el) hits.current.set(t, el); else hits.current.delete(t); }}
              tabIndex={t === rover ? 0 : -1} aria-label={BOARD[t].name} aria-pressed={sel === t} disabled={done}
              onClick={(e) => pressTile(t, (e as MouseEvent).detail === 0)} onKeyDown={onKey(t)} />
          ))}
        </div>
      )}

      {geo && bub !== null && (
        // 말풍선 전체가 확정 누름 영역(태블릿 0.75 에서 단추 30 < 44 → 말풍선 135×60 전체, DESIGN §18.3)
        <div key={bub} class={`pick-bubble${geo.below ? ' is-below' : ''}${done ? ' is-gone' : ''}`} data-tile={bub} style={{ ...box(geo.box), '--tail-x': `${geo.tailX}px` }}
          aria-hidden={done ? 'true' : undefined} onClick={() => !done && onConfirm(bub)}>
          <b class={`pick-bubble-name${name.length > 6 ? ' is-long' : ''}`}>{name}</b>
          <button type="button" ref={go} class="pick-go" disabled={done}
            onClick={(e) => { e.stopPropagation(); onConfirm(bub); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClear(); hits.current.get(bub)?.focus({ preventScroll: true }); } }}>
            {GO[pick.kind]}
          </button>
        </div>
      )}
    </>
  );
}
