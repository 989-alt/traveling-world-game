// 두루마리 패널(DESIGN §15.2 팝업 2a·2b, 결과 화면 오른쪽 패널). 위·아래 파란 광택 막대 + 금 캡, 가운데 크림 종이.
// 돌아가기는 왼쪽 위 작은 나무 간판(UI-sign-small) 화살표.
import type { ComponentChildren } from 'preact';
import { assetUrl } from '../../assets/manifest';
import { DialogLayer, useDialog } from './PlankDialog';
import '../../styles/overlays.css';
import '../../styles/popups.css';

/** CSS 에서 쓰는 그림 주소(매니페스트 키 → url(...)). 없으면 none 이라 CSS 대체색이 보인다 */
export const cssUrl = (k: string) => { const u = assetUrl(k); return u ? `url("${u}")` : 'none'; };

export function ScrollBar({ bottom }: { bottom?: boolean }) {
  return (
    <div class={`sp-bar${bottom ? ' sp-bar--bottom' : ''}`} aria-hidden="true">
      <i class="sp-cap sp-cap--l" /><i class="sp-cap sp-cap--r" />
    </div>
  );
}

/** 작은 나무 간판 버튼(40×40, UI-sign-small). 그림이 안 오면 CSS 나무색으로 */
export function SignButton({ label, onClick, children, class: cls, pressed }: { label: string; onClick: () => void; children: ComponentChildren; class?: string; pressed?: boolean }) {
  return (
    <button type="button" class={`sign-btn${cls ? ` ${cls}` : ''}`} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}
      style={{ '--sign': cssUrl('ui.sign') }}>
      <span class="sign-btn-face" aria-hidden="true">{children}</span>
    </button>
  );
}

export const ArrowLeft = () => (
  <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
);

/** 팝업 2a·2b: 두루마리 대화상자 */
export function ScrollDialog({ label, onBack, children }: { label: string; onBack: () => void; children: ComponentChildren }) {
  const ref = useDialog<HTMLElement>(onBack);
  return (
    <DialogLayer>
      <section ref={ref} class="sp sp--pop" role="dialog" aria-modal="true" aria-label={label}>
        <ScrollBar />
        <div class="sp-paper">
          <SignButton label="뒤로" class="sp-back" onClick={onBack}><ArrowLeft /></SignButton>
          {children}
        </div>
        <ScrollBar bottom />
      </section>
    </DialogLayer>
  );
}
