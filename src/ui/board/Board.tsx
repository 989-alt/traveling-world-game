// 보드 화면 (PRD §8-3, §11, §12; DESIGN §7·§16). 1366×768 스테이지를 화면에 맞춰 통째로 늘이고 줄인다.
// 레이어 2개(§16.6): board-world(광장·칸 30·다리·이정표·마스크·깃발·건물·말·귀퉁이 캐릭터 — 줌은 이것만) / board-hud(패널·주사위·타이머·독점 띠).
// U5(§16.9.2·§16.9.3): 캐릭터가 둘 — 광장 네 귀 돌 단 위 전신 96px(이모션·반응은 여기서만, 5~10초) + 칸 위 말 44px(이모션 0: 홉·깃발·망치·표류·쓰러짐).
// 칸 윗면·공터는 TILES[n].top/.anchor(geometry), 사람·건물 자리는 place()(layout)에서만 온다. 칸 이름은 칸 그림 속 볼트 이름표(코드 글자 없음).
import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { assetUrl, boardKeys } from '../../assets/manifest';
import { Pic } from '../../assets/AssetImg';
import { isLoaded, preload } from '../../assets/preload';
import { BOARD, BOARD_SIZE, continentTiles, type Continent, type Tile } from '../../shared/board';
import { LAST_MINUTES_MS } from '../../shared/economy';
import type { GameState, LogEvent, Seat } from '../../shared/types';
import { josa } from '../../state/nick';
import { Character, type Ambient } from '../characters/Character';
import { cuesFor, isTokenMotion, type MotionId } from '../characters/motions';
import { MotionScheduler } from '../characters/scheduler';
import { playConfetti } from '../cutscene/confetti';
import { HOP_GAP_MS, MAX_HOP, PICK_BOT_FLASH_MS } from '../../shared/timing';
import { PICK_STEPS } from '../../shared/types';
import { PICK_LIFT, PickLayer, type BoardPick, type TilePick } from './PickLayer';
import { camShift, useCamera, ZOOM } from './camera';
import { DiceCup } from './DiceCup';
import { ROLL_GIVE_UP_MS, rollTimes, type RollShow } from './dice-show';
import { HangSign } from './HangSign';
import { boxesHit, BRIDGES, CHAR, CORNER_FEET, CORNER_HS, HUD, hudBoxes, PLAZA_ART, SIGNPOSTS, STAGE, TILES, type SignGeo, type TileGeo } from './geometry';
import { place } from './layout';
import { flagClip, ownGeo } from './own-geo';
import { CoinFlyLayer, useCoinFx } from './CoinFx';
import { PlayerPanel } from './PlayerPanel';
import { usePortrait } from './RotateGuard';
import { fitScale } from '../device/stage';
import '../../styles/ribbon.css';
import '../../styles/board.css';

export type BoardGame = Pick<GameState, 'tiles' | 'players' | 'turn' | 'clock' | 'settings' | 'phase'> & { monopolies?: GameState['monopolies'] };
export interface BoardPlayer { seat: Seat; charId: number; name: string; isBot: boolean }
export interface BoardProps {
  game: BoardGame;
  players: BoardPlayer[];
  mySeat: Seat | null;
  /** 서버 로그(앞에서부터 누적). 새로 붙은 이벤트만 반응 모션으로 바꾼다 */
  log?: LogEvent[];
  /** 모달·카드가 보드를 덮고 있음 → 대기 모션 정지 */
  covered?: boolean;
  /** 주사위: 뗀 게이지 위치 0~1 하나만 보낸다 */
  onRoll?: (gauge: number) => void;
  /** 줌 끔(재접속 전체 다시 받기 등). reduced-motion·탭 숨김은 Board 가 알아서 끈다 */
  noZoom?: boolean;
  /** 줌이 걸림/풀림(§16.6): 풀린 뒤에 카드·문항을 연다 */
  onCamera?: (active: boolean) => void;
  /** 개발 하네스 전용: 착지 뒤 머무는 시간(줌 스냅샷) */
  zoomHoldMs?: number;
  /** game.clock 을 받은 이 기기 시각(ms). 있으면 다음 상태가 올 때까지 간판 시계를 1초마다 줄여 보인다(표시만) */
  clockAt?: number;
  /** U10 보드에서 칸 고르기(DESIGN §18): 세계여행·내 땅으로·축제 단계. 없으면 평소 판 */
  pick?: BoardPick | null;
  /** 알림 카드가 떠 있음(§18.5): 내 컵 disabled + 옅게 .6 */
  locked?: boolean;
}

/** 독점 연출 타임라인(§16.5, ms) */
export const MONO = { glow: 200, hop2: 540, paint: 500, band: 600, end: 3000, reducedBanner: 2000 } as const;

const id = (s: Seat) => String(s);
const buildingKey = (t: number, level: number) => (level >= 4 ? `landmark.${t}` : `building.${t}.${level}`);
/** 대륙 → 토큰 이름(continent-*) */
export const CONT_VAR: Record<Continent, string> = {
  asia: 'continent-asia', europe: 'continent-europe', africa: 'continent-africa', namerica: 'continent-north-america', samerica: 'continent-south-america',
};
const CONT_NAME: Record<Continent, string> = { asia: '아시아', europe: '유럽', africa: '아프리카', namerica: '북아메리카', samerica: '남아메리카' };
/** 칸 환경광(캐릭터 색감을 칸 그림에 맞춘다): 눈·얼음 칸은 차게, 사막 칸은 따뜻하게 */
const AMBIENT: Partial<Record<number, Ambient>> = { 8: 'cool', 15: 'cool', 21: 'cool', 5: 'warm', 16: 'warm', 29: 'warm' };

type Mono = { continent: Continent; seat: Seat };

/** 판 그림을 못 받아도 이 시간 뒤엔 판을 연다(그림마다 실패 폴백이 있다) */
export const BOARD_LOAD_LIMIT_MS = 8000;

