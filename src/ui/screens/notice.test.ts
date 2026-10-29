// U123 L3·L4: 대기실 안내는 까닭에 맞는 한 문장, 아이 말투, "차시" 없음
import { describe, expect, it } from 'vitest';
import { NOTICE_TEXT } from './notice';

describe('대기실 안내 문구', () => {
  it('20분 판 저장본은 판 모양이 아니라 놀이 시간이 바뀐 까닭을 말한다', () => {
    expect(NOTICE_TEXT.oldTime).toBe('놀이 시간이 바뀌어서 새 판으로 시작해요.');
    expect(NOTICE_TEXT.oldTime).not.toContain('판이 새로 바뀌었어요');
  });
  it('대기실 옛 설정이 40분으로 바뀌면 짧게 알린다', () => {
    expect(NOTICE_TEXT.newTime).toBe('놀이 시간이 바뀌어서 40분 놀이로 맞췄어요.');
  });
  it('옛 판 안내는 그대로, 세 문장 모두 다르고 "차시" 없음', () => {
    expect(NOTICE_TEXT.oldBoard).toBe('지난 판은 새 판으로 시작해요. 판이 새로 바뀌었어요!');
    const all = Object.values(NOTICE_TEXT);
    expect(new Set(all).size).toBe(3);
    for (const t of all) { expect(t).not.toContain('차시'); expect(t.length).toBeLessThanOrEqual(30); }
  });
});
