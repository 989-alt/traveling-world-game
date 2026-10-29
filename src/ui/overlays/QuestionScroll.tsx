// 두루마리 퀴즈판(DESIGN §4.2, v3 03). 도착한 사람만 누르고, 나머지 셋은 같은 문항을 읽기만 한다.
// 한 번 누르면 바로 잠긴다(연타·바꾸기 불가). 시간이 다 되면 '시간이 다 됐어요'(표시만), 버튼은 서버가 단계를 넘기면 판째 내려간다.
// R2 T-D: 막대 44 + 남색 손잡이·금 캡(D1), 스톱워치(D2), 청사진 스케치 2(D3), 건설 미리보기(D5), 고민 포즈 P13·P10 교대(D6).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Pic } from '../../assets/AssetImg';
import { cardAssetOf, hasAsset } from '../../assets/manifest';
import { STEP_MS } from '../../shared/economy';
import { useNow } from '../missions/Timer';
import { Timer } from '../missions/Timer';
import { josa } from '../../state/nick';
import { BUILDING } from './ActionPanel';
import { ContinentChip, SidePeek, useAutoFocus, won } from './parts';
import { GRAPH_OF_CARD } from '../graph/climate-data';
import { chartCities, Picture } from './ExplainCard';
import { ClimateChart } from '../graph/ClimateChart';

export interface QuestionScrollProps {
  country: string;
  continent?: string;
  stem: string;
  /** 4지선다면 선지 4개, 참/거짓 형식이면 null */
  choices: string[] | null;
  review: boolean;
  mine: boolean;
  arriverName: string;
  /** 도착한 사람의 에셋 캐릭터 번호(옆에서 고민하는 포즈) */
  charId: number;
  /** 종이 위 자료: 그 문항 카드의 image·image2 파일(PRD §3.1). 그래프는 코드로 그린다. 4단계면 둘을 나란히 */
  materials: string[];
  /** 카드 그림 에셋이 없을 때 첫 자료 자리에 쓰는 키(문화 카드 장면·남극) */
  fallback: string | null;
  deadline: number | null;
  hintRemoved: number[];
  canHint: boolean;
  /** 아래 막대 칩: 이 문항 결과가 정하는 것 */
  stake: string | null;
  /** 건설 문항(내 땅 도착, 정답이면 다음 건물): 오른쪽 미리보기. 관전자도 본다(정답과 무관한 정보) */
  build?: BuildInfo | null;
  onAnswer: (choice: number | boolean, ms: number) => void;
  onHint: () => void;
}

/** level = 지금 단계(0 빈 땅 ~ 3 호텔), cost = 다음 단계 건설비 */
export interface BuildInfo { tile: number; level: number; cost: number }

const LETTER = ['a', 'b', 'c', 'd'] as const;

export function QuestionScroll(p: QuestionScrollProps) {
  const [picked, setPicked] = useState<number | boolean | null>(null);
  const sent = useRef(false);
  const now = useNow(200);
  // 남은 시간은 표시용. 버튼 잠금은 서버가 단계를 넘길 때(이 판이 내려갈 때)만 — 기기 시계가 틀려도 서버 마감 전엔 누를 수 있다.
  // 늦게 온 답은 서버가 거른다
  const expired = p.deadline !== null && now >= p.deadline;
  const locked = !p.mine || picked !== null;
  const first = useAutoFocus<HTMLButtonElement>(p.mine);
  useEffect(() => { sent.current = false; setPicked(null); }, [p.stem]);

  const pick = (v: number | boolean) => {
    if (locked || sent.current) return;
    sent.current = true; // 같은 프레임의 두 번째 탭도 막는다
    setPicked(v);
    p.onAnswer(v, p.deadline === null ? STEP_MS.question : Math.max(0, STEP_MS.question - (p.deadline - Date.now())));
  };

  const opts: { v: number | boolean; text: string; cls: string }[] = p.choices
    ? p.choices.map((text, i) => ({ v: i, text, cls: `ov-ans--${LETTER[i]}` }))
    : [{ v: true, text: '참', cls: 'ov-ans--c' }, { v: false, text: '거짓', cls: 'ov-ans--b' }];

  // 그래프는 코드로, 그림은 카드 에셋 → 없으면 첫 자리만 대체 그림. 둘째 그림 에셋이 없으면 비운다(해설 카드는 그 자리에 까닭 글을 쓰므로)
  const pics = (p.materials.length ? p.materials : ['']).flatMap((f, i) => {
    const k = GRAPH_OF_CARD[f] ? '' : cardAssetOf(f) ?? (i === 0 ? p.fallback : null);
    return k === null ? [] : [{ f, k }];
  });
  // 자료가 전부 그래프·도시 둘 이상: 도시마다 같은 폭 한 칸(4단계 서울|런던|로마 — 칸 안을 다시 나누지 않는다)
  const charts = chartCities(p.materials);
  const firstLive = opts.find((o) => !(typeof o.v === 'number' && p.hintRemoved.includes(o.v)))?.v;
  const one = pics.length === 1 && !GRAPH_OF_CARD[pics[0].f];
  return (<>
    <SidePeek charId={p.charId} pose="think" />
    <section class={`qs${p.build ? ' qs--build' : ''}`} role="dialog" aria-modal="true" aria-label={`${p.country} 문제`} data-role={p.mine ? 'player' : 'spectator'} data-locked={locked ? '1' : '0'}>
      <header class="qs-bar qs-bar--top">
        <i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" />
        <h2 class="qs-country">{p.country}</h2>
        <ContinentChip continent={p.continent} />
        {p.review && <span class="ov-chip ov-chip--review">복습</span>}
        <div class="qs-timer"><Timer deadlineAt={p.deadline ?? 0} totalMs={STEP_MS.question} watch /></div>
      </header>
      <div class="qs-paper">
        <i class="qs-frame" aria-hidden="true" />
        {one && <Sketch kind="house" />}
        {one && <Sketch kind="pyramid" />}
        {charts ? (
          <div class="qs-pic qs-pic--graph qs-pic--charts" data-n={charts.length}>
            <figure class="qs-fig"><div class="ex-graph"><ClimateChart cities={charts} fit /></div></figure>
          </div>
        ) : pics.length > 0 && (
          <div class={`qs-pic${pics.length > 1 ? ' qs-pic--two' : ''}${pics.some((x) => GRAPH_OF_CARD[x.f]) ? ' qs-pic--graph' : ''}`}>
            {pics.map((x) => <figure key={x.f} class="qs-fig"><Picture file={x.f} k={x.k} alt="" /></figure>)}
          </div>
        )}
        <p class="qs-stem">{p.stem}</p>
        <div class={`qs-grid${p.choices ? '' : ' qs-grid--tf'}`} role="radiogroup" aria-label="답 고르기">
          {opts.map((o) => {
            const gone = typeof o.v === 'number' && p.hintRemoved.includes(o.v);
            return (
              <button type="button" role="radio" key={String(o.v)} ref={o.v === firstLive ? first : undefined} class={`ov-ans ${o.cls}${gone ? ' is-gone' : ''}`}
                aria-checked={picked === o.v} disabled={locked || gone} data-choice={String(o.v)}
                onClick={() => pick(o.v)}>
                <span>{o.text}</span>
              </button>
            );
          })}
        </div>
        {!p.mine && !expired && <p class="qs-watch" role="status">{josa(p.arriverName, '이', '가')} 푸는 중이에요. 같이 생각해 봐요</p>}
        <p class="qs-status" role="status" hidden={!p.mine && !expired}>
          {expired && picked === null ? '시간이 다 됐어요' : picked !== null ? '골랐어요! 정답을 확인해요' : ''}
        </p>
      </div>
      <footer class="qs-bar qs-bar--bottom">
        <i class="sp-cap sp-cap--l" aria-hidden="true" /><i class="sp-cap sp-cap--r" aria-hidden="true" />
        {p.stake && <span class="ov-chip ov-chip--discount">{p.stake}</span>}
        {p.mine && p.canHint && p.choices && !p.hintRemoved.length && picked === null && !expired && (
          <button type="button" class="ov-btn ov-btn--small ov-btn--secondary qs-hint" onClick={p.onHint}>힌트 쓰기</button>
        )}
      </footer>
      {p.build && <BuildPreview {...p.build} />}
    </section>
  </>);
}

