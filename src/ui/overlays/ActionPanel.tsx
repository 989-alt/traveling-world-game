// 행동 패널(DESIGN §4.2 작은 두루마리): 사기·건설·통행료·인수. 문구는 PRD §3.2 꼴 그대로.
// 도착한 사람만 누르고, 나머지는 같은 패널을 읽기만 한다. 방패 팝업은 땅 주인에게만.
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { STEP_MS } from '../../shared/economy';
import { josa } from '../../state/nick';
import { Timer } from '../missions/Timer';
import { useAutoFocus, won } from './parts';

export const BUILDING = ['', '집', '시장', '호텔', '랜드마크'];

/** 정답 할인 문구(PRD §3.2): "땅값 400 → 정답 할인 200" / "땅값 400 · 다음엔 반값에 도전" */
export const priceLine = (what: string, full: number, paid: number, correct: boolean) =>
  correct && paid < full ? `${what} ${won(full)} → 정답 할인 ${won(paid)}` : `${what} ${won(full)} · 다음엔 반값에 도전`;

export interface ActionChoice { label: string; act: () => void; primary?: boolean; disabled?: boolean; id: string }

export interface ScrollPanelProps {
  title: string;
  lines: ComponentChildren[];
  choices: ActionChoice[];
  mine: boolean;
  arriverName: string;
  deadline: number | null;
  totalMs?: number;
  note?: string;
  kind: string;
}

/** 작은 두루마리 하나. 한 번 누르면 모든 버튼이 잠긴다 */
export function ScrollPanel(p: ScrollPanelProps) {
  const [done, setDone] = useState(false);
  const sent = useRef(false);
  const primary = useAutoFocus<HTMLButtonElement>(p.mine);
  const go = (c: ActionChoice) => {
    if (sent.current || !p.mine || c.disabled) return;
    sent.current = true;
    setDone(true);
    c.act();
  };
  return (
    <section class="ap" role="dialog" aria-label={p.title} data-kind={p.kind} data-role={p.mine ? 'player' : 'spectator'}>
      <header class="ap-bar"><i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" />
        <h2 class="ap-title">{p.title}</h2>
        {p.deadline !== null && <div class="ap-timer"><Timer deadlineAt={p.deadline} totalMs={p.totalMs ?? STEP_MS.action} /></div>}
      </header>
      <div class="ap-paper">
        {p.lines.map((l, i) => <p key={i} class="ap-line">{l}</p>)}
        <div class="ap-btns">
          {p.choices.map((c) => (
            <button type="button" key={c.id} ref={c === (p.choices.find((x) => x.primary && !x.disabled) ?? p.choices[0]) ? primary : undefined} data-act={c.id} class={`ov-btn ${c.primary ? 'ov-btn--primary' : 'ov-btn--secondary'}`}
              disabled={!p.mine || done || c.disabled} onClick={() => go(c)}>{c.label}</button>
          ))}
        </div>
        {p.note && <p class="ap-note">{p.note}</p>}
        {!p.mine && <p class="ap-note" role="status">{josa(p.arriverName, '이', '가')} 고르고 있어요</p>}
      </div>
    </section>
  );
}

/** 통행료 결과 알림. 오답이면 사들이기(인수) 버튼이 꺼진 채로 '정답을 맞혀야 사들일 수 있어요'. 잠깐 떴다 사라진다.
 *  호텔·랜드마크(3단계 이상, PRD §3.2 2026-10-29 U5)가 선 땅은 인수 버튼이 아예 없다: 정답 'hotel'·오답 'hotelWrong' */
export type NoTakeover = 'wrong' | 'hotel' | 'hotelWrong' | 'tourist' | 'coin';
const WHY: Record<NoTakeover, string> = {
  wrong: '',
  hotel: '',
  hotelWrong: '',
  tourist: '관광지는 사들일 수 없어요',
  coin: '코인이 모자라서 이번엔 사들일 수 없어요',
};

export function TollNotice({ payerName, ownerName, full, paid, why, tileName }: {
  payerName: string; ownerName: string; full: number; paid: number; why: NoTakeover; tileName: string;
}) {
  const correct = why !== 'wrong' && why !== 'hotelWrong';
  const hotel = why === 'hotel' || why === 'hotelWrong';
  const chip = hotel
    ? (correct && paid < full ? `통행료 ${won(full)} → 정답 할인 ${won(paid)} · 호텔부터는 사들일 수 없어요` : `통행료 ${won(full)}`)
    : correct ? (paid < full ? `통행료 ${won(full)} → 정답 할인 ${won(paid)}` : `통행료 ${won(full)}`) : `통행료 ${won(full)} · 정답을 맞혀야 사들일 수 있어요`;
  return (
    <section class="ap ap--notice" role="status" data-kind="toll-notice" aria-label="통행료">
      <header class="ap-bar"><i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" /><h2 class="ap-title">{tileName} · {josa(ownerName, '이', '가')} 주인이에요</h2></header>
      <div class="ap-paper">
        <p class="ap-line">
          <span class={`ov-chip ${correct && paid < full ? 'ov-chip--discount' : 'ov-chip--toll'}`}>
            {chip}
          </span>
        </p>
        {!hotel && (
          <div class="ap-btns">
            <button type="button" class="ov-btn ov-btn--primary" data-act="takeover" disabled>땅 사들이기</button>
          </div>
        )}
        <p class="ap-note">{josa(payerName, '이', '가')} 통행료 {won(paid)}코인을 냈어요.{WHY[why] && ` ${WHY[why]}`}</p>
      </div>
    </section>
  );
}
