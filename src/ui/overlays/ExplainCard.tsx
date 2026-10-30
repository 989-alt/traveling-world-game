// 해설 카드(PRD §3.1): 맞혔든 아니든 방 안 모두가 본다. 전체판 7초·짧은판 4초 동안 닫을 수 없다(서버가 넘긴다).
// 전체판 = 그림 + 정답 + 까닭 2문장(4단계는 자료 2개 나란히), 짧은판 = 그림 + 정답 한 줄.
// 참/거짓 단계면 아래 띠에 문장과 참·거짓 버튼(도착한 사람 화면엔 안 뜬다). 한 번 누르면 잠기고, 안 누르면 아무것도 보내지 않는다.
import { useEffect, useRef, useState } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';
import { hasAsset } from '../../assets/manifest';
import type { PublicCard } from '../../state/content';
import { STEP_MS } from '../../shared/economy';
import { josa } from '../../state/nick';
import { ClimateChart } from '../graph/ClimateChart';
import { GRAPH_OF_CARD, type CityKey } from '../graph/climate-data';
import { Timer } from '../missions/Timer';
import { ContinentChip, Countdown, SidePeek, useAutoFocus } from './parts';
import '../../styles/explain-kind.css';

const LEVEL = ['', '집', '시장', '호텔', '랜드마크'];
/** 4단계 비교 까닭 앞 색 꼬리표(DESIGN §4.2 해설 카드 행, 2026-10-29 U5): 같은 점 = 초록(answer.c), 다른 점 = 주황(answer.b) */
const REASON_KIND = { same: '같은 점', diff: '다른 점' } as const;

export interface TfBar {
  text: string;
  /** 이 기기가 답할 수 있음(도착한 사람이 아님·파산 아님) */
  canAnswer: boolean;
  deadline: number | null;
  onPick: (v: boolean) => void;
  /** 참/거짓 결과 2초(tfResult, DESIGN §18.5): 정답 + 맞힌 사람. 있으면 같은 띠가 결과로 바뀐다 */
  result?: TfResult | null;
}

export interface TfResult {
  answer: boolean;
  /** 참가 자리(도착자 제외) — correct: 맞힘 / 틀림·답 없음 */
  chips: { seat: number; name: string; correct: boolean }[];
}

export interface ExplainCardProps {
  card: PublicCard;
  countryName: string;
  continent?: string;
  /** 칸 번호(1단계·남극 카드는 문화 카드 그림을 쓴다) */
  tile: number;
  variant: 'full' | 'short';
  correct: boolean | null;
  /** 아무것도 고르지 않고 20초가 지남 */
  timedOut: boolean;
  arriverName: string;
  mine: boolean;
  deadline: number | null;
  tf: TfBar | null;
  /** 도착한 사람의 캐릭터 번호: 왼쪽 큰 캐릭터(정답 P12, 아니면 P13 — R2 D6). 없으면 안 그린다 */
  charId?: number;
  /** 해설 단계에서만: 카드가 표시 시간만큼 실제로 보였으면(탭이 가려지지 않고 알림에 덮이지 않음) 한 번 부른다. 화면엔 아무것도 없다 */
  onShown?: () => void;
  /** 알림(이벤트 카드·통행료·컷씬)이 카드 위를 덮고 있다 — 그동안은 보인 시간으로 세지 않는다 */
  covered?: boolean;
}

/** PRD §3.1 최소 표시 시간 */
const SHOWN_MS = { full: STEP_MS.explanationFull, short: STEP_MS.explanationShort };

