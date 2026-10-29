// 보상 고르기: 2~3개 중 하나, 10초, 무응답이면 첫 번째. 보관함이 꽉 차면 엔진이 보관 보상을 아예 내놓지 않는다.
import { useEffect, useRef, useState } from 'preact/hooks';
import { AssetImg } from '../../assets/AssetImg';
import { hasAsset } from '../../assets/manifest';
import { STEP_MS } from '../../shared/economy';
import type { ItemKind, Reward } from '../../shared/types';
import { timeLeft } from './logic';
import { Timer, useNow } from './Timer';

export const REWARD_TEXT: Record<Reward, { name: string; desc: string }> = {
  travelTile: { name: '세계 여행', desc: '세계 여행 칸으로 가요' },
  island: { name: '무인도', desc: '무인도로 가요' },
  doubleRoll: { name: '한 번 더!', desc: '주사위를 한 번 더 굴려요' },
  toStart: { name: '출발 칸', desc: '출발 칸으로 가요' },
  toMyLand: { name: '내 땅으로', desc: '내 땅 하나를 골라 가요' },
  takeFund: { name: '기금 받기', desc: '모인 기금을 받아요' },
  tollFree: { name: '통행료 면제권', desc: '통행료를 한 번 안 내요' },
  tollHalf: { name: '통행료 반값권', desc: '통행료를 반만 내요' },
  escape: { name: '탈출 카드', desc: '무인도에서 바로 나와요' },
  shield: { name: '방패', desc: '남이 내 땅을 사들이는 걸 한 번 막아요' },
  hint: { name: '힌트', desc: '문제 힌트를 볼 수 있어요' },
};
const ITEMS: Reward[] = ['tollFree', 'tollHalf', 'escape', 'shield', 'hint'];
export const isItem = (r: Reward): r is ItemKind => ITEMS.includes(r);

export interface RewardPickProps {
  options: Reward[];
  deadlineAt: number; // 서버 마감. 없으면 지금부터 STEP_MS.reward
  onChoose: (index: number) => void;
}

function Icon({ r }: { r: Reward }) {
  return hasAsset(`item.${r}`) ? <AssetImg k={`item.${r}`} class="rw-img" alt="" /> : <span class="rw-img rw-img--none" aria-hidden="true" />;
}

export function RewardPick({ options, deadlineAt, onChoose }: RewardPickProps) {
  const [done, setDone] = useState(false);
  const left = timeLeft(deadlineAt, useNow());
  const choose = (i: number) => { if (done) return; setDone(true); onChoose(i); };

  const expire = useRef(() => {});
  expire.current = () => choose(0); // 무응답 → 첫 번째
  useEffect(() => { if (left <= 0) expire.current(); }, [left <= 0]);

  return (
    <section class="rw" aria-label="보상 고르기" data-done={done ? '1' : '0'}>
      <header class="rw-head">
        <AssetImg k="ui.chest" class="rw-chest" alt="" />
        <h2 class="rw-title">보상을 하나 골라요</h2>
        <Timer deadlineAt={deadlineAt} totalMs={STEP_MS.reward} />
      </header>
      <div class="rw-list">
        {options.map((r, i) => (
          <button type="button" key={i} class="rw-card" data-reward={r} disabled={done} onClick={() => choose(i)}>
            <Icon r={r} />
            <b class="rw-name">{REWARD_TEXT[r].name}</b>
            <span class="rw-desc">{REWARD_TEXT[r].desc}</span>
            {isItem(r) && <em class="rw-keep">보관</em>}
          </button>
        ))}
      </div>
    </section>
  );
}
