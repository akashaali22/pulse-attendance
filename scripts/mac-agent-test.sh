#!/bin/bash
# Exercises the macOS agent's server logic on any machine: the macOS-only pieces (Keychain,
# ioreg screen lock) are stubbed, everything else — pairing, heartbeats, the offline queue,
# check-out on shutdown — runs for real against a server.
#
#   bash scripts/mac-agent-test.sh --base https://server --email x@y.z --password '...'
set -u
BASE=""; EMAIL=""; PASSWORD=""
while [ $# -gt 0 ]; do case "$1" in --base) BASE="$2"; shift 2;; --email) EMAIL="$2"; shift 2;; --password) PASSWORD="$2"; shift 2;; *) shift;; esac; done
[ -n "${BASE}" ] && [ -n "${EMAIL}" ] && [ -n "${PASSWORD}" ] || { echo "need --base --email --password"; exit 1; }

PASS=0; FAIL=0
check() { if [ "$2" = "1" ]; then echo "PASS  $1${3:+ — $3}"; PASS=$((PASS+1)); else echo "FAIL  $1${3:+ — $3}"; FAIL=$((FAIL+1)); fi; }

SANDBOX="$(mktemp -d)"
export HOME="${SANDBOX}"
APPDIR="${SANDBOX}/Library/Application Support/PulseAgent"
mkdir -p "${APPDIR}"
AGENT="${SANDBOX}/pulse-agent.sh"
LOCKFLAG="${SANDBOX}/screen-locked"

# stub the macOS-only calls
sed -e 's#^token_get() .*#token_get() { cat "${APP_DIR}/token" 2>/dev/null; }#' \
    -e 's#^token_set() .*#token_set() { printf "%s" "$1" > "${APP_DIR}/token"; }#' \
    -e 's#^token_delete() .*#token_delete() { rm -f "${APP_DIR}/token"; }#' \
    -e 's#^  ioreg -n Root.*#  [ -f "'"${LOCKFLAG}"'" ] \&\& return 0#' \
    -e 's/^HEARTBEAT_SECONDS=.*/HEARTBEAT_SECONDS=10/' \
    agent/mac/pulse-agent.sh > "${AGENT}"
if bash -n "${AGENT}"; then check "stubbed agent still parses" 1; else check "stubbed agent still parses" 0; fi

status_of() {
  curl -sS --max-time 25 -H "Authorization: Bearer $(cat "${APPDIR}/token")" "${BASE}/api/agent/event" |
    sed -E 's/.*"status":"([A-Z_]+)".*/\1/'
}

# ── 1. pairing ──
printf '%s\n' "${PASSWORD}" | bash "${AGENT}" pair "${BASE}/login" "${EMAIL}" >"${SANDBOX}/pair.out" 2>&1
if grep -q "Linked as" "${SANDBOX}/pair.out"; then check "pairs with the server" 1 "$(head -1 "${SANDBOX}/pair.out")"; else check "pairs with the server" 0 "$(head -2 "${SANDBOX}/pair.out" | tr '\n' ' ')"; fi
if [ -s "${APPDIR}/token" ]; then check "token stored" 1; else check "token stored" 0; fi
if grep -q "/login" "${APPDIR}/config" 2>/dev/null; then check "a pasted /login URL is cleaned to the server address" 0 "$(grep SERVER "${APPDIR}/config")"; else check "a pasted /login URL is cleaned to the server address" 1 "$(grep SERVER "${APPDIR}/config" 2>/dev/null)"; fi

# ── 2. running: check-in and heartbeats ──
bash "${AGENT}" run & RUNPID=$!
sleep 25
S="$(status_of)"
if [ "${S}" = "WORKING" ] || [ "${S}" = "ON_BREAK" ]; then check "agent start → checked in" 1 "status ${S}"; else check "agent start → checked in" 0 "status ${S}"; fi
if grep -q "agent started" "${SANDBOX}/Library/Logs/PulseAgent.log"; then check "writes its log" 1; else check "writes its log" 0; fi

# ── 3. screen lock is detected ──
touch "${LOCKFLAG}"; sleep 14
if grep -q "screen locked" "${SANDBOX}/Library/Logs/PulseAgent.log"; then check "screen lock detected" 1; else check "screen lock detected" 0; fi
rm -f "${LOCKFLAG}"; sleep 14
if grep -q "screen unlocked" "${SANDBOX}/Library/Logs/PulseAgent.log"; then check "unlock detected" 1; else check "unlock detected" 0; fi

# ── 4. offline: events wait in the queue ──
kill "${RUNPID}" 2>/dev/null; wait "${RUNPID}" 2>/dev/null
sed -i "s#^SERVER=.*#SERVER=http://127.0.0.1:9#" "${APPDIR}/config"
: > "${APPDIR}/queue"
bash "${AGENT}" run & RUNPID=$!
sleep 25
QUEUED="$(wc -l < "${APPDIR}/queue" | tr -d ' ')"
if [ "${QUEUED}" -gt 0 ]; then check "offline events are kept on the Mac" 1 "${QUEUED} waiting"; else check "offline events are kept on the Mac" 0; fi

# ── 5. back online: the queue is delivered ──
kill "${RUNPID}" 2>/dev/null; wait "${RUNPID}" 2>/dev/null
sed -i "s#^SERVER=.*#SERVER=${BASE}#" "${APPDIR}/config"
bash "${AGENT}" run & RUNPID=$!
sleep 35
LEFT="$(wc -l < "${APPDIR}/queue" | tr -d ' ')"
if [ "${LEFT}" = "0" ]; then check "queue is delivered once online" 1; else check "queue is delivered once online" 0 "${LEFT} left"; fi

# ── 6. shutdown → check-out ──
kill -TERM "${RUNPID}" 2>/dev/null; sleep 15
S="$(status_of)"
if [ "${S}" != "WORKING" ] && [ "${S}" != "ON_BREAK" ]; then check "shutdown → checked out" 1 "status ${S}"; else check "shutdown → checked out" 0 "status ${S}"; fi
bash "${AGENT}" status >"${SANDBOX}/status.out" 2>&1
if grep -q "Employee:" "${SANDBOX}/status.out"; then check "status command works" 1 "$(grep Status "${SANDBOX}/status.out" | tr -s ' ')"; else check "status command works" 0; fi

rm -rf "${SANDBOX}"
echo ""
echo "${PASS}/$((PASS+FAIL)) mac-agent checks passed"
[ "${FAIL}" -eq 0 ]
