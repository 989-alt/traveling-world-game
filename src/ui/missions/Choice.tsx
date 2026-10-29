// 사진 고르기·그래프 읽기: 맞는 것을 모두 고른다(여러 개 켜고 끄기). 그림이 없으면 글자 카드로.
import { MissionImg } from './MissionImg';

export interface ChoiceItem { id: number; text: string; image?: string }

export interface ChoiceProps {
  items: ChoiceItem[]; // 보이는 순서(섞인 순서)
  value: number[];
  onChange: (v: number[]) => void;
  disabled?: boolean;
  urlFor?: (key: string) => string | null;
  /** 실패 해설: 정답 id. 정답 카드는 초록 테 + 체크, 학생이 잘못 고른 카드는 회색 */
  answer?: number[];
}

export function Choice({ items, value, onChange, disabled, urlFor, answer }: ChoiceProps) {
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div class={`ch${disabled ? ' is-locked' : ''}`} role="group" aria-label="모두 고르세요" data-photo={items.some((i) => i.image) ? '1' : '0'}>
      {items.map((it, n) => {
        const on = value.includes(it.id);
        const key = !!answer?.includes(it.id);
        const miss = !!answer && on && !key;
        return (
          <button type="button" key={it.id} role="checkbox" aria-checked={on} disabled={disabled}
            class={`ch-card${on ? ' is-on' : ''}${key ? ' is-key' : ''}${miss ? ' is-miss' : ''}`} data-opt={it.id} data-n={n} onClick={() => toggle(it.id)}
            aria-label={answer ? `${it.text}${key ? ' (정답)' : ''}` : undefined}>
            <MissionImg file={it.image} label={it.text} urlFor={urlFor} fallback={<span class="ch-text">{it.text}</span>} />
            <i class="ch-check" aria-hidden="true">{key || (on && !answer) ? '✓' : miss ? '✕' : ''}</i>
          </button>
        );
      })}
    </div>
  );
}
