// 관전자 참/거짓 1탭. T07 에 같은 이름의 화면이 생기면 그쪽을 쓰고 이 파일은 지운다(props 는 같게 맞춰 둠).
export interface TfPickProps {
  text: string;
  onPick: (value: boolean) => void;
  picked?: boolean | null;
}

export function TfPick({ text, onPick, picked = null }: TfPickProps) {
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
