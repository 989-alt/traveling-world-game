// 오버레이 공용 조각: 1366×768 스테이지 맞춤, 대륙 칩, 남은 시간 막대, 별 반짝이.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Pic } from '../../assets/AssetImg';
import { STAGE } from '../board/geometry';
import { fitScale } from '../device/stage';
import { useNow } from '../missions/Timer';
import '../../styles/overlays.css';

/** 보드와 같은 배율로 1366×768 판을 화면 가운데에 둔다(px 값을 DESIGN 그대로 쓰려고) */
export function Stage({ children, dim, class: cls, label }: { children: ComponentChildren; dim?: boolean; class?: string; label?: string }) {
  const [scale, setScale] = useState(1);
  const [padY, setPadY] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      const k = fitScale();
      setScale(k);
      setPadY(Math.max(0, (innerHeight / k - STAGE.h) / 2)); // 스테이지 위·아래 남는 높이(스테이지 px): 화면 아래까지 잇는 그림(SidePeek)용
    };
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return (
    <div class={`ov-layer${dim ? ' is-dim' : ''}${cls ? ` ${cls}` : ''}`} aria-label={label}>
      <div class="ov-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})`, '--stage-pad-y': `${padY}px` }}>{children}</div>
    </div>
  );
}

export const CONTINENT_NAME: Record<string, string> = {
  asia: '아시아', europe: '유럽', africa: '아프리카', namerica: '북아메리카', samerica: '남아메리카', oceania: '오세아니아',
};

export function ContinentChip({ continent }: { continent?: string }) {
  if (!continent) return null;
  return <span class={`ov-chip ov-chip--${continent}`}>{CONTINENT_NAME[continent]}</span>;
}

/** 줄어드는 막대(해설 7초·문화 카드 5초 등). transform 하나로 줄인다.
 *  줄기만 한다(DESIGN §18.5, PRD §4.3 U10): 표시 값 = min(직전 표시 값, 남은 시간). 서버가 마감을 늘려도(해설 shown 대기) 다시 차지 않고,
 *  0 에 멈춘 채 마감이 아직 남았으면 막대 아래 "잠깐만요" 한 줄 */
export function Countdown({ deadline, total, label }: { deadline: number | null; total: number; label?: string }) {
  const now = useNow(100);
  const raw = deadline === null ? 0 : Math.max(0, deadline - now);
  // 직전 표시 값에서 실제로 흐른 시간만큼 줄인 값과 남은 시간 중 작은 쪽: 마감이 늘어도(연장·시계 차 재측정) 막대가 멈추거나 다시 차지 않는다
  const shown = useRef<{ total: number; v: number; at: number; zeroAt: number | null } | null>(null);
  if (!shown.current || shown.current.total !== total) shown.current = { total, v: Infinity, at: now, zeroAt: null };
  const left = Math.max(0, Math.min(shown.current.v - (now - shown.current.at), raw));
  shown.current.v = left;
  shown.current.at = now;
  if (left <= 0 && shown.current.zeroAt === null) shown.current.zeroAt = now;
  // 0 인데 마감이 늘었거나(방송됨), 0 이 된 지 300ms 가 지나도 단계가 그대로면(서버가 shown 을 기다리며 마감을 늘림 — 방송 없이도) "잠깐만요"
  const wait = left <= 0 && (raw > 0 || now - (shown.current.zeroAt ?? now) >= 300);
  return (
    <div class={`ov-countbox${wait ? ' is-wait' : ''}`}>
      <div class="ov-count" role="timer" aria-label={label ? `${label} ${Math.ceil(left / 1000)}초` : undefined}
        data-left={Math.ceil(left / 1000)} data-ms={Math.round(left)}>
        <span class="ov-count-bar" style={{ transform: `scaleX(${Math.min(1, left / total)})` }} />
      </div>
      {wait && <span class="ov-count-wait" role="status">잠깐만요</span>}
    </div>
  );
}

export function Sparkles() {
  return (
    <span class="ov-sparkles" aria-hidden="true">
      <i style={{ left: '-34px', top: '14%', '--k': 1.3 }} />
      <i style={{ left: '-20px', top: '60%', '--k': 0.7, '--d': '0.6s' }} />
      <i style={{ left: '30%', top: '-24px', '--k': 0.6, '--d': '1.1s' }} />
      <i style={{ right: '-36px', top: '26%', '--k': 1.2, '--d': '0.3s' }} />
      <i style={{ right: '-16px', top: '70%', '--k': 0.8, '--d': '0.9s' }} />
      <i style={{ right: '22%', bottom: '-22px', '--k': 0.6, '--d': '1.4s' }} />
    </span>
  );
}

export const won = (n: number) => n.toLocaleString('ko-KR');

/** 오버레이가 뜨면 주 조작(첫 버튼 등)에 초점을 둔다. when=false 면 건드리지 않는다 */
export function useAutoFocus<T extends HTMLElement>(when = true) {
  const ref = useRef<T>(null);
  useEffect(() => { if (when) ref.current?.focus({ preventScroll: true }); }, [when]);
  return ref;
}

/** Enter·Space·Escape 로 누르기(클릭 가능한 구역의 키보드 길) */
export const keyActivate = (f: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); f(); }
};

/** 문항·해설 왼쪽의 큰 캐릭터(v3 03, R2 D6). think = 문항 중 P13(머리 긁기)·P10(두 손 모음)을 4초마다 80ms 크로스페이드로 교대
 *  (모션 줄이기면 P13 고정). cheer = 정답 뒤 P12, stuck = 오답·시간 끝 뒤 P13 유지. 스테이지 왼쪽 아래에 허리까지 보인다 */
const SWAP_MS = 4000;
export function SidePeek({ charId, pose }: { charId: number; pose: 'think' | 'cheer' | 'stuck' }) {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    if (pose !== 'think' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const h = setInterval(() => setAlt((a) => !a), SWAP_MS);
    return () => clearInterval(h);
  }, [pose]);
  const shown = pose === 'cheer' ? 'p12' : pose === 'think' && alt ? 'p10' : 'p13';
  return (
    <div class="qs-peek" data-pose={shown} aria-hidden="true">
      {pose === 'cheer'
        ? <Pic k={`char.${charId}.p12.big`} class="qs-peek-img is-on" eager />
        : <>
          <Pic k={`char.${charId}.p13.big`} class={`qs-peek-img${shown === 'p13' ? ' is-on' : ''}`} eager />
          {pose === 'think' && <Pic k={`char.${charId}.p10.big`} class={`qs-peek-img${shown === 'p10' ? ' is-on' : ''}`} eager />}
        </>}
    </div>
  );
}
