#!/bin/bash
# Pulse Attendance — macOS installer.
#
#   curl -fsSL https://your-server/api/agent/download/mac | bash
#
# Installs the agent for the current user only (no admin password needed), links it to an employee
# account and starts it at every login. Nothing else on the Mac is touched.
set -eu

SERVER_DEFAULT="__SERVER_URL__"
APP_DIR="${HOME}/Library/Application Support/PulseAgent"
AGENT="${APP_DIR}/pulse-agent.sh"
PLIST="${HOME}/Library/LaunchAgents/com.pulse.attendance.agent.plist"
LABEL="com.pulse.attendance.agent"

say() { printf '%s\n' "$*"; }
say ""
say "  Pulse Attendance — Mac agent"
say "  ───────────────────────────"

server="${PULSE_SERVER:-${SERVER_DEFAULT}}"
case "${server}" in
  http://*|https://*) ;;
  *) printf '  Server address (e.g. https://pulse-attendance.onrender.com): '; read -r server ;;
esac

mkdir -p "${APP_DIR}" "${HOME}/Library/LaunchAgents"
say "  Downloading the agent…"
curl -fsSL "${server%/}/api/agent/download/mac-agent" -o "${AGENT}"
chmod +x "${AGENT}"

say ""
say "  Sign in once with the employee's account."
"${AGENT}" pair "${server}" "${1:-}"

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
launchctl load "${PLIST}"

say ""
say "  Done. Attendance is now automatic on this Mac."
say ""
say "  Check status:  \"${AGENT}\" status"
say "  Unlink:        \"${AGENT}\" unpair && launchctl unload \"${PLIST}\" && rm \"${PLIST}\""
say "  Log:           ${HOME}/Library/Logs/PulseAgent.log"
say ""
