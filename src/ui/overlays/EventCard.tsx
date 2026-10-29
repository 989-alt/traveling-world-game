// 이벤트 카드(DESIGN §4.2: 두루마리 소형 + 이벤트 머리띠). 모두에게 잠깐 뜨고, 누르면 바로 닫힌다.
import { AssetImg } from '../../assets/AssetImg';
import { hasAsset } from '../../assets/manifest';
import { monopolyNeedsBuilding, type Continent } from '../../shared/board';
import { ANTARCTIC_BONUS, ISLAND_ESCAPE_COST, KOREA_BONUS } from '../../shared/economy';
import type { LogEvent } from '../../shared/types';
import { josa } from '../../state/nick';
import { REWARD_TEXT } from '../missions/RewardPick';
import { CONTINENT_NAME, keyActivate, useAutoFocus, won } from './parts';

export const EVENT_MS = 3200;
type Ev = Extract<LogEvent, { ev: 'event' }>;

/** 기후 사건 → 생활 영향(1단원 범위) */
const CLIMATE: Record<string, { name: string; key: string; life: string }> = {
  drought: { name: '가뭄', key: 'event.climate.drought', life: '비가 오래 오지 않아 농작물이 잘 자라지 못해요.' },
  flood: { name: '홍수', key: 'event.climate.flood', life: '큰비에 강물이 넘쳐 집과 논밭이 물에 잠겼어요.' },
  heatwave: { name: '폭염', key: 'event.climate.heat', life: '무더위가 이어져 밖에서 일하기 힘들어요.' },
  blizzard: { name: '폭설', key: 'event.climate.blizzard', life: '눈이 많이 쌓여 길이 막히고 집 밖으로 나가기 힘들어요.' },
  typhoon: { name: '태풍', key: 'event.climate.typhoon', life: '강한 바람과 큰 파도에 지붕이 날아가고 배가 바다에 못 나가요.' },
};

export function eventText(e: Ev, name: string): { title: string; body: string; key: string } {
  const p = e.payload as Record<string, unknown>;
  const who = (a: string, b: string) => josa(name, a, b);
  switch (e.kind) {
    case 'island':
      return { title: `${who('이', '가')} 무인도에 갇혔어요`, key: 'event.island',
        body: `세 번 쉬어 가요. 주사위 두 개가 같은 눈이면 나올 수 있고, 탈출 카드나 ${won(ISLAND_ESCAPE_COST)}코인으로 바로 나와도 돼요.` };
    case 'travel':
      return { title: '세계여행 칸에 왔어요', key: 'event.travel', body: '다음 차례에 가고 싶은 칸을 골라 바로 날아가요.' };
    case 'festival':
      return { title: '세계 축제가 열렸어요', key: 'event.festival',
        body: Number(p.fund) > 0 ? `${who('이', '가')} 모인 기금 ${won(Number(p.fund))}코인을 받았어요.` : '아직 모인 기금은 없어요. 내 땅이 있으면 하나 골라 통행료를 두 배로 올려요.' };
    case 'fund': // 미션 보상 "기금 받기"(기금 칸은 없어졌다)
      return { title: '기금을 받았어요', key: 'event.fund', body: `${who('이', '가')} 모인 기금 ${won(Number(p.received))}코인을 가져갔어요.` };
    case 'climate': {
      const c = CLIMATE[String(p.kind)] ?? CLIMATE.drought;
      const where = CONTINENT_NAME[String(p.continent)] ?? '';
      return { title: `기후 위기: ${where}에 ${c.name}`, key: c.key, body: `${c.life} 두 바퀴 동안 ${where} 땅 통행료가 절반이 돼요.` };
    }
    case 'antarctic': {
      const item = typeof p.item === 'string' ? REWARD_TEXT[p.item as keyof typeof REWARD_TEXT]?.name : null;
      return p.correct
        ? { title: '남극 탐험 성공!', key: 'event.antarctic', body: `보너스 ${won(ANTARCTIC_BONUS)}코인${item ? `과 ${josa(item, '을', '를')}` : '을'} 받았어요.` }
        : { title: '남극 탐험을 마쳤어요', key: 'event.antarctic', body: '다음엔 정답을 맞혀 보너스에 도전해요.' };
    }
    case 'korea':
      return p.correct
        ? { title: '한국 탐험 성공!', key: 'event.korea', body: `보너스 ${won(KOREA_BONUS)}코인을 받았어요.` }
        : { title: '한국 탐험을 마쳤어요', key: 'event.korea', body: '다음엔 정답을 맞혀 보너스에 도전해요.' };
    case 'monopoly': {
      const where = CONTINENT_NAME[String(p.continent)] ?? '';
      return { title: `${who('이', '가')} ${josa(where, '을', '를')} 독점했어요!`, key: 'event.monopoly', body: monopolyNeedsBuilding(p.continent as Continent) ? `${where}의 나라를 모두 갖고 건물도 세웠어요.` : `${where}의 나라를 모두 가졌어요.` };
    }
    default:
      return { title: '관광지에 왔어요', key: 'event.travel', body: '' };
  }
}

export function EventCard({ ev, name, onClose }: { ev: Ev; name: string; onClose: () => void }) {
  const t = eventText(ev, name);
  const self = useAutoFocus<HTMLElement>();
  return (
    <section class="evc" ref={self} role="button" tabIndex={0} aria-label={`${t.title}. 누르면 닫혀요`} data-event={ev.kind} onClick={onClose} onKeyDown={keyActivate(onClose)}>
      <header class="evc-band"><h2 class="evc-title">{t.title}</h2></header>
      <div class="evc-paper">
        {hasAsset(t.key) && <AssetImg k={t.key} class="evc-img" alt="" />}
        <p class="evc-body">{t.body}</p>
        <span class="evc-hint">누르면 닫혀요</span>
      </div>
    </section>
  );
}
