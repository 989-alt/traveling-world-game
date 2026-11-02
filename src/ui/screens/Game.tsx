// 게임 화면: T06 보드 + 지금 단계 오버레이 + 새 로그 알림(이벤트 카드·통행료·컷씬). 보드·미션 컴포넌트는 props 로만 쓴다.
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { hasAsset, tileLazyKeys } from '../../assets/manifest';
import { preload } from '../../assets/preload';
import { buildCost, landPrice, tollQuote } from '../../engine/pay';
import { BOARD, countryLabel, TRAVEL_TILE } from '../../shared/board';
import { STEP_MS, TAKEOVER_MAX_LEVEL, TOLL_RATE } from '../../shared/economy';
import type { Mission } from '../../shared/content-types';
import type { GameState, LogEvent } from '../../shared/types';
import type { GameClient } from '../../state/client';
import { cardIn, cultureOf, materialOf, missionOf, questionOf, tfOf } from '../../state/content';
import { josa } from '../../state/nick';
import { freezeScreenClock } from '../../state/clock';
import { localDeadline, stepKeyOf, type ClientState } from '../../state/store';
import { lastOf, noticeShowMs, noticesFrom, seatViews, stepView, type Notice } from '../../state/view';
import { Board, type BoardGame } from '../board/Board';
import type { BoardPick } from '../board/PickLayer';
import { HUD } from '../board/geometry';
import { HangSign } from '../board/HangSign';
import { RotateGuard, usePortrait } from '../board/RotateGuard';
import { Cutscene } from '../cutscene/Cutscene';
import { MissionPanel } from '../missions/MissionPanel';
import { RewardPick } from '../missions/RewardPick';
import { BUILDING, priceLine, ScrollPanel, TollNotice, type NoTakeover } from '../overlays/ActionPanel';
import { CultureCard } from '../overlays/CultureCard';
import { EventCard } from '../overlays/EventCard';
import { ExplainCard, type TfResult } from '../overlays/ExplainCard';
import { IslandPanel, ShieldPopup } from '../overlays/Pickers';
import { Stage, won } from '../overlays/parts';
import { QuestionScroll } from '../overlays/QuestionScroll';
import { PauseModal, useInertSiblings, type PauseKind } from '../overlays/PauseModal';
import { SaveScreen } from './Pause';
import { Rules } from './Rules';
import { stakeLine } from './stake';

/** 줌이 풀리길 기다리지 않는 단계 */
const NO_CAM_HOLD = new Set<string>(['explanation', 'tf', 'tfResult', 'reward']);

