#!/bin/bash
# Builds agent/bin/PulseAgent.dmg — the Mac counterpart of agent/bin/PulseAgent.exe.
#
# Run this ON A MAC, from the web/ folder:
#
#   npm run build:agent:mac -- --server https://pulse-attendance.onrender.com
#
# The --server address is only pre-filled in the first-run dialog; employees can change it. Leave it
# out and they type it themselves. A disk image can only be made by macOS itself (hdiutil), which is
# why this is the one build step that cannot run on the deployment machine.
set -eu

cd "$(dirname "$0")/.."            # web/
SERVER="https://pulse-attendance.onrender.com"
SIGN_ID="${SIGN_ID:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2 ;;
    --sign) SIGN_ID="${2:-}"; shift 2 ;;
    --sign=*) SIGN_ID="${1#--sign=}"; shift ;;
    --server=*) SERVER="${1#--server=}"; shift ;;
    *) echo "Unknown option: $1"; echo "Usage: build-agent-mac.sh [--server https://your-server] [--sign 'Developer ID Application: …']"; exit 1 ;;
  esac
done

command -v hdiutil >/dev/null 2>&1 || { echo "hdiutil not found — a .dmg can only be built on macOS."; exit 1; }

APP_NAME="Pulse Attendance"
BUILD="$(mktemp -d)"
STAGE="${BUILD}/stage"
APP="${STAGE}/${APP_NAME}.app"
DMG="agent/bin/PulseAgent.dmg"
trap 'rm -rf "${BUILD}"' EXIT

echo "  Assembling ${APP_NAME}.app…"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp agent/mac/app/Info.plist "${APP}/Contents/Info.plist"
cp agent/mac/app/launcher.sh "${APP}/Contents/MacOS/PulseAgent"
cp agent/mac/pulse-agent.sh "${APP}/Contents/Resources/pulse-agent.sh"
chmod +x "${APP}/Contents/MacOS/PulseAgent" "${APP}/Contents/Resources/pulse-agent.sh"
[ -n "${SERVER}" ] && printf '%s' "${SERVER%/}" >"${APP}/Contents/Resources/server.txt"

# The app wears the same icon as the dashboard, built from the web icon with the tools in macOS.
if [ -f public/icon-512.png ]; then
  echo "  Building the icon…"
  ICONSET="${BUILD}/AppIcon.iconset"
  mkdir -p "${ICONSET}"
  for size in 16 32 64 128 256 512; do
    sips -z "${size}" "${size}" public/icon-512.png --out "${ICONSET}/icon_${size}x${size}.png" >/dev/null 2>&1
    sips -z $(( size * 2 )) $(( size * 2 )) public/icon-512.png --out "${ICONSET}/icon_${size}x${size}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "${ICONSET}" -o "${APP}/Contents/Resources/AppIcon.icns" 2>/dev/null || echo "  (icon skipped)"
fi

# Signing. With a Developer ID identity (SIGN_ID) the image can then be notarised by Apple and opens
# anywhere with no warning at all. Without one, an ad-hoc signature seals the bundle — macOS still
# refuses the first launch, because only Apple's notarisation buys that trust.
if [ -n "${SIGN_ID:-}" ]; then
  echo "  Signing with ${SIGN_ID}…"
  codesign --force --deep --timestamp --options runtime --sign "${SIGN_ID}" "${APP}"
  codesign --verify --deep --strict --verbose=2 "${APP}"
else
  echo "  Signing ad-hoc (no Developer ID given)…"
  codesign --force --deep --sign - "${APP}" >/dev/null 2>&1 || echo "  (could not sign — the app still runs, but the bundle is unsealed)"
fi

# The first thing anyone sees after opening the image, because macOS will refuse the app once.
cat >"${STAGE}/How to open this.txt" <<'NOTE'
Pulse Attendance — opening it the first time
============================================

1. Drag "Pulse Attendance" onto the Applications folder in this window.

2. Double-click it. macOS will say it "cannot verify this app is free of malware".
   That message appears for every app that is not signed with a paid Apple Developer
   ID. It is not a finding about this app.

3. Open  System Settings > Privacy & Security , scroll to the bottom, and press
   "Open Anyway". Then open the app again.

   Or, in Terminal, clear the download flag once:

       xattr -dr com.apple.quarantine "/Applications/Pulse Attendance.app"

   (On macOS 15 and later, right-clicking and choosing Open no longer works for
   unsigned apps — use one of the two steps above.)

4. The app opens your browser. Confirm your account to connect. If you are already
   signed in, there is no password to enter and no server address to configure.

No admin password is needed: it installs for your account only, starts at every
login, and keeps its device token in the Mac's Keychain.

Prefer one line in Terminal instead, with no warning at all? Run:

    curl -fsSL YOUR-SERVER/api/agent/download/mac | bash
NOTE

[ -n "${SERVER}" ] && sed -i '' "s|YOUR-SERVER|${SERVER%/}|" "${STAGE}/How to open this.txt"

ln -s /Applications "${STAGE}/Applications"
mkdir -p agent/bin
rm -f "${DMG}"
echo "  Creating the disk image…"
hdiutil create -volname "${APP_NAME}" -srcfolder "${STAGE}" -ov -format UDZO -quiet "${DMG}"
[ -n "${SIGN_ID:-}" ] && codesign --force --timestamp --sign "${SIGN_ID}" "${DMG}"
shasum -a 256 "${DMG}" | awk '{print $1}' >"${DMG}.sha256"

echo ""
echo "  Built ${DMG} ($(du -h "${DMG}" | awk '{print $1}'))"
echo "  SHA-256: $(cat "${DMG}.sha256")"
echo ""
echo "  Commit it so the server can hand it to employees:"
echo "    git add ${DMG} ${DMG}.sha256 && git commit -m 'Ship the Mac agent disk image' && git push"
echo ""

printf '1.1.0\n' >"${DMG}.version"