export function Board({ game, players, mySeat, log, covered, onRoll, noZoom, onCamera, zoomHoldMs, clockAt, pick = null, locked = false }: BoardProps) {
  // ── 판 그림 받기: 로비를 거치지 않고 들어오면(새로고침·재접속) 빈 칸 대신 '판 펼치는 중' ──
  const [art, setArt] = useState(() => isLoaded(boardKeys()));
  useEffect(() => {
    if (art) return;
    let live = true;
    const h = setTimeout(() => live && setArt(true), BOARD_LOAD_LIMIT_MS);
    void preload(boardKeys()).then(() => live && setArt(true));
    return () => { live = false; clearTimeout(h); };
  }, []);
  // ── 화면 맞춤 ──
  const [scale, setScale] = useState(1);
  // 가로 전용 게임: 세로면 게임 루트의 RotateGuard 가 덮는다(QA6). 보드는 대기 모션만 멈춘다
  const portrait = usePortrait();
  useLayoutEffect(() => {
    const fit = () => setScale(fitScale());
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setReduced(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);

  // ── 모션 스케줄러 둘(U5 §16.9.3): 귀퉁이 전신 캐릭터 = 이모션·반응(A 5~10초, 동시 ≤ 2) / 판 위 말 = 행동만(A 없음) ──
  const [, setTick] = useState(0);
  const sched = useMemo(() => new MotionScheduler({ onChange: () => setTick((t) => t + 1) }), []);
  const token = useMemo(() => new MotionScheduler({ onChange: () => setTick((t) => t + 1), maxIdle: 0 }), []);
  useEffect(() => () => { sched.dispose(); token.dispose(); }, []);
  /** 모션을 누가 하나: 말 모션(홉·깃발·망치·표류·쓰러짐)은 칸 위 말, 나머지는 귀퉁이 캐릭터 */
  const cue = (x: string, m: MotionId) => (isTokenMotion(m) ? token : sched).trigger(x, m);
  const seated = useRef<string[]>([]);
  useEffect(() => {
    const ids = players.map((p) => id(p.seat));
    seated.current.filter((x) => !ids.includes(x)).forEach((x) => { sched.remove(x); token.remove(x); }); // 나간 자리
    seated.current = ids;
    ids.forEach((x) => { sched.add(x); token.add(x); });
    preload(players.flatMap((p) => Array.from({ length: 17 }, (_, i) => `char.${p.charId}.p${String(i + 2).padStart(2, '0')}`)));
  }, [players.map((p) => `${p.seat}:${p.charId}`).join()]);

  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const f = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const [zoomed, setZoomed] = useState(false);
  /** 주사위 연출 중(§17.1.2): 줌처럼 카드·문항을 늦춘다(Game 의 onCamera). 이동이 시작돼 줌이 걸리면 그쪽이 이어받는다 */
  const [, setDiceHoldS] = useState(false);
  // 줌 걸림 || 주사위 연출 중 → onCamera. 바뀐 그 자리에서 바로 알린다(한 렌더 늦으면 줌이 풀린 직후 카드가 늦게 뜬다)
  const camRef = useRef({ zoomed: false, hold: false, flash: false, sent: false as boolean | null });
  const camCb = useRef(onCamera);
  camCb.current = onCamera;
  const reportCam = () => {
    const c = camRef.current, on = c.zoomed || c.hold || c.flash;
    if (c.sent === on) return;
    c.sent = on;
    camCb.current?.(on);
  };
  const setDiceHold = (v: boolean) => { camRef.current.hold = v; setDiceHoldS(v); reportCam(); };
  useEffect(() => sched.setPaused(!!covered || hidden || zoomed || portrait), [covered, hidden, zoomed, portrait]); // 대기 모션 A 는 줌 동안 정지(§16.6), 세로 안내 동안 정지(QA6)
  useEffect(() => sched.markTurn(id(game.turn.seat)), [game.turn.seat]);

  // 무인도 표류·파산(쓰러짐 → 회색, 다른 사람은 놀람)
  const wasOut = useRef<boolean[]>(game.players.map((p) => p.bankrupt));
  useEffect(() => {
    game.players.forEach((p, s) => {
      token.setDrifting(id(s as Seat), p.islandTurns > 0 && !p.bankrupt);
      if (p.bankrupt && !wasOut.current[s]) {
        sched.setBankrupt(id(s as Seat)); // 귀퉁이·말 둘 다 쓰러짐 → 회색
        token.setBankrupt(id(s as Seat));
        players.forEach((o) => o.seat !== s && sched.trigger(id(o.seat), 'surprised'));
      }
    });
    wasOut.current = game.players.map((p) => p.bankrupt);
  }, [game.players.map((p) => `${p.islandTurns}:${p.bankrupt}`).join()]);

  // ── 독점 연출(§16.5): 글로우 → 마스크·이정표 자리색(영구) → 띠 + 색종이 → 글로우 끔 ──
  const [painted, setPainted] = useState<Mono[]>(() => game.monopolies ?? []);
  const [glow, setGlow] = useState<Mono | null>(null);
  const [band, setBand] = useState<(Mono & { key: number }) | null>(null);
  const pending = useRef(new Set<Continent>());
  const monoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => monoTimers.current.forEach(clearTimeout), []);
  const paint = (m: Mono) => setPainted((cur) => (cur.some((x) => x.continent === m.continent) ? cur : [...cur, m]));
  const playMonopoly = (m: Mono) => {
    pending.current.add(m.continent);
    const at = (ms: number, f: () => void) => monoTimers.current.push(setTimeout(f, ms));
    const key = Date.now();
    if (reduced) { // 즉시 글로우·자리색, 띠·색종이 없이 배너 2초
      setGlow(m); paint(m); setBand({ ...m, key });
      at(MONO.reducedBanner, () => setBand((b) => (b?.key === key ? null : b)));
      at(MONO.end, () => { setGlow((g) => (g === m ? null : g)); pending.current.delete(m.continent); });
      return;
    }
    at(MONO.glow, () => { setGlow(m); token.trigger(id(m.seat), 'hop'); });
    at(MONO.hop2, () => token.trigger(id(m.seat), 'hop'));
    at(MONO.paint, () => paint(m));
    at(MONO.band, () => setBand({ ...m, key }));
    at(MONO.end, () => { setGlow((g) => (g === m ? null : g)); setBand((b) => (b?.key === key ? null : b)); pending.current.delete(m.continent); });
  };

  // ── 주사위 B(§17.1): 굴림 한 번 = RollShow. 내가 떼면 바로(눈은 서버가), 남·봇은 서버 눈이 온 순간(봇은 흔들기 600 뒤). 이동은 그 연출 뒤에 ──
  const [roll, setRoll] = useState<RollShow | null>(null);
  const rollRef = useRef<RollShow | null>(null);
  const rollSeq = useRef(0);
  /** 이 시각(performance.now) 전에는 이동(홉·줌)을 시작하지 않는다 = 굴림 연출 끝(+1830 / reduced 900) */
  const moveGate = useRef(0);
  const diceTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => diceTimers.current.forEach(clearTimeout), []);
  const showRoll = (r: RollShow | null) => {
    rollRef.current = r;
    setRoll(r);
    diceTimers.current.forEach(clearTimeout);
    diceTimers.current = [];
    if (!r) { setDiceHold(false); return; }
    setDiceHold(true);
    const now = performance.now();
    const t = rollTimes(r);
    if (t) {
      moveGate.current = t.end;
      // 이동이 시작되면 줌(onActive)이 이어받는다. 줌이 안 걸리는 이동(움직임 줄임·제자리)도 조금 뒤 푼다
      diceTimers.current.push(setTimeout(() => setDiceHold(false), t.end - now + 250));
    } else if (r.mine) { // 서버 눈이 안 오면(거부·끊김) 컵을 대기로
      diceTimers.current.push(setTimeout(() => { if (rollRef.current?.id === r.id && rollRef.current.d1 === undefined) showRoll(null); }, ROLL_GIVE_UP_MS));
    }
  };
  /** 서버 주사위 이벤트 → 연출. 내가 뗀 굴림이면 그 연출에 눈만 채운다 */
  const onDice = (e: Extract<LogEvent, { ev: 'dice' }>) => {
    const now = performance.now();
    const cur = rollRef.current;
    if (cur && cur.mine && cur.d1 === undefined && cur.seat === e.seat) return showRoll({ ...cur, d1: e.d1, d2: e.d2, gotAt: now });
    // U10(S13 실측): 봇 굴림도 받은 순간 바로 쏟는다. 옛 '흔들기 600 뒤 쏟기'는 서버 연출 합(DICE_SHOW_MS 1830)에 없는 화면 시간이라
    // 그만큼 이동·도착 카드가 늦게 떠 문화 카드 첫 방문이 4.3초만 보였다(서버 마감은 그대로). 화면 = 서버 시간
    showRoll({ id: ++rollSeq.current, seat: e.seat, t0: now, d1: e.d1, d2: e.d2, gotAt: now, mine: false, reduced });
  };

  // 새 로그 → 반응·내 턴 모션, 독점 연출
  const seen = useRef(log?.length ?? 0);
  const owners = useRef(game.tiles.map((t) => t.owner));
  useEffect(() => {
    if (!log) return;
    if (log.length < seen.current) seen.current = 0; // 새 판
    const seats = players.map((p) => p.seat);
    for (const ev of log.slice(seen.current)) {
      for (const c of cuesFor(ev, seats, owners.current)) cue(id(c.seat), c.motion);
      if (ev.ev === 'event' && ev.kind === 'monopoly') playMonopoly({ continent: ev.payload.continent as Continent, seat: ev.seat });
      // 재접속 다시 받기·탭 숨김은 연출 없이 바로(이동도 바로)
      if (ev.ev === 'dice') { if (noZoom || document.hidden) { moveGate.current = 0; showRoll(null); } else onDice(ev); }
    }
    seen.current = log.length;
    owners.current = game.tiles.map((t) => t.owner);
  }, [log?.length]);
  // 상태가 기준: 영구 자리색(재접속·로그 없이 온 독점)은 연출 없이 바로 칠하고, 상태에 없는 색(새 판)은 지운다. 연출 중인 대륙은 연출이 칠한다
  useEffect(() => {
    const st = game.monopolies ?? [];
    setPainted((cur) => {
      const keep = cur.filter((m) => pending.current.has(m.continent) || st.some((x) => x.continent === m.continent && x.seat === m.seat));
      const add = st.filter((m) => !pending.current.has(m.continent) && !keep.some((x) => x.continent === m.continent));
      return keep.length === cur.length && !add.length ? cur : [...keep, ...add];
    });
  }, [(game.monopolies ?? []).map((m) => `${m.continent}:${m.seat}`).join()]);

  // ── 코인 연출(롤링 숫자·증감 팝·코인 흐름): 이동 연출이 끝난 뒤. 재접속 다시 받기·탭 숨김은 바로 최종값 ──
  const coinFx = useCoinFx({
    coins: game.players.map((p) => p.coin), bankrupt: game.players.map((p) => p.bankrupt), owners: game.tiles.map((t) => t.owner),
    log, instant: !!noZoom || hidden, reduced,
  });

  // ── U10 칸 고르기(DESIGN §18): 내 선택 · 확정 · 봇 반짝 ──
  const pickKey = pick ? `${pick.kind}|${pick.seat}` : '';
  const [sel, setSel] = useState<number | null>(null);
  const [rover, setRover] = useState(-1);
  /** 확정한(또는 사람이 확정해 이동이 온) 칸: scale 200ms 를 끝까지 보이고 걷는다. tile −1 = 축제 "이번엔 안 고를래요"(칸 없음, 잠금만).
   *  seat = 테 자리색(고르기 단계가 끝난 뒤에도 해제까지 자리색 유지, §18.1) */
  const [conf, setConf] = useState<{ tile: number; key: number; seat: Seat } | null>(null);
  const confSeq = useRef(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    // 다시 받기(새로고침·재접속) 중 고르던 사람: 서버에 남은 선택 표시(turn.preview)로 시작 — 마감 때 그 칸으로 확정되므로 내 화면에도 보여야 한다
    setSel(pick?.mine && pick.preview !== null && pick.eligible.includes(pick.preview) ? pick.preview : null);
    if (pick) setRover(pick.eligible.length ? [...pick.eligible].sort((a, b) => a - b)[0] : -1);
    if (pick) setConf(null);
  }, [pickKey]);
  useEffect(() => {
    if (!conf) return;
    const k = conf.key;
    // 고르기가 끝났으면 220ms(확정 scale) 뒤 해제. 아직 고르는 중이면(서버가 확정을 거부·유실) ROLL_GIVE_UP_MS 뒤 풀어 다시 고를 수 있게
    const h = setTimeout(() => setConf((c) => (c?.key === k ? null : c)), pickRef.current ? ROLL_GIVE_UP_MS : 220);
    return () => clearTimeout(h);
  }, [conf?.key, pickKey]);
  const select = (t: number) => {
    if (!pick?.mine || conf || sel === t) return;
    setSel(t);
    pick.onPreview?.(t); // 선택이 바뀔 때만 서버에 보낸다(관전자 중계)
  };
  const clearSel = () => {
    if (!pick?.mine || conf || sel === null) return;
    setSel(null);
    pick.onPreview?.(null);
  };
  const confirm = (t: number) => {
    if (!pick?.mine || conf || !pick.eligible.includes(t)) return;
    setConf({ tile: t, key: ++confSeq.current, seat: pick.seat });
    pick.onConfirm?.(t); // 한 번만: 그 뒤 칸·단추 disabled
  };
  /** 축제 "이번엔 안 고를래요": 확정과 같이 한 번만, 그 뒤 칸·단추 잠금 */
  const skip = () => {
    if (!pick?.mine || conf || !pick.onSkip) return;
    setConf({ tile: -1, key: ++confSeq.current, seat: pick.seat });
    pick.onSkip();
  };
  // 고르기 단계가 끝남(서버 상태): 그 칸 = 이동 로그(세계여행 · 내 땅으로) 또는 축제 지정(festivalTarget).
  // 봇이 골랐으면 그 칸을 1초 반짝인 뒤에 이동을 시작한다(서버가 PICK_BOT_FLASH_MS 를 마감에 더함), 사람이면 확정 scale 만
  const [flash, setFlash] = useState<{ tile: number; seat: Seat; key: number } | null>(null);
  const flashGate = useRef<{ seat: number; until: number } | null>(null);
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => flashTimers.current.forEach(clearTimeout), []);
  const prevPick = useRef<{ seat: Seat; step: string; logLen: number } | null>(null);
  useEffect(() => {
    const { seat, step } = game.turn;
    const len = log?.length ?? 0;
    const prev = prevPick.current;
    const picking = (PICK_STEPS as readonly string[]).includes(step);
    if (picking && prev?.seat === seat && prev.step === step) return; // 아직 고르는 중
    prevPick.current = picking ? { seat, step, logLen: len } : null;
    if (!prev || noZoom || document.hidden) return;
    let tile = -1;
    if (prev.step === 'festival') tile = game.tiles.findIndex((t) => t.owner === prev.seat && t.festivalTarget);
    else {
      const via = prev.step === 'travel' ? 'travel' : 'mission';
      for (let i = len - 1; i >= prev.logLen && log; i--) {
        const e = log[i];
        if (e.ev === 'move' && e.seat === prev.seat) { if (e.via === via) tile = e.to; break; }
      }
    }
    if (tile < 0) return;
    if (players.find((p) => p.seat === prev.seat)?.isBot) {
      const key = Date.now();
      flashGate.current = { seat: prev.seat, until: performance.now() + PICK_BOT_FLASH_MS };
      setFlash({ tile, seat: prev.seat, key });
      camRef.current.flash = true; // 반짝이는 동안 카드·문항을 늦춘다(줌이 이어받는다)
      reportCam();
      flashTimers.current.push(setTimeout(() => setFlash((f) => (f?.key === key ? null : f)), PICK_BOT_FLASH_MS));
      flashTimers.current.push(setTimeout(() => { camRef.current.flash = false; reportCam(); }, PICK_BOT_FLASH_MS + 250));
    } else setConf((c) => (c?.tile === tile ? c : { tile, key: ++confSeq.current, seat: prev.seat }));
  }, [game.turn.seat, game.turn.step, log?.length]);

  // ── 이동: 칸당 1홉 ──
  const [shown, setShown] = useState(() => ({ pos: game.players.map((p) => p.pos), hop: game.players.map(() => false), busy: game.players.map(() => false) }));
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // 자리마다 따로 홉 타이머를 둔다: 한 사람의 목표가 바뀌어도 다른 사람의 홉은 끊기지 않는다
  const hopTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const targets = useRef(game.players.map((p) => p.pos));
  /** 카메라가 따라가는 이동자(마지막으로 움직이기 시작한 자리) */
  const [mover, setMover] = useState<Seat | null>(null);
  const noZoomRef = useRef(noZoom);
  noZoomRef.current = noZoom;
  const [zoomOff, setZoomOff] = useState(false); // 이번 이동은 줌 없이(재접속 다시 받기)
  /** 굴림 연출이 끝나길 기다리는 이동(자리) — 기다리는 동안도 '이동 중'(data-hopping) */
  const [waitMove, setWaitMove] = useState<number[]>([]);
  /** 이동 중 말 머리 위 합 칩(판 레이어): 홉마다 따라가고 착지 +300 에 사라진다 */
  const [hopChip, setHopChip] = useState<{ seat: Seat; n: number; key: number } | null>(null);
  useEffect(() => () => hopTimers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const set = (s: number, patch: { pos?: number; hop?: boolean; busy?: boolean }) =>
      setShown((cur) => {
        const next = { pos: [...cur.pos], hop: [...cur.hop], busy: [...cur.busy] };
        if (patch.pos !== undefined) next.pos[s] = patch.pos;
        if (patch.hop !== undefined) next.hop[s] = patch.hop;
        if (patch.busy !== undefined) next.busy[s] = patch.busy;
        return next;
      });
    game.players.forEach((p, s) => {
      if (targets.current[s] === p.pos) return; // 목표가 그대로인 자리는 건드리지 않는다
      targets.current[s] = p.pos;
      clearTimeout(hopTimers.current.get(s));
      setWaitMove((w) => (w.includes(s) ? w.filter((x) => x !== s) : w));
      // 서버 이동 로그(from → to)가 있으면 그 출발 칸에서 센다: 화면과 서버(도착 단계 마감 늦춤 = 이동 연출 시간)의 홉 수가 같게
      let mv: Extract<LogEvent, { ev: 'move' }> | undefined;
      for (let i = (log?.length ?? 0) - 1; i >= 0 && !mv; i--) { const e = log![i]; if (e.ev === 'move' && e.seat === s) mv = e; }
      const from = mv && mv.to === p.pos ? mv.from : shownRef.current.pos[s];
      const d = (p.pos - from + BOARD_SIZE) % BOARD_SIZE;
      if (d === 0) return set(s, { busy: false });
      const to = p.pos;
      // 주사위 B(§17.1.2): 이 자리의 굴림 연출이 끝난 뒤(뗌 +1830)에 홉·줌을 시작하고, 합 숫자는 말 머리 위 칩으로 옮겨 탄다
      const r = rollRef.current;
      const fg = flashGate.current;
      const wait = Math.max(r && r.seat === s ? moveGate.current - performance.now() : 0, fg && fg.seat === s ? fg.until - performance.now() : 0, 0);
      const chip = r && r.seat === s && !r.reduced && r.d1 !== undefined && mv?.via === 'dice' ? r.d1 + r.d2! : null;
      const go = () => {
        setWaitMove((w) => w.filter((x) => x !== s));
        setMover(s as Seat);
        setZoomOff(!!noZoomRef.current);
        if (chip !== null) setHopChip({ seat: s as Seat, n: chip, key: r!.id });
        const land = () => {
          set(s, { busy: false });
          if (chip !== null) hopTimers.current.set(s + 100, setTimeout(() => setHopChip((c) => (c?.key === r!.id ? null : c)), 300));
        };
        if (d > MAX_HOP) { // 순간 이동(세계여행·무인도 등): 도착 칸으로 카메라가 날아간다
          set(s, { pos: to, hop: false, busy: true });
          hopTimers.current.set(s, setTimeout(land, HOP_GAP_MS));
          return;
        }
        let i = 0;
        const step = () => {
          i++;
          set(s, { pos: (from + i) % BOARD_SIZE, hop: true, busy: true });
          token.trigger(id(s as Seat), 'hop');
          hopTimers.current.set(s, setTimeout(i < d ? step : land, HOP_GAP_MS));
        };
        step();
      };
      if (wait > 0) {
        setWaitMove((w) => (w.includes(s) ? w : [...w, s]));
        hopTimers.current.set(s, setTimeout(go, wait));
      } else go();
    });
  }, [game.players.map((p) => p.pos).join()]);

  // ── 칸별 배치 ──
  const occupants: Seat[][] = Array.from({ length: BOARD_SIZE }, () => []);
  players.forEach((p) => occupants[shown.pos[p.seat]]?.push(p.seat));
  const feet = new Map<Seat, { x: number; y: number; h: number }>();
  occupants.forEach((occ, t) => {
    if (!occ.length) return;
    const pl = place(TILES[t], occ.length, false); // 건물은 윗면 밖(앞 모서리 발코니, §17.2) — 말 배치에 안 걸린다
    occ.forEach((s, i) => feet.set(s, { ...pl.feet[i], h: pl.h }));
  });

  // ── 줌 카메라(§16.6): 이동자 발 앵커를 화면 가운데로, world 하나만 ──
  const cam = useCamera({
    focus: mover !== null ? feet.get(mover) ?? null : null,
    moving: mover !== null && shown.busy[mover],
    enabled: !reduced && !hidden && !zoomOff,
    onActive: (on) => { camRef.current.zoomed = on; setZoomed(on); reportCam(); },
    holdMs: zoomHoldMs,
  });


  // 줌된 이동자가 HUD 패널 뒤로 들어가면 그 패널만 옅게(위치·크기 불변 — 얼굴을 가리지 않게)
  const moverFeet = mover !== null ? feet.get(mover) : undefined;
  const veiled = new Set<string>();
  if (cam.active && cam.phase !== 'out' && moverFeet) {
    const s = ZOOM.scale, { tx, ty } = camShift(s, moverFeet), k = (moverFeet.h / CHAR.h) * s;
    const sx = moverFeet.x * s + tx, sy = moverFeet.y * s + ty;
    const body = { x: sx - (CHAR.w / 2) * k - 8, y: sy - CHAR.h * k - 12, w: CHAR.w * k + 16, h: CHAR.h * k + 16 };
    for (const b of hudBoxes()) if (b.id.startsWith('panel') && boxesHit(b.box, body)) veiled.add(b.id);
  }

  /** 이동 중(홉·굴림 연출 기다림): 컵은 쏟기 ~ 이동 끝까지 못 누른다 */
  const moving = shown.busy.some(Boolean) || waitMove.length > 0;
  const myTurn = mySeat !== null && game.phase === 'playing' && game.turn.seat === mySeat && game.turn.step === 'roll' && !game.players[mySeat].bankrupt;
  const glowTiles = glow ? continentTiles(glow.continent) : [];
  const ownerOf = (c: Continent) => painted.find((m) => m.continent === c)?.seat ?? null;
  const nameOf = (s: Seat) => players.find((p) => p.seat === s)?.name ?? `${s + 1}번`;

  // 칸 묶음 상태(§18.1): 고르기 단계엔 줌이 없다 — 줌이 걸려 있으면(앞 사람 이동 연출) 풀린 뒤에 밝힌다
  const pickOn = !!pick && !cam.active;
  const eligible = new Set(pickOn ? pick!.eligible : []);
  const mark = pickOn ? (pick!.mine ? sel : pick!.preview) : null;
  const tilePick = (i: number): TilePick | undefined => {
    if (flash?.tile === i) return 'flash';
    if (conf?.tile === i) return 'confirm';
    if (!pickOn) return undefined;
    if (!eligible.has(i)) return 'dim';
    return mark === i ? 'sel' : 'lit';
  };
  const ringSeat = flash ? flash.seat : pick ? pick.seat : conf ? conf.seat : null;
  const pickStates = TILES.map((g) => tilePick(g.index));

  return (
    <div class="board-root" data-hopping={shown.busy.some(Boolean) || waitMove.length > 0 ? '1' : '0'} data-art={art ? '1' : '0'}>
      <Pic k="ui.boardBg" class="board-bg" fallback={<span class="board-bg board-bg--fallback" />} eager />
      <div class="board-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }} data-scale={scale}>
        {/* ── 판 레이어(줌 대상) ── */}
        <div class={`board-cam${cam.active ? ' is-zoom' : ''}`} data-cam={cam.phase}>
        <div class="board-world" style={cam.style}>
          <AmbientFilters />
          <div class="plaza" style={box(PLAZA_ART)}>
            <Pic k="plaza" class="plaza-img" alt="세계 지도 광장" fallback={<span class="plaza-fallback" />} eager />
          </div>
          {SIGNPOSTS.map((s) => <PlazaMask key={s.continent} continent={s.continent} seat={ownerOf(s.continent)} reduced={reduced} />)}

          {TILES.map((g) => (
            <Island key={g.index} g={g} tile={BOARD[g.index]} current={game.turn.tile === g.index} glow={glowTiles.includes(g.index)}
              pick={pickStates[g.index]} ring={ringSeat} />
          ))}
          <Bridges />
          {SIGNPOSTS.map((s) => <Signpost key={s.continent} s={s} seat={ownerOf(s.continent)} />)}

          {/* 땅 주인·건물 C2(§17.2): 뒤 기둥 + 삼각기 7 · 뒤오른쪽 바깥 세로 깃발(길이 = 단계, 4단계 금별) · 앞오른쪽 절벽 발코니 위 건물 미니어처.
              윗면 가운데(공터 = 말 자리)엔 아무것도 없다 — 건물이 칸 풍경을 가리지 않는다(사용자 2026-10-30) */}
          {TILES.map((g) => {
            const ts = game.tiles[g.index];
            return ts.owner === null ? null : <Ownership key={g.index} g={g} seat={ts.owner} level={ts.level} pick={pickStates[g.index]} />;
          })}

          {players.map((p) => {
            const f = feet.get(p.seat);
            if (!f) return null;
            const t = shown.pos[p.seat];
            return (
              <Character key={p.seat} seat={p.seat} tile={t} charId={p.charId} name={p.name} x={f.x} y={f.y} h={f.h} ambient={AMBIENT[t] ?? null}
                hop={shown.hop[p.seat]} crowded={occupants[t].length > 1} playing={token.get(id(p.seat))} grey={token.isGrey(id(p.seat))} reduced={reduced}
                lift={!shown.busy[p.seat] && pickStates[t] ? PICK_LIFT[pickStates[t]!] : 0} />
            );
          })}
          {hopChip && feet.get(hopChip.seat) && (() => {
            const f = feet.get(hopChip.seat)!;
            return <b key={hopChip.key} class="hop-chip" data-seat={hopChip.seat} style={{ left: `${f.x}px`, top: `${f.y - f.h - 4}px` }}>{hopChip.n}</b>;
          })()}
          {/* 광장 네 귀 돌 단 위 전신 캐릭터(U5 §16.9.2): 자리 1·2 위, 3·4 아래. 이모션·반응은 여기서만 */}
          {players.map((p) => {
            const f = CORNER_FEET[p.seat];
            return (
              <Character key={`c${p.seat}`} corner seat={p.seat} tile={-1} charId={p.charId} name={p.name} x={f.x} y={f.y} h={CORNER_HS[p.seat]}
                hop={false} crowded={false} playing={sched.get(id(p.seat))} grey={sched.isGrey(id(p.seat))} reduced={reduced} />
            );
          })}
        </div>
        </div>

        {/* ── 화면 레이어(HUD, 줌에 안 커짐) ── */}
        <div class={`board-hud${cam.active && cam.phase !== 'out' ? ' is-cam' : ''}`} data-cam={cam.phase}>
          <TimerSign game={game} clockAt={clockAt} />

          {players.map((p) => (
            <PlayerPanel key={p.seat} seat={p.seat} name={p.name} isBot={p.isBot} at={HUD.panels[p.seat]}
              coin={game.players[p.seat].coin} shownCoin={coinFx.shown[p.seat]} rolling={coinFx.animate} shake={coinFx.shake[p.seat]}
              pops={coinFx.pops.filter((x) => x.seat === p.seat)} turn={game.phase === 'playing' && game.turn.seat === p.seat}
              me={p.seat === mySeat} out={game.players[p.seat].bankrupt} veiled={veiled.has(`panel${p.seat + 1}`)} />
          ))}

          <div class={`dice-wrap${cam.active ? ' is-cam' : ''}${pick || conf ? ' is-pick' : ''}${locked && !roll ? ' is-locked' : ''}`} style={{ left: `${HUD.dice.x}px`, top: `${HUD.dice.y}px` }}>
            <DiceCup
              enabled={myTurn && !moving && !locked && !pick}
              dim={!myTurn && !roll}
              show={roll}
              holdSum={moving}
              onPressStart={() => mySeat !== null && sched.trigger(id(mySeat), 'expect')}
              onCancel={() => mySeat !== null && sched.stop(id(mySeat), 'expect')}
              onDone={(rid) => { if (rollRef.current?.id === rid) { rollRef.current = null; setRoll(null); } }}
              onRelease={(g) => {
                if (mySeat !== null) sched.stop(id(mySeat), 'expect');
                if (mySeat !== null) showRoll({ id: ++rollSeq.current, seat: mySeat, t0: performance.now(), mine: true, reduced });
                onRoll?.(g);
              }}
            />
          </div>

          {pickOn && (
            <PickLayer pick={pick!} sel={mark} conf={conf?.tile ?? null} rover={rover} setRover={setRover}
              onSelect={select} onConfirm={confirm} onClear={clearSel} onSkip={skip} />
          )}

          <CoinFlyLayer flies={coinFx.flies} />
          {band && <MonopolyBand key={band.key} name={nameOf(band.seat)} continent={band.continent} seat={band.seat} reduced={reduced} />}
        </div>
      </div>
      {!art && (
        <div class="board-loading" role="status">
          <span class="board-loading-card"><span class="board-loading-dot" aria-hidden="true" />판 펼치는 중…</span>
        </div>
      )}
    </div>
  );
}