/** ending: 독점승으로 판이 끝났지만 보드에서 독점 연출(§16.5)을 보이는 3초 — 오버레이·알림·메뉴 없이 보드만 */
export function Game({ client, s, ending = false }: { client: GameClient; s: ClientState; ending?: boolean }) {
  const room = s.room!;
  const g = room.game!;
  /** 멈춘 판(U14, DESIGN §20.1): 판은 멈춘 프레임 그대로 그리고(단계 오버레이 유지) 그 위에 멈춤 모달 */
  const paused = room.phase === 'paused';
  // 화면 타이머(링·막대·고르기 간판)를 멈춘 순간에 묶는다. 렌더에서 바로: 재개 상태(밀린 마감)와 같은 렌더에 풀려야 링이 튀지 않는다
  freezeScreenClock(paused ? (g.clock.pausedAt !== null ? g.clock.pausedAt - s.skew : s.clockAt) : null);
  useEffect(() => () => freezeScreenClock(null), []);
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
  const gameRef = useRef<HTMLDivElement>(null);

  // ── 새 로그 → 알림 줄. 알림마다 고유 id(같은 칸 컷씬이 연달아 와도 새로 마운트) ──
  // afterMove: 같은 묶음에 이동이 있었던 알림 = 그 이동의 줌이 풀린 뒤에 연다(서버가 이동 연출 + 알림 시간을 마감에 더한다, PRD §4.3 U10)
  const nextId = useRef(0);
  /** ms: 재접속으로 남은 구간만 보이는 알림의 표시 시간(없으면 noticeShowMs) */
  type Queued = { id: number; n: Notice; afterMove: boolean; ms?: number };
  // 전체 다시 받기(입장·재접속): 진행 중인 컷씬은 남은 구간부터 이어 보고(DESIGN §12.3), 서버 표시 창(showUntil)이 남은 알림은
  // 그 남은 시간만큼만 다시 연다(QA r14, PRD §4.3 U10). 창이 끝난 지난 알림은 버린다
  const resumed = (): Queued[] => {
    const c = s.room?.cutscene;
    if (c) return [{ id: ++nextId.current, n: { kind: 'cutscene', seat: c.builder, tile: c.tile, t0: c.t0 }, afterMove: false }];
    const su = s.room?.showUntil;
    let left = su ? su - s.skew - Date.now() : 0;
    if (left <= 0) return [];
    // 이번 차례 묶음(마지막 주사위·세계여행 이동 뒤)의 알림을 끝에서부터 남은 시간만큼
    let from = s.log.length;
    while (from > 0 && !(s.log[from - 1].ev === 'dice' || (s.log[from - 1].ev === 'move' && (s.log[from - 1] as { via?: string }).via !== 'dice'))) from--;
    const ns = noticesFrom(s.log.slice(from), g).filter((n) => n.kind !== 'cutscene');
    const out: Queued[] = [];
    for (let i = ns.length - 1; i >= 0 && left > 0; i--) {
      const full = noticeShowMs(ns[i]);
      out.unshift({ id: 0, n: ns[i], afterMove: false, ms: Math.min(full, left) });
      left -= full;
    }
    return out.map((x) => ({ ...x, id: ++nextId.current }));
  };
  const [queue, setQueue] = useState(resumed);
  const seenSeq = useRef(s.seq);
  useEffect(() => {
    if (s.seq === seenSeq.current) return;
    seenSeq.current = s.seq;
    if (s.resynced) { setQueue(resumed()); return; }
    const moved = s.fresh.some((e) => e.ev === 'move' && e.from !== e.to);
    const add = noticesFrom(s.fresh, g).map((n) => ({ id: ++nextId.current, n, afterMove: moved }));
    if (add.length) setQueue((q) => [...q, ...add]);
    // 주사위가 나온 순간 도착 칸 그림을 미리 받는다
    for (const e of s.fresh) if (e.ev === 'move') void preload(tileLazyKeys(e.to));
  }, [s.seq]);
  // 이동 직후에 오는 단계만 줌을 기다린다. 해설·참거짓·보상은 답이 나온 뒤라 기다리지 않는다(해설을 본 신호 shown 이 빠지지 않게)
  // 서버가 도착 단계 마감을 이동 연출 시간만큼 늦춘다(shared/timing movesShowMs) → 줌이 끝난 뒤에 열어도 제 시간이 남는다
  const camHold = cam && !NO_CAM_HOLD.has(t.step);
  // 줌이 한 번 풀리면 줄에 있는 알림은 더는 줌을 기다리지 않는다(다음 사람 줌이 와도 숨지 않음)
  useEffect(() => { if (!cam) setQueue((q) => (q.some((x) => x.afterMove) ? q.map((x) => (x.afterMove ? { ...x, afterMove: false } : x)) : q)); }, [cam]);
  const head = queue[0];
  /** 이 알림은 이미 열렸다: 줌·이동·다음 단계와 무관하게 제 시간(EVENT_MS 3.2초 · TOLL_MS 3초)을 다 채운다(DESIGN §18.5) */
  const opened = useRef<number | null>(null);
  // 아직 안 연 알림만 제 이동의 줌이 풀리길 기다린다. 이미 재생 중인 컷씬은 끊지 않는다
  const noticeWait = !!head && opened.current !== head.id && head.afterMove && cam && head.n.kind !== 'cutscene';
  if (head && !noticeWait && !ending) opened.current = head.id;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // 멈춘 동안 컷씬이 제 타이머로 끝나도 줄에서 빼지 않는다(재개 때 서버 t0 로 남은 부분부터 다시 붙인다)
  const pop = (id: number) => { if (!pausedRef.current) setQueue((q) => q.filter((x) => x.id !== id)); };

  const view = stepView(paused ? { ...g, phase: 'playing' } : g, s.log, me);
  // 알림이 남아 있으면 문화 카드·문항은 알림이 다 끝난 뒤에 띄운다(겹침 방지). 알림은 줄이지 않는다 — 서버가 알림 시간을 마감에 더했다
  const holding = !!head && (view.kind === 'culture' || view.kind === 'question');
  const headOpen = !!head && opened.current === head.id;
  /** 멈춤으로 끊긴 알림의 남은 표시 시간(U14: 알림 카드도 멈춘 채, 재개 뒤 남은 만큼) */
  const noticeLeft = useRef<{ id: number; ms: number } | null>(null);
  useEffect(() => {
    if (!head || !headOpen || paused || head.n.kind === 'cutscene') return; // 컷씬은 제 길이
    const ms = noticeLeft.current?.id === head.id ? noticeLeft.current.ms : head.ms ?? noticeShowMs(head.n);
    const t0 = Date.now();
    const h = setTimeout(() => pop(head.id), Math.max(0, ms));
    return () => { clearTimeout(h); noticeLeft.current = { id: head.id, ms: ms - (Date.now() - t0) }; };
  }, [head?.id, headOpen, paused]);
  const picking = view.kind === 'travel' || view.kind === 'pickTile' || view.kind === 'festival';
  const overlay = holding || ending || camHold || picking ? null : renderStep();
  const covered = !!overlay || !!head || paused;

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
          onShown={view.kind === 'explanation' && me !== null ? () => client.send({ t: 'shown', stepKey: shownKey }) : undefined} covered={!!head || portrait || rules || paused}
          tf={stmt ? { text: stmt.text, canAnswer: eligible && t.step === 'tf', deadline, onPick: (value) => act({ type: 'tfAnswer', value }), result: tfResult() } : null} /></Stage>;
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
          onTf={eligible && t.step === 'tf' ? (value) => { setMtf({ id: m.id, v: value }); act({ type: 'tfAnswer', value }); } : undefined}
          tfPicked={mtf?.id === m.id ? mtf.v : null} tfResult={tfResult()} shown={t.mission} reveal={mine ? t.reveal : null} /></div></Stage>;
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
      // 세계여행 · 내 땅으로 · 축제: 오버레이 없이 보드에서 칸을 직접 고른다(Board pick, DESIGN §18)
      case 'travel': case 'pickTile': case 'festival':
        return null;
    }
  }

  /** 오버레이 마운트 키의 단계: 미션 → 참/거짓 → 결과는 'mission' 하나, 해설 참/거짓 → 결과는 'tf' 하나 */
  function overlayStep(): string {
    if (t.missionId && (t.step === 'tf' || t.step === 'tfResult')) return 'mission';
    return t.step === 'tfResult' ? 'tf' : t.step;
  }

  /** 고르기 단계(PRD §3.6.1): 고를 수 있는 칸 = 세계여행은 세계여행 칸 뺀 29칸, 내 땅으로·축제는 내 땅 */
  function boardPick(): BoardPick | null {
    if (ending || !picking) return null;
    const kind = view.kind as BoardPick['kind'];
    const eligible = kind === 'travel' ? BOARD.map((x) => x.index).filter((i) => i !== TRAVEL_TILE) : g.tiles.flatMap((x, i) => (x.owner === t.seat ? [i] : []));
    const send = (tile: number) => act(kind === 'travel' ? { type: 'travel', tile } : kind === 'pickTile' ? { type: 'pickTile', tile } : { type: 'pickFestival', tile });
    return {
      kind, seat: t.seat, mine, name: arriver.name, eligible, preview: t.preview ?? null, deadline, total: STEP_MS[kind],
      onPreview: mine ? (tile) => client.send({ t: 'pickPreview', tile }) : undefined,
      onConfirm: mine ? send : undefined,
      onSkip: mine && kind === 'festival' ? () => act({ type: 'pickFestival', tile: null }) : undefined,
    };
  }

  /** 참/거짓 결과 2초(tfResult): 정답 + 참가 자리(도착자 제외)가 맞혔는지 — 닫을 때 남긴 tf_answer 로그 */
  function tfResult(): TfResult | null {
    if (t.step !== 'tfResult' || !t.tf || t.tf.answer === undefined) return null;
    const stmt = t.tf.stmtId;
    const got = new Map<number, boolean>();
    for (let i = s.log.length - 1; i >= 0; i--) { const e = s.log[i]; if (e.ev === 'tf_answer' && e.stmtId === stmt && !got.has(e.seat)) got.set(e.seat, e.correct && e.value !== null); else if (e.ev !== 'tf_answer' && got.size) break; }
    const chips = seats.filter((x) => x.seat !== t.seat).map((x) => ({ seat: x.seat, name: x.name, correct: got.get(x.seat) ?? false }));
    return { answer: t.tf.answer, chips };
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
    if (n.kind === 'event') return <Stage class="ov-layer--notice"><EventCard key={id} ev={n.ev} name={seats[n.ev.seat].name} onClose={pop1} /></Stage>;
    if (n.kind === 'cutscene') {
      const b = seats[n.seat];
      return <Cutscene tile={n.tile} charId={b.charId} builder={b.name} country={BOARD[n.tile].name}
        toll={Math.round((BOARD[n.tile].price ?? 0) * TOLL_RATE[4])} startedAt={n.t0 === undefined ? undefined : n.t0 - s.skew} onDone={pop1} key={id} />;
    }
    const e = n.ev;
    return <Stage class="ov-layer--notice"><TollNotice payerName={seats[e.payer].name} ownerName={seats[e.owner].name} tileName={BOARD[e.tile].name}
      full={Math.round(e.base * e.multiplier)} paid={e.paid} why={whyNoTakeover(s.log, e, g.tiles[e.tile].level)} /></Stage>;
  }

  const host = me === room.hostSeat;
  const pm = usePauseUi(client, s, host, paused, gameRef);
  const resumeFix = useRef(paused);
  useEffect(() => {
    // 재개(U14): 멈출 때 떠 있던 컷씬은 서버가 민 t0 로 남은 샷부터 다시(재접속 복구와 같은 길). 끝난 컷씬은 뺀다
    if (resumeFix.current && !paused) {
      setQueue((q) => {
        const h = q[0];
        if (!h || h.n.kind !== 'cutscene' || opened.current !== h.id) return q;
        const c = room.cutscene;
        return c ? [{ id: ++nextId.current, n: { kind: 'cutscene', seat: c.builder, tile: c.tile, t0: c.t0 }, afterMove: false }, ...q.slice(1)] : q.slice(1);
      });
    }
    resumeFix.current = paused;
  }, [paused]);
  return (
    <div ref={gameRef} class={`game${paused ? ' is-paused' : ''}`} data-ending={ending ? '1' : undefined} data-step={t.step} data-seat={me ?? ''} data-turn={t.seat}
      data-paused={paused ? '1' : undefined}>
      <Board game={g as unknown as BoardGame} players={players} mySeat={me} log={s.log} covered={covered}
        onRoll={(gauge) => act({ type: 'roll', gauge })} noZoom={s.resynced} onCamera={setCam} clockAt={s.clockAt}
        pick={boardPick()} locked={(!!head && !ending) || paused} />
      {/* 단계가 바뀌면 오버레이를 새로 마운트(같은 컴포넌트의 잠금 상태가 다음 단계로 새지 않게).
          단 미션 → 관전 참/거짓(tf) → 결과(tfResult)는 같은 패널: 푼 사람의 선·블록이 남아 있어야 실패 해설이 그 위에 겹친다(QA r3).
          해설 참/거짓 → 결과도 같은 창(선지가 결과로 바뀐다, DESIGN §18.5) */}
      <Fragment key={`${t.seat}|${overlayStep()}|${t.tile}`}>{overlay}</Fragment>
      {/* 알림 카드: 게임 루트 고정 레이어(z.notice — HUD·오버레이 위, 세로 안내 아래). 한 번 열리면 제 시간을 다 채운다 */}
      {head && !ending && headOpen && <Fragment key={head.id}>{renderNotice(head)}</Fragment>}
      {!ending && <GameMenu host={host} paused={paused} onRules={() => setRules(true)} onPause={() => client.send({ t: 'pause' })} onLeave={pm.openLeave} />}
      {rules && !pm.open && <Rules onClose={() => setRules(false)} />}
      {/* 멈춤 모달·확인 창·자리 번호 화면(z 50, DESIGN §20). 형제는 inert, 세로 안내(아래 RotateGuard)만 그 위 */}
      {!ending && pm.node}
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

/** 규칙 · 멈춤/나가기 = 광장 뒤쪽 매달린 간판 2개(DESIGN §16.4·§20.5, 타이머 양옆). 윗줄 칸·패널을 가리지 않는다.
 *  방장 = 멈춤(1탭 즉시, 멈춘 동안 disabled). 학생 = 나가기(문 아이콘) → 내 화면만 나가기 확인 창(C-L) */
export function GameMenu({ host, paused = false, onRules, onPause, onLeave }: {
  host: boolean; paused?: boolean; onRules: () => void; onPause: () => void; onLeave?: () => void;
}) {
  return (
    <Stage class="ov-layer--menu">
      <nav class="gm" aria-label="게임 메뉴">
        <HangSign at={HUD.rules} class="gm-sign">
          <button type="button" class="hang-plate gm-btn" aria-label="규칙 보기" title="규칙" onClick={onRules}>규칙</button>
        </HangSign>
        {host ? (
          <HangSign at={HUD.save} class="gm-sign">
            <button type="button" class="hang-plate gm-btn" data-act="pause" disabled={paused} aria-label="멈춤" title="멈춤" onClick={onPause}><PauseIcon /></button>
          </HangSign>
        ) : onLeave && (
          <HangSign at={HUD.save} class="gm-sign">
            <button type="button" class="hang-plate gm-btn" data-act="leave-sign" disabled={paused} aria-label="게임 나가기" title="게임 나가기" onClick={onLeave}><DoorIcon /></button>
          </HangSign>
        )}
      </nav>
    </Stage>
  );
}

/** 학생 나가기 간판: 문 + 화살표(간판 글자색, DESIGN §20.5) */
function DoorIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.5 2.5H4.2c-.6 0-1 .4-1 1v11c0 .6.4 1 1 1h6.3" />
      <path d="M7.5 9h8M13 6.2 15.8 9 13 11.8" />
      <circle cx="8.2" cy="9.6" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 멈춤 UI(DESIGN §20): 상태 4(P-H·P-S·C-E·C-L) + 자리 번호 화면, 잠금·정지·되돌리기 */
function usePauseUi(client: GameClient, s: ClientState, host: boolean, paused: boolean, gameRef: { current: HTMLDivElement | null }) {
  const [ask, setAsk] = useState<null | 'end' | 'leave'>(null); // 멈춘 동안 열린 확인 창
  const [signLeave, setSignLeave] = useState(false); // 학생 간판으로 연 C-L(판은 계속)
  const [seat, setSeat] = useState(false); // 자리 번호 화면
  const [busy, setBusy] = useState(false); // 계속하기·끝내기·나가기를 보내고 답 기다림
  const layer = useRef<HTMLDivElement>(null);
  // 멈춤이 오면 간판 C-L 을 닫고 P-S(멈춤 우선), 재개되면 창을 전부 닫는다(C-L 복원 안 함). 그리기 전에
  useLayoutEffect(() => { setSignLeave(false); setAsk(null); setSeat(false); setBusy(false); }, [paused]);
  // 판 정지: 게임 루트 안의 WAAPI·CSS 애니메이션(주사위 컵·말 이동·대기 모션·컷씬 타임라인)을 그 프레임에서 멈추고, 재개 때 잇는다.
  // 모달 레이어·세로 안내는 제외(모달 pop·세로 안내 그림은 돈다)
  useLayoutEffect(() => {
    const root = gameRef.current;
    if (!paused || !root || typeof root.getAnimations !== 'function') return;
    const held = root.getAnimations({ subtree: true }).filter((a) => {
      const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return a.playState === 'running' && !(el && el.closest('.pm-host, .board-rotate'));
    });
    for (const a of held) a.pause();
    return () => { for (const a of held) if (a.playState === 'paused') a.play(); };
  }, [paused]);
  const kind: PauseKind | null = paused ? (ask === 'end' ? 'C-E' : ask === 'leave' ? 'C-L' : host ? 'P-H' : 'P-S') : signLeave ? 'C-L' : null;
  const open = kind !== null || (paused && seat);
  useInertSiblings(open, layer);
  const g = s.room!.game!;
  // 같은 상자(.pm-host) 안에서 모달 ↔ 자리 번호 화면을 바꾼다: 형제 inert 표시가 이 상자 하나를 기준으로 남는다
  const node = !open ? null : (
    <div ref={layer} class="pm-host">
      {paused && seat && s.pins ? <SaveScreen s={s} onDone={() => setSeat(false)} /> : (
        <Stage dim class="ov-layer--pause">
          <PauseModal kind={kind!} remainingMs={g.clock.remainingMs} busy={busy} fromSign={!paused}
            onResume={() => { if (client.send({ t: 'resume' })) setBusy(true); }}
            onAskEnd={() => setAsk('end')}
            onAskLeave={() => setAsk('leave')}
            onBack={() => { if (paused) setAsk(null); else setSignLeave(false); }}
            onEnd={() => { if (client.endGame()) setBusy(true); }}
            onLeave={() => { setBusy(true); client.leaveGame(); }}
            onSeat={() => setSeat(true)} />
        </Stage>
      )}
    </div>
  );
  return { node, open, openLeave: () => setSignLeave(true) };
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <rect x="3" y="2" width="3.6" height="12" rx="1.2" fill="currentColor" />
      <rect x="9.4" y="2" width="3.6" height="12" rx="1.2" fill="currentColor" />
    </svg>
  );
}
