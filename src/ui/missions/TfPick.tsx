// 관전자 참/거짓 1탭. T07 에 같은 이름의 화면이 생기면 그쪽을 쓰고 이 파일은 지운다(props 는 같게 맞춰 둠).
import { TfChips, type TfResult } from '../overlays/ExplainCard';

export interface TfPickProps {
  text: string;
  onPick: (value: boolean) => void;
  picked?: boolean | null;
  /** 참/거짓 결과 2초(tfResult, DESIGN §18.5): 정답 선지 테 + 맞힌 사람 칩. 있으면 누를 수 없다 */
  result?: TfResult | null;
}

export function TfPick({ text, onPick, picked = null, result = null }: TfPickProps) {
  if (result) {
    const opt = (v: boolean) => `tf-btn ${v ? 'tf-btn--t' : 'tf-btn--f'} ex-tf-res${result.answer === v ? ' is-answer' : ' is-off'}`;
    return (
      <div class="tf ex-tf is-result" role="group" aria-label="참 거짓 결과" data-answer={String(result.answer)}>
        <p class="tf-text">{text}</p>
        <div class="tf-btns">
          <button type="button" class={opt(true)} data-tf="true" aria-pressed={picked === true} disabled>참</button>
          <button type="button" class={opt(false)} data-tf="false" aria-pressed={picked === false} disabled>거짓</button>
        </div>
        <TfChips result={result} />
      </div>
    );
  }
  return (
    <div class="tf" role="group" aria-label="참 거짓">
      <p class="tf-text">{text}</p>
      <div class="tf-btns">
        <button type="button" class="tf-btn tf-btn--t" disabled={picked !== null} aria-pressed={picked === true} onClick={() => onPick(true)}>참</button>
        <button type="button" class="tf-btn tf-btn--f" disabled={picked !== null} aria-pressed={picked === false} onClick={() => onPick(false)}>거짓</button>
      </div>
    </div>
  );
}
