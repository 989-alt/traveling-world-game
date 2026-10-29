#!/usr/bin/env bash
# PRD S11 'AI 말투 0' 검수. 사용: lang-review.sh [--dry-run] <번호>   |   lang-review.sh --judge <결과.json> [입력.json]
# 검수자는 GPT-6.1-sol(codex, effort medium). Claude 는 검수하지 않는다.
# GPT 한도 실패일 때만 agy Gemini 4 Argon Medium 으로 같은 입력을 다시 보낸다 (run.sh / sol-round.sh 와 같은 값·같은 감지).
# 결과: <상태 디렉터리>/lang-review-<번호>.json. 지적 0건이면 exit 0, 1건 이상이면 목록 출력 후 exit 1.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../harness/bin/state-dir.sh"   # ROOT STATE

MODEL_SOL="${MODEL_SOL:-gpt-6.1-sol}"          # run.sh 와 같은 값
SOL_EFFORT="${SOL_EFFORT:-medium}"             # run.sh 와 같은 값
QA_FALLBACK_MODEL="${QA_FALLBACK_MODEL:-gemini-4-argon-medium}"  # sol-round.sh 와 같은 값
CHUNK="${CHUNK:-300}"
SCHEMA="$HERE/lang-review-schema.json"
# codex 의 실제 한도 메시지만 본다(sol-round.sh 의 느슨한 정규식은 에코된 프롬프트에도 걸린다). 로그 끝 30줄에서만 찾는다.
LIMIT_RE="hit your usage limit|usage_limit_reached"
export CMUX_CODEX_HOOKS_DISABLED=1   # run.sh/sol-round.sh 와 같다: cmux 래퍼의 훅 우회·computer-use 주입을 끈다

# 판정: 지적 0건 exit 0, 아니면 목록 + exit 1
#   judge <결과.json> [입력 strings.json] — 입력을 주면 지적 id 가 입력에 있는지도 본다(없으면 exit 2)
judge() {
  node -e '
    const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),f=r.findings;
    if(!Array.isArray(f)){console.error("findings 배열 없음");process.exit(2)}
    if(process.argv[2]){
      const ids=new Set(JSON.parse(fs.readFileSync(process.argv[2],"utf8")).items.map(i=>i.id));
      const bad=f.filter(x=>!ids.has(x.id));
      if(bad.length){console.error("입력에 없는 id: "+bad.map(x=>x.id).join(", "));process.exit(2)}
    }
    if(!f.length){console.log("지적 0건 — 통과 (reviewer="+r.reviewer+")");process.exit(0)}
    console.log("지적 "+f.length+"건 (reviewer="+r.reviewer+")");
    for(const x of f)console.log("- "+x.id+" | "+x.text+"\n    문제: "+x.problem+"\n    제안: "+x.suggestion);
    process.exit(1)
  ' "$1" "${2:-}"
}

if [ "${1:-}" = "--judge" ]; then judge "${2:?결과 파일 필요}" "${3:-}"; exit $?; fi

DRY=0; [ "${1:-}" = "--dry-run" ] && { DRY=1; shift; }
N="${1:?검수 번호 필요 (예: lang-review.sh 1)}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STATE="${LANG_REVIEW_STATE:-$STATE}"   # 테스트용 덮어쓰기
OUT="$STATE/lang-review-$N.json"
rm -f "$OUT"   # 이전 결과가 남아 통과로 오판되지 않게

node "$HERE/extract-strings.mjs" --out "$WORK/all.json" >/dev/null || exit 2
node -e '
  const fs=require("fs"),[all,dir,n]=process.argv.slice(1),it=JSON.parse(fs.readFileSync(all,"utf8")).items;
  let c=0;for(let i=0;i<it.length;i+=+n){fs.writeFileSync(dir+"/chunk-"+(++c)+".json",JSON.stringify({items:it.slice(i,i+ +n)}));}
  fs.writeFileSync(dir+"/count",c+" "+it.length)
' "$WORK/all.json" "$WORK" "$CHUNK"
read -r CHUNKS TOTAL < "$WORK/count"
echo "항목 ${TOTAL}개 → 청크 ${CHUNKS}개 (청크당 최대 ${CHUNK})"

prompt_for() { printf '%s\n%s\n' "$(cat "$HERE/lang-review-prompt.md")" "$(cat "$1")"; }

# 명령 두 개 — dry-run 이 출력하는 것과 실제로 실행하는 것이 같은 함수에서 나온다.
CODEX_CMD=(codex exec -m "$MODEL_SOL" -c "model_reasoning_effort=$SOL_EFFORT" --color never -s read-only --output-schema "$SCHEMA")
AGY_CMD=(agy --model "$QA_FALLBACK_MODEL" --json-schema "$SCHEMA" --output-format json --print-timeout 0s --sandbox)

