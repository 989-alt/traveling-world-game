// 최종 결과(PRD §8-14). 캡처 한 장에 들어가게 짠다. (중간 결과 §8-13 은 2026-10-28 U1 에 없어졌다 — 순위 한 줄은 멈춤 화면)
// 2026-10-31 U12 엔딩(DESIGN §19, 승인 시안 MOCK-end-C2): 첫 장 = 기념사진(END-photo-frame + END-photo-bg + LM-nn + 캐릭터 P20/P21 4명 합성,
// 목 메달·로제트·'나' 하트 링·마스킹 테이프 이름표·제목) + 펼친 여권(주인 자리색 표지, 초상·학습 도장 4·나라 도장 격자·랜드마크 스티커·3줄) +
// 닫힌 여권 3(누르면 그 사람 여권이 펼쳐짐). 둘째 장 '자세히 보기' = END-passport-wide 그릇에 S9 학습 기록 전부(대번호별 정답·헷갈린 생각 번호·
// 얻은 것·도장 도감·같은 기후·기념 자석). 그림은 전부 에셋(end.*·result.*), 글자·순위 숫자·수치만 코드. svg 0(세계 지도는 여권 도장 격자로 대체).
// 2026-10-31 U13(§19.9): 글씨·메달을 그림과 하나로 — 메달은 포즈 그림(CHn-P20-gold·P21-silver/bronze/plain, 로봇 -s<자리> 목도리), 순위 숫자는
// END-rosette-n, 제목은 END-photo-frame-v2, 여권 항목 이름은 END-passport-open-n-v2 그림에 든다. 가변 글자(이름·수치·도장 나라·3줄·독점)는 Gaegu 손글씨
// (잉크색·기울기·multiply). 크기 = 머리 폭 기준, 발 기준선 한 줄. 메달 포즈·v2 여권·세운 여권·탭이 아직 없는 경우는 U12 그림으로 내려간다.
// 보내는 것 없음: 로그에서 그 자리에서 계산해 그리기만 한다. 애니메이션 §19.6(약 6초), 움직임 줄이기 = 마지막 장면 한 번 페이드.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AssetImg, Pic } from '../../assets/AssetImg';
import { assetUrl, hasAsset } from '../../assets/manifest';
import { preload } from '../../assets/preload';
import { buildReport, type MetaMap, type Rate, type Row, type SeatReport } from '../../engine/report';
import { BOARD } from '../../shared/board';
import type { LogEvent, Seat } from '../../shared/types';
import { BUILDING } from '../overlays/ActionPanel';
import { CONTINENT_NAME, won } from '../overlays/parts';
import { STAGE, useStageScale } from '../overlays/PlankDialog';
import {
  BALLOON, BOOK, FOOT_Y, GROUP, LANDMARK, OPEN_V2, RIGHT, ROSETTE, ROSETTE_Y, STAND, STAND_H, STAND_SLOTS, TAB, TAPE, TAPE_ROT, WINDOW, figure, footXs, landmarkX, medalPoseKey, stampName, toStage, type OpenV2,
} from './end-geom';
import { countryName, META } from './meta';
import '../../styles/results.css';

export interface SeatInfo { seat: Seat; charId: number; name: string; isBot: boolean }
export interface ResultsProps {
  log: LogEvent[];
  seats: SeatInfo[];
  mySeat?: Seat | null;
  meta?: MetaMap;
}

