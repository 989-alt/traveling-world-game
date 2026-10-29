// 칸 고르기(세계여행·내 땅으로·세계 축제)와 무인도 탈출, 방패 팝업. 전부 버튼으로만 고른다.
import { useRef, useState } from 'preact/hooks';
import { BOARD, TRAVEL_TILE } from '../../shared/board';
import { ISLAND_ESCAPE_COST, STEP_MS } from '../../shared/economy';
import { josa } from '../../state/nick';
import { Timer } from '../missions/Timer';
import { useAutoFocus, won } from './parts';

export function TilePicker({ title, note, tiles, deadline, totalMs, onPick, skipLabel, onSkip }: {
  title: string; note: string; tiles: number[]; deadline: number | null; totalMs: number;
  onPick: (tile: number) => void; skipLabel?: string; onSkip?: () => void;
}) {
  const [done, setDone] = useState(false);
  const first = useAutoFocus<HTMLButtonElement>();
  const once = (f: () => void) => { if (done) return; setDone(true); f(); };
  return (
    <section class="tp" role="dialog" aria-label={title}>
      <header class="ap-bar"><i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" />
        <h2 class="ap-title">{title}</h2>
        {deadline !== null && <div class="ap-timer"><Timer deadlineAt={deadline} totalMs={totalMs} /></div>}
      </header>
      <div class="tp-paper">
        <p class="ap-line">{note}</p>
        <div class="tp-grid">
          {tiles.map((t) => (
            <button type="button" key={t} ref={t === tiles[0] ? first : undefined} class={`tp-tile tp-tile--${BOARD[t].continent ?? BOARD[t].kind}`} data-tile={t} disabled={done} onClick={() => once(() => onPick(t))}>
              {BOARD[t].name}
            </button>
          ))}
        </div>
        {onSkip && <button type="button" class="ov-btn ov-btn--secondary" disabled={done} onClick={() => once(onSkip)}>{skipLabel}</button>}
      </div>
    </section>
  );
}

export const travelTiles = () => BOARD.map((t) => t.index).filter((i) => i !== TRAVEL_TILE);

export function IslandPanel({ turnsLeft, coin, hasCard, onEscape }: {
  turnsLeft: number; coin: number; hasCard: boolean; onEscape: (m: 'coin' | 'item') => void;
}) {
  const sent = useRef(false);
  const [done, setDone] = useState(false);
  const primary = useAutoFocus<HTMLButtonElement>();
  const go = (m: 'coin' | 'item') => { if (sent.current) return; sent.current = true; setDone(true); onEscape(m); };
  return (
    <section class="ap ap--island" role="dialog" aria-label="무인도" data-kind="island">
      <header class="ap-bar"><i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" /><h2 class="ap-title">무인도에서 쉬는 중이에요</h2></header>
      <div class="ap-paper">
        <p class="ap-line">앞으로 {turnsLeft}번 더 쉬어요. 주사위 두 개가 같은 눈이면 바로 나가요.</p>
        <div class="ap-btns">
          <button type="button" ref={primary} class="ov-btn ov-btn--primary" data-act="escape-coin" disabled={done || coin < ISLAND_ESCAPE_COST} onClick={() => go('coin')}>
            {won(ISLAND_ESCAPE_COST)}코인 내고 나가기
          </button>
          {hasCard && <button type="button" class="ov-btn ov-btn--secondary" data-act="escape-item" disabled={done} onClick={() => go('item')}>탈출 카드 쓰기</button>}
        </div>
      </div>
    </section>
  );
}

/** 땅 주인에게만: 5초 안에 고르지 않으면 서버가 방패로 막는다 */
export function ShieldPopup({ attacker, tileName, deadline, onAnswer }: {
  attacker: string; tileName: string; deadline: number | null; onAnswer: (use: boolean) => void;
}) {
  const [done, setDone] = useState(false);
  const primary = useAutoFocus<HTMLButtonElement>();
  const go = (v: boolean) => { if (done) return; setDone(true); onAnswer(v); };
  return (
    <section class="ap ap--shield" role="alertdialog" aria-label="방패" data-kind="shield">
      <header class="ap-bar"><i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" />
        <h2 class="ap-title">방패를 쓸까요?</h2>
        <div class="ap-timer"><Timer deadlineAt={deadline ?? 0} totalMs={STEP_MS.shield} /></div>
      </header>
      <div class="ap-paper">
        <p class="ap-line">{josa(attacker, '이', '가')} 내 땅 {josa(tileName, '을', '를')} 사들이려고 해요.</p>
        <div class="ap-btns">
          <button type="button" ref={primary} class="ov-btn ov-btn--primary" data-act="shield-use" disabled={done} onClick={() => go(true)}>방패로 막기</button>
          <button type="button" class="ov-btn ov-btn--secondary" data-act="shield-skip" disabled={done} onClick={() => go(false)}>넘겨주기</button>
        </div>
        <p class="ap-note">고르지 않으면 5초 뒤에 방패가 알아서 막아요.</p>
      </div>
    </section>
  );
}
