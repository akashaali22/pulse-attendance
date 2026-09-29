#!/bin/bash
# Pulse Attendance — what runs when an employee opens PulseAgent.app.
#
# The agent itself is agent/mac/pulse-agent.sh, copied into this bundle at build time. This file is
# only the face of it: the first run asks for the employee's account in ordinary macOS dialogs and
# arranges for the agent to start at every login; later runs show where things stand.
#
# Nothing here needs an admin password — everything lives under the employee's own home folder.
set -u

RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
APP_DIR="${HOME}/Library/Application Support/PulseAgent"
AGENT="${APP_DIR}/pulse-agent.sh"
PLIST="${HOME}/Library/LaunchAgents/com.pulse.attendance.agent.plist"
LABEL="com.pulse.attendance.agent"
TITLE="Pulse Attendance"

# ── macOS dialogs ────────────────────────────────────────────────────────────────────────────────
# osascript answers with "button returned:OK, text returned:…"; a cancelled dialog exits non-zero.
ask() { # prompt, default, [hidden]
  local hidden="" out
  [ "${3:-}" = "hidden" ] && hidden=" with hidden answer"
  out="$(osascript -e "display dialog \"$1\" with title \"${TITLE}\" default answer \"$2\"${hidden} buttons {\"Cancel\",\"Continue\"} default button \"Continue\"" 2>/dev/null)" || exit 0
  printf '%s' "${out#*text returned:}"
}
note() { osascript -e "display dialog \"$1\" with title \"${TITLE}\" buttons {\"OK\"} default button \"OK\"" >/dev/null 2>&1; }
fail() { osascript -e "display alert \"${TITLE}\" message \"$1\" as critical" >/dev/null 2>&1; exit 1; }

# ── install the agent into the employee's own folder ─────────────────────────────────────────────
# Copying it out of the bundle means attendance keeps working if the app is moved or the disk image
# is ejected, and an updated app simply overwrites it.
mkdir -p "${APP_DIR}" "${HOME}/Library/LaunchAgents" || fail "Cannot write to your home folder."
launchctl unload "${PLIST}" >/dev/null 2>&1 || true
cp "${RES}/pulse-agent.sh" "${AGENT}" || fail "The app is incomplete — download it again."
chmod +x "${AGENT}"

install_login_item() {
  cat >"${PLIST}" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${AGENT}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/PulseAgent.err.log</string>
</dict>
</plist>
PLIST_EOF
  launchctl unload "${PLIST}" >/dev/null 2>&1 || true
  launchctl load "${PLIST}" >/dev/null 2>&1 || fail "macOS refused to start the agent at login."
}

# ── already linked: show where things stand ──────────────────────────────────────────────────────
if "${AGENT}" status >/dev/null 2>&1; then
  install_login_item
  status="$("${AGENT}" status 2>&1)"
  choice="$(osascript - "${status}" <<'APPLESCRIPT'
on run argv
  choose from list {"Open dashboard", "Check for updates", "Unlink this Mac"} with title "Pulse Attendance" with prompt (item 1 of argv)
end run
APPLESCRIPT
)" || exit 0
  case "${choice}" in
    *"Open dashboard"*)
      server="$(sed -n 's/^SERVER=//p' "${APP_DIR}/config" | tr -d "'\"")"
      [ -n "${server}" ] && open "${server}"
      ;;
    *"Check for updates"*)
      release="$(curl -fsS --max-time 60 https://pulse-attendance.onrender.com/api/agent/release)" || fail "Could not check for updates. Try again when online."
      latest="$(printf '%s' "${release}" | /usr/bin/plutil -extract macVersion raw -o - -)"
      if [ "${latest}" = "1.1.0" ]; then note "You have the latest version (1.1.0)."; exit 0; fi
      expected="$(printf '%s' "${release}" | /usr/bin/plutil -extract macSha256 raw -o - -)"
      package="${APP_DIR}/PulseAgent-update.dmg"
      curl -fsS --max-time 180 https://pulse-attendance.onrender.com/api/agent/download/mac-dmg -o "${package}" || fail "Download failed. Try again."
      actual="$(shasum -a 256 "${package}" | awk '{print $1}')"
      [ "${actual}" = "${expected}" ] || fail "Download verification failed. Try again."
      open "${package}"
      note "Update verified. Drag Pulse Attendance into Applications, replace the old app, then open it to finish. Your account stays connected."
      ;;
    *"Unlink"*)
      "${AGENT}" unpair >/dev/null 2>&1 || fail "Connect to the internet and try unlinking again."
      launchctl unload "${PLIST}" >/dev/null 2>&1 || true
      rm -f "${PLIST}"
      note "This Mac is no longer linked. Open the app again to link it to another account."
      ;;
  esac
  exit 0
fi

# ── first run: link this Mac to an employee ──────────────────────────────────────────────────────
server="$(cat "${RES}/server.txt" 2>/dev/null || true)"
server="${server:-https://pulse-attendance.onrender.com}"
rm -f "${APP_DIR}/link-code"
"${AGENT}" pair "${server}" >"${APP_DIR}/pair-result" 2>&1 &
pair_pid=$!
for (( i=0; i<65; i++ )); do
  [ ! -f "${APP_DIR}/link-code" ] || break
  kill -0 "${pair_pid}" 2>/dev/null || break
  sleep 1
done
if [ -f "${APP_DIR}/link-code" ]; then
  note "Continue in your browser to connect this Mac. No password is needed if you are already signed in.\n\nMatching code: $(cat "${APP_DIR}/link-code")"
fi
wait "${pair_pid}" || fail "Could not finish connecting. Check your internet, then reopen the app and approve the browser request."
install_login_item
note "Connected. Pulse Attendance starts automatically when you log in. You can close this window."
