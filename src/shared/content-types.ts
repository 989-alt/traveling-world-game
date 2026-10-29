// src/data/*.json 의 모양. 원본(docs/traveling-world/문항)에서 sources·sourceRef 를 뺀 것과 같다.
// 필드 설명과 글자 수 상한은 docs/traveling-world/문항/README.md.

// 2026-10-26 판 재설계: 잠비아(zm)·페루(pe)·뉴질랜드(nz)는 보관(원본에만 있고 빌드에서 빠짐, PRD §3.3).
export type CountryId =
  | 'ph' | 'th' | 'sa' | 'np' | 'cn' | 'kr' | 'it' | 'fr' | 'ch' | 'no' | 'ru' | 'cd' | 'tz'
  | 'et' | 'eg' | 'mx' | 'us' | 'ca' | 'gl' | 'ec' | 'br' | 'cl' | 'ar' | 'aq';
export type CultureCountryId = Exclude<CountryId, 'aq'> | 'au';
export type Level = 1 | 2 | 3 | 4;
/** 지도 내용 번호. 예 "8.1", "B2.1" */
export type TopicId = string;
/** 오개념 번호 "M1"~"M22" */
export type MTag = string;

export type ReasonKind = 'same' | 'diff';

export interface ExplanationCard {
  id: string; // "th-2", 남극은 "aq-s1"
  country: CountryId;
  level: Level;
  answer: string; // 정답 한 줄 (짧은판은 이 줄만)
  reasons: [string, string]; // 까닭 2문장 (전체판)
  /** 4단계 비교 카드만: reasons[i] 의 비교 종류(같은 점·다른 점). 화면이 색 꼬리표로 보인다(DESIGN §4.2, 2026-10-29 U5) */
  reasonKinds?: ReasonKind[];
  image: string; // 파일명만
  image2?: string; // 4단계: 나란히 놓을 두 번째 자료
  topics: TopicId[];
  mTags: MTag[];
}

export interface Choice {
  text: string;
  image?: string;
  mTags?: MTag[]; // 오답 선지에만
}

export interface Question {
  id: string;
  cardId: string;
  kind: 'initial' | 'review';
  level: Level;
  stem: string;
  image?: string;
  choices: [Choice, Choice, Choice, Choice];
  answer: 0 | 1 | 2 | 3;
  topics: TopicId[];
}

export interface TfStatement {
  id: string;
  cardId: string;
  text: string;
  answer: boolean;
  mTags: MTag[]; // 거짓이면 ≥1
  topics: TopicId[];
}

export interface CultureBadge {
  id: string;
  name: string;
  kind: 'food' | 'festival' | 'play';
  image: string;
  origin: 'guide' | 'outside';
}

export interface CultureCard {
  id: string;
  country: CultureCountryId;
  name: string;
  continent: 'asia' | 'europe' | 'africa' | 'namerica' | 'samerica' | 'oceania';
  intro: string;
  note?: string; // 보조 줄. 그린란드: "덴마크 자치령"
  image: string;
  badge?: CultureBadge;
}

export type MissionType = 'connect' | 'block' | 'order' | 'photo' | 'graph';

export interface Mission {
  id: string;
  type: MissionType;
  title: string;
  prompt: string;
  /** 실패 해설 1~2문장(≤80자). 정답처럼 서버만 안다: 판정 뒤 실패한 도착자에게만 보낸다 */
  explain: string;
  image?: string;
  pairs?: { left: string; right: string }[]; // connect·block
  steps?: string[]; // order: 정답 순서대로
  options?: { text: string; image?: string; correct: boolean }[]; // photo·graph
  analytic: boolean; // 비교·분석(A수준)
  spectatorTf: { text: string; answer: boolean; mTags: MTag[] };
  topics: TopicId[];
  mTags: MTag[];
}