const box = (b: { x: number; y: number; w: number; h: number }) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

/** 땅 주인·건물 C2(§17.2·§17.2.1) 한 칸. 기둥·밧줄 = 코드 SVG(다리 밧줄과 같은 선), 삼각기 1장 × 7, 세로 깃발 1장을 clip-path 로 4단,
 *  4단계 금별, 발코니(자리색 테) + 건물 미니어처(BLD 1~3 · LM). 새로 꽂힘(주인)·지어짐(단계)은 key 가 바뀔 때 한 번 튀어 오른다(§13 C) */
const Ownership = memo(function Ownership({ g, seat, level, pick }: { g: TileGeo; seat: Seat; level: number; pick?: TilePick }) {
  const o = ownGeo(g, seat, level);
  const at = (b: { x: number; y: number; w: number; h: number }) => box({ x: b.x - g.img.x, y: b.y - g.img.y, w: b.w, h: b.h });
  const n = seat + 1;
  const L = (p: { x: number; y: number }) => `${(p.x - g.img.x).toFixed(1)} ${(p.y - g.img.y).toFixed(1)}`;
  return (
    <div class="own" data-tile={g.index} data-owner={seat} data-level={level} data-pick={pick}
      style={{ ...box(g.img), zIndex: g.z + 1, '--seat': `var(--seat-${n})` }} aria-hidden="true">
      <div key={`f${seat}`} class="own-flagset">
        <svg class="own-rig" viewBox={`0 0 ${g.img.w} ${g.img.h}`} width={g.img.w} height={g.img.h}>
          {/* 외곽선(남색) 먼저, 위에 나무 — 하늘·풍경 어느 쪽에서도 선이 읽힌다 */}
          <path class="own-rope own-rope--edge" d={`M${L(o.rope.a)} Q${L(o.rope.c)} ${L(o.rope.b)}`} />
          {o.posts.map((p, i) => <line key={`e${i}`} class="own-post own-post--edge" x1={p.x - g.img.x} y1={p.y0 - g.img.y} x2={p.x - g.img.x} y2={p.y1 - g.img.y} />)}
          {o.posts.map((p, i) => <line key={i} class="own-post" x1={p.x - g.img.x} y1={p.y0 - g.img.y} x2={p.x - g.img.x} y2={p.y1 - g.img.y} />)}
          <path class="own-rope" d={`M${L(o.rope.a)} Q${L(o.rope.c)} ${L(o.rope.b)}`} />
          {o.posts.map((p, i) => <circle key={`k${i}`} class="own-knob" cx={p.x - g.img.x} cy={p.y0 - g.img.y + 1.6} r="2.1" />)}
        </svg>
        <Pennants g={g} boxes={o.pennants} n={n} />
        <span class="own-flag" data-len={o.flagLen} style={{ ...at(o.flag), clipPath: flagClip(o.flagLen) }}>
          <Pic k={`own.flag.${n}`} class="own-flag-img" fallback={<span class="own-flag-img own-flag--css" />} />
        </span>
        {o.star && <Pic k="ui.star-gold" class="own-star" style={at(o.star)} fallback={<span class="own-star own-star--css" style={at(o.star)} />} />}
      </div>
      {o.balcony && o.building && (
        <div key={`b${level}`} class="own-bld" data-level={level} style={at({ x: o.balcony.x, y: o.building.y, w: o.balcony.w, h: o.balcony.y + o.balcony.h - o.building.y })}>
          <Pic k={`own.balcony.${n}`} class="own-balcony" style={box({ x: 0, y: o.balcony.y - o.building.y, w: o.balcony.w, h: o.balcony.h })}
            fallback={<span class="own-balcony own-balcony--css" style={box({ x: 0, y: o.balcony.y - o.building.y + 6, w: o.balcony.w, h: o.balcony.h - 12 })} />} />
          <Pic k={buildingKey(g.index, level)} class="own-mini" alt={`${level}단계 건물`} style={box({ x: o.building.x - o.balcony.x, y: 0, w: o.building.w, h: o.building.h })}
            fallback={<span class="own-mini own-mini--css" style={box({ x: o.building.x - o.balcony.x + 4, y: 6, w: o.building.w - 8, h: o.building.h - 6 })} />} />
        </div>
      )}
    </div>
  );
});

