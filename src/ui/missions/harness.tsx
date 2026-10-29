// 시험용 하네스(앱 라우트 아님). e2e 가 /dev/missions 를 연 뒤 이 모듈을 주입한다. 주소 인자:
//   stage=1(실제 게임처럼 오버레이 Stage 배율 안에 띄운다 — 태블릿 배율 좌표 시험용)  m=m-09  role=player|spectator  noreveal=1(실패해도 해설 키 없음 — 옛 서버 흉내)  dur=45000  bad=1(그림 주소를 일부러 404 로)  real=1(assets/img 원본 PNG 로 그림 확인)  view=reward&opts=a,b,c&rdur=10000
// 제출·참거짓·보상 선택은 window.__mission 에 쌓인다. 서버 판정은 __mission.finish(success) 로 흉내 낸다.
// 실패면 서버처럼 정답 키 + explain(worker/reveal.ts)을 만들어 넘긴다(표시 번호 = 원래 번호).
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';
import missionData from '../../data/missions.json';
import type { Mission } from '../../shared/content-types';
import type { Reward } from '../../shared/types';
import { MissionPanel } from './MissionPanel';
import { MAP_OF_IMAGE, SPOT_OF, ZONE_OF_LABEL } from './map-spots';
import type { MissionShown } from '../../shared/protocol';
import { missionReveal } from '../../../worker/reveal';
import { RewardPick } from './RewardPick';
import { Stage } from '../overlays/parts';
import type { MissionAnswerMsg } from './logic';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/missions.css';

const q = new URLSearchParams(location.search);
const missions = missionData as Mission[];
const rec = { sent: [] as MissionAnswerMsg[], tf: [] as boolean[], reward: [] as { index: number }[] };

declare global { interface Window { __mission: typeof rec & { finish: (ok: boolean) => void } } }

const dur = Number(q.get('dur') ?? 45000);
const deadline = Date.now() + dur;

function Harness() {
  const [phase, setPhase] = useState<'play' | 'tf'>('play');
  const [ok, setOk] = useState(false);
  const [tf, setTf] = useState<boolean | null>(null);
  window.__mission = Object.assign(rec, { finish: (s: boolean) => { setOk(s); setPhase('tf'); } });

  if (q.get('view') === 'reward') {
    const opts = (q.get('opts') ?? 'travelTile,island,shield').split(',') as Reward[];
      return (
      <div class="mp-stage"><AssetImg k="ui.boardBg" class="mp-bg" />
        <RewardPick options={opts} deadlineAt={Date.now() + Number(q.get('rdur') ?? 10000)} onChoose={(index) => rec.reward.push({ index })} />
      </div>
    );
  }
  const m = missions.find((x) => x.id === (q.get('m') ?? 'm-01'))!;
  // 서버 대신 표시 목록을 만든다. 순서는 원래 그대로(표시 번호 = 원래 번호라 시험 기대값이 그대로). 이 파일은 번들 밖이다
  const ps = m.pairs ?? [];
  const mode = m.image ? MAP_OF_IMAGE[m.image] : undefined;
  const shown: MissionShown = {
    left: ps.map((x) => x.left), right: ps.map((x) => x.right), steps: m.steps ?? [],
    ...(mode === 'spots' && ps.every((x) => SPOT_OF[x.left]) ? { at: ps.map((x) => SPOT_OF[x.left]) } : {}),
    ...(mode === 'zones' ? { zones: ps.map((x) => ZONE_OF_LABEL[x.right] ?? '') } : {}),
  };
  const panel = (
      <MissionPanel mission={m} role={q.get('role') === 'spectator' ? 'spectator' : 'player'} phase={phase} deadlineAt={deadline} durationMs={dur}
        success={ok} shown={q.get('noshown') ? null : shown}
        reveal={phase === 'tf' && !ok && !q.get('noreveal') ? missionReveal(m, { left: ps.map((_, i) => i), right: ps.map((_, i) => i), steps: (m.steps ?? []).map((_, i) => i) }) : null} onSubmit={(a) => rec.sent.push(a)} onTf={(v) => { rec.tf.push(v); setTf(v); }} tfPicked={tf}
        urlFor={q.get('bad') ? (k) => `/webp/__404__${k}.webp` : q.get('real') ? (k) => `/img/${k.slice(8)}.png` : undefined} />
  );
  // Game.tsx 와 같은 감싸기: <Stage dim><div class="ov-center"><MissionPanel/></div></Stage>
  if (q.get('stage')) return <><div class="mp-stage"><AssetImg k="ui.boardBg" class="mp-bg" /></div><Stage dim label="미션"><div class="ov-center">{panel}</div></Stage></>;
  return <div class="mp-stage"><AssetImg k="ui.boardBg" class="mp-bg" />{panel}</div>;
}

render(<Harness />, document.getElementById('app')!);