const TITLE = '최종 결과';
const END_TITLE = '세계 여행 끝!';
const pct = (r: Rate) => (r.n ? `${Math.round((r.ok / r.n) * 100)}%` : '-');
const frac = (r: Rate) => `${r.ok}/${r.n}`;
const PLACE = ['gold', 'silver', 'bronze', 'plain'] as const;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** §19.6 시간표(초) */
const T = { rosette: [2.55, 2.3, 2.05, 1.8], sparkle: 2.85, tape: 3.2, book: 3.5, portrait: 4.1, coin: 4.3, grid: 5.0, sticker: 5.5, lines: 5.8, closed: 6.0, done: 7.0 };
const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/** 1위가 세운 랜드마크 → 없으면 1위가 도장을 가장 높게 받은 나라의 랜드마크 → 그것도 없으면 빈 언덕 */
function photoLandmark(r: SeatReport | undefined): string | null {
  if (!r) return null;
  const lmKey = (tile: number) => (hasAsset(`landmark.${tile}.big`) ? `landmark.${tile}.big` : hasAsset(`landmark.${tile}`) ? `landmark.${tile}` : null);
  for (const t of r.landmarks) { const k = lmKey(t); if (k) return k; }
  const best = [...r.stamps].sort((a, b) => b.level - a.level);
  for (const s of best) {
    const tile = BOARD.find((t) => t.country === s.country && t.kind !== 'start');
    const k = tile && lmKey(tile.index);
    if (k) return k;
  }
  return null;
}