/** 삼각기 7 = 요소 1개에 배경 7겹(같은 그림): 소유 칸마다 그림 요소 7개를 두면 판 전체 수십 개가 되어 부하 때 칸 래스터가 늦었다(U8-impl 실측 흔들림) */
function Pennants({ g, boxes, n }: { g: TileGeo; boxes: { x: number; y: number; w: number; h: number }[]; n: number }) {
  const url = assetUrl(`own.pennant.${n}`);
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  if (!url) return <>{boxes.map((b, i) => <span key={i} class="own-pennant own-pennant--css" style={box({ x: b.x - g.img.x, y: b.y - g.img.y, w: b.w, h: b.h })} />)}</>;
  return (
    <span class="own-pennants" data-n={boxes.length} style={{
      ...box({ x: x0 - g.img.x, y: y0 - g.img.y, w: x1 - x0, h: y1 - y0 }),
      backgroundImage: boxes.map(() => `url("${url}")`).join(','),
      backgroundPosition: boxes.map((b) => `${(b.x - x0).toFixed(2)}px ${(b.y - y0).toFixed(2)}px`).join(','),
      backgroundSize: boxes.map((b) => `${b.w}px ${b.h}px`).join(','),
      backgroundRepeat: 'no-repeat',
    }} />
  );
}

