// 게임 화면: T06 보드 + 지금 단계 오버레이 + 새 로그 알림(이벤트 카드·통행료·컷씬). 보드·미션 컴포넌트는 props 로만 쓴다.
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { hasAsset, tileLazyKeys } from '../../assets/manifest';
import { preload } from '../../assets/preload';
import { buildCost, landPrice, tollQuote } from '../../engine/pay';
import { BOARD, countryLabel } from '../../shared/board';
import { STEP_MS, TAKEOVER_MAX_LEVEL, TOLL_RATE } from '../../shared/economy';
import type { Mission } from '../../shared/content-types';
import type { GameState, LogEvent } from '../../shared/types';
import type { GameClient } from '../../state/client';
import { cardIn, cultureOf, materialOf, missionOf, questionOf, tfOf } from '../../state/content';
import { josa } from '../../state/nick';
import { localDeadline, stepKeyOf, type ClientState } from '../../state/store';
import { lastOf, noticesFrom, seatViews, stepView, type Notice } from '../../state/view';
import { Board, type BoardGame } from '../board/Board';
import { HUD } from '../board/geometry';
import { HangSign } from '../board/HangSign';
import { RotateGuard, usePortrait } from '../board/RotateGuard';
import { Cutscene } from '../cutscene/Cutscene';
import { MissionPanel } from '../missions/MissionPanel';
import { RewardPick } from '../missions/RewardPick';
import { BUILDING, priceLine, ScrollPanel, TollNotice, type NoTakeover } from '../overlays/ActionPanel';
import { CultureCard } from '../overlays/CultureCard';
import { EventCard, EVENT_MS } from '../overlays/EventCard';
import { ExplainCard } from '../overlays/ExplainCard';
import { IslandPanel, ShieldPopup, TilePicker, travelTiles } from '../overlays/Pickers';
import { Stage, won } from '../overlays/parts';
import { QuestionScroll } from '../overlays/QuestionScroll';
import { Rules } from './Rules';
import { stakeLine } from './stake';

export const TOLL_NOTICE_MS = 3000;
/** 줌이 풀리길 기다리지 않는 단계 */
const NO_CAM_HOLD = new Set<string>(['explanation', 'tf', 'reward']);
/** 문항이 알림 뒤에서 기다릴 때 알림 상한 */
export const HELD_NOTICE_MS = 1000;

