// 정답 없는 사본(public-content.json)이 src/data 와 같은지. 다르면 아래 명령으로 다시 만든다(traveling-world/ 에서):
// node -e "const fs=require('fs');const r=f=>JSON.parse(fs.readFileSync('src/data/'+f+'.json'));const cd=new Map(r('cards').map(c=>[c.id,c]));const pic=x=>{const c=cd.get(x.cardId);return c.image2?{image:c.image,image2:c.image2}:{image:c.image}};const mi=x=>{const o={id:x.id,type:x.type,title:x.title,prompt:x.prompt};if(x.image)o.image=x.image;if(x.options)o.options=x.options.map(p=>p.image?{text:p.text,image:p.image}:{text:p.text});o.spectatorTf={text:x.spectatorTf.text};return o};fs.writeFileSync('src/state/public-content.json',JSON.stringify({questions:r('questions').map(x=>({id:x.id,stem:x.stem,choices:x.choices.map(c=>c.text),...pic(x)})),tf:r('tf').map(x=>({id:x.id,text:x.text,...pic(x)})),missions:r('missions').map(mi)}))"
import { describe, expect, it } from 'vitest';
import questions from '../../data/questions.json';
import tf from '../../data/tf.json';
import missions from '../../data/missions.json';
import cards from '../../data/cards.json';
import pub from '../public-content.json';
import pubRaw from '../public-content.json?raw';
import { cardAssetOf, hasAsset } from '../../assets/manifest';
import { materialOf } from '../content';
import { GRAPH_OF_CARD } from '../../ui/graph/climate-data';

// 화면 코드 전부(테스트 제외)를 글자 그대로
const SOURCES = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}', '!../../**/__tests__/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('정답 없는 문항 사본', () => {
  it('src/data 와 같은 문항·문장(정답·오개념 태그 없이)', () => {
    // 카드 자료(그림 파일 이름)는 문항 단계부터 보인다(PRD §3.1, QA r1). 카드 글은 없다
    const pic = (cardId: string) => { const c = cards.find((k) => k.id === cardId)!; return c.image2 ? { image: c.image, image2: c.image2 } : { image: c.image }; };
    expect(pub.questions).toEqual(questions.map((q) => ({ id: q.id, stem: q.stem, choices: q.choices.map((c) => c.text), ...pic(q.cardId) })));
    expect(pub.tf).toEqual(tf.map((t) => ({ id: t.id, text: t.text, ...pic(t.cardId) })));
    // 미션: 보여 줄 것만(정답 플래그·관전 참/거짓 정답·태그 없음). 짝(pairs)·정답 순서(steps)는 서버가 섞어 내려 준다
    type M = { id: string; type: string; title: string; prompt: string; image?: string; options?: { text: string; image?: string }[]; spectatorTf: { text: string } };
    expect(pub.missions).toEqual((missions as M[]).map((x) => ({
      id: x.id, type: x.type, title: x.title, prompt: x.prompt,
      ...(x.image ? { image: x.image } : {}),
      ...(x.options ? { options: x.options.map((o) => (o.image ? { text: o.text, image: o.image } : { text: o.text })) } : {}),
      spectatorTf: { text: x.spectatorTf.text },
    })));
    // 해설 카드 글은 사본에 없다(서버가 해설 단계에 보낸다)
    expect(Object.keys(pub)).toEqual(['questions', 'tf', 'missions']);
    // 선지 그림이 생기면 사본 모양을 바꿔야 한다
    expect(questions.every((q) => q.choices.every((c) => !('image' in c)))).toBe(true);
  });
  it('사본에 정답·태그·짝·정답 순서·카드 글이 없다', () => {
    expect(pubRaw).not.toMatch(/"answer"|"reasons"|"mTags"|"topics"|"correct"|"pairs"|"steps"/);
    // 실패 해설 explain 은 정답처럼 서버만 안다(판정 뒤 도착자에게만, PRD §3.5): 키도 문장도 사본에 없다
    expect(pubRaw).not.toMatch(/"explain"/);
    expect(missions.length).toBe(40);
    for (const m of missions) { expect(m.explain, m.id).toBeTruthy(); expect(pubRaw, m.id).not.toContain(m.explain); }
    // 짝 한 쌍·정답 순서 목록·카드 정답 줄·까닭이 사본 어디에도 없다(낱말 하나는 다른 문항 선지와 겹칠 수 있어 묶음으로 본다)
    for (const m of missions) {
      for (const p of m.pairs ?? []) expect(pubRaw).not.toContain(JSON.stringify(p).slice(1, -1));
      if (m.steps) expect(pubRaw).not.toContain(JSON.stringify(m.steps).slice(1, -1));
    }
    // 참 문장 하나가 카드 정답 줄과 같은 글일 수 있다(문장 자체는 보여 줄 글) — 그 경우만 뺀다
    const shown = new Set(tf.map((t) => t.text));
    for (const c of cards) for (const t of [c.answer, ...c.reasons]) if (!shown.has(t)) expect(pubRaw, t).not.toContain(JSON.stringify(t));
  });
  it('문항 단계 자료(PRD §3.1): 모든 문항이 사본에서 그 카드 자료를 얻고, 그림 에셋 키는 해설 카드와 같다. 그래프를 묻는 문항엔 그래프가 있다', () => {
    for (const q of [...questions, ...tf]) {
      const c = cards.find((k) => k.id === q.cardId)!;
      expect(materialOf(q.id), q.id).toEqual([c.image, ...(c.image2 ? [c.image2] : [])]);
    }
    for (const c of cards) {
      expect(cardAssetOf(c.image) ?? null, c.id).toBe(hasAsset(`card.${c.id}`) ? `card.${c.id}` : null);
      if (c.image2) expect(cardAssetOf(c.image2) ?? null, c.id).toBe(hasAsset(`card.${c.id}.b`) ? `card.${c.id}.b` : null);
    }
    const graphQs = [...pub.questions.map((q) => [q.stem, q]), ...pub.tf.map((t) => [t.text, t])] as [string, { image: string; image2?: string }][];
    const asked = graphQs.filter(([text]) => /그래프/.test(text));
    expect(asked.length).toBeGreaterThanOrEqual(12);
    for (const [text, m] of asked) expect(!!GRAPH_OF_CARD[m.image] || !!(m.image2 && GRAPH_OF_CARD[m.image2]), text).toBe(true);
  });
  it('보관 나라(잠비아·페루·뉴질랜드, PRD §3.3)는 빌드 산출·사본에 없다', async () => {
    const culture = (await import('../../data/culture-cards.json')).default as { country: string }[];
    const gone = ['zm', 'pe', 'nz'];
    expect(cards.filter((c) => gone.includes(c.country))).toEqual([]);
    expect(culture.filter((c) => gone.includes(c.country))).toEqual([]);
    expect([...questions, ...tf].filter((x) => /^(zm|pe|nz)-/.test(x.cardId))).toEqual([]);
    expect(pubRaw).not.toMatch(/"(zm|pe|nz)-[0-9]/);
    expect([cards.length, questions.length, culture.length]).toEqual([94, 282, 24]);
  });
  it('화면 코드(src, 테스트·개발 하네스 제외)는 questions·tf·missions·cards.json 을 import 하지 않는다', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const hits = Object.entries(SOURCES).filter(([p, src]) => !/harness\.tsx$/.test(p) && !/\/engine\/__|\/worker\//.test(p) &&
      /from ['"][./]*data\/(questions|tf|missions|cards)\.json/.test(src)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
});
