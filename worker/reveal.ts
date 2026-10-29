// 미션 실패 해설(PRD §3.5, QA r3): 정답 키를 표시 번호로 바꾼다. 서버(room.ts)와 시험 하네스만 쓴다 — 화면 번들엔 안 실린다.
import type { Mission } from '../src/shared/content-types';
import type { MissionReveal } from '../src/shared/protocol';

/** 표시 번호 d → 원래 번호(room.ts MissionOrder 와 같은 모양) */
export interface ShownOrder { left: number[]; right: number[]; steps: number[] }

/** 정답 키 + explain. 연결·블록·순서는 표시 순서(order)가 있어야 만든다(없으면 null) */
export function missionReveal(m: Mission, order: ShownOrder | null): MissionReveal | null {
  const explain = m.explain ?? '';
  switch (m.type) {
    case 'connect':
    case 'block': {
      if (!order || !m.pairs) return null;
      // 왼쪽 표시 l 의 원래 짝 i → 그 짝 오른쪽이 서 있는 표시 자리
      return { pairs: order.left.map((i, l) => [l, order.right.indexOf(i)] as [number, number]), explain };
    }
    case 'order': {
      if (!order || !m.steps) return null;
      // 정답 k 번째 단계(원래 번호 k)가 서 있는 표시 자리
      return { steps: m.steps.map((_, k) => order.steps.indexOf(k)), explain };
    }
    default:
      return m.options ? { correct: m.options.flatMap((o, i) => (o.correct ? [i] : [])), explain } : null;
  }
}
