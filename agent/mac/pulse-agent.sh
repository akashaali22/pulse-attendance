#!/bin/bash
# Pulse Attendance — macOS agent.
#
# Turns ordinary macOS events into attendance: login, unlock, wake, lock, sleep, logout, shutdown.
# Uses only what ships with macOS (bash, curl, ioreg, security), so nothing has to be installed.
# The device token is kept in the login Keychain, never in a plain file.
#
#   ./pulse-agent.sh pair https://your-server you@company.com   # once, asks for the password
#   ./pulse-agent.sh run                                        # started automatically at login
#   ./pulse-agent.sh status | unpair | selftest
set -u

# launchd starts us with a bare environment, so never assume USER/HOME are exported.
AGENT_USER="${USER:-$(id -un)}"
HOME="${HOME:-$(eval echo "~${AGENT_USER}")}"
APP_DIR="${HOME}/Library/Application Support/PulseAgent"
CONFIG="${APP_DIR}/config"
QUEUE="${APP_DIR}/queue"
LOG="${HOME}/Library/Logs/PulseAgent.log"
KEYCHAIN_SERVICE="PulseAttendanceAgent"
VERSION="1.0.0"
HEARTBEAT_SECONDS=60
CLOCK_JUMP_TOLERANCE=120   # a bigger jump than this means the clock was changed or the Mac slept

mkdir -p "${APP_DIR}" "$(dirname "${LOG}")"
umask 077

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"${LOG}"; }
say() { printf '%s\n' "$*"; }

load_config() { [ -f "${CONFIG}" ] && . "${CONFIG}"; SERVER="${SERVER:-}"; EMPLOYEE="${EMPLOYEE:-}"; }
save_config() { printf 'SERVER=%q\nEMPLOYEE=%q\n' "${SERVER}" "${EMPLOYEE}" >"${CONFIG}"; }

token_get() { security find-generic-password -a "${AGENT_USER}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null; }
token_set() { security add-generic-password -a "${AGENT_USER}" -s "${KEYCHAIN_SERVICE}" -w "$1" -U >/dev/null 2>&1; }
token_delete() { security delete-generic-password -a "${AGENT_USER}" -s "${KEYCHAIN_SERVICE}" >/dev/null 2>&1; }

# Server address only: "http://host:port". Accepts a pasted dashboard URL too.
normalize_server() {
  local s="${1%/}"
  case "${s}" in http://*|https://*) ;; *) s="http://${s}" ;; esac
  printf '%s' "$(printf '%s' "${s}" | sed -E 's#^(https?://[^/]+).*#\1#')"
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# Screen lock state, straight from the window server.
is_locked() {
  ioreg -n Root -d1 -a 2>/dev/null | grep -q '<key>CGSSessionScreenIsLocked</key>[[:space:]]*<true/>' && return 0
  return 1
}

# ── event queue: one JSON-ish record per line "epoch|type|reason|trusted" ─────────────────────────
queue_add() { printf '%s|%s|%s|%s\n' "$(date +%s)" "$1" "$2" "${TRUSTED:-true}" >>"${QUEUE}"; }

send_events() { # $1 = extra events JSON (may be empty)
  local token server payload events line age now type reason trusted first=1
  token="$(token_get)"; server="${SERVER}"
  [ -n "${token}" ] && [ -n "${server}" ] || return 1
  now="$(date +%s)"
  events=""
  if [ -s "${QUEUE}" ]; then
    while IFS='|' read -r ts type reason trusted; do
      [ -n "${ts:-}" ] || continue
      age=$(( (now - ts) * 1000 )); [ "${age}" -lt 0 ] && age=0
      [ ${first} -eq 1 ] || events="${events},"
      first=0
      events="${events}{\"type\":\"${type}\",\"reason\":\"${reason}\",\"ageMs\":${age},\"queued\":true,\"trusted\":${trusted}}"
    done <"${QUEUE}"
  fi
  if [ -n "${1:-}" ]; then
    [ ${first} -eq 1 ] || events="${events},"
    events="${events}$1"
  fi
  [ -n "${events}" ] || return 0
  payload="{\"events\":[${events}]}"

  local body status
  body="$(curl -sS --max-time 20 -w '\n%{http_code}' -X POST \
    -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" \
    -H "User-Agent: PulseAgent-mac/${VERSION}" \
    --data "${payload}" "${server}/api/agent/event" 2>>"${LOG}")" || return 1
  status="$(printf '%s' "${body}" | tail -n1)"
  case "${status}" in
    200) : >"${QUEUE}"; printf '%s' "${body}" | sed '$d' >"${APP_DIR}/last-status.json" 2>/dev/null; return 0 ;;
    401) log "device is no longer linked (401) — run: pulse-agent.sh pair"; return 2 ;;
    *)   log "server answered ${status}"; return 1 ;;
  esac
}

status_field() { # crude JSON field read, enough for the few values we show
  sed -E "s/.*\"$1\":\"?([^,\"}]*)\"?.*/\1/" "${APP_DIR}/last-status.json" 2>/dev/null
}

