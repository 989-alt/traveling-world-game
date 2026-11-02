// U16 간판 사슬 하네스(DESIGN §21.1): 게임 루트(.game) 꼴로 보드(덮임) + 큰 카드 1장(<Stage dim>) + 진짜 GameMenu(folded) 를 세운다.
// 주소 인자: view=question|build|culture|explain|mission|reward|shield|none  last=1(막판 5분)  host=0(학생 나가기)  m=<미션 id>
// window.__chain = { pauses, rules, setView(v) } — setView 로 카드를 바꿔 사슬이 다시 내려오지 않는지(전환 횟수) 잰다
import { render } from 'preact';
import { useState } from 'preact/hooks';
import '../../src/styles/tokens.css';
import '../../src/styles/base.css';
import '../../src/styles/board.css';
import cards from '../../src/data/cards.json';
import missionData from '../../src/data/missions.json';
import { createGame } from '../../src/engine/engine';
import { buildCost } from '../../src/engine/pay';
import { BOARD } from '../../src/shared/board';
import { STEP_MS } from '../../src/shared/economy';
import type { CultureCard as Culture, Mission } from '../../src/shared/content-types';
import type { MissionShown, PublicCard } from '../../src/shared/protocol';
import { cultureOf, materialOf, questionOf } from '../../src/state/content';
import { Board, type BoardPlayer } from '../../src/ui/board/Board';
import { MissionPanel } from '../../src/ui/missions/MissionPanel';
import { RewardPick } from '../../src/ui/missions/RewardPick';
import { MAP_OF_IMAGE, SPOT_OF, ZONE_OF_LABEL } from '../../src/ui/missions/map-spots';
import { CultureCard } from '../../src/ui/overlays/CultureCard';
import { ExplainCard } from '../../src/ui/overlays/ExplainCard';
import { Stage } from '../../src/ui/overlays/parts';
import { ShieldPopup } from '../../src/ui/overlays/Pickers';
import { QuestionScroll } from '../../src/ui/overlays/QuestionScroll';
import { GameMenu } from '../../src/ui/screens/Game';
import { RotateGuard } from '../../src/ui/board/RotateGuard';

const q = new URLSearchParams(location.search);
const host = q.get('host') !== '0';
const PLAYERS: BoardPlayer[] = [
  { seat: 0, charId: 1, name: '용감한 수달', isBot: false },
  { seat: 1, charId: 7, name: '꼬마 로봇', isBot: true },
  { seat: 2, charId: 4, name: '씩씩한 판다', isBot: false },
  { seat: 3, charId: 6, name: '느긋한 고래', isBot: false },
];
const g = createGame({ seed: 7, bots: [false, true, false, false] });
[[1, 0, 0], [2, 1, 2], [12, 2, 3], [22, 0, 4], [26, 2, 2]].forEach(([t, s, l]) => (g.tiles[t] = { owner: s as 0, level: l as 0, festivalTarget: false }));
g.phase = 'playing';
g.clock.remainingMs = q.get('last') === '1' ? 4 * 60_000 + 12_000 : 23 * 60_000 + 5_000;
const clockAt = Date.now();
const deadline = Date.now() + 600_000;
const rec = { pauses: 0, rules: 0, setView: (_v: string) => {} };
(window as unknown as { __chain: typeof rec }).__chain = rec;

function Card({ view }: { view: string }) {
  if (view === 'none') return null;
  if (view === 'mission') {
    const m = (missionData as Mission[]).find((x) => x.id === (q.get('m') ?? 'm-04'))!;
    const ps = m.pairs ?? [];
    const mode = m.image ? MAP_OF_IMAGE[m.image] : undefined;
    const shown: MissionShown = {
      left: ps.map((x) => x.left), right: ps.map((x) => x.right), steps: m.steps ?? [],
      ...(mode === 'spots' && ps.every((x) => SPOT_OF[x.left]) ? { at: ps.map((x) => SPOT_OF[x.left]) } : {}),
      ...(mode === 'zones' ? { zones: ps.map((x) => ZONE_OF_LABEL[x.right] ?? '') } : {}),
    };
    return <Stage dim label="미션"><div class="ov-center"><MissionPanel mission={m} role="player" phase="play" deadlineAt={deadline} shown={shown} onSubmit={() => {}} /></div></Stage>;
  }
  if (view === 'reward') {
    return <Stage dim label="보상"><div class="ov-center"><RewardPick options={['tollFree', 'shield', 'travelTile']} deadlineAt={deadline} onChoose={() => {}} /></div></Stage>;
  }
  if (view === 'shield') return <Stage dim><ShieldPopup attacker="꼬마 로봇" tileName={BOARD[12].name} deadline={deadline} onAnswer={() => {}} /></Stage>;
  if (view === 'culture') {
    const card = cultureOf(BOARD[4].country!) as Culture;
    return <Stage dim label="문화 카드"><CultureCard card={card} tile={4} firstVisit charId={1} arriverName="용감한 수달" mine deadline={Date.now() + STEP_MS.culture} onNext={() => {}} /></Stage>;
  }
  const tile = 16;
  const t = BOARD[tile];
  const qid = 'eg-1-q1';
  if (view === 'explain') {
    const card = (cards as unknown as PublicCard[]).find((c) => qid.startsWith(c.id + '-'))!;
    return <Stage dim label="해설 카드"><ExplainCard card={card} countryName={t.name} continent={t.continent} tile={tile} variant="full"
      correct timedOut={false} arriverName="용감한 수달" mine deadline={deadline} tf={null} charId={1} /></Stage>;
  }
  const pq = questionOf(qid)!;
  const build = view === 'build' ? { tile, level: 1, cost: buildCost(tile, 2) } : null;
  return <Stage dim label="문제"><QuestionScroll country={t.name} continent={t.continent} stem={pq.stem} choices={pq.choices} review={false} mine
    arriverName="용감한 수달" charId={1} materials={materialOf(qid)} fallback={`culture.${tile}`} deadline={deadline} hintRemoved={[]} canHint={false}
    stake="땅값 550 → 정답이면 440" build={build} onAnswer={() => {}} onHint={() => {}} /></Stage>;
}

function Harness() {
  const [view, setView] = useState(q.get('view') ?? 'question');
  rec.setView = setView;
  const folded = view !== 'none';
  return (
    <div class={`game${folded ? ' is-folded' : ''}`} data-view={view}>
      <Board game={g as never} players={PLAYERS} mySeat={0} log={[]} covered={folded} onRoll={() => {}} noZoom clockAt={clockAt} />
      <Card key={view} view={view} />
      <GameMenu host={host} folded={folded} game={g} clockAt={clockAt} onRules={() => rec.rules++} onPause={() => rec.pauses++} onLeave={() => {}} />
      <RotateGuard />
    </div>
  );
}

render(<Harness />, document.getElementById('app')!);
