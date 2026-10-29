// 보드 위 치비 1명. 판 위 말(.bc, 44px) 또는 광장 귀퉁이 전신 캐릭터(.bcc, 96px — U5 §16.9.2, 같은 포즈 파일). 위치는 발 앵커(x, y) + 키 h. 움직임은 WAAPI transform·opacity 와 포즈 교체(80ms 크로스페이드)뿐.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';
import { HOP_MS } from '../../shared/timing';
import { CHAR } from '../board/geometry';
import { crowdFrames, MOTIONS, poseKey } from './motions';
import type { Playing } from './scheduler';
import '../../styles/characters.css';

/** 칸 환경광(눈·얼음 칸 차게, 사막 칸 따뜻하게) — Board 의 SVG 필터 #amb-cool·#amb-warm */
export type Ambient = 'cool' | 'warm';

export interface CharacterProps {
  seat: number;
  /** 서 있는 칸(검사·디버그용 data-tile) */
  tile: number;
  charId: number;
  name: string;
  /** 발 앵커(스테이지 px) */
  x: number;
  y: number;
  /** 스프라이트 키(px). 토큰 44 가 상한, 여럿이 서면 줄어든다 */
  h: number;
  /** 이번 위치 변화가 칸 이동 1홉이면 포물선, 아니면 짧은 미끄러짐 */
  hop: boolean;
  /** 같은 칸에 2명 이상: A 트윈은 끄고(포즈만), B·C 는 위아래 3% 로 묶는다 */
  crowded: boolean;
  playing: Playing | null;
  grey: boolean;
  reduced: boolean;
  /** 서 있는 칸의 환경광(없으면 기본) */
  ambient?: Ambient | null;
  /** 광장 귀퉁이 전신 캐릭터(U5): 루트 클래스 .bcc(말 .bc 와 따로 센다) */
  corner?: boolean;
}

const SHIFT_MS = 200;
/** 홉 높이(캐릭터 배율 전 px) — 칸 사이 다리를 넘는 낮은 포물선 */
export const HOP_LIFT = 18;
const at = (x: number, y: number, k: number) => `translate(${x}px, ${y}px) scale(${k})`;

/** 공중 포물선: 땅 경로(slot)는 직선, 높이만 여기서 — 그림자는 땅에 남아 작아지고 옅어진다 */
const AIR: Keyframe[] = [
  { transform: 'translateY(0) scale(1.06, 0.92)', easing: 'cubic-bezier(0.3, 0.6, 0.6, 1)' }, // 도약 직전 살짝 눌림
  { transform: `translateY(${-HOP_LIFT * 0.75}px) scale(0.96, 1.05)`, offset: 0.3, easing: 'ease-out' },
  { transform: `translateY(${-HOP_LIFT}px) scale(1, 1)`, offset: 0.5, easing: 'ease-in' },
  { transform: `translateY(${-HOP_LIFT * 0.6}px) scale(0.97, 1.04)`, offset: 0.78, easing: 'ease-in' },
  { transform: 'translateY(0) scale(1, 1)' },
];
const SHADOW: Keyframe[] = [
  { transform: 'scale(1)', opacity: 1 },
  { transform: 'scale(0.55)', opacity: 0.4, offset: 0.5 },
  { transform: 'scale(1)', opacity: 1 },
];
/** 착지: 눌렸다 튕겨 돌아옴(발 앵커 기준) */
const LAND: Keyframe[] = [
  { transform: 'scale(1.12, 0.86)' },
  { transform: 'scale(0.96, 1.04)', offset: 0.45 },
  { transform: 'scale(1, 1)' },
];
const LAND_MS = 180;

