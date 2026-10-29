// 멈춤(PRD §8-11) → 이어 하기(§8-12), 끝 = 최종 결과(§8-14, T09 Results). 2026-10-28 U1: 중간 결과(§8-13)는 없어졌고
// 그 순위 한 줄은 멈춤 화면 아래로 왔다. 멈춤 화면은 남은 시간 칩 + 자리 PIN 4자리(화면 폭 20% 이상) + 순위 한 줄 — 사진으로 찍어 두게 한다.
import { useState } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';
import { assetsOf } from '../../engine/pay';
import { BOARD, countryNameOf } from '../../shared/board';
import type { GameState, Seat } from '../../shared/types';
import type { GameClient } from '../../state/client';
import { cardIn } from '../../state/content';
import type { ClientState } from '../../state/store';
import { ranking, seatViews } from '../../state/view';
import { BUILDING } from '../overlays/ActionPanel';
import { won } from '../overlays/parts';
import { Hourglass } from '../board/Board';
import { metaWith } from '../results/meta';
import { Results } from '../results/Results';
import '../../styles/screens.css';
import { NOTICE_TEXT, type NoticeKind } from './notice';

export function Paused({ client, s }: { client: GameClient; s: ClientState }) {
  // 이번 접속에서 막 멈췄으면(PIN 이 왔으면) 멈춤 화면, 나중에 같은 코드로 다시 들어왔으면 바로 이어 하기 화면
  const [stage, setStage] = useState<'save' | 'resume'>('save');
  if (s.pins && stage === 'save') return <SaveScreen s={s} onDone={() => setStage('resume')} />;
  return <ResumeScreen client={client} s={s} />;
}

/** 남은 시간 mm:ss */
export const mmss = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

/** 결과 화면에 넘길 자리 정보(seatViews 그대로) */
const resultSeats = (s: ClientState) => seatViews(s.room!).map(({ seat, charId, name, isBot }) => ({ seat, charId, name, isBot }));

/** 지금 순위 한 줄: 얼굴 4 + 재산(옛 중간 결과 흡수) */
function RankLine({ s }: { s: ClientState }) {
  const g = s.room!.game!;
  const seats = seatViews(s.room!);
  const assets = (i: number) => assetsOf(g as unknown as GameState, i);
  return (
    <ol class="pause-rank" aria-label="지금 순위">
      {ranking(g, assets).map((seat, n) => (
        <li key={seat} class="pause-rank-item" data-seat={seat} style={{ '--seat': `var(--seat-${seat + 1})` }}>
          <span class="pause-rank-no">{n + 1}</span>
          <AssetImg k={`char.${seats[seat].charId}.f00`} class="pause-rank-face" alt={seats[seat].name} />
          <span class="pause-rank-coin">{won(assets(seat))}</span>
        </li>
      ))}
    </ol>
  );
}

/** 남은 시간 칩(모래시계 + mm:ss) */
function TimeLeft({ ms }: { ms: number }) {
  return <p class="pause-time" data-k="time-left" aria-label={`남은 시간 ${mmss(ms)}`}><Hourglass /> 남은 시간 <b>{mmss(ms)}</b></p>;
}

function SaveScreen({ s, onDone }: { s: ClientState; onDone: () => void }) {
  const seats = seatViews(s.room!);
  const mine = s.pins!.find((p) => p.seat === s.seat); // 자기 자리 PIN 하나만 보인다(PRD §8-11 QA8)
  return (
    <main class="sc sc--save">
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <section class="save" aria-label="멈춤">
        <TimeLeft ms={s.room!.game!.clock.remainingMs} />
        <h1 class="save-title">잠깐 쉬어요. 다음에 이어서 해요</h1>
        <p class="save-lead">이 화면을 사진으로 찍어 두세요. 다른 기기로 들어올 때 방 코드와 아래 번호가 필요해요.</p>
        {mine && (
          <div class="save-card" style={{ '--seat': `var(--seat-${mine.seat + 1})` }}>
            {s.code && <span class="save-code" data-k="room-code" aria-label={`방 코드 ${s.code.split('').join(' ')}`}>방 코드 <b>{s.code}</b></span>}
            <span class="save-seat">{mine.seat + 1}번 자리 · {seats[mine.seat].name}</span>
            <b class="save-pin" data-pin={mine.pin} aria-label={`비밀번호 ${mine.pin.split('').join(' ')}`}>{mine.pin}</b>
          </div>
        )}
        <RankLine s={s} />
        <button type="button" class="ov-btn ov-btn--primary" data-act="saved" onClick={onDone}>사진 찍었어요</button>
      </section>
    </main>
  );
}

