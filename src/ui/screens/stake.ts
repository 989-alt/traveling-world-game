// 문항 아래 막대 문구: 이 문항 결과가 정하는 것(Game.tsx 에서 뺐다 — 시험하려고)
import { landPrice, tollQuote } from '../../engine/pay';
import { BOARD } from '../../shared/board';
import { ANTARCTIC_BONUS, KOREA_BONUS } from '../../shared/economy';
import type { GameState } from '../../shared/types';
import { josa } from '../../state/nick';

// parts.tsx·ActionPanel.tsx 는 토큰 CSS 를 읽어 단위 시험에서 못 부른다 — 같은 두 줄을 여기 둔다
const won = (n: number) => n.toLocaleString('ko-KR');
const BUILDING = ['', '집', '시장', '호텔', '랜드마크'];

type StakeGame = Pick<GameState, 'tiles'>;

export function stakeLine(g: StakeGame, seat: number, tileIdx: number | null): string | null {
  if (tileIdx === null) return null;
  const tile = BOARD[tileIdx];
  if (!tile) return null;
  // 탐험형 칸: 땅값·통행료가 없다. 정답 보상만
  if (tile.kind === 'antarctic') return `정답이면 보너스 ${won(ANTARCTIC_BONUS)}코인`;
  if (tile.kind === 'start') return `정답이면 보너스 ${won(KOREA_BONUS)}코인`;
  if (tile.kind !== 'country' && tile.kind !== 'tourist') return null;
  const st = g.tiles[tileIdx];
  if (st.owner === null) return `땅값 ${won(landPrice(tileIdx, false))} → 정답이면 ${won(landPrice(tileIdx, true))}`;
  if (st.owner === seat) return st.level < 4 ? `정답이면 ${josa(BUILDING[st.level + 1], '을', '를')} 지을 수 있어요` : null;
  const q = (c: boolean) => tollQuote(g as unknown as GameState, tileIdx, c, null).paid;
  return `통행료 ${won(q(false))} → 정답이면 ${won(q(true))}`;
}
