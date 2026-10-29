// 개발용 오버레이 하네스(/dev/overlay, 앱 라우트 아님). 보드(덮임) 위에 진행 화면 하나를 띄워 시안(v3 02·03)과 대조한다.
// 주소 인자: view=question|build|culture|explain|mission(m=<미션 id>)  role=player|spectator  char=1..7  tile=<칸>  level=<건물 단계 0~3>  correct=1|0
// 이 모듈을 불러오면 #app 에 바로 그린다. e2e(overlays.spec)가 index.html 의 main.tsx 를 막고 주입한다.
import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import cards from '../data/cards.json';
import { createGame } from '../engine/engine';
import { buildCost } from '../engine/pay';
import { BOARD } from '../shared/board';
import type { CultureCard as Culture } from '../shared/content-types';
import type { PublicCard } from '../shared/protocol';
import { STEP_MS } from '../shared/economy';
import { cultureOf, materialOf, questionOf } from '../state/content';
import { Board, type BoardPlayer } from '../ui/board/Board';
import { CultureCard } from '../ui/overlays/CultureCard';
import { ExplainCard } from '../ui/overlays/ExplainCard';
import { Stage } from '../ui/overlays/parts';
import { QuestionScroll } from '../ui/overlays/QuestionScroll';
import missionData from '../data/missions.json';
import type { Mission } from '../shared/content-types';
import type { MissionShown } from '../shared/protocol';
import { MissionPanel } from '../ui/missions/MissionPanel';
import { MAP_OF_IMAGE, SPOT_OF, ZONE_OF_LABEL } from '../ui/missions/map-spots';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'question';
const charId = Number(q.get('char') ?? 1);
const mine = q.get('role') !== 'spectator';
const PLAYERS: BoardPlayer[] = [
  { seat: 0, charId, name: '용감한 수달', isBot: charId === 7 },
  { seat: 1, charId: 7, name: '꼬마 로봇', isBot: true },
  { seat: 2, charId: 4, name: '씩씩한 판다', isBot: false },
  { seat: 3, charId: 6, name: '느긋한 고래', isBot: false },
];
const g = createGame({ seed: 7, bots: [false, true, false, false] });
[[1, 0, 0], [2, 1, 2], [12, 2, 3], [22, 0, 4], [26, 2, 2]].forEach(([t, s, l]) => (g.tiles[t] = { owner: s as 0, level: l as 0, festivalTarget: false }));
const rec = { answers: [] as unknown[], next: 0 };
(window as unknown as { __ov: typeof rec }).__ov = rec;
const deadline = Date.now() + Number(q.get('dur') ?? 60_000);

function Overlay() {
  if (view === 'mission') { // 게임과 같은 자리(Stage dim + ov-center)
    const m = (missionData as Mission[]).find((x) => x.id === (q.get('m') ?? 'm-04'))!;
    const ps = m.pairs ?? [];
    const mode = m.image ? MAP_OF_IMAGE[m.image] : undefined;
    const shown: MissionShown = {
      left: ps.map((x) => x.left), right: ps.map((x) => x.right), steps: m.steps ?? [],
      ...(mode === 'spots' && ps.every((x) => SPOT_OF[x.left]) ? { at: ps.map((x) => SPOT_OF[x.left]) } : {}),
      ...(mode === 'zones' ? { zones: ps.map((x) => ZONE_OF_LABEL[x.right] ?? '') } : {}),
    };
    return <Stage dim label="미션"><div class="ov-center"><MissionPanel mission={m} role={mine ? 'player' : 'spectator'} phase="play"
      deadlineAt={deadline} shown={shown} onSubmit={() => {}} /></div></Stage>;
  }
  if (view === 'culture') {
    const tile = Number(q.get('tile') ?? 4);
    const card = cultureOf(BOARD[tile].country!) as Culture;
    return <Stage dim label="문화 카드"><CultureCard card={card} tile={tile} firstVisit={q.get('first') !== '0'} charId={charId} arriverName="용감한 수달"
      mine={mine} deadline={Date.now() + STEP_MS.culture} onNext={() => rec.next++} /></Stage>;
  }
  const tile = Number(q.get('tile') ?? 16);
  const t = BOARD[tile];
  const qid = q.get('q') ?? 'eg-1-q1';
  if (view === 'explain') {
    const card = (cards as unknown as PublicCard[]).find((c) => qid.startsWith(c.id + '-'))!;
    return <Stage dim label="해설 카드"><ExplainCard card={card} countryName={t.name} continent={t.continent} tile={tile} variant="full"
      correct={q.get('correct') === '0' ? false : true} timedOut={false} arriverName="용감한 수달" mine={mine} deadline={deadline} tf={null} charId={charId} /></Stage>;
  }
  const pq = questionOf(qid)!;
  const level = Number(q.get('level') ?? 1);
  const build = view === 'build' ? { tile, level, cost: buildCost(tile, level + 1) } : null;
  return <Stage dim label="문제"><QuestionScroll country={t.name} continent={t.continent} stem={pq.stem} choices={pq.choices} review={false} mine={mine}
    arriverName="용감한 수달" charId={charId} materials={materialOf(qid)} fallback={`culture.${tile}`} deadline={deadline} hintRemoved={[]} canHint={false}
    stake={build ? `정답이면 시장을 지을 수 있어요` : `땅값 550 → 정답이면 440`} build={build}
    onAnswer={(choice, ms) => rec.answers.push({ choice, ms })} onHint={() => {}} /></Stage>;
}

render(<>
  <Board game={g as never} players={PLAYERS} mySeat={0} log={[]} covered onRoll={() => {}} noZoom />
  <Overlay />
</>, document.getElementById('app')!);
