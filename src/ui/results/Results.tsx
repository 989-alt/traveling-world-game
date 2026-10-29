// 최종 결과(PRD §8-14). 캡처 한 장에 들어가게 짠다. (중간 결과 §8-13 은 2026-10-28 U1 에 없어졌다 — 순위 한 줄은 멈춤 화면)
// 화면(DESIGN §4.2 결과·§16.7, 기준 그림 RESULT-mock): 위 금 리본 배너(제목 코드), 왼쪽 순위 단상 = 따로 뜬 섬 3개(1위 가운데·가장 높음·금 트로피,
// 2위 왼쪽·3위 오른쪽 = 은·동 메달) + 4위 작은 섬(맨 왼쪽), 캐릭터는 환호 포즈 1024. 오른쪽 크림 두루마리 첫 장 = 금 도장 4·세계 지도 핀·한 줄 칩 3·
// 랜드마크 기념품 3(글자 ≥ 14px). '자세히 보기' = 둘째 장(넓은 두루마리): 대번호별 정답·헷갈린 생각 번호·얻은 것·도장 도감·같은 기후·기념 자석(S9).
// 색종이 canvas 1장. 보내는 것 없음: 로그에서 그 자리에서 계산해 그리기만 한다.
// 2026-10-29 U6(DESIGN §16.7.1~4): 코드로 그린 도형(트로피·메달·섬·배너·이름표·두루마리·도장·지도판·핀·칩·점·버튼·탭 고리·받침·색종이)은
// 전부 그림 에셋 result.*(RS-*). 글자·순위 숫자·수치만 코드. svg 요소는 세계 지도(WorldMap, 핀이 위경도 좌표라)뿐.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AssetImg, Pic } from '../../assets/AssetImg';
import { assetUrl } from '../../assets/manifest';
import { buildReport, type MetaMap, type Rate, type Row, type SeatReport } from '../../engine/report';
import type { LogEvent, Seat } from '../../shared/types';
import { WorldMap } from '../missions/WorldMap';
import { BUILDING } from '../overlays/ActionPanel';
import { CONTINENT_NAME, won } from '../overlays/parts';
import { STAGE, useStageScale } from '../overlays/PlankDialog';
import { countryName, META } from './meta';
import '../../styles/missions.css';
import '../../styles/results.css';

export interface SeatInfo { seat: Seat; charId: number; name: string; isBot: boolean }
export interface ResultsProps {
  log: LogEvent[];
  seats: SeatInfo[];
  mySeat?: Seat | null;
  meta?: MetaMap;
}

