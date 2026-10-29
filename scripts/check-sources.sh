#!/usr/bin/env bash
# 출처 미표기 검사(PRD §13, S6). dist/ 와 src/data/ 의 텍스트 파일에 출처 흔적이 0건이어야 한다.
# dist/ 가 없으면 빌드가 안 된 것이므로 실패(exit 1). src/data/ 는 있으면 검사한다.
set -uo pipefail
cd "$(dirname "$0")/.."

PATTERN='지도서|교과서|\[MCP|\[6사|\[4사|pp?\.[[:space:]]?[0-9]'   # PRD §13 의 \s 를 POSIX 로

[ -d dist ] || { echo "check-sources: dist/ 없음 — 먼저 npm run build" >&2; exit 1; }
TARGETS=(dist); [ -d src/data ] && TARGETS+=(src/data)

# -I: 이진 파일(webp·mp3) 건너뜀
if HITS="$(grep -rnIE "$PATTERN" "${TARGETS[@]}")"; then
  echo "check-sources: 출처 흔적 발견" >&2
  echo "$HITS" | cut -c1-200 >&2
  exit 1
fi
echo "check-sources: OK (${TARGETS[*]})"
