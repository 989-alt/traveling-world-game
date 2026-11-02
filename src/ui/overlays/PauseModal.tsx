// 멈춤 모달(DESIGN §20, PRD §3.7·§8-11·§8-17 U14): 행동 패널과 같은 작은 두루마리(파란 막대 + 금 캡 + 청사진 종이) 560×280.
// 상태 4 — P-H 멈춤(방장) · P-S 멈춤(학생) · C-E 끝내기 확인 · C-L 나가기 확인. 확인 창은 같은 상자에서 막대 글자와 종이만 바꾼다(다시 pop 하지 않음).
// 레이어 z 50(토큰 z.pause), 단색 35% 어둡게(.is-dim, backdrop-filter 없음). 모달 밖 형제는 inert(세로 안내와 같은 방식).
// Esc = 그 창의 되돌리기 단추: P-H [게임 계속하기], P-S 아무 일 없음, C-E·C-L [아니요, 계속할래요].
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { Hourglass } from '../board/Board';
import { Stage } from './parts';

export type PauseKind = 'P-H' | 'P-S' | 'C-E' | 'C-L';

/** 남은 시간 mm:ss */
export const mmss = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

export interface PauseModalProps {
  kind: PauseKind;
  /** P-H 본문의 남은 놀이 시간(멈춘 값) */
  remainingMs?: number;
  /** 요청을 보내고 답을 기다리는 중: 단추 잠금 + aria-busy(두 번 눌림 무시) */
  busy?: boolean;
  /** C-L 을 보드 간판으로 열었다(판은 계속) → 작은 줄 하나 더 */
  fromSign?: boolean;
  onResume?: () => void;
  /** P-H [게임 끝내기] → C-E */
  onAskEnd?: () => void;
  /** P-S [게임 나가기] → C-L */
  onAskLeave?: () => void;
  /** C-E·C-L [아니요, 계속할래요] → 앞 창(간판으로 연 C-L 은 닫힘) */
  onBack?: () => void;
  onEnd?: () => void;
  onLeave?: () => void;
  /** 작은 글자 [나중에 이어 하기]·[내 자리 번호 보기] → 자리 번호 화면 */
  onSeat?: () => void;
}

interface Btn { id: string; label: string; tone: 'primary' | 'secondary' | 'danger'; act?: () => void; first?: boolean }
/** 단추 색. 빨강(danger)은 확인 창(C-E·C-L)의 단추 하나에만(DESIGN §20.4) */
const TONE: Record<Btn['tone'], string> = { primary: 'ov-btn--primary', secondary: 'ov-btn--secondary', danger: 'ov-btn--danger' };

export function PauseModal(p: PauseModalProps) {
  const box = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const lock = useRef(false); // 같은 창에서 두 번 눌림 무시(busy 가 렌더되기 전 사이도)
  useEffect(() => { lock.current = false; }, [p.kind, p.busy]);
  const once = (f?: () => void) => () => { if (!f || p.busy || lock.current) return; lock.current = true; f(); };

  let title: string;
  let body: ComponentChildren;
  let btns: Btn[];
  let link: { label: string; act?: () => void } | null = null;
  let note: string | null = null;
  switch (p.kind) {
    case 'P-H':
      title = '잠깐 멈췄어요';
      body = <>친구들 화면도 함께 멈춰 있어요 · <span class="pm-time" data-k="time-left"><Hourglass />남은 시간 <b>{mmss(p.remainingMs ?? 0)}</b></span></>;
      btns = [
        { id: 'resume', label: '게임 계속하기', tone: 'primary', act: p.onResume, first: true },
        { id: 'ask-end', label: '게임 끝내기', tone: 'secondary', act: p.onAskEnd },
      ];
      link = { label: '나중에 이어 하기', act: p.onSeat };
      break;
    case 'P-S':
      title = '방장이 잠깐 멈췄어요';
      body = '방장이 다시 시작하면 이어서 해요';
      btns = [{ id: 'ask-leave', label: '게임 나가기', tone: 'secondary', act: p.onAskLeave, first: true }];
      link = { label: '내 자리 번호 보기', act: p.onSeat };
      break;
    case 'C-E':
      title = '게임을 끝낼까요?';
      body = '모두 첫 화면으로 돌아가요. 이 판은 저장되지 않아요';
      btns = [
        { id: 'back', label: '아니요, 계속할래요', tone: 'secondary', act: p.onBack, first: true },
        { id: 'end', label: '네, 끝낼래요', tone: 'danger', act: p.onEnd },
      ];
      break;
    case 'C-L':
      title = '게임에서 나갈까요?';
      body = '내 자리는 로봇이 이어서 해요. 나는 첫 화면으로 가요';
      btns = [
        { id: 'back', label: '아니요, 계속할래요', tone: 'secondary', act: p.onBack, first: true },
        { id: 'leave', label: '네, 나갈래요', tone: 'danger', act: p.onLeave },
      ];
      if (p.fromSign) note = '판은 계속 돌아가고 있어요';
      break;
  }

  // 첫 포커스 = 주 단추(확인 창은 "아니요"). 창이 바뀌어도(P → C) 그 창의 첫 단추로
  useLayoutEffect(() => { firstRef.current?.focus({ preventScroll: true }); }, [p.kind]);
  useEsc(p.kind === 'P-H' ? p.onResume : p.kind === 'P-S' ? undefined : p.onBack, box, p.busy);

  return (
    <section ref={box} class="ap pm" role="dialog" aria-modal="true" aria-labelledby="pm-title" data-kind={p.kind} aria-busy={p.busy ? 'true' : undefined}
      onKeyDown={(e) => trapTab(e, box.current)}>
      <header class="ap-bar"><i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" />
        <h2 class="ap-title" id="pm-title">{title}</h2>
      </header>
      <div class="ap-paper pm-paper">
        <p class="ap-line pm-line">{body}</p>
        <div class="ap-btns pm-btns">
          {btns.map((b) => (
            <button type="button" key={`${p.kind}-${b.id}`} ref={b.first ? firstRef : undefined} data-act={b.id}
              class={`ov-btn ${TONE[b.tone]} pm-btn`} disabled={p.busy} aria-busy={p.busy && b.tone !== 'secondary' ? 'true' : undefined}
              onClick={b.id === 'back' || b.id.startsWith('ask') ? b.act : once(b.act)}>{b.label}</button>
          ))}
        </div>
        {link && <button type="button" class="ov-link" data-act="seat" disabled={p.busy} onClick={link.act}>{link.label}</button>}
        {note && <p class="ap-note pm-note">{note}</p>}
      </div>
    </section>
  );
}