/** 카드가 실제로 보인 시간(탭이 보이고 알림에 안 덮인 동안만)이 ms 를 채우면 f 를 한 번 부른다. 가려지면 멈췄다가 이어서 센다 */
function useShown(f: (() => void) | undefined, ms: number, covered: boolean) {
  // 부를 때의 f 를 쓴다: 재접속 직후 첫 렌더의 f 는 옛 stepKey 를 품고 있을 수 있다(그 뒤 전체 로그가 와서 바뀜)
  const fRef = useRef(f);
  fRef.current = f;
  const left = useRef(ms);
  const done = useRef(false);
  const [vis, setVis] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const v = () => setVis(document.visibilityState !== 'hidden');
    v(); // 이 효과가 돌기 전(마운트 직후)에 가려졌으면 그 이벤트를 놓쳤다
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, []);
  const counting = !!f && vis && !covered;
  useEffect(() => {
    if (!counting || done.current) return;
    const t0 = performance.now();
    const h = setTimeout(() => {
      if (document.visibilityState === 'hidden') return; // 가려진 사이 이벤트를 아직 못 받음 → vis 가 바뀌며 남은 시간부터 다시 센다
      done.current = true;
      fRef.current?.();
    }, left.current);
    return () => { clearTimeout(h); left.current = Math.max(0, left.current - (performance.now() - t0)); };
  }, [counting]);
}

export function Picture({ file, k, alt }: { file: string; k: string; alt: string }) {
  const g = GRAPH_OF_CARD[file];
  if (g) return <div class="ex-graph"><ClimateChart cities={g} fit /></div>;
  return <AssetImg k={k} class="ex-img" alt={alt} />;
}

/** 자료 둘 이상이 전부 그래프이고 한 자료에 도시가 여럿이면(자료 칸 안을 다시 나누게 되면) 도시 목록(자료 순서대로).
 *  이때는 도시마다 같은 폭 한 칸씩 한 줄로 그린다. 예: 한국 4단계 = 서울 | 런던 | 로마 세 칸. 그 밖에는 null(자료마다 한 칸) */
export function chartCities(files: string[]): CityKey[] | null {
  if (files.length < 2 || !files.every((f) => GRAPH_OF_CARD[f])) return null;
  const cities = files.flatMap((f) => GRAPH_OF_CARD[f]);
  return cities.length > files.length ? cities : null;
}

