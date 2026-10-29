// 별명 낱말 목록(서버는 [형용사 번호, 동물 번호]만 보낸다, protocol NICK_*_COUNT = 16). 둘 다 3자 이하 → 별명 ≤ 7자.
import { NICK_ADJ_COUNT, NICK_ANIMAL_COUNT } from '../shared/protocol';

export const ADJ = ['용감한', '씩씩한', '느긋한', '똑똑한', '날쌘', '상냥한', '명랑한', '다정한', '신나는', '힘센', '재빠른', '차분한', '웃는', '꼼꼼한', '튼튼한', '귀여운'];
export const ANIMAL = ['수달', '판다', '고래', '여우', '다람쥐', '펭귄', '코끼리', '부엉이', '돌고래', '기린', '사자', '토끼', '거북', '고양이', '강아지', '너구리'];
if (ADJ.length !== NICK_ADJ_COUNT || ANIMAL.length !== NICK_ANIMAL_COUNT) throw new Error('별명 낱말 수가 protocol 과 다름');

export const nickName = (n: [number, number]) => `${ADJ[n[0]] ?? ADJ[0]} ${ANIMAL[n[1]] ?? ANIMAL[0]}`;

/** 마지막 글자에 받침이 있으면 a, 없으면 b ("수달이", "판다가") */
export function josa(word: string, a: string, b: string) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (c >= 0 && c <= 11171 && c % 28 !== 0 ? a : b);
}