function ResumeScreen({ client, s }: { client: GameClient; s: ClientState }) {
  const room = s.room!;
  const g = room.game!;
  const seats = seatViews(room);
  const assets = (i: number) => assetsOf(g as unknown as GameState, i);
  const order = ranking(g, assets);
  const lands = (seat: Seat) => g.tiles.flatMap((t, i) => (t.owner === seat ? [{ i, level: t.level }] : []));
  const cards = g.revealedCards.flatMap((id) => cardIn(room.cards, id) ?? []); // 카드 글은 서버가 정지 때 보낸다
  const canStart = s.seat !== null;
  return (
    <main class="sc sc--resume">
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <section class="resume" aria-label="여기까지 정리">
        <TimeLeft ms={g.clock.remainingMs} />
        <h1 class="save-title">여기까지 왔어요</h1>
        <div class="resume-cols">
          <ol class="resume-rank" aria-label="순위">
            {order.map((seat, n) => (
              <li key={seat} class="rank-row" style={{ '--seat': `var(--seat-${seat + 1})` }} data-seat={seat}>
                <span class="rank-no">{n + 1}</span>
                <AssetImg k={`char.${seats[seat].charId}.f00`} class="rank-face" alt="" />
                <span class="rank-name">{seats[seat].name}{seat === s.seat ? ' (나)' : ''}</span>
                <span class="rank-coin">재산 {won(assets(seat))}</span>
                <span class="rank-lands">
                  {lands(seat).length
                    ? lands(seat).map((l) => <span key={l.i} class="land-chip">{BOARD[l.i].name}{l.level ? ` · ${BUILDING[l.level]}` : ''}</span>)
                    : <span class="land-none">아직 땅이 없어요</span>}
                </span>
              </li>
            ))}
          </ol>
          <section class="resume-cards" aria-label="함께 본 해설 카드">
            <h2>함께 본 해설 카드 {cards.length}장</h2>
            {cards.length ? (
              <ul class="rc-list">
                {cards.map((c) => (
                  <li key={c.id} class="rc" data-card={c.id}>
                    <span class="rc-head">{countryNameOf(c.country)} · {c.level}단계</span>
                    <span class="rc-text">{c.answer}</span>
                  </li>
                ))}
              </ul>
            ) : <p class="land-none">아직 본 카드가 없어요</p>}
          </section>
        </div>
        {canStart && (
          <div class="resume-go">
            <button type="button" class="start-btn" data-act="resume" onClick={() => client.send({ t: 'resume' })}><span class="start-tri" aria-hidden="true" />이어서 하기</button>
            {s.error === 'notHost' && <p class="sc-msg" role="alert">방장이 들어오거나 친구가 두 명 넘게 모이면 이어서 할 수 있어요.</p>}
          </div>
        )}
      </section>
    </main>
  );
}

export function Finished({ s }: { s: ClientState }) {
  // 순위·자산은 log 의 result 이벤트에서 나온다
  return <Results log={s.log} seats={resultSeats(s)} mySeat={s.seat} meta={metaWith(s.room!.cards)} />;
}

/** 재개 안내: 옛 판(40칸) 저장본은 이어 할 수 없어 서버가 대기실로 돌렸다(PRD §9.1, 2026-10-26 판 재설계).
 *  대기실 위에 띄운다 — 같은 자리 번호로 다시 앉아 새 판을 시작한다 */
export function OldBoardNotice({ kind }: { kind: NoticeKind }) {
  return <p class="net-banner" role="status" data-notice={kind}>{NOTICE_TEXT[kind]}</p>;
}