/** 건설 미리보기 240×420(R2 D5, v3 03 오른쪽): 지금 건물 → 다음 건물(4단계면 랜드마크) + 건설비 칩 */
function BuildPreview({ tile, level, cost }: BuildInfo) {
  const next = level + 1;
  const keyOf = (l: number) => (l >= 4 ? `landmark.${tile}` : l >= 1 ? `building.${tile}.${l}` : `tile.${tile}`);
  const pic = (l: number, cls: string) => (hasAsset(keyOf(l))
    ? <Pic k={keyOf(l)} class={`qs-bld-img ${cls}`} alt={l >= 1 ? BUILDING[l] : '빈 땅'} eager />
    : <span class={`qs-bld-img ${cls} qs-bld-none`}>{l >= 1 ? BUILDING[l] : '빈 땅'}</span>);
  return (
    <aside class="qs-bld" aria-label={`정답이면 ${BUILDING[next]}`} data-level={level}>
      <figure class="qs-bld-fig qs-bld-fig--now">{pic(level, 'is-now')}</figure>
      <span class="qs-bld-arrow" aria-hidden="true" />
      <figure class="qs-bld-fig qs-bld-fig--next">{pic(next, 'is-next')}</figure>
      <span class="qs-bld-cost"><Pic k="ui.coin" class="qs-bld-coin" fallback={<i class="qs-bld-coin qs-bld-coin--css" />} eager />{won(cost)}</span>
    </aside>
  );
}

/** 청사진 종이의 연필 스케치(v3 03, R2 D3): 그림 왼쪽 집·오른쪽 피라미드, 각 160px. 장식이라 스크린리더에서 숨긴다 */
function Sketch({ kind }: { kind: 'house' | 'pyramid' }) {
  return (
    <svg class={`qs-sketch qs-sketch--${kind}`} viewBox="0 0 160 150" aria-hidden="true">
      {kind === 'house' ? (
        <g>
          <path d="M34 128 V70 L80 34 L126 70 V128 Z M24 78 L80 30 L136 78" />
          <path d="M64 128 V96 Q80 80 96 96 V128 M44 84 H58 V98 H44 Z M102 84 H116 V98 H102 Z" />
          <path d="M18 132 H142 M80 18 V30 M70 50 H90" />
          <path d="M30 140 H60 M100 140 H130 M14 60 V120 M146 60 V120" class="qs-sketch-thin" />
        </g>
      ) : (
        <g>
          <path d="M14 128 L80 30 L146 128 Z M80 30 L96 128 M47 79 H113 M30 104 H130" />
          <path d="M8 134 H152 M80 14 V24" />
          <path d="M20 142 H70 M90 142 H140 M60 54 L40 54 M100 54 L120 54" class="qs-sketch-thin" />
        </g>
      )}
    </svg>
  );
}