/** ending: 독점승으로 판이 끝났지만 보드에서 독점 연출(§16.5)을 보이는 3초 — 오버레이·알림·메뉴 없이 보드만 */
export function Game({ client, s, ending = false }: { client: GameClient; s: ClientState; ending?: boolean }) {
  const room = s.room!;
  const g = room.game!;
  const t = g.turn;
  const me = s.seat;
  const seats = useMemo(() => seatViews(room), [room.seats]);
  const players = seats.map(({ seat, charId, name, isBot }) => ({ seat, charId, name, isBot }));
  const arriver = seats[t.seat];
  const mine = me === t.seat;
  const deadline = localDeadline(s);
  const tile = t.tile !== null ? BOARD[t.tile] : null;
  const act = client.act.bind(client);
  const [rules, setRules] = useState(false);
  const portrait = usePortrait(); // 세로 안내 덮개(RotateGuard)가 떠 있음 — 해설 카드 표시 시간에서 뺀다(PRD §6 S5 "표시", QA7)
  /** 줌 카메라가 걸려 있음(§16.6): 줌이 풀린 뒤에 카드·문항·알림을 연다(서버 시간은 그대로, 표시만 늦춘다) */
  const [camOn, setCamOn] = useState(false);
  // 이동 로그가 온 그 렌더부터 줌이 걸린 것으로 본다: Board 의 onCamera(true) 는 다음 렌더라, 그 사이 카드가 한 프레임 떴다 사라지지 않게
  const camSeq = useRef(s.seq);
  const camSoon = useRef(false);
  if (s.seq !== camSeq.current) {
    camSeq.current = s.seq;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 제자리 이동(from = to)은 줌이 안 걸리므로 카드를 늦추지 않는다
    if (!s.resynced && !reduced && !document.hidden && s.fresh.some((e) => e.ev === 'move' && e.from !== e.to)) camSoon.current = true;
  }
  const [, kick] = useState(0);
  useEffect(() => { // Board 가 줌을 안 걸면(제자리·순간 끔) 짧게 기다렸다 푼다
    if (!camSoon.current || camOn) return;
    const h = setTimeout(() => { camSoon.current = false; kick((n) => n + 1); }, 600);
    return () => clearTimeout(h);
  }, [s.seq, camOn]);
  const setCam = (on: boolean) => { camSoon.current = false; setCamOn(on); };
  const cam = camOn || camSoon.current;
  const [mtf, setMtf] = useState<{ id: string; v: boolean } | null>(null); // 미션 관전 참/거짓: 고른 값(잠금 표시)

  // ── 새 로그 → 알림 줄. 알림마다 고유 id(같은 칸 컷씬이 연달아 와도 새로 마운트) ──
  const nextId = useRef(0);
  // 전체 다시 받기(입장·재접속): 진행 중인 컷씬만 남은 구간부터 이어 본다(DESIGN §12.3). 나머지 지난 알림은 버린다
  const resumed = (): { id: number; n: Notice }[] => {
    const c = s.room?.cutscene;
    return c ? [{ id: ++nextId.current, n: { kind: 'cutscene', seat: c.builder, tile: c.tile, t0: c.t0 } }] : [];
  };
  const [queue, setQueue] = useState(resumed);
  const seenSeq = useRef(s.seq);
  useEffect(() => {
    if (s.seq === seenSeq.current) return;
    seenSeq.current = s.seq;
    if (s.resynced) { setQueue(resumed()); return; }
    const add = noticesFrom(s.fresh, g).map((n) => ({ id: ++nextId.current, n }));
    if (add.length) setQueue((q) => [...q, ...add]);
    // 주사위가 나온 순간 도착 칸 그림을 미리 받는다
    for (const e of s.fresh) if (e.ev === 'move') void preload(tileLazyKeys(e.to));
  }, [s.seq]);
  // 이동 직후에 오는 단계만 줌을 기다린다. 해설·참거짓·보상은 답이 나온 뒤라 기다리지 않는다(해설을 본 신호 shown 이 빠지지 않게)
  // 서버가 도착 단계 마감을 이동 연출 시간만큼 늦춘다(shared/timing movesShowMs) → 줌이 끝난 뒤에 열어도 제 시간이 남는다
  const camHold = cam && !NO_CAM_HOLD.has(t.step);
  const head = queue[0];
  // 알림도 줌이 풀린 뒤에 연다. 단 이미 재생 중인 컷씬은 줌이 시작돼도 끊지 않는다(다시 마운트하면 처음부터·건너뜀이 꼬인다)
  const headHold = camHold && head?.n.kind !== 'cutscene';
  const pop = (id: number) => setQueue((q) => q.filter((x) => x.id !== id));

  const view = stepView(g, s.log, me);
  // 알림이 남아 있으면 문화 카드·문항은 알림이 다 끝난 뒤에 띄운다(겹침 방지).
  // 문화 카드·문항이 기다리는 동안은 통행료·이벤트 알림을 1초로 줄여 볼·답할 시간을 덜 깎는다(컷씬은 누르면 바로 넘어감)
  const holding = !!head && (view.kind === 'culture' || view.kind === 'question');
  useEffect(() => {
    if (!head || head.n.kind === 'cutscene' || headHold) return;
    const ms = holding ? HELD_NOTICE_MS : head.n.kind === 'toll' ? TOLL_NOTICE_MS : EVENT_MS;
    const h = setTimeout(() => pop(head.id), ms);
    return () => clearTimeout(h);
  }, [head?.id, holding, headHold]);
  const overlay = holding || ending || camHold ? null : renderStep();
  const covered = !!overlay || !!head;

  function waiting(text: string) {
    return <Stage><p class="ov-wait" role="status">{text}</p></Stage>;
  }

  function renderStep() {
    const who = (a: string, b: string) => josa(arriver.name, a, b);
    switch (view.kind) {
      case 'none': return null;
      case 'island':
        return <Stage><IslandPanel turnsLeft={g.players[t.seat].islandTurns} coin={g.players[t.seat].coin}
          hasCard={g.players[t.seat].items.includes('escape')} onEscape={(method) => act({ type: 'escape', method })} /></Stage>;
      case 'culture': {
        const card = tile?.country && cultureOf(tile.country);
        if (!card) return null;
        return <Stage dim label="문화 카드"><CultureCard card={card} tile={view.tile} firstVisit={view.firstVisit} charId={arriver.charId}
          arriverName={arriver.name} mine={mine} deadline={deadline} onNext={() => act({ type: 'ack' })} /></Stage>;
      }
      case 'question': {
        const q = t.question;
        if (!q) return null;
        const pq = q.format === 'choice' ? questionOf(q.qid) : null;
        const stem = pq?.stem ?? tfOf(q.qid)?.text ?? '';
        return <Stage dim label="문제"><QuestionScroll key={q.qid} country={tile ? countryLabel(tile) : ''} continent={tile?.continent} stem={stem}
          choices={pq?.choices ?? null} review={q.review || q.variant === 'short'} mine={mine} arriverName={arriver.name} charId={arriver.charId}
          materials={materialOf(q.qid)} fallback={tile?.kind === 'antarctic' ? 'event.antarctic' : hasAsset(`culture.${t.tile}`) ? `culture.${t.tile}` : null}
          deadline={deadline} hintRemoved={q.hintRemoved} canHint={g.players[t.seat].items.includes('hint')} stake={stake()}
          build={buildInfo()} onAnswer={(choice, ms) => act({ type: 'answer', choice, ms: Math.round(ms) })} onHint={() => act({ type: 'useHint' })} /></Stage>;
      }
      case 'explanation':
      case 'tf': {
        const q = t.question;
        const card = q && cardIn(room.cards, q.cardId); // 카드 글은 서버가 해설 단계에 보낸다
        if (!q || !card) return null;
        const stmt = view.kind === 'tf' && t.tf ? tfOf(t.tf.stmtId) : null;
        const eligible = me !== null && me !== t.seat && !g.players[me].bankrupt;
        const shownKey = stepKeyOf(room, s.log.length); // 이 렌더의 해설 단계. ExplainCard 는 보낼 때 가장 최근 렌더의 onShown 을 부른다
        return <Stage dim label="해설 카드"><ExplainCard key={q.qid} card={card} countryName={tile ? countryLabel(tile) : ''} continent={tile?.continent}
          tile={t.tile ?? 0} variant={q.variant} correct={t.correct} charId={arriver.charId}
          timedOut={s.log.some((e) => e.ev === 'answer' && e.qid === q.qid && e.choice === null && e.seat === t.seat)} arriverName={arriver.name} mine={mine} deadline={deadline}
          onShown={view.kind === 'explanation' && me !== null ? () => client.send({ t: 'shown', stepKey: shownKey }) : undefined} covered={!!head || portrait || rules}
          tf={stmt ? { text: stmt.text, canAnswer: eligible, deadline, onPick: (value) => act({ type: 'tfAnswer', value }) } : null} /></Stage>;
      }
      case 'mission':
      case 'reward': {
        if (view.kind === 'reward' && mine) return <Stage dim label="보상"><div class="ov-center"><RewardPick options={t.rewardOptions} deadlineAt={deadline ?? Date.now()} onChoose={(index) => act({ type: 'chooseReward', index })} /></div></Stage>;
        if (view.kind === 'reward') return waiting(`${who('이', '가')} 보상을 고르고 있어요`);
        const m = t.missionId ? missionOf(t.missionId) : null;
        if (!m) return null;
        const eligible = me !== null && me !== t.seat && !g.players[me].bankrupt;
        return <Stage dim label="미션"><div class="ov-center"><MissionPanel key={m.id} mission={m as unknown as Mission} role={mine ? 'player' : 'spectator'}
          phase={t.step === 'mission' ? 'play' : 'tf'} deadlineAt={deadline ?? Date.now()} success={t.missionSuccess}
          onSubmit={mine ? (a) => act({ type: 'missionAnswer', ...a }) : undefined}
          onTf={eligible ? (value) => { setMtf({ id: m.id, v: value }); act({ type: 'tfAnswer', value }); } : undefined}
          tfPicked={mtf?.id === m.id ? mtf.v : null} shown={t.mission} reveal={mine ? t.reveal : null} /></div></Stage>;
      }
      case 'toll': {
        if (t.tile === null) return null;
        const full = tollQuote(g as unknown as GameState, t.tile, false, null).paid;
        const paid = tollQuote(g as unknown as GameState, t.tile, t.correct === true, null).paid;
        const items = g.players[t.seat].items;
        return <Stage><ScrollPanel kind="toll" title={`${tile!.name} · 통행료`} mine={mine} arriverName={arriver.name} deadline={deadline} totalMs={STEP_MS.toll}
          lines={[<span class={`ov-chip ${paid < full ? 'ov-chip--discount' : 'ov-chip--toll'}`}>{paid < full ? `통행료 ${won(full)} → 정답 할인 ${won(paid)}` : `통행료 ${won(full)}`}</span>]}
          choices={[
            ...(items.includes('tollFree') ? [{ id: 'tollFree', label: '면제권 쓰기', primary: true, act: () => act({ type: 'payToll', item: 'tollFree' }) }] : []),
            ...(items.includes('tollHalf') ? [{ id: 'tollHalf', label: '반값권 쓰기', act: () => act({ type: 'payToll', item: 'tollHalf' }) }] : []),
            { id: 'pay', label: '그냥 낼래요', act: () => act({ type: 'payToll', item: null }) },
          ]} /></Stage>;
      }
      case 'action': {
        if (t.tile === null || !tile) return null;
        const st = g.tiles[t.tile];
        const correct = t.correct === true;
        if (st.owner === null) {
          const full = landPrice(t.tile, false), paid = landPrice(t.tile, correct);
          return <Stage><ScrollPanel kind="buy" title={`${tile.name} · 빈 땅이에요`} mine={mine} arriverName={arriver.name} deadline={deadline}
            lines={[<span class={`ov-chip ${correct ? 'ov-chip--discount' : 'ov-chip--toll'}`}>{priceLine('땅값', full, paid, correct)}</span>]}
            choices={[{ id: 'buy', label: '땅 사기', primary: true, act: () => act({ type: 'buy' }) }, { id: 'pass', label: '그냥 지나가기', act: () => act({ type: 'pass' }) }]} /></Stage>;
        }
        const next = st.level + 1;
        return <Stage><ScrollPanel kind="build" title={`${tile.name} · 내 땅이에요`} mine={mine} arriverName={arriver.name} deadline={deadline}
          lines={[<span class="ov-chip ov-chip--discount">정답! {josa(BUILDING[next], '을', '를')} 지을 수 있어요 · 짓는 데 드는 돈 {won(buildCost(t.tile, next))}</span>]}
          choices={[{ id: 'build', label: `${BUILDING[next]} 짓기`, primary: true, act: () => act({ type: 'build' }) }, { id: 'pass', label: '다음에 지을래요', act: () => act({ type: 'pass' }) }]} /></Stage>;
      }
      case 'takeover': {
        if (t.tile === null || !tile) return null;
        const toll = lastOf(s.log, 'toll');
        const owner = seats[g.tiles[t.tile].owner ?? 0];
        const full = toll ? Math.round(toll.base * toll.multiplier) : 0;
        return <Stage><ScrollPanel kind="takeover" title={`${tile.name} · ${josa(owner.name, '이', '가')} 주인이에요`} mine={mine} arriverName={arriver.name}
          deadline={deadline} totalMs={STEP_MS.takeover}
          lines={[
            <span class="ov-chip ov-chip--discount">통행료 {won(full)} → 정답 할인 {won(toll?.paid ?? 0)} · 사들일 수 있어요</span>,
            <>{won(t.takeoverCost)}코인을 내면 이 땅과 건물이 내 것이 돼요.</>,
          ]}
          choices={[{ id: 'takeover', label: '땅 사들이기', primary: true, act: () => act({ type: 'takeover' }) }, { id: 'pass', label: '그냥 지나가기', act: () => act({ type: 'pass' }) }]} /></Stage>;
      }
      case 'shield': {
        if (t.tile === null) return null;
        const owner = g.tiles[t.tile].owner;
        if (me !== null && me === owner) return <Stage dim><ShieldPopup attacker={arriver.name} tileName={tile!.name} deadline={deadline} onAnswer={(use) => act({ type: 'shield', use })} /></Stage>;
        return waiting(`${josa(seats[owner ?? 0].name, '이', '가')} 방패를 쓸지 고르고 있어요`);
      }
      case 'travel':
        if (!mine) return waiting(`${who('이', '가')} 세계여행으로 갈 곳을 고르고 있어요`);
        return <Stage><TilePicker title="어디로 떠날까요?" note="고른 칸으로 바로 날아가요. 출발 칸을 지나면 월급도 받아요." tiles={travelTiles()}
          deadline={deadline} totalMs={STEP_MS.travel} onPick={(tile) => act({ type: 'travel', tile })} /></Stage>;
      case 'pickTile': {
        if (!mine) return waiting(`${who('이', '가')} 갈 땅을 고르고 있어요`);
        const own = g.tiles.flatMap((x, i) => (x.owner === t.seat ? [i] : []));
        return <Stage><TilePicker title="내 땅으로 가요" note="갈 땅을 하나 골라요." tiles={own} deadline={deadline} totalMs={STEP_MS.pickTile} onPick={(tile) => act({ type: 'pickTile', tile })} /></Stage>;
      }
      case 'festival': {
        if (!mine) return waiting(`${who('이', '가')} 축제를 열 땅을 고르고 있어요`);
        const own = g.tiles.flatMap((x, i) => (x.owner === t.seat ? [i] : []));
        return <Stage><TilePicker title="축제를 열 땅을 골라요" note="고른 땅은 통행료가 두 배가 돼요." tiles={own} deadline={deadline} totalMs={STEP_MS.festival}
          onPick={(tile) => act({ type: 'pickFestival', tile })} skipLabel="이번엔 안 고를래요" onSkip={() => act({ type: 'pickFestival', tile: null })} /></Stage>;
      }
    }
  }

  /** 건설 문항(내 나라 땅, 4단계 전): 문항 오른쪽 미리보기(R2 D5) — 지금 단계 → 다음 단계 + 건설비 */
  function buildInfo() {
    if (t.tile === null || tile?.kind !== 'country') return null;
    const st = g.tiles[t.tile];
    return st.owner === t.seat && st.level < 4 ? { tile: t.tile, level: st.level, cost: buildCost(t.tile, st.level + 1) } : null;
  }

  /** 문항 아래 막대: 이 문항 결과가 정하는 것 */
  function stake(): string | null {
    return stakeLine(g as unknown as GameState, t.seat, t.tile);
  }

  function renderNotice({ id, n }: { id: number; n: Notice }) {
    const pop1 = () => pop(id);
    if (n.kind === 'event') return <Stage><EventCard key={id} ev={n.ev} name={seats[n.ev.seat].name} onClose={pop1} /></Stage>;
    if (n.kind === 'cutscene') {
      const b = seats[n.seat];
      return <Cutscene tile={n.tile} charId={b.charId} builder={b.name} country={BOARD[n.tile].name}
        toll={Math.round((BOARD[n.tile].price ?? 0) * TOLL_RATE[4])} startedAt={n.t0 === undefined ? undefined : n.t0 - s.skew} onDone={pop1} key={id} />;
    }
    const e = n.ev;
    return <Stage><TollNotice payerName={seats[e.payer].name} ownerName={seats[e.owner].name} tileName={BOARD[e.tile].name}
      full={Math.round(e.base * e.multiplier)} paid={e.paid} why={whyNoTakeover(s.log, e, g.tiles[e.tile].level)} /></Stage>;
  }

  const host = me === room.hostSeat;
  return (
    <div class="game" data-ending={ending ? '1' : undefined} data-step={t.step} data-seat={me ?? ''} data-turn={t.seat}>
      <Board game={g as unknown as BoardGame} players={players} mySeat={me} log={s.log} covered={covered}
        onRoll={(gauge) => act({ type: 'roll', gauge })} noZoom={s.resynced} onCamera={setCam} clockAt={s.clockAt} />
      {/* 단계가 바뀌면 오버레이를 새로 마운트(같은 컴포넌트의 잠금 상태가 다음 단계로 새지 않게).
          단 미션 → 관전 참/거짓(tf)은 같은 패널: 푼 사람의 선·블록이 남아 있어야 실패 해설이 그 위에 겹친다(QA r3) */}
      <Fragment key={`${t.seat}|${t.step === 'tf' && t.missionId ? 'mission' : t.step}|${t.tile}`}>{overlay}</Fragment>
      {head && !ending && !headHold && <Fragment key={head.id}>{renderNotice(head)}</Fragment>}
      {!ending && <GameMenu host={host} pending={!!g.clock.pauseBy} onRules={() => setRules(true)} onPause={() => client.send({ t: 'pause' })} />}
      {rules && <Rules onClose={() => setRules(false)} />}
      {/* 세로 안내: 마지막 자식 + fixed 전용 z → 모든 레이어 위, 형제는 inert(DESIGN §4.2, QA6) */}
      <RotateGuard />
    </div>
  );
}