/** 칸 그림 한 장. 이름표는 그림 속 볼트 판 — 그림을 못 불러올 때만 코드 이름표(폴백) */
/** pick(U10 §18.1): 고르기 상태 — 글로우 요소(.tile-pick, 그림 아래)와 칸 묶음 옅음·들어올림. ring = 자리색 테의 자리 */
const Island = memo(function Island({ g, tile, current, glow, pick, ring }: { g: TileGeo; tile: Tile; current: boolean; glow: boolean; pick?: TilePick; ring?: Seat | null }) {
  return (
    <div class={`tile tile--${g.side}${current ? ' is-current' : ''}${glow ? ' is-glow' : ''}`} data-tile={g.index} data-kind={tile.kind} data-plate={g.plate}
      data-top={g.top.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
      data-anchor={`${g.anchor.x.toFixed(2)},${g.anchor.y.toFixed(2)}`} data-top-w={g.topW.toFixed(2)}
      data-land={`${g.land.x.toFixed(2)},${g.land.y.toFixed(2)},${g.land.w.toFixed(2)},${g.land.h.toFixed(2)}`}
      data-pick={pick}
      style={{ ...box(g.img), zIndex: g.z, '--ring': pick && ring != null ? `var(--seat-${ring + 1})` : undefined }}>
      {/* 글로우 요소(§18.1, 그림 아래): 같은 칸 그림 사본에 정적 drop-shadow — 섬 모양을 따라 금 글로우 · 자리색 테(새 그림 0장). 고르기 동안만 */}
      {pick && pick !== 'dim' && (
        <span class="tile-pick" aria-hidden="true">
          <Pic k={`tile.${g.index}`} class="tile-pick-glow" eager fallback={<span class="tile-pick-box" />} />
          {pick !== 'lit' && <Pic k={`tile.${g.index}`} class="tile-pick-ring" eager fallback={<span class="tile-pick-box is-ring" />} />}
        </span>
      )}
      {current && <span class="tile-current" style={{ left: `${g.anchor.x - g.img.x}px`, top: `${g.anchor.y - g.img.y}px` }} />}
      <Pic k={`tile.${g.index}`} class="tile-img" alt={tile.name} eager fallback={
        <span class="tile-fallback" data-band={tile.continent ?? 'wood'}>
          <span class="tile-fallback-plate">{tile.name}</span>
        </span>
      } />
    </div>
  );
});

/** 칸 사이 밧줄 다리 30(코드 SVG 1종, 중립 나무 — 대륙 신호 아님 §16.3).
 *  U5: 세로 이웃 칸이 ≤ 10 겹쳐(아래 칸이 앞) 다리를 행마다 다른 층(z = 위 행 칸 + 1)에 그린다 — SVG 를 z 별로 나눈다 */
/** 층마다 SVG 는 그 층 다리들을 감싸는 상자만큼만(전체 스테이지 크기 SVG 를 여러 장 겹치면 줌 1.8 에서 그림자 필터 면이 커져 크롬이 해상도를 낮춘다) */
const BRIDGE_LAYERS = [...new Set(BRIDGES.map((b) => b.z))].sort((a, b) => a - b).map((z) => {
  const list = BRIDGES.filter((b) => b.z === z), pad = 6;
  const x0 = Math.floor(Math.min(...list.map((b) => b.box.x)) - pad), y0 = Math.floor(Math.min(...list.map((b) => b.box.y)) - pad);
  const x1 = Math.ceil(Math.max(...list.map((b) => b.box.x + b.box.w)) + pad), y1 = Math.ceil(Math.max(...list.map((b) => b.box.y + b.box.h)) + pad);
  return { z, list, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
});
const Bridges = memo(function Bridges() {
  return (<>
    {BRIDGE_LAYERS.map(({ z, list, x, y, w, h }) => (
      <svg key={z} class="board-bridges" style={{ zIndex: z, left: `${x}px`, top: `${y}px` }} viewBox={`${x} ${y} ${w} ${h}`} width={w} height={h} aria-hidden="true">
        {list.map((b) => (
          <g key={b.from} class="br" data-bridge={`${b.from}-${b.to}`} data-dir={b.dir}
            transform={b.dir === 'h' ? `translate(${b.box.x} ${b.box.y})` : `translate(${b.box.x + b.box.w} ${b.box.y}) rotate(90)`}>
            <BridgeBody len={b.dir === 'h' ? b.box.w : b.box.h} />
          </g>
        ))}
      </svg>
    ))}
  </>);
});

/** 다리 몸(가로, 길이 len × 18): 판자(5.3px 간격) + 밧줄 난간 2 + 양 끝 말뚝 4. 가로 다리 24 = 판자 4(옛 모양 그대로).
 *  세로 다리는 칸 틈 + 양쪽 걸침이 길어(≈ 56) 판자 수만 늘린다 — 늘여 그리면 판자가 뭉개진다 */
function BridgeBody({ len }: { len: number }) {
  const n = Math.max(4, Math.round((len - 2.6) / 5.3));
  const step = (len - 2.4 - 1.2) / n;
  const sag = Math.min(4, len / 8);
  return (
    <>
      <path d={`M0.5 2.6 Q${len / 2} ${2.6 + sag} ${len - 0.5} 2.6`} class="br-rope" />
      {Array.from({ length: n }, (_, i) => <rect key={i} x={2.4 + i * step} y="3.4" width={step - 0.9} height="11.4" rx="1" class="br-plank" />)}
      <path d={`M0.5 15.4 Q${len / 2} ${15.4 + sag * 0.93} ${len - 0.5} 15.4`} class="br-rope" />
      {[[0, 1], [len - 2, 1], [0, 13.6], [len - 2, 13.6]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="2" height="3.2" rx="0.7" class="br-post" />)}
    </>
  );
}

/** 이정표 = UI-signpost 그림(판 + 짧은 기둥) + 대륙색 면(독점 뒤 자리색) + 흰 글자 Jua 16 */
const Signpost = memo(function Signpost({ s, seat }: { s: SignGeo; seat: Seat | null }) {
  const face = seat === null ? `var(--${CONT_VAR[s.continent]})` : `var(--seat-${seat + 1})`;
  return (
    <div class="sign" data-continent={s.continent} data-owner={seat ?? ''} style={{ ...box(s.img), zIndex: Math.round(s.foot.y * 10) }}>
      <span class="sign-shadow" aria-hidden="true" />
      <Pic k="ui.signpost" class="sign-img" fallback={<span class="sign-fallback" />} eager />
      <span class="sign-face" style={{ ...box({ x: s.face.x - s.img.x, y: s.face.y - s.img.y, w: s.face.w, h: s.face.h }), '--face': face }}>
        <b class="sign-text">{s.name}</b>
      </span>
    </div>
  );
});

/** 광장 지도 위 대륙 마스크(독점 자리색, 영구). 마스크 그림 알파로 자리색을 칠하고 지도 명암은 살린다(mix-blend color) */
function PlazaMask({ continent, seat, reduced }: { continent: Continent; seat: Seat | null; reduced: boolean }) {
  const url = assetUrl(`plaza.mask.${continent}`);
  if (!url) return null;
  return (
    <span class={`plaza-mask${seat !== null ? ' is-on' : ''}${reduced ? ' is-instant' : ''}`} data-continent={continent} data-owner={seat ?? ''} aria-hidden="true"
      style={{ ...box(PLAZA_ART), '--mask': `url("${url}")`, '--paint': seat === null ? 'transparent' : `var(--seat-${seat + 1})` }} />
  );
}

/** 독점 띠(slide-in) + 색종이 40. reduced-motion 이면 정적 배너만 */
function MonopolyBand({ name, continent, seat, reduced }: { name: string; continent: Continent; seat: Seat; reduced: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => (reduced ? undefined : playConfetti(cv.current)), []);
  return (
    <div class={`mono${reduced ? ' is-static' : ''}`} role="status" data-continent={continent} style={{ '--seat': `var(--seat-${seat + 1})` }}>
      {!reduced && <canvas class="mono-confetti" ref={cv} width={STAGE.w} height={STAGE.h} aria-hidden="true" />}
      {/* 결과 화면과 같은 금 리본(크림 판 + 금 꼬리), 가운데. 독점자 깃발 + 닉네임은 자리색 */}
      <div class="mono-band">
        <div class="ribbon mono-ribbon">
          <p class="ribbon-title mono-title">
            <Pic k={`own.flag.${seat + 1}`} class="mono-flag" fallback={<span class="mono-flag mono-flag--css" />} />
            <b><span class="mono-who">{josa(name, '이', '가')}</span> {josa(CONT_NAME[continent], '을', '를')} 독점했어요!</b>
          </p>
        </div>
      </div>
    </div>
  );
}

/** 캐릭터 환경광 필터(정적 SVG feColorMatrix): 차가운 칸·따뜻한 칸·보통(그림 채도에 맞춤) */
const AmbientFilters = memo(function AmbientFilters() {
  return (
    <svg class="board-filters" width="0" height="0" aria-hidden="true">
      <filter id="amb-cool" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" values="0.86 0.04 0.04 0 0.02  0.02 0.94 0.06 0 0.03  0.02 0.06 1.02 0 0.07  0 0 0 1 0" />
      </filter>
      <filter id="amb-warm" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" values="1.06 0.04 0 0 0.04  0.02 0.98 0 0 0.02  0 0 0.84 0 -0.01  0 0 0 1 0" />
      </filter>
      <filter id="amb-base" color-interpolation-filters="sRGB">
        <feColorMatrix type="saturate" values="1.08" />
      </filter>
    </svg>
  );
});

/** 남은 놀이 시간 간판(DESIGN §15.5 보드 HUD, 2026-10-28 U1): 모래시계 16 + mm:ss 22px.
 *  막판(마지막 5분, 모든 길이 같음)은 간판 면이 붉고 아래에 "통행료 ×1.5" 칩. 서버 값이 기준이고, 다음 상태가 오기 전엔 받은 시각부터 1초씩 줄여 보인다 */
function TimerSign({ game, clockAt }: { game: BoardGame; clockAt?: number }) {
  const running = game.phase === 'playing' && clockAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [running, clockAt]);
  const ms = Math.max(0, game.clock.remainingMs - (running ? Math.max(0, now - clockAt!) : 0));
  const sec = Math.ceil(ms / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  const last = ms <= LAST_MINUTES_MS;
  return (
    <HangSign at={HUD.timer} class={`board-timer-sign${last ? ' is-last' : ''}`}>
      <div class="hang-plate board-timer" role="timer" data-last={last ? '1' : '0'} aria-label={`남은 시간 ${mm}분 ${ss}초${last ? ', 통행료 1.5배' : ''}`}>
        <Hourglass />
        <b>{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</b>
      </div>
      {last && <span class="board-timer-chip" aria-hidden="true">통행료 ×1.5</span>}
    </HangSign>
  );
}

export function Hourglass() {
  return (
    <svg class="board-timer-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 1.5h10M3 14.5h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M4.2 2v1.6c0 1.7 1.6 3 3.8 4.4-2.2 1.4-3.8 2.7-3.8 4.4V14M11.8 2v1.6c0 1.7-1.6 3-3.8 4.4 2.2 1.4 3.8 2.7 3.8 4.4V14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M5.6 4.2h4.8C10 5.3 9 6.2 8 6.9 7 6.2 6 5.3 5.6 4.2zM5 13c.4-1.4 1.6-2.3 3-3 1.4.7 2.6 1.6 3 3z" fill="currentColor" />
    </svg>
  );
}
