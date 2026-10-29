// 광장 귀퉁이 플레이어 패널 (DESIGN §4.2·§16.9.2 U5): 초상 없는 200×48 금테 알약 — 왼쪽 자리색 띠 30%(닉네임 15px, 두 낱말이면 두 줄 + 봇 캡션),
// 오른쪽 크림 70%(코인 아이콘 16 + 숫자 22px). 초상은 빼고 바로 옆 돌 단에 전신 캐릭터가 선다.
// 코인은 롤링 숫자(바뀐 자리만 릴), 위에는 증감 팝(CoinFx). 읽어 주는 값(aria-label)은 늘 최종 코인.
import { Pic } from '../../assets/AssetImg';
import type { Seat } from '../../shared/types';
import { CoinCounter, CoinPops, type ActivePop } from './CoinFx';

export interface PanelProps {
  seat: Seat;
  name: string;
  isBot: boolean;
  coin: number;
  /** 화면에 보이는 숫자(연출 중엔 아직 이전 값일 수 있음). 없으면 coin */
  shownCoin?: number;
  /** 숫자를 굴린다(아니면 바로 바뀜) */
  rolling?: boolean;
  pops?: ActivePop[];
  /** 코인을 내는 중: 코인 아이콘이 살짝 흔들린다 */
  shake?: boolean;
  turn: boolean;
  me: boolean;
  out: boolean;
  /** 패널 중심(스테이지 px). 없으면 CSS 귀퉁이 자리 */
  at?: { x: number; y: number };
  /** 줌 중 이동자가 패널 뒤에 들어옴 → 패널을 옅게(자리·크기는 그대로) */
  veiled?: boolean;
}

const CORNER = ['tl', 'tr', 'bl', 'br'] as const;

export function PlayerPanel(p: PanelProps) {
  return (
    <section
      class={`panel panel--${CORNER[p.seat]}${p.turn ? ' is-turn' : ''}${p.out ? ' is-out' : ''}${p.veiled ? ' is-veiled' : ''}`}
      style={{
        '--seat': `var(--seat-${p.seat + 1})`, '--seat-text': `var(--seat-${p.seat + 1}-text)`, '--seat-on': `var(--seat-${p.seat + 1}-on)`,
        ...(p.at ? { left: `${p.at.x}px`, top: `${p.at.y}px` } : {}),
      }}
      aria-label={`${p.name}${p.isBot ? '(봇)' : ''} 코인 ${p.coin.toLocaleString('ko-KR')}${p.turn ? ', 지금 차례' : ''}`}
      data-seat={p.seat}
    >
      <span class="panel-pill">
        <span class="panel-band">
          <span class="panel-name">{p.name.split(' ').map((w, i) => <span key={i} class="panel-name-w">{w}</span>)}</span>
        </span>
        <span class="panel-coin">
          <span class={`panel-coin-ico${p.shake ? ' is-shake' : ''}`}>
            <Pic k="ui.coin" class="panel-coin-img" fallback={<i class="panel-coin-img panel-coin-fallback" />} />
          </span>
          <CoinCounter value={p.shownCoin ?? p.coin} animate={!!p.rolling} />
        </span>
      </span>
      {p.isBot && <span class="panel-bot">봇</span>}
      {p.me && <span class="panel-me">나</span>}
      <CoinPops pops={p.pops ?? []} />
    </section>
  );
}
