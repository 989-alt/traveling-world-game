// 개발용 보드 하네스(/dev/board). 서버 없이 엔진 상태로 보드를 띄우고, e2e 가 window.__board 로 장면을 바꾼다.
// 이 모듈을 불러오면 #app 에 바로 그린다.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../styles/tokens.css';
import '../styles/base.css';
import { createGame } from '../engine/engine';
import { BOARD_SIZE, continentTiles, type Continent } from '../shared/board';
import type { GameState, LogEvent, Seat } from '../shared/types';
import { Board, type BoardPlayer } from '../ui/board/Board';
import { GameMenu } from '../ui/screens/Game';
import { RotateGuard } from '../ui/board/RotateGuard';

const PLAYERS: BoardPlayer[] = [
  { seat: 0, charId: 1, name: '용감한 수달', isBot: false },
  { seat: 1, charId: 7, name: '꼬마 로봇', isBot: true },
  { seat: 2, charId: 4, name: '씩씩한 판다', isBot: false },
  { seat: 3, charId: 6, name: '느긋한 고래', isBot: false },
];

/** 스크린숏용 판(R4 합성): 땅 주인·건물 1~4단계·눈(그린란드)·사막(이집트)·숲(브라질)·얼음(남극) 칸 위 캐릭터·내 차례 */
function demo(): GameState {
  const g = createGame({ seed: 7, bots: [false, true, false, false] });
  const own: [tile: number, seat: Seat, level: 0 | 1 | 2 | 3 | 4][] = [
    [1, 0, 0], [2, 1, 2], [3, 0, 1], [12, 2, 3], [16, 3, 1], [22, 0, 4], [26, 2, 2], [28, 3, 3], [18, 1, 1], [13, 2, 0],
  ];
  for (const [t, s, l] of own) g.tiles[t] = { owner: s, level: l, festivalTarget: false };
  [21, 16, 27, 8].forEach((p, s) => (g.players[s].pos = p));
  [4820, 6150, 3390, 5600].forEach((c, s) => (g.players[s].coin = c));
  g.clock.remainingMs = 24 * 60_000 + 31_000;
  return g;
}

type St = { game: GameState; log: LogEvent[]; covered: boolean; key: number; resync?: boolean };
let api: { set: (f: (g: GameState) => void, remount?: boolean) => Promise<void>; raw: (f: (s: St) => St) => Promise<void> } | null = null;
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function Harness() {
  const [state, setState] = useState<St>(() => ({ game: demo(), log: [], covered: false, key: 0 }));
  const q = new URLSearchParams(location.search);
  const mySeat = (Number(q.get('seat') ?? 0) as Seat);
  const hold = q.get('hold'); // 줌 스냅샷 모드: 착지 뒤 줌을 이만큼(ms) 붙잡는다
  useEffect(() => {
    api = {
      set: (f, remount = false) => {
        setState((cur) => {
          const game = structuredClone(cur.game);
          f(game);
          return { ...cur, game, key: remount ? cur.key + 1 : cur.key };
        });
        return frames().then(frames);
      },
      raw: (f) => { setState(f); return frames().then(frames); },
    };
  }, []);
  return (<>
    <Board key={state.key} game={state.game} players={PLAYERS} mySeat={mySeat} log={state.log} covered={state.covered} noZoom={!!state.resync}
      zoomHoldMs={hold ? Number(hold) : undefined} onCamera={(on) => { (window as unknown as { __cam: boolean }).__cam = on; }}
      onRoll={(gauge) => { (window as unknown as { __lastRoll: number }).__lastRoll = gauge; }} />
    {q.get('menu') === '1' && <GameMenu host onRules={() => {}} onPause={() => {}} />}
    <RotateGuard />
  </>);
}

declare global {
  interface Window { __board: unknown }
}

window.__board = {
  /** 하네스 상태 api 가 붙었나(첫 effect 뒤) */
  ready: () => api !== null,
  /** 칸 t 에 n 명(자리 0..n-1), 나머지는 맞은편 칸. 칸 주인 = 자리 0, 단계 level. 새로 마운트해 순간 배치. */
  scene: (t: number, n: number, level: 0 | 1 | 2 | 3 | 4) =>
    api!.set((g) => {
      g.tiles.forEach((x) => { x.owner = null; x.level = 0; });
      if (level > 0) g.tiles[t] = { owner: 0, level, festivalTarget: false };
      g.players.forEach((p, s) => { p.pos = s < n ? t : (t + 20) % BOARD_SIZE; p.islandTurns = 0; p.bankrupt = false; });
    }, true),
  /** 자리 s 를 칸 p 로(12칸 이내 앞이면 칸당 1홉) */
  move: (s: Seat, p: number) => api!.set((g) => { g.players[s].pos = p; }),
  demo: () => api!.set((g) => Object.assign(g, demo()), true),
  patch: (f: (g: GameState) => void) => api!.set(f),
  /** 모달이 보드를 덮음(대기 모션 정지) */
  cover: (covered: boolean) => api!.raw((s) => ({ ...s, covered })),
  /** 서버 로그 이벤트 하나를 붙인다(반응 모션) */
  log: (ev: LogEvent) => api!.raw((s) => ({ ...s, log: [...s.log, ev] })),
  /** 코인 연출: 상태 바꾸기 + 로그 이벤트를 한 방송처럼 함께 붙인다. resync = 전체 다시 받기(연출 없이 최종값) */
  coins: (f: (g: GameState) => void, events: LogEvent[], resync = false) =>
    api!.raw((st) => {
      const game = structuredClone(st.game);
      f(game);
      return { ...st, game, log: [...st.log, ...events], resync };
    }),
  busy: () => document.querySelector('.board-root')?.getAttribute('data-hopping') === '1',
  /** 대륙 독점 성립: 그 대륙 칸 전부 자리 s 소유 + 상태 monopolies + 로그 event monopoly(연출) */
  monopoly: (continent: Continent, s: Seat) =>
    api!.raw((st) => {
      const game = structuredClone(st.game);
      for (const t of continentTiles(continent)) game.tiles[t] = { owner: s, level: game.tiles[t].level, festivalTarget: false };
      game.monopolies = [...game.monopolies.filter((m) => m.continent !== continent), { continent, seat: s }];
      return { ...st, game, log: [...st.log, { ev: 'event', seat: s, kind: 'monopoly', payload: { continent } }] };
    }),
};

render(<Harness />, document.getElementById('app')!);