export function Character(p: CharacterProps) {
  const slot = useRef<HTMLDivElement>(null);
  const motion = useRef<HTMLDivElement>(null);
  const air = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  const [dust, setDust] = useState(0);
  const front = useRef<HTMLSpanElement>(null);
  const prev = useRef<{ x: number; y: number; k: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const k = p.h / CHAR.h;

  // 위치: 홉은 땅 위 직선 경로(slot) + 높이 포물선(bc-air) + 땅에 남는 그림자(작아지고 옅어짐) + 착지 눌림·먼지.
  // 자리 재배치는 짧게 미끄러짐. 전부 transform·opacity 만(WAAPI)
  useLayoutEffect(() => {
    const el = slot.current!;
    const to = at(p.x, p.y, k);
    const from = prev.current;
    prev.current = { x: p.x, y: p.y, k };
    el.style.transform = to;
    if (!from || p.reduced || (from.x === p.x && from.y === p.y && from.k === k)) return;
    setMoving(true);
    const ground = el.animate([{ transform: at(from.x, from.y, from.k) }, { transform: to }], { duration: p.hop ? HOP_MS : SHIFT_MS, easing: p.hop ? 'linear' : 'ease-out' });
    const parts = p.hop ? [air.current?.animate(AIR, HOP_MS), shadow.current?.animate(SHADOW, { duration: HOP_MS, easing: 'ease-in-out' })] : [];
    let land: Animation | undefined;
    ground.onfinish = () => {
      setMoving(false);
      if (!p.hop) return;
      land = air.current?.animate(LAND, { duration: LAND_MS, easing: 'ease-out' });
      setDust((n) => n + 1);
    };
    return () => { ground.cancel(); parts.forEach((a) => a?.cancel()); land?.cancel(); };
  }, [p.x, p.y, k, p.hop, p.reduced]);

  // 모션 트윈
  const m = p.playing ? MOTIONS[p.playing.motion] : null;
  useEffect(() => {
    if (!m?.frames || p.reduced || (p.crowded && m.tier === 'A')) return;
    const a = motion.current!.animate(p.crowded ? crowdFrames(m.frames) : m.frames, {
      duration: m.cycle ?? m.ms,
      iterations: m.iterations ?? 1,
      easing: 'ease-in-out',
    });
    return () => a.cancel();
  }, [p.playing?.motion, p.playing?.startedAt, p.reduced, p.crowded]);

  // 포즈: 앞 그림만 80ms 페이드 인, 뒤엔 직전 포즈가 남아 깜빡임이 없다
  const pose = m ? m.pose : p.grey ? 17 : 1;
  const [layers, setLayers] = useState({ back: pose, front: pose });
  useLayoutEffect(() => {
    if (layers.front !== pose) setLayers({ back: layers.front, front: pose });
  }, [pose]);
  // 페이드가 끝나면 뒤 그림을 걷는다: 포즈 그림은 투명 배경이라 남겨 두면 이전 포즈(팔·발)가 비쳐 겹쳐 보인다(줌에서 잘 보임)
  useLayoutEffect(() => {
    const drop = () => setLayers((l) => (l.back === l.front ? l : { back: l.front, front: l.front }));
    if (p.reduced || !front.current) { drop(); return; }
    const a = front.current.animate([{ opacity: 0 }, { opacity: 1 }], 80);
    a.onfinish = drop;
    return () => a.cancel();
  }, [layers.front]);

  const busy = moving || (!!m?.frames && !p.reduced && !(p.crowded && m.tier === 'A'));
  return (
    <div
      ref={slot}
      class={`${p.corner ? 'bcc' : 'bc'}${busy ? ' is-moving' : ''}${p.grey ? ' is-grey' : ''}`}
      data-seat={p.seat}
      data-tile={p.tile}
      data-motion={p.playing?.motion ?? ''}
      data-ambient={p.ambient ?? 'base'}
      style={{ zIndex: Math.round(p.y * 10), '--seat': `var(--seat-${p.seat + 1})` }}
    >
      <span class="bc-foot" aria-hidden="true" />
      <span class="bc-shadow" ref={shadow} aria-hidden="true" />
      {dust > 0 && !p.reduced && <span class="bc-dust" key={dust} aria-hidden="true"><i /><i /><i /></span>}
      <div ref={air} class="bc-air">
      <div ref={motion} class="bc-motion">
        <div class={`bc-breath${p.playing || p.grey ? ' is-still' : ''}`}>
          <div class="bc-sprite" role="img" aria-label={p.name}>
            {layers.back !== layers.front && <span class="bc-pose"><AssetImg k={poseKey(p.charId, layers.back)} class="bc-img" /></span>}
            <span class="bc-pose" ref={front} key={layers.front}><AssetImg k={poseKey(p.charId, layers.front)} class="bc-img" /></span>
            {m?.coin && !p.reduced && <span class="bc-coin" key={p.playing!.startedAt}><AssetImg k="ui.coin" class="bc-coin-img" /></span>}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
