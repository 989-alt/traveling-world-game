// 미션 패널(DESIGN §4.2 보라 패널). 5유형을 한 틀에서 보여 준다.
// 점수·정답은 여기서 가리지 않는다: 푼 사람은 번호 꾸러미(onSubmit)만 보내고, 성공·실패는 서버가 알려 준다(success).
// role='spectator' 는 같은 활동을 읽기 전용으로 보여 주고, 끝난 뒤(phase='tf') 참/거짓 1탭을 띄운다.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';
import type { Mission } from '../../shared/content-types';
import { STEP_MS } from '../../shared/economy';
import type { MissionReveal, MissionShown } from '../../shared/protocol';
import { ClimateChart } from '../graph/ClimateChart';
import { GRAPH_OF_IMAGE } from '../graph/climate-data';
import '../../styles/missions.css';
import { Choice } from './Choice';
import { Connect } from './Connect';
import {
  blocksAnswer, choiceAnswer, connectAnswer, elapsed, emptySlots, orderAnswer, shuffled, timeLeft,
  type Links, type MissionAnswerMsg, type Slots,
} from './logic';
import { MAP_OF_IMAGE } from './map-spots'; // 이름→지도 위치·구역 표(SPOT_OF·ZONE_OF_LABEL)는 번들에 싣지 않는다: 서버가 at·zones 로 보낸다
import { Placement, type BlockDef, type SlotDef } from './Placement';
import { TfPick } from './TfPick';
import { Timer, useNow } from './Timer';
import { WorldMap } from './WorldMap';

/** 막대·선이 무엇인지 묻는 활동: 범례와 눈금 숫자가 답을 알려 주므로 모양만 그린다 */
const SHAPE_ONLY = new Set(['m-33']);

export interface MissionPanelProps {
  mission: Mission;
  role: 'player' | 'spectator';
  /** play = 푸는 중(타이머), tf = 끝남(서버 판정 도착, 관전자 참/거짓) */
  phase: 'play' | 'tf';
  deadlineAt: number; // 서버가 정한 마감(ms 시각)
  durationMs?: number;
  /** 서버 판정(phase=tf 일 때) */
  success?: boolean;
  onSubmit?: (a: MissionAnswerMsg) => void;
  onTf?: (v: boolean) => void;
  tfPicked?: boolean | null;
  /** 시험용: 그림 주소 */
  urlFor?: (key: string) => string | null;
  /** 서버가 섞어 내려 준 연결·블록·순서 목록(지도 칸 위치·구역 포함). 그 순서 그대로 그리고 표시 번호로 답한다.
   *  연결·블록·순서 미션은 이것이 있어야 그린다(없으면 '불러오는 중' 만 — 옛 방·누락 대비). 시험 하네스도 이것을 만들어 준다 */
  shown?: MissionShown | null;
  /** 실패 해설(정답 키 + explain). 서버가 판정 뒤 실패한 도착자에게만 보낸다. 있으면 참/거짓 창 동안 정답을 겹쳐 보여 준다 */
  reveal?: MissionReveal | null;
}

/** 블록 정답 키 [블록, 칸] → 칸마다 정답 블록 */
const keyOfSlots = (pairs: [number, number][] | undefined, n: number): number[] | undefined => {
  if (!pairs) return undefined;
  const a = Array.from({ length: n }, () => -1);
  for (const [b, slot] of pairs) a[slot] = b;
  return a;
};

const circled = (s: string) => (/^[㉠-㉯]/.test(s) ? s[0] : '');