function whyNoTakeover(log: LogEvent[], e: Extract<LogEvent, { ev: 'toll' }>, level: number): NoTakeover {
  if (BOARD[e.tile].kind === 'tourist') return 'tourist';
  let ans: Extract<LogEvent, { ev: 'answer' }> | undefined;
  for (let i = log.indexOf(e); i >= 0; i--) { const x = log[i]; if (x.ev === 'answer' && x.seat === e.payer) { ans = x; break; } }
  if (level > TAKEOVER_MAX_LEVEL) return ans?.correct ? 'hotel' : 'hotelWrong'; // 호텔부터 인수 불가(PRD §3.2 U5): 버튼 없음
  if (!ans?.correct) return 'wrong';
  return 'coin';
}

/** 규칙 · 멈춤 = 광장 뒤쪽 매달린 간판 2개(DESIGN §16.4, 타이머 양옆). 윗줄 칸·패널을 가리지 않는다.
 *  멈춤은 방장만, 확인 1탭("잠깐 쉴까요?"). 누르면 지금 턴을 마친 뒤 멈춘다(pending = 서버가 멈춤 요청을 받음) */
export function GameMenu({ host, pending = false, onRules, onPause }: { host: boolean; pending?: boolean; onRules: () => void; onPause: () => void }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (!ask) return; const h = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(h); }, [ask]);
  return (
    <Stage class="ov-layer--menu">
      <nav class="gm" aria-label="게임 메뉴">
        <HangSign at={HUD.rules} class="gm-sign">
          <button type="button" class="hang-plate gm-btn" aria-label="규칙 보기" title="규칙" onClick={onRules}>규칙</button>
        </HangSign>
        {host && (
          <HangSign at={HUD.save} class={`gm-sign${ask ? ' is-ask' : ''}${pending ? ' is-pending' : ''}`}>
            <button type="button" class="hang-plate gm-btn" data-act="pause" disabled={pending}
              aria-label={pending ? '이 차례가 끝나면 멈춰요' : ask ? '한 번 더 누르면 멈춰요' : '멈춤'} title="멈춤"
              onClick={() => (ask ? (setAsk(false), onPause()) : setAsk(true))}><PauseIcon /></button>
            {ask && !pending && <p class="gm-ask" role="status">잠깐 쉴까요? 한 번 더 누르면 멈춰요</p>}
            {pending && <p class="gm-ask" role="status">이 차례가 끝나면 멈춰요</p>}
          </HangSign>
        )}
      </nav>
    </Stage>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <rect x="3" y="2" width="3.6" height="12" rx="1.2" fill="currentColor" />
      <rect x="9.4" y="2" width="3.6" height="12" rx="1.2" fill="currentColor" />
    </svg>
  );
}
