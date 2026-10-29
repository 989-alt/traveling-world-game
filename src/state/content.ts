// 화면이 읽는 콘텐츠. 문항·참/거짓·미션은 정답을 뺀 사본(public-content.json)만 번들에 싣는다 — 정답은 서버만 안다.
// 연결·블록·순서 미션의 짝·단계 목록은 사본에 없다: 서버가 섞은 표시 목록(PublicTurn.mission)을 내려 준다.
// 해설 카드 글도 사본에 없다: 서버가 해설 단계에 보낸다(state.cards).
// 사본은 content.test.ts 가 src/data 와 대조한다. src/data 가 바뀌면 그 테스트 머리 주석의 명령으로 다시 만든다.
import culture from '../data/culture-cards.json';
import pub from './public-content.json';
import type { CultureCard, Mission } from '../shared/content-types';
import type { PublicCard } from '../shared/protocol';

/** image·image2 = 그 문항 카드의 자료 파일(PRD §3.1: 자료는 문항 단계부터, 카드 글만 해설까지 비공개) */
interface Material { image: string; image2?: string }
export interface PublicQuestion extends Material { id: string; stem: string; choices: string[] }
export interface PublicTf extends Material { id: string; text: string }
/** 화면용 미션: 정답 플래그(options.correct)·관전 참/거짓 정답·태그·짝(pairs)·정답 순서(steps)·실패 해설(explain)을 뺀 것 */
export type PublicMission = Omit<Mission, 'options' | 'spectatorTf' | 'mTags' | 'topics' | 'analytic' | 'pairs' | 'steps' | 'explain'> & {
  options?: { text: string; image?: string }[];
  spectatorTf: { text: string };
};

const Q = new Map((pub.questions as PublicQuestion[]).map((q) => [q.id, q]));
const TF = new Map((pub.tf as PublicTf[]).map((t) => [t.id, t]));
export type { PublicCard };
const CULTURE = new Map((culture as CultureCard[]).map((c) => [c.country, c]));
const MISSIONS = new Map((pub.missions as PublicMission[]).map((m) => [m.id, m]));

export const questionOf = (id: string) => Q.get(id);
export const tfOf = (id: string) => TF.get(id);
/** 문항(4지선다·참/거짓 형식)의 카드 자료 파일. 4단계는 두 개 */
export const materialOf = (qid: string): string[] => { const m = Q.get(qid) ?? TF.get(qid); return m ? [m.image, ...(m.image2 ? [m.image2] : [])] : []; };
/** 서버가 보낸 카드 글(state.cards)에서 찾는다 */
export const cardIn = (cards: PublicCard[] | undefined, id: string | undefined) => (id ? cards?.find((c) => c.id === id) : undefined);
export const cultureOf = (country: string) => CULTURE.get(country as CultureCard['country']);
export const missionOf = (id: string) => MISSIONS.get(id);