export function ExplainCard(p: ExplainCardProps) {
  const c = p.card;
  useShown(p.onShown, SHOWN_MS[p.variant], !!p.covered);
  const key = hasAsset(`card.${c.id}`) ? `card.${c.id}` : c.country === 'aq' ? 'event.antarctic' : `culture.${p.tile}`;
  const two = p.variant === 'full' && c.level === 4 && !!c.image2;
  const charts = chartCities(two ? [c.image, c.image2!] : [c.image]);
  const result = p.correct
    ? (p.mine ? '정답! 잘 맞혔어요' : `${josa(p.arriverName, '이', '가')} 맞혔어요`)
    : p.timedOut ? '시간이 다 됐어요. 정답을 같이 봐요' : '정답을 같이 볼까요?';
  return (<>
    {p.charId !== undefined && <SidePeek charId={p.charId} pose={p.correct ? 'cheer' : 'stuck'} />}
    <section class={`ex ex--${p.variant}${p.tf ? ' has-tf' : ''}`} role="dialog" aria-label={`${p.countryName} 해설 카드`} data-variant={p.variant} data-card={c.id} data-two={two ? '1' : '0'}>
      <header class="ex-head">
        <h2 class="ex-name">{p.countryName}</h2>
        <ContinentChip continent={p.continent} />
        <span class="ov-chip ov-chip--level">{c.level}단계 · {LEVEL[c.level]}</span>
        <span class={`ex-result${p.correct ? ' is-ok' : ''}`} role="status">
          {p.correct && <span class="ex-check" aria-hidden="true" />}{result}
        </span>
      </header>
      <div class="ex-body">
        <div class={`ex-pics${two && !charts ? ' ex-pics--two' : ''}`}>
          {charts ? <figure class="ex-fig ex-fig--charts"><div class="ex-graph"><ClimateChart cities={charts} fit /></div></figure>
            : <figure class="ex-fig"><Picture file={c.image} k={key} alt={c.answer} /></figure>}
          {two && !charts && (
            <figure class="ex-fig">
              {GRAPH_OF_CARD[c.image2!] ? <Picture file={c.image2!} k={key} alt="" />
                : hasAsset(`card.${c.id}.b`) ? <AssetImg k={`card.${c.id}.b`} class="ex-img" alt={c.reasons[1]} />
                : <figcaption class="ex-alt">{c.reasons[1]}</figcaption>}
            </figure>
          )}
        </div>
        <div class="ex-text">
          <p class="ex-answer">{c.answer}</p>
          {p.variant === 'full' && (
            <ul class="ex-reasons">
              {c.reasons.map((r, i) => {
                const kind = c.reasonKinds?.[i];
                return (
                  <li key={r} class={kind ? 'has-kind' : undefined}>
                    {kind && <span class={`ex-kind ex-kind--${kind}`} data-kind={kind}>{REASON_KIND[kind]}</span>}{r}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {p.tf ? <TfRow {...p.tf} /> : (
        <footer class="ex-foot">
          <Countdown deadline={p.deadline} total={SHOWN_MS[p.variant]} label="해설 남은 시간" />
        </footer>
      )}
    </section>
  </>);
}

/** 참/거짓 결과 칩(참가 자리, 맞힌 사람 = correct.soft + 자리색 테). 해설 참/거짓 · 미션 관전 참/거짓 공용 */
export function TfChips({ result: r }: { result: TfResult }) {
  return (
    <ul class="ex-tf-chips" role="status" aria-label={`정답은 ${r.answer ? '참' : '거짓'}`}>
      {r.chips.map((c) => (
        <li key={c.seat} class={`ex-tf-chip${c.correct ? ' is-ok' : ''}`} data-seat={c.seat} style={{ '--seat': `var(--seat-${c.seat + 1})` }}>
          {c.correct && <span class="ex-check" aria-hidden="true" />}<span class="ex-tf-chip-name">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

function TfRow(t: TfBar) {
  const [picked, setPicked] = useState<boolean | null>(null);
  const sent = useRef(false);
  const first = useAutoFocus<HTMLButtonElement>(t.canAnswer);
  useEffect(() => { sent.current = false; setPicked(null); }, [t.text]);
  const pick = (v: boolean) => {
    if (sent.current || !t.canAnswer) return;
    sent.current = true;
    setPicked(v);
    t.onPick(v);
  };
  if (t.result) {
    const r = t.result;
    const opt = (v: boolean) => `ov-ans ${v ? 'ov-ans--c' : 'ov-ans--b'} ex-tf-btn ex-tf-res${r.answer === v ? ' is-answer' : ' is-off'}`;
    return (
      <footer class="ex-tf is-result" role="group" aria-label="참 거짓 결과" data-answer={String(r.answer)}>
        <p class="ex-tf-text">{t.text}</p>
        <div class="ex-tf-btns">
          <button type="button" class={opt(true)} data-tf="true" aria-pressed={picked === true} disabled>참</button>
          <button type="button" class={opt(false)} data-tf="false" aria-pressed={picked === false} disabled>거짓</button>
        </div>
        <TfChips result={r} />
      </footer>
    );
  }
  if (!t.canAnswer) return <div class="ex-tf ex-tf--wait" role="status">친구들이 참·거짓을 고르는 중이에요</div>;
  return (
    <footer class="ex-tf" role="group" aria-label="참 거짓 고르기">
      <Timer deadlineAt={t.deadline ?? 0} totalMs={STEP_MS.tf} />
      <p class="ex-tf-text">{t.text}</p>
      <div class="ex-tf-btns">
        <button type="button" ref={first} class="ov-ans ov-ans--c ex-tf-btn" data-tf="true" aria-pressed={picked === true} disabled={picked !== null} onClick={() => pick(true)}>참</button>
        <button type="button" class="ov-ans ov-ans--b ex-tf-btn" data-tf="false" aria-pressed={picked === false} disabled={picked !== null} onClick={() => pick(false)}>거짓</button>
      </div>
    </footer>
  );
}
