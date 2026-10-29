// 규칙 도움말(PRD §8-16, 정적). 로비·보드에서 연다.
import { ISLAND_ESCAPE_COST, KOREA_BONUS, SALARY, START_COIN, TF_REWARD } from '../../shared/economy';
import { Stage, useAutoFocus, won } from '../overlays/parts';

const RULES: [string, string][] = [
  ['차례', '주사위 버튼을 누르고 있다가 떼면 굴러가요. 나온 수만큼 칸을 움직여요.'],
  ['나라 칸', '도착하면 그 나라 카드를 보고 퀴즈를 하나 풀어요. 맞히든 아니든 해설은 모두 함께 봐요. 첫 바퀴에는 여행지의 지형을, 둘째 바퀴부터는 기후와 생활 모습을 만나요.'],
  ['정답이면', '땅값과 통행료가 반으로 줄어요. 내 땅이면 건물을 한 단계 올리고, 남의 땅이면 사들일 수도 있어요.'],
  ['친구 차례', `해설 뒤에 나오는 참·거짓을 맞히면 ${won(TF_REWARD)}코인을 받아요.`],
  ['건물', '집 → 시장 → 호텔 → 랜드마크 순서로 올라가요. 호텔이나 랜드마크가 선 땅은 아무도 사들이지 못해요.'],
  ['미션 칸', '활동을 해내면 보상을 하나 골라요. 친구들은 끝난 뒤 참·거짓을 골라요.'],
  ['출발·한국', `출발 칸을 지나거나 도착하면 ${won(SALARY)}코인. 출발 칸에 도착하면 한국 카드를 보고 퀴즈를 풀어요. 맞히면 ${won(KOREA_BONUS)}코인을 더 받아요.`],
  ['특별한 칸', `남극에 도착하면 탐험 퀴즈를 풀고, 이어서 한 대륙에 기후 위기가 찾아와 그 대륙 통행료가 절반이 돼요. 무인도는 세 번 쉬어요(${won(ISLAND_ESCAPE_COST)}코인이면 바로 나와요). 탈출비와 기후 위기로 줄어든 통행료는 은행 기금에 모여 세계 축제 칸에 온 사람이 가져가요.`],
  ['이기는 법', `처음엔 ${won(START_COIN)}코인으로 시작해요. 한 대륙의 나라를 모두 가지면 이겨요. 나라가 4개뿐인 대륙은 건물도 하나 지어야 해요. 나만 빼고 모두 코인이 바닥나도 이기고, 놀이 시간이 끝났을 때 재산이 가장 많아도 이겨요. 마지막 5분엔 통행료가 1.5배예요.`],
];

export function Rules({ onClose }: { onClose: () => void }) {
  const close = useAutoFocus<HTMLButtonElement>();
  return (
    <Stage dim label="규칙" class="ov-layer--top">
      <section class="rules" role="dialog" aria-modal="true" aria-label="게임 규칙">
        <header class="ap-bar"><h2 class="ap-title">이렇게 놀아요</h2></header>
        <dl class="rules-list">
          {RULES.map(([k, v]) => [<dt key={`t${k}`}>{k}</dt>, <dd key={`d${k}`}>{v}</dd>])}
        </dl>
        <button type="button" ref={close} class="ov-btn ov-btn--primary rules-close" onClick={onClose}>알겠어요</button>
      </section>
    </Stage>
  );
}