export function Results({ log, seats, mySeat = null, meta = META }: ResultsProps) {
  const rep = useMemo(() => buildReport(log, meta, seats.map((s) => s.isBot)), [log, meta, seats]);
  const order = rep.final;
  const ranks = order?.ranks ?? seats.map((s) => s.seat);
  // '나' = 사람 자리면 그 자리, 관전자·방장 보기(봇 자리·자리 없음)면 1위(§19 edge)
  const me: Seat = mySeat !== null && seats[mySeat] && !seats[mySeat].isBot ? mySeat : ranks[0];
  const [pick, setPickRaw] = useState<Seat>(me);
  const [moved, setMoved] = useState(false); // 주인을 한 번이라도 바꿨으면 펼친 여권이 바뀔 때 짧게 넘김
  const setPick = (s: Seat) => { setMoved(true); setPickRaw(s); };
  const [detail, setDetail] = useState(false);
  /** 순위 n 자리의 포즈 = 메달을 그린 그림(1위 P20 금+트로피, 2·3·4위 P21 은·동·크림, 로봇은 자리색 목도리 .s<자리>) */
  const heroOf = (seat: Seat, n: number) => medalPoseKey(seats[seat].charId, seat, order ? n : null);
  const scale = useStageScale();
  const calm = useMemo(reduced, []);
  // 그림을 받아(디코드까지) 둔 뒤 애니메이션을 시작한다(사진이 흰색에서 한 장처럼 떠오르게). 못 받아도 2.5초 뒤 시작
  const [phase, setPhase] = useState<'wait' | 'intro' | 'done'>('wait');
  useEffect(() => {
    let live = true;
    const keys = ['end.photoBg', 'end.frame', `end.passport.open.${me + 1}`, 'end.tab.more', ...ranks.flatMap((s, n) => [heroOf(s, n), `end.tape.${s + 1}`, `end.rosette.${n + 1}`, `end.passport.stand.${s + 1}`])].filter(hasAsset);
    const go = () => { if (live) setPhase((p) => (p === 'wait' ? (calm ? 'done' : 'intro') : p)); };
    void preload(keys).then(go);
    const t = setTimeout(go, 2500);
    return () => { live = false; clearTimeout(t); };
  }, []);
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setPhase('done'), T.done * 1000);
    return () => clearTimeout(t);
  }, [phase]);

  const stageCls = `rs-stage end-stage end-${phase}${calm ? ' end-calm' : ''}`;
  const stageStyle = { width: `${STAGE.w}px`, height: `${STAGE.h}px`, transform: `translate(-50%, -50%) scale(${scale})` };

  if (rep.empty) {
    return (
      <main class="sc rs" data-kind="final" aria-label={TITLE}>
        <AssetImg k="ui.boardBg" class="sc-bg" />
        <div class={stageCls} style={stageStyle}>
          <section class="end-wide end-empty" data-k="empty" role="status">
            <Pic k="end.passport.wide" class="end-wide-img" fallback={<span class="end-wide-img end-fb-paper" />} eager />
            <h1 class="end-empty-title">{END_TITLE}</h1>
            <p>아직 한 번도 주사위를 굴리지 않았어요. 게임을 하면 여기에 기록이 쌓여요.</p>
          </section>
        </div>
      </main>
    );
  }

  const xs = footXs(ranks.length);
  const lm = photoLandmark(order ? rep.seats[ranks[0]] : undefined);
  const others = ranks.filter((s) => s !== pick);
  const info = (seat: Seat) => seats[seat];
  const assets = order?.assets;

  return (
    <main class="sc rs" data-kind="final" aria-label={TITLE}>
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <div class={stageCls} style={stageStyle} data-page={detail ? 'detail' : 'summary'}>
        <h1 class="rs-title sr-only">{TITLE}</h1>
        <Confetti on={phase !== 'wait'} calm={calm || phase === 'done'} />
        <span class="end-flash" aria-hidden="true" />

        {/* ── 기념사진(그룹 −4.4°, 시안 실측) ── */}
        <figure class="end-photo" aria-label="기념사진" style={{ left: px(GROUP.x), top: px(GROUP.y), width: px(GROUP.w), height: px(GROUP.h) }}>
          <div class="end-window" style={{ left: px(WINDOW.x), top: px(WINDOW.y), width: px(WINDOW.w), height: px(WINDOW.h) }}>
            <Pic k="end.photoBg" class="end-bg" fallback={<span class="end-bg end-fb-sky" />} eager />
            {lm ? <Pic k={lm} class="end-lm" alt="" eager
              style={{ left: px(landmarkX(ranks.length) - WINDOW.x - LANDMARK.h / 2), top: px(LANDMARK.base - WINDOW.y - LANDMARK.h), width: px(LANDMARK.h), height: px(LANDMARK.h) }} />
              : <Pic k="end.balloon" class="end-lm end-balloon" alt="" eager
                style={{ left: px(BALLOON.x - WINDOW.x - BALLOON.h / 2), top: px(BALLOON.base - WINDOW.y - BALLOON.h), width: px(BALLOON.h), height: px(BALLOON.h) }} />}
          </div>
          <ol class="end-people" data-k="rank" aria-label="순위">
            {ranks.map((seat, n) => {
              const first = n === 0 && !!order;
              const fx = xs[n], fy = FOOT_Y;
              const hero = heroOf(seat, n);
              const f = figure(hero, info(seat).charId, fx, fy);
              const isMe = seat === me;
              const slot = [1, 0, 2, 3].filter((r) => r < ranks.length).indexOf(n); // 왼쪽부터 몇 번째 슬롯
              return (
                <li key={seat} class={`end-person${first ? ' is-first' : ''}${isMe ? ' is-me' : ''}`} data-seat={seat} data-place={PLACE[n]} data-rank={order ? n + 1 : undefined}
                  aria-label={`${order ? `${n + 1}위 ` : ''}${info(seat).name}${info(seat).isBot ? ' 봇' : ''}${isMe ? ' (나)' : ''}${assets ? ` ${won(assets[seat])}원` : ''}`}>
                  <span class="end-shadow" aria-hidden="true" style={{ left: px(fx), top: px(fy), width: px(f.body * 0.4), marginLeft: px(-f.body * 0.17) }} />
                  <span class="end-foot" aria-hidden="true" data-head={Math.round(f.head)} data-body={Math.round(f.body)} data-top={Math.round(fy - f.trim)} style={{ left: px(fx), top: px(fy) }} />
                  <Pic k={hero} class="end-hero" eager
                    style={{ left: px(f.left), top: px(f.top), width: px(f.side), height: px(f.side) }}
                    fallback={<span class="end-face" style={{ left: px(fx), top: px(fy - 120) }}><AssetImg k={`char.${info(seat).charId}.f00`} class="end-face-img" alt="" /></span>} />
                  {first && [0, 1].map((i) => (
                    <Pic key={i} k="result.dot.star" class={`end-spark end-spark--${i}`} style={{ left: px(f.trophy.x + (i ? 0.2 : -0.22) * f.trim), top: px(f.trophy.y + (i ? 0.02 : -0.08) * f.trim) }} />
                  ))}
                  <span class="end-rosette" style={{ left: px(fx), top: px(ROSETTE_Y), width: px(ROSETTE), height: px(ROSETTE), margin: px(-ROSETTE / 2), animationDelay: `${T.rosette[n] ?? 1.8}s` }}>
                    {order
                      ? <Pic k={`end.rosette.${n + 1}`} class="end-ro-img" alt={`${n + 1}위`} eager fallback={<><span class="end-ro-img end-fb-ring" /><b class="end-fb-n">{n + 1}</b></>} />
                      : <Pic k="result.medal.plain" class="end-ro-img" fallback={<span class="end-ro-img end-fb-ring" />} eager />}
                  </span>
                  <span class="end-tape" style={{ left: px(fx), top: px(TAPE.y), width: px(TAPE.w), height: px(TAPE.h), marginLeft: px(-TAPE.w / 2), marginTop: px(-TAPE.h / 2), '--rot': `${TAPE_ROT[slot] ?? 0}deg`, animationDelay: `${T.tape + (3 - n) * 0.06}s` }}>
                    <Pic k={`end.tape.${seat + 1}`} class="end-tape-img" fallback={<span class="end-tape-img end-fb-tape" style={{ '--seat': `var(--seat-${seat + 1})` }} />} eager />
                    <FitName name={info(seat).name} />
                  </span>
                </li>
              );
            })}
          </ol>
          <span class="end-develop" aria-hidden="true" style={{ left: px(WINDOW.x), top: px(WINDOW.y), width: px(WINDOW.w), height: px(WINDOW.h) }} />
          {/* 제목 '세계 여행 끝!' 은 틀 그림(END-photo-frame-v2) 아래 테에 들어 있다. 그림을 못 받을 때만 코드 손글씨 */}
          <Pic k="end.frame" class="end-frame" alt={END_TITLE} fallback={<><span class="end-frame end-fb-frame" /><p class="end-fb-title">{END_TITLE}</p></>} eager />
        </figure>

        {/* ── 펼친 여권(주인 = pick) ── */}
        <Passport2 key={pick} seat={pick} g={OPEN_V2[pick + 1]} info={info(pick)} r={rep.seats[pick]} monopolies={rep.monopolies.filter((m) => m.seat === pick)} isMe={pick === me} swap={moved} />

        {/* ── 닫힌 여권 3: 나머지 사람, 순위 차례(Tab 순서 = 순위) ── */}
        <div class="end-closed" role="group" aria-label="다른 친구 여권">
          {others.map((seat, i) => {
            const st = STAND[seat + 1]; // 세운 닫힌 여권(시안 부채꼴, 바닥 중앙 기준 회전)
            const slot = STAND_SLOTS[i] ?? STAND_SLOTS[2];
            const w = STAND_H * st.a;
            return (
              <button key={seat} type="button" class="end-cp" data-k="owner" data-seat={seat} aria-label={`${info(seat).name} 여권 펼치기`} title={info(seat).name}
                onClick={() => setPick(seat)}
                style={{ left: px(slot.cx - w / 2), top: px(slot.top), width: px(w), height: px(STAND_H), '--rot': `${slot.rot}deg`, animationDelay: `${T.closed + i * 0.08}s` }}>
                <span class="end-cp-win" style={{ left: `${st.w[0]}%`, top: `${st.w[1]}%`, width: `${st.w[2]}%`, height: `${st.w[3]}%`, '--seat': `var(--seat-${seat + 1})` }}>
                  <AssetImg k={`char.${info(seat).charId}.f00`} class="end-cp-face" alt="" />
                </span>
                <Pic k={`end.passport.stand.${seat + 1}`} class="end-cp-img" fallback={<span class="end-cp-img end-fb-cover" style={{ '--seat': `var(--seat-${seat + 1})` }} />} />
              </button>
            );
          })}
        </div>

        {/* '자세히 보기' / '돌아가기' = 책갈피 탭 그림(END-tab-more/back, 글자가 그림에 듦). 하나의 버튼(data-k="detail"), 자리·그림만 바뀜 */}
        <button type="button" class="end-tab" data-k="detail" aria-pressed={detail} aria-label={detail ? '돌아가기' : '자세히 보기'} onClick={() => setDetail(!detail)}
          style={detail ? { left: px(TAB.back.x), top: px(TAB.back.y), width: px(TAB.w), height: px(TAB.h) } : { left: px(TAB.x), top: px(BOOK.top + TAB.dy), width: px(TAB.w), height: px(TAB.h) }}>
          <Pic key={detail ? 'back' : 'more'} k={detail ? 'end.tab.back' : 'end.tab.more'} class="end-tab-img"
            fallback={<span class="end-tab-img end-fb-tab"><span class="end-fb-tab-t">{detail ? '돌아가기' : '자세히 보기'}</span></span>} />
        </button>

        {/* ── 둘째 장(S9 전부): 와이드 여권 그릇 ── */}
        <section class="end-wide" data-k="detail-page" aria-label="자세한 학습 기록" hidden={!detail}>
          {detail ? <Pic k="end.passport.wide" class="end-wide-img" fallback={<span class="end-wide-img end-fb-paper" />} /> : <span class="end-wide-img" />}
          <div class="end-wide-head">
            <div class="rs-tabs" role="tablist" aria-label="누구의 기록">
              {seats.map((s) => (
                <button key={s.seat} type="button" role="tab" class="rs-tab" data-k="tab" data-seat={s.seat} aria-selected={pick === s.seat}
                  aria-label={`${s.name}${s.isBot ? ' 봇' : ''}`} title={s.name} onClick={() => setPick(s.seat)}>
                  <AssetImg k={`char.${s.charId}.f00`} class="rs-tab-face" alt="" />
                  <Pic k={`result.tab-ring.${s.seat + 1}`} class="rs-tab-ring" fallback={<span class="rs-tab-ring rs-fb" style={{ '--seat': `var(--seat-${s.seat + 1})` }} />} />
                </button>
              ))}
            </div>
            <b class="rs-who">{info(pick).name}{assets && <small class="rs-who-coin"><AssetImg k="ui.coin" class="rs-coin-ico" />{won(assets[pick])}원</small>}</b>
          </div>
          <div class="end-wide-in">
            <section class="rs-learn" aria-label="퀴즈 기록">
              {rep.seats[pick].isBot ? <p class="rs-note" data-k="bot-note">봇은 학습 기록을 모으지 않아요.</p> : <Learn r={rep.seats[pick]} />}
            </section>
            <section class="rs-side" aria-label="도장 도감">
              <StampBook r={rep.seats[pick]} />
              <Magnets r={rep.seats[pick]} />
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

/** 펼친 여권 상자: x·폭·위 고정(시안), 높이 = 그림 비율(가로형 v2 실측) */
function bookBox(seat: Seat) {
  const H = BOOK.w / OPEN_V2[seat + 1].a;
  return { W: BOOK.w, H, top: BOOK.top, bottom: BOOK.top + H };
}

/** 테이프 이름(Gaegu 22px, 나 24px): 테이프 안에 안 들어가면 20px 로 한 번 줄인다(말줄임 0). 글꼴을 받은 뒤 잰다 */
function FitName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => { const el = ref.current; if (live && el && el.scrollWidth > el.clientWidth + 1) setSmall(true); };
    check();
    void document.fonts?.ready.then(check);
    return () => { live = false; };
  }, [name]);
  return <span ref={ref} class={`end-name${small ? ' is-small' : ''}`}>{name}</span>;
}