if [ "$DRY" = 1 ]; then
  echo "[1차 GPT]  ${CODEX_CMD[*]} -o <청크결과.json> \"<프롬프트+청크>\" </dev/null"
  echo "[한도 대체] ${AGY_CMD[*]} -p \"<프롬프트+청크>\" </dev/null > <청크결과.json>   (GPT 출력이 /$LIMIT_RE/ 일 때만)"
  echo "결과: $OUT"
  echo "드라이런 — 실제 호출 없음"
  exit 0
fi

# agy json 래퍼에서 스키마 객체를 꺼낸다 (sol-round.sh 와 같은 방식)
agy_unwrap() {
  node -e '
    const fs=require("fs"),raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(raw.status!=="SUCCESS"){console.error("agy status="+raw.status);process.exit(1)}
    const ok=x=>x&&typeof x==="object"&&Array.isArray(x.findings);
    for(const v of [raw.structured_output,raw.result,raw.output,raw.response]){
      if(ok(v)){fs.writeFileSync(process.argv[2],JSON.stringify(v));process.exit(0)}
      if(typeof v==="string"){try{const p=JSON.parse(v);if(ok(p)){fs.writeFileSync(process.argv[2],JSON.stringify(p));process.exit(0)}}catch{}}
    }
    console.error("agy 결과 추출 실패: status="+raw.status);process.exit(1)
  ' "$1" "$2"
}

# 청크 결과가 findings 배열을 가진 JSON 인지
valid() { node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(Array.isArray(x.findings)?0:1)' "$1" 2>/dev/null; }

REVIEWERS=()
for ((c = 1; c <= CHUNKS; c++)); do
  P="$(prompt_for "$WORK/chunk-$c.json")"; R="$WORK/res-$c.json"; LOG="$WORK/log-$c.txt"
  if [ "${LANG_REVIEWER:-gpt}" = argon ]; then   # 사용자가 Argon 문체 검수를 이름으로 지시한 경우(2026-10-29)
    echo "[청크 $c/$CHUNKS] $QA_FALLBACK_MODEL (agy, 지정)"
    "${AGY_CMD[@]}" -p "$P" </dev/null >"$WORK/agy-$c.json" 2>"$LOG" && agy_unwrap "$WORK/agy-$c.json" "$R" && valid "$R" || { echo "청크 $c 실패(agy):" >&2; tail -5 "$LOG" >&2; exit 2; }
    REVIEWERS+=("$QA_FALLBACK_MODEL"); continue
  fi
  echo "[청크 $c/$CHUNKS] $MODEL_SOL"
  if "${CODEX_CMD[@]}" -o "$R" "$P" </dev/null >"$LOG" 2>&1 && valid "$R"; then
    REVIEWERS+=("$MODEL_SOL")
  elif [ -s "$R" ] && ! tail -n 30 "$LOG" | grep -qiE "$LIMIT_RE"; then
    echo "청크 $c 결과가 스키마(findings 배열)에 맞지 않음" >&2; exit 2
  elif tail -n 30 "$LOG" | grep -qiE "$LIMIT_RE"; then
    echo "[청크 $c/$CHUNKS] GPT 한도 — $QA_FALLBACK_MODEL (agy) 로 대체"
    "${AGY_CMD[@]}" -p "$P" </dev/null >"$WORK/agy-$c.json" 2>"$LOG" && agy_unwrap "$WORK/agy-$c.json" "$R" && valid "$R" || { echo "청크 $c 실패(agy)" >&2; exit 2; }
    REVIEWERS+=("$QA_FALLBACK_MODEL")
  else
    echo "청크 $c 실패(codex, 한도 아님):" >&2; tail -5 "$LOG" >&2; exit 2
  fi
done

# 청크 결과 합치기
mkdir -p "$STATE"
node -e '
  const fs=require("fs"),[dir,n,out,total,round,...rv]=process.argv.slice(1),findings=[];
  for(let c=1;c<=+n;c++)findings.push(...JSON.parse(fs.readFileSync(dir+"/res-"+c+".json","utf8")).findings);
  const u=[...new Set(rv)];
  fs.writeFileSync(out,JSON.stringify({round:+round,reviewer:u.length===1?u[0]:"mixed",chunkReviewers:rv,itemCount:+total,chunks:+n,findings},null,2)+"\n")
' "$WORK" "$CHUNKS" "$OUT" "$TOTAL" "$N" "${REVIEWERS[@]}" || { echo "결과 합치기 실패" >&2; rm -f "$OUT"; exit 2; }
echo "결과 $OUT"
judge "$OUT" "$WORK/all.json"
