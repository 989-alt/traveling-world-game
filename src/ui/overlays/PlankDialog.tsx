// 첫 화면 팝업 틀(DESIGN §15.2, R2 C2·C3·C4). 나무판(UI-plank-panel 9-slice)·두루마리(ScrollPanel) 둘 다 이 레이어 위에 뜬다.
// 접근성은 shadcn Dialog 구조: role=dialog + aria-modal, 열리면 첫 조작에 초점, Tab 은 안에서만 돈다, Esc = 닫기.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { assetUrl } from '../../assets/manifest';
import { fitScale } from '../device/stage';
import '../../styles/popups.css';

/** 화면 설계 판(DESIGN px 기준) — 보드 기하(T-D)와 따로 둔다 */
export const STAGE = { w: 1366, h: 768 } as const;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** 1366×768 판을 화면에 맞춘 배율(contain) */
export function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(fitScale());
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return scale;
}

/** 대화상자 안에서만 Tab 이 돌고, Esc 로 닫는다. 열릴 때 첫 조작(또는 [data-autofocus])에 초점 */
export function useDialog<T extends HTMLElement>(onEsc: () => void) {
  const ref = useRef<T>(null);
  const esc = useRef(onEsc);
  esc.current = onEsc;
  // 레이아웃 효과: 그려지자마자 초점(바로 누른 Esc·Tab 도 대화상자 안에서 받는다)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); esc.current(); return; }
      if (e.key !== 'Tab') return;
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!all.length) return;
      const i = all.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); all[all.length - 1].focus(); }
      else if (!e.shiftKey && i === all.length - 1) { e.preventDefault(); all[0].focus(); }
    };
    el.addEventListener('keydown', key);
    return () => { el.removeEventListener('keydown', key); if (prev?.isConnected) prev.focus({ preventScroll: true }); };
  }, []);
  return ref;
}

/** 뒤를 검정 35% 로 덮고 1366×768 판 가운데에 내용을 둔다 */
export function DialogLayer({ children, onDim }: { children: ComponentChildren; onDim?: () => void }) {
  const scale = useStageScale();
  return (
    <div class="pp-layer" onPointerDown={(e) => { if (e.target === e.currentTarget) onDim?.(); }}>
      <div class="pp-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div>
    </div>
  );
}

/** 팝업 1: 밧줄에 매달린 나무판이 위에서 떨어진다(350ms bounce). 제목은 크림 종이 띠 */
export function PlankDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useDialog<HTMLElement>(onClose);
  const plankUrl = assetUrl('ui.plank');
  return (
    <DialogLayer onDim={onClose}>
      <section ref={ref} class="plank" role="dialog" aria-modal="true" aria-labelledby="plank-title"
        style={{ '--plank': plankUrl ? `url("${plankUrl}")` : 'none' }}>
        <h2 id="plank-title" class="plank-title">{title}</h2>
        {children}
      </section>
    </DialogLayer>
  );
}

/** 나무 버튼(280×120, 나무결 + 못 4) */
export function PlankButton({ icon, label, onClick, act }: { icon: string; label: string; onClick: () => void; act?: string }) {
  return (
    <button type="button" class="plank-btn" data-act={act} onClick={onClick}>
      <span class="plank-btn-icon" aria-hidden="true">{icon}</span>{label}
    </button>
  );
}