const TITLE = '최종 결과';
const pct = (r: Rate) => (r.n ? `${Math.round((r.ok / r.n) * 100)}%` : '-');
const frac = (r: Rate) => `${r.ok}/${r.n}`;
const PLACE = ['gold', 'silver', 'bronze', 'plain'] as const;
/** 단상 포즈: 1위 환호(P12), 2·3위 점프(P11), 4위 서기(P01) */
const POSE = ['p12', 'p11', 'p11', 'p01'];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Results({ log, seats, mySeat = null, meta = META }: ResultsProps) {
  const rep = useMemo(() => buildReport(log, meta, seats.map((s) => s.isBot)), [log, meta, seats]);
  const order = rep.final;
  const ranks = order?.ranks ?? seats.map((s) => s.seat);
  const assets = order?.assets;
  const firstHuman = rep.seats.find((s) => !s.isBot)?.seat ?? 0;
  const [pick, setPick] = useState<Seat>(mySeat !== null && !rep.seats[mySeat].isBot ? mySeat : firstHuman);
  const [detail, setDetail] = useState(false);
  const info = (seat: Seat) => seats[seat];
  const cur = rep.seats[pick];
  const scale = useStageScale();

  return (
    <main class="sc rs" data-kind="final" aria-label={TITLE}>
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <div class="rs-stage" style={{ width: `${STAGE.w}px`, height: `${STAGE.h}px`, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {!rep.empty && <Confetti />}
        <div class="rs-banner">
          <Pic k="result.banner" class="rs-banner-img" fallback={<span class="rs-banner-img rs-fb" />} eager />
          <h1 class="rs-title">{TITLE}</h1>
        </div>
        {rep.empty ? (
          <section class="rs-scroll rs-empty" data-k="empty" role="status">
            <Pic k="result.scroll" class="rs-scroll-img" fallback={<span class="rs-scroll-img rs-fb" />} eager />
            <p>아직 한 번도 주사위를 굴리지 않았어요. 게임을 하면 여기에 기록이 쌓여요.</p>
          </section>
        ) : (
          <>
            <ol class="rs-rank" aria-label="순위" data-k="rank">
              {ranks.map((seat, n) => (
                <li key={seat} class={`rs-rank-row rs-place rs-place--${n + 1}`} data-seat={seat} data-place={PLACE[n]}>
                  <Pic k={`result.isle.${n + 1}`} class="rs-isle" eager />
                  <span class="rs-hero-shadow" aria-hidden="true" />
                  <Pic k={`char.${info(seat).charId}.${POSE[n]}.big`} class="rs-hero" eager
                    fallback={<Pic k={`char.${info(seat).charId}.p12.big`} class="rs-hero" fallback={<AssetImg k={`char.${info(seat).charId}.f00`} class="rs-face" alt="" />} />} />
                  {n === 0 && order && <Pic k="result.trophy" class="rs-trophy" eager />}
                  {/* 2·3위 섬 앞면에 거는 은·동 메달(시안 RESULT-mock, 발 아래 섬 테 위) */}
                  {(n === 1 || n === 2) && order && <Pic k={`result.medal.${PLACE[n]}`} class="rs-isle-medal" eager />}
                  <div class="rs-plate">
                    <Pic k={`result.plate.${seat + 1}`} class="rs-plate-img" fallback={<span class="rs-plate-img rs-fb" style={{ '--seat': `var(--seat-${seat + 1})` }} />} eager />
                    <span class="rs-no" aria-label={order ? `${n + 1}위` : undefined}>
                      {order && <Pic k={`result.medal.${PLACE[n]}`} class="rs-no-img" fallback={<span class="rs-no-img rs-fb" />} eager />}
                      <b class="rs-no-n">{order ? n + 1 : ''}</b>
                    </span>
                    <span class="rs-plate-text">
                      <span class="rs-name">{info(seat).name}{seat === mySeat ? ' (나)' : ''}{info(seat).isBot && <b class="rs-bot">봇</b>}</span>
                      {assets && <span class="rs-coin"><AssetImg k="ui.coin" class="rs-coin-ico" />{won(assets[seat])}원</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ol>

            <section class="rs-scroll" aria-label="내 학습 카드" data-k="learn" data-page={detail ? 'detail' : 'summary'} style={{ '--wide': `url(${assetUrl('result.scroll-wide')})` }}>
              {/* 첫 장 = RS-scroll 한 장 그대로. 둘째 장 = RS-scroll-wide 를 border-image 로(막대를 줄이고 종이만 늘림 — 글자 칸 높이 확보).
                  둘째 장 <img> 는 숨긴 탐침: 못 받으면 크림 대체 판 */}
              {detail
                ? <Pic key="wide" k="result.scroll-wide" class="rs-probe" fallback={<span class="rs-scroll-img rs-fb" />} />
                : <Pic key="tall" k="result.scroll" class="rs-scroll-img" fallback={<span class="rs-scroll-img rs-fb" />} eager />}
              <div class="rs-paper">
                <div class="rs-head">
                  <div class="rs-tabs" role="tablist" aria-label="누구의 기록">
                    {seats.map((s) => (
                      <button key={s.seat} type="button" role="tab" class="rs-tab" data-k="tab" data-seat={s.seat} aria-selected={pick === s.seat}
                        aria-label={`${s.name}${s.isBot ? ' 봇' : ''}`} title={s.name} onClick={() => setPick(s.seat)}>
                        <AssetImg k={`char.${s.charId}.f00`} class="rs-tab-face" alt="" />
                        <Pic k={`result.tab-ring.${s.seat + 1}`} class="rs-tab-ring" fallback={<span class="rs-tab-ring rs-fb" style={{ '--seat': `var(--seat-${s.seat + 1})` }} />} />
                      </button>
                    ))}
                  </div>
                  <b class="rs-who">{info(pick).name}</b>
                  <button type="button" class="rs-more" data-k="detail" aria-pressed={detail} onClick={() => setDetail(!detail)}>
                    <Pic k="result.btn-blue" class="rs-more-img" fallback={<span class="rs-more-img rs-fb" />} />
                    <span class="rs-more-t">{detail ? '돌아가기' : '자세히 보기'}</span>
                  </button>
                </div>
                {/* 첫 장: 시안 그대로 크게(글자 ≥ 14px) */}
                <div class="rs-summary" hidden={detail}>
                  <Coins r={cur} />
                  <MapPins r={cur} meta={meta} monopolies={rep.monopolies.filter((m) => m.seat === pick)} seat={pick} />
                  <Lines r={cur} />
                  <Souvenirs r={cur} />
                </div>
                {/* 둘째 장: 자세한 학습 기록(S9) */}
                <div class="rs-detail" hidden={!detail}>
                  <div class="rs-cols">
                    <section class="rs-learn" aria-label="퀴즈 기록">
                      {cur.isBot ? <p class="rs-note" data-k="bot-note">봇은 학습 기록을 모으지 않아요.</p> : <Learn r={cur} />}
                    </section>
                    <section class="rs-side" aria-label="도장 도감">
                      <StampBook r={cur} />
                    </section>
                  </div>
                  <Magnets r={cur} />
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

/** 금 도장 4: 동전 아래에 수 */
function Coins({ r }: { r: SeatReport }) {
  const items: [string, string, string][] = [
    ['plane', '다녀온 곳', `${r.stamps.length}곳`],
    ['mountain', '랜드마크', `${r.landmarks.length}개`],
    ['palm', '도착 퀴즈', r.isBot ? '-' : pct(r.total.arrive)],
    ['compass', '참/거짓', r.isBot ? '-' : pct(r.total.tf)],
  ];
  return (
    <ul class="rs-medals" data-k="medals">
      {items.map(([ico, label, v]) => (
        <li key={ico} class="rs-medal-item" aria-label={`${label} ${v}`}>
          <Pic k={`result.stamp.${ico}`} class="rs-medal-coin" fallback={<span class="rs-medal-coin rs-fb" />} />
          <b class="rs-medal-v">{v}</b><span class="rs-medal-l">{label}</span>
        </li>
      ))}
    </ul>
  );
}

/** 세계 지도 + 도장 핀 + 독점 대륙(자리색 칩) */
function MapPins({ r, meta, monopolies, seat }: { r: SeatReport; meta: MetaMap; monopolies: { continent: string }[]; seat: Seat }) {
  return (
    <div class="rs-map" data-k="map">
      <Pic k="result.map-board" class="rs-map-board" fallback={<span class="rs-map-board rs-fb" />} />
      <div class="rs-map-box">
        <WorldMap mode="plain" />
        {r.stamps.map((s) => {
          const p = meta[s.country]?.pin;
          return p && (
            <span key={s.country} class="rs-pin" data-k="pin" data-country={s.country} style={{ left: `${p.x}%`, top: `${p.y}%` }} title={countryName(s.country)}>
              <Pic k="result.pin" class="rs-pin-img" fallback={<i class="rs-pin-img rs-fb" />} />
            </span>
          );
        })}
      </div>
      {monopolies.length > 0 && (
        <p class="rs-mono" data-k="monopoly" style={{ '--seat': `var(--seat-${seat + 1})` }}>
          {monopolies.map((m) => <b key={m.continent} class="rs-mono-chip" data-continent={m.continent}>{CONTINENT_NAME[m.continent] ?? m.continent} 독점</b>)}
        </p>
      )}
    </div>
  );
}

/** 한 줄 칩 3: 핵심 학습 결과(16px) */
function Lines({ r }: { r: SeatReport }) {
  const a = r.total.arrive;
  const t = r.total.tf;
  const rows: ['check' | 'star', string][] = r.isBot
    ? [['check', '봇은 학습 기록을 모으지 않아요'], ['check', `도장 ${r.stamps.length}곳을 모았어요`], ['check', `랜드마크 ${r.landmarks.length}개를 세웠어요`]]
    : [
      ['check', a.n ? `도착 퀴즈 ${a.n}문제 중 ${a.ok}문제 맞혔어요` : '도착 퀴즈를 아직 안 풀었어요'],
      ['check', t.n ? `참/거짓 ${t.n}번 중 ${t.ok}번 맞혔어요` : '참/거짓을 아직 안 골랐어요'],
      ['star', `정답 덕분에 ${won(r.gains.tollSaved)}원 아끼고 ${r.gains.discountedBuys}곳 싸게 샀어요`],
    ];
  return (
    <ul class="rs-lines" data-k="lines">
      {rows.map(([ico, text]) => (
        <li key={text}>
          <Pic k="result.line-chip" class="rs-line-chip" fallback={<i class="rs-line-chip rs-fb" />} />
          <Pic k={`result.dot.${ico}`} class="rs-line-dot" fallback={<i class="rs-line-dot rs-fb" />} />
          <span class="rs-line-t">{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** 랜드마크 기념품 3: 금 받침 위 랜드마크 원본색. 없으면 빈 받침(흐리게) */
function Souvenirs({ r }: { r: SeatReport }) {
  const lms = r.landmarks.slice(0, 3);
  return (
    <div class="rs-souv" data-k="landmarks" aria-label="세운 랜드마크">
      {[0, 1, 2].map((i) => (
        <span key={i} class={`rs-souv-slot${lms[i] === undefined ? ' is-empty' : ''}`}>
          <Pic k="result.souv-stand" class="rs-souv-stand" />
          {lms[i] !== undefined && <Pic k={`landmark.${lms[i]}`} class="rs-lm" alt="랜드마크" />}
        </span>
      ))}
      {r.landmarks.length > 3 && <b class="rs-souv-more">+{r.landmarks.length - 3}</b>}
    </div>
  );
}

function Learn({ r }: { r: SeatReport }) {
  const none = !r.rows.length && !r.level4.arrive.n && !(r.level4.tf.n + r.level4.tf.none);
  return (
    <>
      {none ? <p class="rs-note" data-k="no-answers">아직 푼 문제가 없어요.</p> : (
        <table class="rs-rates" data-k="rates">
          <caption class="rs-legend">대번호마다 <i class="rs-legend-a" />도착해서 푼 문제 <i class="rs-legend-t" />참/거짓</caption>
          <thead class="sr-only"><tr><th>내용</th><th>도착해서 푼 문제</th><th>참/거짓</th></tr></thead>
          <tbody>
            {r.rows.map((x) => <RateRow key={x.key} x={x} label={`내용 ${x.key}`} />)}
            <RateRow x={r.level4} label="4단계 (랜드마크)" four />
          </tbody>
        </table>
      )}
      {r.review.n > 0 && <p class="rs-sub" data-k="review">다시 나온 문제는 따로 세어요: {frac(r.review)}</p>}
      <div class="rs-pair">
        <div data-k="mtags" class="rs-box">
          <h2>헷갈린 생각 번호</h2>
          {r.wrongM.length ? <p class="rs-chips">{r.wrongM.map((m) => <b key={m} class="rs-chip">{m}</b>)}</p> : <p class="rs-none">없음</p>}
        </div>
        <div data-k="gains" class="rs-box">
          <h2>정답으로 얻은 것</h2>
          <ul class="rs-gains">
            <li><b>{r.gains.discountedBuys}</b>곳 싸게 샀어요</li>
            <li><b>{r.gains.takeovers}</b>곳 사들였어요</li>
            <li><b>{won(r.gains.tollSaved)}</b>원 아꼈어요</li>
          </ul>
        </div>
      </div>
    </>
  );
}

function RateRow({ x, label, four }: { x: Row; label: string; four?: boolean }) {
  const a = x.arrive;
  const t = x.tf;
  return (
    <tr data-k={four ? 'level4' : 'row'} data-row={x.key}>
      <th scope="row">{label}</th>
      <td data-col="arrive" style={{ '--rate': a.n ? `${(a.ok / a.n) * 100}%` : '0%' }}>{a.n ? `${pct(a)} (${frac(a)})` : '-'}</td>
      <td data-col="tf" style={{ '--rate': t.n ? `${(t.ok / t.n) * 100}%` : '0%' }}>
        {t.n ? `${pct(t)} (${frac(t)})` : '-'}{t.none > 0 && <small class="rs-skip"> 답하지 않음 {t.none}</small>}
      </td>
    </tr>
  );
}

function StampBook({ r }: { r: SeatReport }) {
  return (
    <div class="rs-book" data-k="stamps">
      <h2>도장 도감 <small>{r.stamps.length}곳</small></h2>
      {r.stamps.length ? (
        <ul class="rs-stamps">{r.stamps.map((s) => <li key={s.country} data-country={s.country} data-level={s.level}>{countryName(s.country)}<b>{BUILDING[s.level]}</b></li>)}</ul>
      ) : <p class="rs-none">아직 도장이 없어요</p>}
      {r.climateGroups.map((g) => (
        <p key={g.climate} class="rs-group" data-k="climate">같은 {g.climate}: {g.stamps.map((x) => countryName(x.country)).join(', ')}</p>
      ))}
    </div>
  );
}

/** 여행 기념 자석(랜드마크 나라, 4줄까지) */
function Magnets({ r }: { r: SeatReport }) {
  const shown = r.magnets.slice(0, 4); // shortcut: 4줄까지만 한 화면에 들어간다. 마그넷 값이 짧아지면 더 늘릴 수 있다
  return (
    <section class="rs-magnets" data-k="magnets" aria-label="여행 기념 자석">
      <h2>여행 기념 자석</h2>
      {shown.length ? (
        <table class="rs-magnet">
          <thead><tr><th>여행지</th><th>지형</th><th>경관</th><th>생활</th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.country} data-k="magnet" data-country={m.country}>
                <th scope="row">{countryName(m.country)}</th><td>{m.terrain}</td><td>{m.scenery}</td><td>{m.life}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p class="rs-none">랜드마크를 세우면 기념 자석이 생겨요</p>}
      {r.magnets.length > shown.length && <p class="rs-sub">그 밖에 {r.magnets.length - shown.length}곳</p>}
    </section>
  );
}

/** 색종이 canvas 1장: RS-confetti 시트(4×2 셀, 셀 = 폭 1/4 × 높이 1/2)를 조각마다 잘라 그린다. 화면 전체에 흩어져 6초 동안
 *  내려오다 그 자리에 멈춘다(장식으로 남음). 모션 줄이기면 흩어진 한 장만. 시트를 못 받으면 아무것도 안 그린다 */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    const url = assetUrl('result.confetti');
    if (!cv || !ctx || !url) return;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bits = Array.from({ length: 90 }, (_, i) => ({ x: rnd() * STAGE.w, y: rnd() * STAGE.h, vy: 40 + rnd() * 50, r: rnd() * 6, s: 10 + rnd() * 10, cell: i % 8 }));
    let raf = 0;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const cw = img.width / 4, ch = img.height / 2;
      const draw = (t: number) => {
        ctx.clearRect(0, 0, STAGE.w, STAGE.h);
        for (const p of bits) {
          ctx.save();
          ctx.translate(p.x + Math.sin(t * 1.5 + p.r) * 10, (p.y + p.vy * t) % (STAGE.h + 40) - 20);
          ctx.rotate(p.r + t * 2);
          // 셀 안 조각은 셀 폭의 절반쯤 → 셀을 2s × 4s 로 그리면 조각 폭 ≈ s(10~20)
          ctx.drawImage(img, (p.cell % 4) * cw, ((p.cell / 4) | 0) * ch, cw, ch, -p.s, -2 * p.s, 2 * p.s, 4 * p.s);
          ctx.restore();
        }
      };
      if (reduced()) { draw(0); return; }
      const t0 = performance.now();
      const frame = (now: number) => {
        const t = (now - t0) / 1000;
        draw(Math.min(t, 6));
        if (t < 6) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    img.src = url;
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);
  return <canvas class="rs-confetti" ref={ref} width={STAGE.w} height={STAGE.h} aria-hidden="true" />;
}
