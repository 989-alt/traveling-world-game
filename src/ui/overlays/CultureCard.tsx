// 문화 카드(PRD §3.4, v3 02): 크림 테 카드, 큰 그림, 아래 캡션. 맛보기 뱃지는 있을 때만 자리를 차지한다.
// 첫 방문은 3초 동안 탭을 받지 않는다(서버도 거부). 그 뒤 방문은 도착한 사람이 탭하면 넘어간다(상한 3초는 서버).
import { useEffect, useRef } from 'preact/hooks';
import { AssetImg, Pic } from '../../assets/AssetImg';
import { hasAsset } from '../../assets/manifest';
import type { CultureCard as Card } from '../../shared/content-types';
import { STEP_MS } from '../../shared/economy';
import { josa } from '../../state/nick';
import { ContinentChip, Countdown, keyActivate, Sparkles, useAutoFocus } from './parts';

export interface CultureCardProps {
  card: Card;
  tile: number;
  firstVisit: boolean;
  /** 도착한 사람의 에셋 캐릭터 번호(빼꼼 P19) */
  charId: number;
  arriverName: string;
  mine: boolean;
  deadline: number | null;
  onNext: () => void;
}

const BADGE_KIND = { food: '맛보기 음식', festival: '맛보기 축제', play: '맛보기 놀이' } as const;

export function CultureCard(p: CultureCardProps) {
  const sent = useRef(false);
  const canSkip = p.mine && !p.firstVisit;
  const tap = () => {
    if (!canSkip || sent.current) return; // 첫 방문 3초는 탭 무시
    sent.current = true;
    p.onNext();
  };
  const self = useAutoFocus<HTMLElement>(canSkip);
  // 다시 온 나라: Enter·Escape 로도 넘긴다(카드에 초점이 없어도)
  useEffect(() => {
    if (!canSkip) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') tap(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [canSkip]);
  const c = p.card;
  return (
    <div class="cc-wrap">
    {/* 빼꼼(R2 D7): P19 반신을 좌우로 뒤집어 손이 카드 왼쪽 위 테를 잡게. 봇은 CH7-P19 */}
    <Pic k={`char.${p.charId}.p19`} class="cc-peek" eager />
    <section class="cc" data-first={p.firstVisit ? '1' : '0'} data-badge={c.badge ? '1' : '0'} aria-label={canSkip ? `${c.name} 문화 카드, 누르면 넘어가요` : `${c.name} 문화 카드`} onClick={tap}
      ref={self} role={canSkip ? 'button' : 'dialog'} tabIndex={canSkip ? 0 : -1} onKeyDown={canSkip ? keyActivate(tap) : undefined}>
      <Sparkles />
      <div class="cc-pic">
        <AssetImg k={`culture.${p.tile}`} class="cc-img" alt={c.name} />
      </div>
      <div class="cc-cap">
        <div class="cc-head">
          <h2 class="cc-name">{c.name}</h2>
          <ContinentChip continent={c.continent} />
          {c.note && <span class="cc-note">{c.note}</span>}
        </div>
        <p class="cc-intro">{c.intro}</p>
        {c.badge && (
          <div class="cc-badge" data-kind={c.badge.kind}>
            {hasAsset(`badge.${p.tile}`) && <AssetImg k={`badge.${p.tile}`} class="cc-badge-img" alt="" />}
            <span class="cc-badge-text"><small>{BADGE_KIND[c.badge.kind]}</small>{c.badge.name}</span>
          </div>
        )}
      </div>
      <footer class="cc-foot">
        <span class="cc-hint">{p.firstVisit ? '처음 와 본 곳이에요. 천천히 둘러봐요' : canSkip ? '다 봤으면 카드를 눌러요' : `${josa(p.arriverName, '이', '가')} 다시 찾아왔어요`}</span>
        <Countdown deadline={p.deadline} total={p.firstVisit ? STEP_MS.culture : STEP_MS.cultureRevisit} />
      </footer>
    </section>
    </div>
  );
}
