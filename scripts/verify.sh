#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AIATWORK Solar Resolution Dialer — end-to-end verification.
#
# Proves the whole app is healthy: installs deps, lints, type-checks every route
# via a production build, boots the server, then smoke-tests every page and the
# AI-call / disposition / monitor APIs. Works with or without ElevenLabs &
# Supabase configured (it accepts the graceful-degradation status codes), so you
# can run it on a bare checkout or a fully-wired environment.
#
#   bash scripts/verify.sh            # full run
#   PORT=5000 bash scripts/verify.sh  # custom port
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-4319}"
BASE="http://localhost:$PORT"
PASS=0
FAIL=0

g(){ printf "\033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
b(){ printf "\033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
s(){ printf "\033[33m•\033[0m %s\n" "$1"; }
h(){ printf "\n\033[1m── %s ──\033[0m\n" "$1"; }
code(){ curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$@"; }
# pass if the returned status is in the list of accepted codes
expect(){ local got="$1" name="$2"; shift 2; for ok in "$@"; do [ "$got" = "$ok" ] && { g "$name ($got)"; return; }; done; b "$name (got $got, want $*)"; }

h "1/5 Install dependencies"
if npm install >/tmp/aj-verify-install.log 2>&1; then g "dependencies installed"
else b "npm install failed — see /tmp/aj-verify-install.log"; fi

h "2/5 Lint (the production build below also type-checks every route)"
if ls .eslintrc .eslintrc.* eslint.config.* >/dev/null 2>&1 \
   || node -e "process.exit(require('./package.json').eslintConfig?0:1)" 2>/dev/null; then
  if CI=1 npm run lint >/tmp/aj-verify-lint.log 2>&1; then g "lint clean"
  else b "lint reported problems — see /tmp/aj-verify-lint.log"; fi
else
  s "ESLint not configured in this repo — skipped (build type-checks all routes)"
fi

h "3/5 Production build (type-checks every route)"
if npm run build >/tmp/aj-verify-build.log 2>&1; then g "build succeeded"
else b "build FAILED — last lines:"; tail -25 /tmp/aj-verify-build.log; fi

h "4/5 Boot the server"
PORT="$PORT" npm run start >/tmp/aj-verify-start.log 2>&1 &
SRV=$!
UP=0
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "$BASE/api/elevenlabs/conversations" 2>/dev/null && { UP=1; break; }
  sleep 1
done
[ "$UP" = 1 ] && g "server up on :$PORT" || b "server did not start — see /tmp/aj-verify-start.log"

if [ "$UP" = 1 ]; then
  h "5/5 Smoke-test pages (200 live, or 307/308 when auth-gated)"
  for p in /dashboard /dialer /leads /monitor /appointments /callbacks \
           /campaigns /leaderboard /reports /settings /ai-agent /login /signup; do
    expect "$(code "$BASE$p")" "page $p" 200 307 308
  done

  h "Smoke-test AI-call, disposition & monitor APIs"
  expect "$(code "$BASE/api/elevenlabs/conversations")" "GET conversations" 200
  expect "$(code "$BASE/api/elevenlabs/conversation/none")" "GET conversation/none → 404" 404
  expect "$(code -X POST "$BASE/api/elevenlabs/disposition" -H 'content-type: application/json' -d '{}')" \
         "POST disposition (invalid) → 400" 400
  expect "$(code -X POST "$BASE/api/elevenlabs/disposition" -H 'content-type: application/json' -d '{"conversationId":"x","outcome":"no_answer"}')" \
         "POST disposition (valid) → 200" 200
  expect "$(code "$BASE/api/elevenlabs/phone-numbers")" "GET phone-numbers (200 / 503 unconfigured)" 200 503
  expect "$(code "$BASE/monitor?call=conv_demo")" "monitor deep-link ?call=" 200
fi

kill "$SRV" 2>/dev/null
wait "$SRV" 2>/dev/null

h "Result"
printf "%s passed · %s failed\n" "$PASS" "$FAIL"
if [ "$FAIL" = 0 ]; then printf "\n\033[32mAll checks passed.\033[0m\n"; exit 0
else printf "\n\033[31mSome checks failed — logs in /tmp/aj-verify-*.log\033[0m\n"; exit 1; fi