/** 모달 레이어(z 50, 단색 35% 어둡게). children 은 PauseModal 또는 자리 번호 화면 */
export function PauseLayer({ children, layerRef }: { children: ComponentChildren; layerRef?: { current: HTMLDivElement | null } }) {
  return <div ref={layerRef} class="pm-host"><Stage dim class="ov-layer--pause">{children}</Stage></div>;
}

/** Esc = 되돌리기 단추. 다른 창(규칙 등)이 Esc 를 먼저 쓰지 않게 캡처 단계에서 받는다 */
function useEsc(f: (() => void) | undefined, box: { current: HTMLElement | null }, busy?: boolean) {
  const cur = useRef(f);
  cur.current = busy ? undefined : f;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !box.current?.isConnected) return;
      // 모달이 inert(세로 안내 아래)면 아무것도 하지 않는다
      if (box.current.closest('[inert]')) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // 컷씬의 Esc(건너뛰기) 등 판 쪽 단축키가 함께 돌지 않게
      cur.current?.();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, []);
}

/** Tab 순환: 창 안 단추끼리만 돈다(밖은 inert 라 어차피 못 가지만 브라우저 주소창으로 새지 않게) */
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return;
  const els = [...root.querySelectorAll<HTMLElement>('button:not([disabled])')];
  if (!els.length) return;
  const i = els.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
  e.preventDefault();
  els[next].focus();
}

const MARK = 'data-pause-inert';
const ROTATE_MARK = 'data-rotate-inert';

/** 모달이 떠 있는 동안 같은 부모의 다른 형제를 전부 inert(나중에 붙는 것도). 세로 안내(.board-rotate)는 건드리지 않는다 —
 *  세로 안내가 떠 있으면 그쪽이 모달까지 inert 로 만든다(DESIGN §20.1). 내리면서 세로 안내가 떠 있으면 표시를 그쪽 것으로 넘긴다 */
export function useInertSiblings(on: boolean, ref: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!on || !el || !parent) return;
    const mark = () => {
      for (const c of parent.children) {
        if (c === el || c.classList.contains('board-rotate') || c.hasAttribute('inert')) continue;
        c.setAttribute('inert', '');
        c.setAttribute(MARK, '');
      }
    };
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(parent, { childList: true });
    return () => {
      mo.disconnect();
      const rotate = !!parent.querySelector(':scope > .board-rotate');
      for (const c of parent.querySelectorAll(`:scope > [${MARK}]`)) {
        c.removeAttribute(MARK);
        if (rotate) c.setAttribute(ROTATE_MARK, '');
        else c.removeAttribute('inert');
      }
    };
  }, [on]);
}