# ── commands ─────────────────────────────────────────────────────────────────────────────────────
cmd_pair() {
  local server="${1:-}" email="${2:-}" password
  load_config
  [ -n "${server}" ] || { printf 'Server address: '; read -r server; }
  [ -n "${email}" ] || { printf 'Email: '; read -r email; }
  printf 'Password: '; stty -echo 2>/dev/null; read -r password; stty echo 2>/dev/null; printf '\n'
  server="$(normalize_server "${server}")"

  local body status token
  body="$(curl -sS --max-time 25 -w '\n%{http_code}' -X POST -H "Content-Type: application/json" \
    --data "{\"email\":\"$(json_escape "${email}")\",\"password\":\"$(json_escape "${password}")\",\"device\":\"$(json_escape "$(scutil --get ComputerName 2>/dev/null || hostname) \\ ${AGENT_USER}")\",\"version\":\"${VERSION}\"}" \
    "${server}/api/agent/pair")" || { say "Cannot reach ${server}"; exit 1; }
  status="$(printf '%s' "${body}" | tail -n1)"
  if [ "${status}" != "200" ]; then
    say "Pairing failed (HTTP ${status}): $(printf '%s' "${body}" | sed '$d')"
    exit 1
  fi
  token="$(printf '%s' "${body}" | sed '$d' | sed -E 's/.*"token":"([^"]+)".*/\1/')"
  [ -n "${token}" ] && [ "${token}" != "${body}" ] || { say "Server did not return a token"; exit 1; }
  SERVER="${server}"
  EMPLOYEE="$(printf '%s' "${body}" | sed '$d' | sed -E 's/.*"employee":"([^"]+)".*/\1/')"
  token_set "${token}"
  save_config
  : >"${QUEUE}"
  say "Linked as ${EMPLOYEE}. Attendance is now automatic on this Mac."
  log "paired as ${EMPLOYEE} with ${SERVER}"
}

cmd_unpair() {
  load_config
  token_delete
  rm -f "${CONFIG}" "${QUEUE}" "${APP_DIR}/last-status.json"
  say "This Mac is no longer linked."
  log "unpaired"
}

cmd_status() {
  load_config
  if [ -z "${SERVER}" ] || [ -z "$(token_get)" ]; then say "Not linked. Run: pulse-agent.sh pair"; exit 1; fi
  say "Server:   ${SERVER}"
  say "Employee: ${EMPLOYEE}"
  say "Status:   $(status_field status) · worked $(status_field workedMin)m"
  say "Queued:   $(wc -l <"${QUEUE}" 2>/dev/null | tr -d ' ') event(s) waiting"
  say "Log:      ${LOG}"
}

cmd_run() {
  load_config
  [ -n "${SERVER}" ] && [ -n "$(token_get)" ] || { log "not linked — exiting"; exit 1; }
  log "agent started (server ${SERVER})"

  local start_epoch last_tick locked_since=0 TRUSTED=true
  start_epoch="$(date +%s)"
  last_tick="${start_epoch}"

  finish() { # logout, shutdown or launchd stopping us
    log "stopping (${1}) — sending check-out"
    queue_add OUT "${1}"
    send_events "" || true
    exit 0
  }
  trap 'finish shutdown' TERM
  trap 'finish logoff' HUP
  trap 'finish manual' INT

  queue_add IN logon
  send_events "" || log "offline at start — check-in saved locally"

  while :; do
    sleep "${HEARTBEAT_SECONDS}"
    local now delta locked_ms up_ms
    now="$(date +%s)"
    delta=$(( now - last_tick ))
    # A jump means the Mac slept or the clock moved: times from now on are less trustworthy,
    # and a long sleep is a check-out at the moment we went to sleep.
    if [ "${delta}" -gt $(( HEARTBEAT_SECONDS + CLOCK_JUMP_TOLERANCE )) ]; then
      log "clock jumped ${delta}s (sleep or time change)"
      TRUSTED=false
      queue_add OUT sleep
      queue_add IN resume
    fi
    last_tick="${now}"

    if is_locked; then
      [ "${locked_since}" -eq 0 ] && { locked_since="${now}"; log "screen locked"; }
    else
      if [ "${locked_since}" -ne 0 ]; then
        log "screen unlocked"
        locked_since=0
        queue_add IN unlock
      fi
    fi

    locked_ms=0
    [ "${locked_since}" -ne 0 ] && locked_ms=$(( (now - locked_since) * 1000 ))
    up_ms=$(( (now - start_epoch) * 1000 ))
    send_events "{\"type\":\"HEARTBEAT\",\"reason\":\"heartbeat\",\"ageMs\":0,\"locked\":$([ "${locked_since}" -ne 0 ] && echo true || echo false),\"lockedMs\":${locked_ms},\"upMs\":${up_ms},\"maxGapMs\":$(( delta * 1000 ))}" || true
  done
}

cmd_selftest() {
  local fails=0
  for tool in curl ioreg security sed awk; do
    if command -v "${tool}" >/dev/null 2>&1; then say "ok    ${tool} available"; else say "FAIL  ${tool} missing"; fails=$((fails+1)); fi
  done
  if [ "$(normalize_server 'http://host:3300/login')" = "http://host:3300" ]; then say "ok    server address is cleaned up"; else say "FAIL  normalize_server"; fails=$((fails+1)); fi
  if [ "$(normalize_server 'host:3300')" = "http://host:3300" ]; then say "ok    bare address gets a scheme"; else say "FAIL  normalize_server scheme"; fails=$((fails+1)); fi
  if is_locked; then say "ok    screen lock detected (locked right now)"; else say "ok    screen lock readable (unlocked right now)"; fi
  load_config
  if [ -n "${SERVER}" ]; then say "ok    linked to ${SERVER} as ${EMPLOYEE}"; else say "info  not linked yet"; fi
  [ "${fails}" -eq 0 ] && say "selftest passed" || say "${fails} problem(s)"
  return "${fails}"
}

case "${1:-}" in
  pair) shift; cmd_pair "${1:-}" "${2:-}" ;;
  run) cmd_run ;;
  status) cmd_status ;;
  unpair) cmd_unpair ;;
  selftest) cmd_selftest ;;
  *) say "Usage: pulse-agent.sh {pair [server] [email] | run | status | unpair | selftest}"; exit 1 ;;
esac
