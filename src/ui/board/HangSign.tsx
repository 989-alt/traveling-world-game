// 매달린 나무 간판(DESIGN §16.4: 규칙 · 남은 시간 · 멈춤). UI-sign-small 그림을 9-slice(border-image)로 늘리고,
// 그림 속 밧줄 고리는 잘라 낸 뒤 밧줄 2 가닥을 CSS 로 단다. 자리·크기는 HUD 표(geometry)에서 온다(스테이지 px, 중심 기준).
import type { ComponentChildren } from 'preact';
import { assetUrl } from '../../assets/manifest';
import { HUD } from './geometry';
import '../../styles/hang-sign.css';

export interface HangBox { x: number; y: number; w: number; h: number }

/** rope: 밧줄 길이(기본 HUD.rope 42 — 규칙·남은 시간·멈춤). 고르기 간판은 33(§18.2) */
export function HangSign({ at, class: cls, rope = HUD.rope, children }: { at: HangBox; class?: string; rope?: number; children: ComponentChildren }) {
  const url = assetUrl('ui.sign');
  return (
    <div class={`hang${cls ? ` ${cls}` : ''}`}
      style={{ left: `${at.x - at.w / 2}px`, top: `${at.y - at.h / 2}px`, width: `${at.w}px`, height: `${at.h}px`, '--rope': `${rope}px`, '--sign-img': url ? `url("${url}")` : 'none' }}>
      <span class="hang-rope hang-rope--l" aria-hidden="true" />
      <span class="hang-rope hang-rope--r" aria-hidden="true" />
      {children}
    </div>
  );
}