export function MissionPanel(p: MissionPanelProps) {
  const m = p.mission;
  const total = p.durationMs ?? STEP_MS.mission;
  const player = p.role === 'player';
  const [locked, setLocked] = useState(false);
  const sent = useRef(false);

  // ── 유형별 모양. 연결·블록·순서: 서버 표시 목록(이미 섞임) 그대로. 사진·그래프: 미션 id 로 섞음 ──
  const listed = m.type === 'connect' || m.type === 'block' || m.type === 'order';
  const sh = listed ? p.shown ?? null : null;
  const missing = listed && !sh; // 표시 목록이 아직 없음(옛 저장본 방 등): 활동 없이 기다림 표시
  const lefts = sh?.left ?? [];
  const rights = sh?.right ?? [];
  const steps = sh?.steps ?? [];
  const n = m.type === 'order' ? steps.length : listed ? lefts.length : m.options?.length ?? 0;
  const order = useMemo(() => (listed ? Array.from({ length: n }, (_, i) => i) : shuffled(n, m.id)), [m.id, n, listed]);
  const [links, setLinks] = useState<Links>({});
  const [slots, setSlots] = useState<Slots>(() => emptySlots(n));
  const [picked, setPicked] = useState<number[]>([]);

  const now = useNow();
  const left = timeLeft(p.deadlineAt, now);
  const frozen = !player || locked || p.phase !== 'play' || missing;
  // 실패 해설: 푼 사람 화면, 판정 뒤(tf), 실패, 서버가 키를 보냈을 때만(관전자·성공자는 없음)
  const rv = player && p.phase === 'tf' && !p.success ? p.reveal ?? null : null;

  const done = m.type === 'connect' ? Object.keys(links).length === n
    : m.type === 'block' || m.type === 'order' ? slots.every((s) => s !== null)
    : picked.length > 0;
  const progress = m.type === 'connect' ? Object.keys(links).length : m.type === 'block' || m.type === 'order' ? slots.filter((s) => s !== null).length : picked.length;

  const build = (): MissionAnswerMsg => {
    const ms = Math.round(elapsed(p.deadlineAt, total, Date.now()));
    switch (m.type) {
      case 'connect': return connectAnswer(links, ms);
      case 'block': return blocksAnswer(slots, ms);
      case 'order': return orderAnswer(slots, ms);
      default: return choiceAnswer(picked, ms);
    }
  };
  const submit = () => {
    if (sent.current || !player) return;
    sent.current = true;
    setLocked(true);
    p.onSubmit?.(build());
  };
  // 타이머 만료: 지금 상태 그대로 제출(부분 정답은 서버가 실패로 판정). 한 번만.
  const latest = useRef(submit);
  latest.current = submit;
  const expired = left <= 0 && p.phase === 'play' && player && !missing;
  useEffect(() => { if (expired) latest.current(); }, [expired]);

  // ── 활동 ──
  let activity;
  if (missing) {
    activity = <p class="mp-wait">활동을 불러오고 있어요</p>;
  } else if (m.type === 'connect') {
    activity = (
      <Connect left={lefts.map((label, i) => ({ id: i, label }))} right={order.map((i) => ({ id: i, label: rights[i] }))}
        value={links} onChange={setLinks} disabled={frozen} answer={rv?.pairs} />
    );
  } else if (m.type === 'block') {
    const mode = m.image ? MAP_OF_IMAGE[m.image] : undefined;
    // 지도 칸 위치(at)·구역 색(zones)은 서버가 표시 순서대로 준다
    const spots = mode === 'spots' && !!sh!.at;
    const sd: SlotDef[] = rights.map((label, i) => ({
      label, mark: circled(label), at: spots ? sh!.at![i] : undefined, zone: mode === 'zones' ? sh!.zones?.[i] || undefined : undefined,
    }));
    const blocks: BlockDef[] = order.map((i) => ({ id: i, label: lefts[i] }));
    activity = (
      <div class={`blk-act${mode ? ' has-map' : ''}`} data-map={mode ?? ''}>
        {mode === 'zones' && <WorldMap mode="zones" zones={sd.flatMap((x) => x.zone ?? [])} />}
        {mode === 'plain' && <WorldMap mode="plain" />}
        <Placement blocks={blocks} slots={sd} value={slots} onChange={setSlots} disabled={frozen} art
          layout={spots ? 'spots' : 'rows'} backdrop={spots ? <WorldMap mode="spots" landmarks /> : undefined} answer={keyOfSlots(rv?.pairs, n)} keyChips />
      </div>
    );
  } else if (m.type === 'order') {
    const blocks: BlockDef[] = order.map((i) => ({ id: i, label: steps[i] }));
    activity = (
      <>
        <Placement blocks={blocks} slots={steps.map((_, i) => ({ label: String(i + 1) }))} value={slots} onChange={setSlots} disabled={frozen} layout="order" answer={rv?.steps} />
        {/* 실패 해설: 정답 순서 한 줄 */}
        {rv?.steps && (
          <ol class="mp-keyrow" aria-label="정답 순서">
            {rv.steps.map((d, k) => <li key={d} class="mp-keystep" data-step={d}><b class="mp-keynum">{k + 1}</b><span>{steps[d]}</span></li>)}
          </ol>
        )}
      </>
    );
  } else {
    const cities = m.type === 'graph' && m.image ? GRAPH_OF_IMAGE[m.image] : undefined;
    activity = (
      <div class={`ch-act${cities ? ' has-graph' : ''}`}>
        {/* 실패 해설 뒤엔 모양만 그리던 m-33 도 눈금·범례를 켠다. fit: viewBox = 칸 크기라 눈금 13px × 스테이지 배율 그대로(QA5) */}
        {cities && <ClimateChart cities={cities} showValues={!!rv || !SHAPE_ONLY.has(m.id)} legend={!!rv || !SHAPE_ONLY.has(m.id)} fit />}
        <Choice items={order.map((i) => ({ id: i, text: m.options![i].text, image: m.options![i].image }))}
          value={picked} onChange={setPicked} disabled={frozen} urlFor={p.urlFor} answer={rv?.correct} />
      </div>
    );
  }

  const status = p.phase === 'tf'
    ? p.success ? '성공! 보상을 골라요' : rv ? '아쉬워요! 정답을 확인해요' : '아쉬워요. 다음엔 다시 도전해요'
    : missing ? '잠시 기다려요'
    : !player ? '친구가 풀고 있어요'
    : locked ? '제출했어요. 결과를 기다려요'
    : m.type === 'photo' || m.type === 'graph' ? `${progress}개 골랐어요` : `${progress}/${n}`;

  return (
    <section class={`mp mp--${m.type}${frozen ? ' is-frozen' : ''}${rv ? ' is-reveal' : ''}`} data-type={m.type} data-role={p.role} data-phase={p.phase} data-locked={locked ? '1' : '0'} data-mission={m.id}
      aria-label={m.title}>
      {/* 머리 문장(R2 D8, v3 04): 퍼즐 엠블럼 + 금 날개 2장(CSS 의사 요소)이 패널 위 테에 걸친다 */}
      <div class="mp-crest" aria-hidden="true"><AssetImg k="ui.missionEmblem" class="mp-emblem" alt="" /></div>
      {/* 제목 띠: 머리 문장 아래 위 테에 걸친 리본(R4-TF2 수정 1). 스톱워치는 오른쪽 위 테에 */}
      <header class="mp-head">
        <div class="mp-banner"><h2 class="mp-title">{m.title}</h2></div>
        <p class="mp-prompt">{m.prompt}</p>
        <div class="mp-timer"><Timer deadlineAt={p.deadlineAt} totalMs={total} watch /></div>
      </header>
      <div class="mp-area" aria-disabled={frozen}>{activity}</div>
      {p.phase === 'tf' && !player ? (
        <TfPick text={m.spectatorTf.text} onPick={(v) => p.onTf?.(v)} picked={p.tfPicked} />
      ) : rv ? (
        // 실패 해설 띠: 보상 띠 자리에 크림 판(금테) + 초록 '정답' 꼬리표
        <footer class="mp-foot mp-foot--reveal">
          <div class="mp-explain" data-mission={m.id}>
            <span class="mp-explain-tag" role="status">{status}</span>
            <p class="mp-explain-text">{rv.explain}</p>
          </div>
        </footer>
      ) : (
        <footer class="mp-foot">
          {/* 보상 띠(R2 D8): 금테 2px 알약 + 가운데 보물 상자(성공하면 보상을 고른다) */}
          <span class="mp-loot" aria-hidden="true">
            <AssetImg k="item.travelTile" class="mp-loot-i" alt="" />
            <AssetImg k="ui.chest" class="mp-chest" alt="" />
            <AssetImg k="item.doubleRoll" class="mp-loot-i" alt="" />
          </span>
          <span class={`mp-status${p.phase === 'tf' ? (p.success ? ' is-ok' : ' is-retry') : ''}`} role="status">{status}</span>
          {player && p.phase === 'play' && !missing && (
            <button type="button" class="mp-submit" disabled={locked || !done} onClick={submit}>다 했어요</button>
          )}
        </footer>
      )}
    </section>
  );
}