/** U13 펼친 여권 v2: 항목 이름 4·학습 도장 4 는 그림, 코드는 손글씨 값만 — 초상(그림 뒤, 틀이 뚫림) · 수치 4(그림 밑줄 위) ·
 *  오른쪽 면 위 주인 이름 · 나라 도장 격자 · 스티커 3 · 3줄(코드 연필선 위) · 독점 한 줄 */
function Passport2({ seat, g, info, r, monopolies, isMe, swap }: { seat: Seat; g: OpenV2; info: SeatInfo; r: SeatReport; monopolies: { continent: string }[]; isMe: boolean; swap: boolean }) {
  const { W, H, top } = bookBox(seat);
  const box = (b: readonly number[]) => ({ left: `${b[0]}%`, top: `${b[1]}%`, width: `${b[2]}%`, height: `${b[3]}%` });
  const lms = r.landmarks.slice(0, 3);
  const vals: [string, number | null, string][] = [
    ['다녀온 곳', r.stamps.length, '곳'],
    ['랜드마크', r.landmarks.length, '개'],
    ['도착 퀴즈', r.isBot || !r.total.arrive.n ? null : Math.round((r.total.arrive.ok / r.total.arrive.n) * 100), '%'],
    ['참/거짓', r.isBot || !r.total.tf.n ? null : Math.round((r.total.tf.ok / r.total.tf.n) * 100), '%'],
  ];
  const right = { left: `${g.right[0]}%`, width: `${g.right[1] - g.right[0]}%` };
  // 3줄 기준선: 스티커 틀 아래 + 7% 부터 오른쪽 면 안 테(91.5%)까지 고르게
  const sb = Math.max(...g.s.map((b) => b[1] + b[3]));
  const lines = [0, 1, 2].map((i) => sb + 7 + (i * (RIGHT.linesEnd - sb - 7)) / 2);
  return (
    <section class={`end-book end-book--v2${swap ? ' is-swap' : ''}`} data-k="learn" data-owner={seat} data-me={isMe ? '1' : undefined} aria-label={`${info.name} 여권`}
      style={{ left: px(BOOK.x), top: px(top), width: px(W), height: px(H), '--H': `${H}`, '--seat': `var(--seat-${seat + 1})`, '--seat-text': `var(--seat-${seat + 1}-text)` }}>
      <span class="end-portrait" style={box(g.p)}>
        <AssetImg k={`char.${info.charId}.f00`} class="end-portrait-face" alt={`${info.name} 얼굴`} />
      </span>
      {g.s.map((s, i) => (
        <span key={i} class={`end-sticker${lms[i] === undefined ? ' is-empty' : ''}`} style={{ ...box(s), animationDelay: `${T.sticker + i * 0.1}s` }}>
          {lms[i] !== undefined && <Pic k={`landmark.${lms[i]}`} class="end-sticker-lm" alt="랜드마크" />}
        </span>
      ))}
      <Pic k={`end.passport.open.${seat + 1}`} class="end-book-img" fallback={<span class="end-book-img end-fb-book" />} eager />
      <div class="end-book-in">
        <b class="end-owner end-hand" style={{ ...right, top: `${RIGHT.owner}%` }}>{info.name}</b>
        <ul class="end-vals" data-k="medals">
          {vals.map(([label, v, unit], i) => (
            <li key={label} class="end-coin" aria-label={`${label} ${v === null ? '-' : `${v}${unit}`}`}
              style={{ left: `${g.v.x[i % 2]}%`, top: `${g.v.y[i >> 1]}%`, animationDelay: `${T.coin + i * 0.2}s` }}>
              <span class="end-fb-label">{label}</span>
              <b class="end-coin-v end-hand">{v === null ? '-' : <Roll to={v} delay={T.coin + i * 0.2} />}{v === null ? '' : unit}</b>
            </li>
          ))}
        </ul>
        <StampGrid r={r} top={monopolies.length ? RIGHT.gridMono : RIGHT.grid[0]} bottom={Math.min(RIGHT.grid[1], g.s[0][1] - 3)} left={RIGHT.gridX[0]} right={RIGHT.gridX[1]} />
        {r.landmarks.length > 3 && <b class="end-sticker-more end-hand" style={{ left: `${g.s[2][0] + g.s[2][2] - 2}%`, top: `${g.s[2][1] - 4}%` }}>+{r.landmarks.length - 3}</b>}
        <Lines r={r} lines={lines} hand style={right} />
        {monopolies.length > 0 && (
          <p class="end-mono end-hand" data-k="monopoly" style={{ ...right, top: `${RIGHT.mono}%` }}>
            {monopolies.map((m) => <b key={m.continent} class="end-mono-t" data-continent={m.continent}>{CONTINENT_NAME[m.continent] ?? m.continent} 독점!</b>)}
          </p>
        )}
      </div>
    </section>
  );
}

