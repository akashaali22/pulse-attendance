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
  status="$("${AGENT}" status 2>&1)"
  choice="$(osascript -e "display dialog \"${status//\"/\\\"}\" with title \"${TITLE}\" buttons {\"Unlink this Mac\",\"Open dashboard\",\"Done\"} default button \"Done\"" 2>/dev/null)" || exit 0
  case "${choice}" in
    *"Open dashboard"*)
      server="$(sed -n 's/^SERVER=//p' "${APP_DIR}/config" | tr -d "'\"")"
      [ -n "${server}" ] && open "${server}"
      ;;
    *"Unlink"*)
      launchctl unload "${PLIST}" >/dev/null 2>&1 || true
      rm -f "${PLIST}"
      "${AGENT}" unpair >/dev/null 2>&1
      note "This Mac is no longer linked. Open the app again to link it to another account."
      ;;
  esac
  exit 0
fi

# ── first run: link this Mac to an employee ──────────────────────────────────────────────────────
server_default="$(cat "${RES}/server.txt" 2>/dev/null || true)"
server="$(ask "Welcome to Pulse Attendance.\n\nThis Mac will record attendance automatically — no buttons to press.\n\nServer address:" "${server_default}")"
[ -n "${server}" ] || fail "A server address is needed."
email="$(ask "Sign in once with the employee's work account.\n\nEmail:" "")"
[ -n "${email}" ] || fail "An email address is needed."
password="$(ask "Password for ${email}:" "" hidden)"
[ -n "${password}" ] || fail "A password is needed."

# cmd_pair reads the password from stdin, so it never appears in the process list.
out="$(printf '%s\n' "${password}" | "${AGENT}" pair "${server}" "${email}" 2>&1)" || fail "${out//\"/}"

install_login_item
note "${out}\n\nPulse Attendance now starts by itself every time you log in. You can close this app — it keeps running in the background."