/** 수치 롤링(0 → 값, 0.5초). 소개 애니메이션이 끝났거나 움직임 줄이기면 바로 값 */
function Roll({ to, delay }: { to: number; delay: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const st = el?.closest('.end-stage');
    if (!el || !st?.classList.contains('end-intro')) return;
    let raf = 0;
    const t0 = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 500));
      el.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    el.textContent = '0';
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (el) el.textContent = String(to); };
  }, [to]);
  return <span ref={ref}>{to}</span>;
}

/** 나라 도장 격자 3×3(빈 도장 테 빨강·파랑 교대). 9 넘으면 마지막 칸 '+n' */
function StampGrid({ r, top, bottom, left, right }: { r: SeatReport; top: number; bottom: number; left?: number; right?: number }) {
  const over = r.stamps.length > 9;
  const shown = over ? r.stamps.slice(0, 8) : r.stamps;
  return (
    <ol class={`end-grid${left !== undefined ? ' end-hand-grid' : ''}`} data-k="map" aria-label={`다녀온 나라 ${r.stamps.length}곳`}
      style={{ top: `${top}%`, height: `${bottom - top}%`, ...(left !== undefined && right !== undefined ? { left: `${left}%`, width: `${right - left}%` } : {}) }}>
      {Array.from({ length: 9 }, (_, i) => {
        const s = shown[i];
        const more = over && i === 8;
        const full = s ? countryName(s.country) : '';
        const name = s ? stampName(s.country, full) : '';
        return (
          <li key={i} class={`end-stamp${s ? ' is-on' : more ? ' is-more' : ''} end-stamp--${i % 2 ? 'blue' : 'red'}`} style={{ animationDelay: `${T.grid + i * 0.08}s` }}
            {...(s ? { 'data-k': 'pin', 'data-country': s.country, title: full } : more ? { 'data-k': 'pin-more', 'data-n': r.stamps.length - 8 } : {})}>
            <Pic k={`end.stampRing.${i % 2 ? 'blue' : 'red'}`} class="end-stamp-ring" fallback={<span class="end-stamp-ring end-fb-ring" />} />
            {s && <span class={`end-stamp-t${name.length >= 4 ? ' is-two' : ''}`}>{name.length >= 4 ? <>{name.slice(0, Math.ceil(name.length / 2))}<br />{name.slice(Math.ceil(name.length / 2))}</> : name}</span>}
            {more && <span class="end-stamp-t">+{r.stamps.length - 8}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** 3줄(잉크): 도착 퀴즈·참/거짓·헷갈린 생각 번호 — 오른쪽 면 줄 선 위 */
function Lines({ r, lines, hand, style }: { r: SeatReport; lines: number[]; hand?: boolean; style?: Record<string, string> }) {
  const a = r.total.arrive;
  const t = r.total.tf;
  const rows = r.isBot
    ? ['봇은 기록을 모으지 않아요', `도장 ${r.stamps.length}곳을 모았어요`, `랜드마크 ${r.landmarks.length}개 세웠어요`]
    : [
      a.n ? `도착 퀴즈 ${frac(a)} 맞혔어요` : '도착 퀴즈를 아직 안 풀었어요',
      t.n ? `참/거짓 ${frac(t)} 맞혔어요` : '참/거짓을 아직 안 골랐어요',
      r.wrongM.length ? `헷갈린 생각 ${r.wrongM.slice(0, 3).join(' ')}${r.wrongM.length > 3 ? ' …' : ''}` : '헷갈린 생각 번호 없음',
    ];
  return (
    <ul class={`end-lines${hand ? ' end-lines--hand' : ''}`} data-k="lines">
      {rows.map((text, i) => <li key={i} data-line={lines[i]} style={{ ...style, top: `${lines[i] ?? 80 + i * 4}%`, animationDelay: `${T.lines + i * 0.12}s` }}>{hand ? <span class="end-hand">{text}</span> : text}</li>)}
    </ul>
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

/** 색종이 canvas 1장(§19.2·§19.6): RS-confetti 시트(4×2 셀) 조각 40개가 1.4초 뒤부터 2.5초 동안 떨어져 사진 윗변(−3° 회전 포함)에 걸려 멈춘다.
 *  움직임 줄이기·소개가 끝난 뒤 다시 그릴 때는 멈춘 마지막 장면 한 장. 시트를 못 받으면 아무것도 안 그린다 */
function Confetti({ on, calm }: { on: boolean; calm: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    const url = assetUrl('result.confetti');
    if (!on || !cv || !ctx || !url) return;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const a = toStage(0, 0), b = toStage(GROUP.w, 0); // 사진 윗변(틀 바깥 위) 두 끝
    const bits = Array.from({ length: 40 }, (_, i) => {
      const u = 0.03 + rnd() * 0.94;
      const x = a.x + (b.x - a.x) * u;
      const rest = a.y + (b.y - a.y) * u - 6 + rnd() * 8; // 사진 윗변에 걸림(캔버스가 사진 아래 층이라 아래쪽은 틀 뒤로)
      return { x, rest, y0: -30 - rnd() * 260, sway: rnd() * 6.28, r0: rnd() * 6, spin: 2 + rnd() * 5, s: 8 + rnd() * 7, cell: i % 8, lag: rnd() * 0.6 };
    });
    let raf = 0;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const cw = img.width / 4, ch = img.height / 2;
      const draw = (t: number) => { // t = 낙하 시작부터 초
        ctx.clearRect(0, 0, STAGE.w, STAGE.h);
        for (const p of bits) {
          const k = Math.max(0, Math.min(1, (t - p.lag) / (2.5 - p.lag)));
          const e = 1 - (1 - k) ** 2;
          const y = p.y0 + (p.rest - p.y0) * e;
          const x = p.x + Math.sin(p.sway + k * 7) * 14 * (1 - k);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.r0 + p.spin * e);
          ctx.drawImage(img, (p.cell % 4) * cw, ((p.cell / 4) | 0) * ch, cw, ch, -p.s, -2 * p.s, 2 * p.s, 4 * p.s);
          ctx.restore();
        }
      };
      if (calm) { draw(3); return; }
      const t0 = performance.now() + 1400;
      const frame = (now: number) => {
        const t = (now - t0) / 1000;
        draw(t);
        if (t < 2.6) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    img.src = url;
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [on]);
  return <canvas class="rs-confetti" ref={ref} width={STAGE.w} height={STAGE.h} aria-hidden="true" />;
}
