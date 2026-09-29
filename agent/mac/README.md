# Pulse Attendance — macOS agent

The Mac counterpart of the Windows agent. It turns ordinary macOS events — login, unlock, wake,
lock, sleep, logout, shutdown — into attendance, and employees press nothing.

It uses only what already ships with macOS (bash, curl, `ioreg`, `security`), so nothing has to be
installed and no admin password is ever asked for. Everything lives under the employee's own home
folder, and the device token is kept in the login Keychain rather than a file.

## Two ways to install, one agent underneath

| | For whom | How |
|---|---|---|
| **PulseAgent.dmg** | People who want an app in Applications | Drag to Applications, allow it once (see Gatekeeper), sign in |
| **One-line Terminal install** | People comfortable with Terminal, and remote setup | `curl -fsSL https://your-server/api/agent/download/mac \| bash` |

Both end up running the same [pulse-agent.sh](pulse-agent.sh) from
`~/Library/Application Support/PulseAgent/`, started at every login by the LaunchAgent
`~/Library/LaunchAgents/com.pulse.attendance.agent.plist`.

## Building the disk image

A `.dmg` can only be made by macOS itself, so this is the one build step that cannot run on the
deployment machine.

**Without a Mac:** the *Build the Mac agent* workflow does it on GitHub's own Mac runners — Actions
tab → Run workflow. It builds the image, mounts it to check the app inside really runs, and commits
it. Nothing else to do.

**On a Mac,** from the `web/` folder:

```
npm run build:agent:mac -- --server https://your-server
```

That assembles `Pulse Attendance.app` from [app/](app/), gives it the dashboard's icon, signs it
ad-hoc, and writes `agent/bin/PulseAgent.dmg` plus its `.sha256`. Commit both — the server hands the
image to employees at `/api/agent/download/mac-dmg`, exactly as it hands `PulseAgent.exe` to Windows.

`--server` sets the internal company address at build time; employees never see an address field.
Opening the app starts a five-minute browser approval. Existing browser logins are reused;
confirm the matching code and account without entering a password in the app.
Use **Check for updates** in the app to download a checksum-verified disk image.

## The free way to install without any warning

The warning comes from `com.apple.quarantine`, a flag that browsers, AirDrop and mail clients attach
to files they bring in — not from the app itself. A copy that never gets the flag never triggers
Gatekeeper's prompt:

- Put `PulseAgent.dmg` on a **USB stick** from a Windows or Linux machine, plug it into the Mac and
  open it from the stick. Drag the app to Applications and double-click: no warning.
- Copying it from a **shared network folder** (SMB) behaves the same way.
- The one-line Terminal installer also never meets Gatekeeper, because it installs a launchd agent
  instead of an app bundle.

AirDrop, email and any browser download do set the flag, so those copies will prompt.

## Making the warning go away for good

The warning is Apple's, not this app's: macOS refuses anything that has not been **notarised**, and
notarisation needs an Apple Developer ID, which costs USD 99 a year. Everything to use one is
already wired up — the build signs and notarises as soon as these four secrets exist in the
repository (Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `APPLE_CERT_P12` | The "Developer ID Application" certificate exported as .p12, then base64-encoded |
| `APPLE_CERT_PASSWORD` | The password you set when exporting that .p12 |
| `APPLE_ID` | The Apple ID of the developer account |
| `APPLE_APP_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | The 10-character team ID from developer.apple.com → Membership |

Run **Actions → Build the Mac agent → Run workflow**. The image is then signed, sent to Apple,
stapled with Apple's approval, and opens on any Mac with a plain double-click — no Terminal, no
Privacy & Security detour, and it works offline. Without those secrets the build behaves exactly as
before, with an ad-hoc signature.

## Gatekeeper

The app is signed ad-hoc, not with an Apple Developer certificate, so macOS does not recognise the
publisher. On first launch it refuses the app and says it **cannot verify this app is free of
malware** — that sentence appears for every app without a paid Developer ID and says nothing about
this one.

Two ways past it, both one-time:

- **System Settings → Privacy & Security**, scroll to the bottom, **Open Anyway**, then open the app again.
- Or clear the download flag: `xattr -dr com.apple.quarantine "/Applications/Pulse Attendance.app"`

On macOS 15 (Sequoia) and later, right-clicking and choosing **Open** no longer works for unsigned
apps — Apple removed that bypass, so use one of the two above.

The one-line installer (`curl -fsSL <server>/api/agent/download/mac | bash`) never hits Gatekeeper at
all, because it installs a launchd agent rather than an app bundle. That is why the download page
offers it first. Buying a Developer ID ($99/year) and notarising the image would remove the warning
from the .dmg path — nothing else about the agent would change.

The ad-hoc signature is not what makes the app run — the bundle's executable is a shell script, so the
binary macOS actually launches is Apple's own `/bin/bash`. It seals the bundle instead, so macOS
notices if anything inside it is swapped out.

## What the app does when opened

- **First time** — asks for the server, the employee's email and password in ordinary macOS dialogs,
  pairs, installs the LaunchAgent, and reports back.
- **Afterwards** — shows the current status, with buttons to open the dashboard or unlink the Mac.

It has no Dock icon (`LSUIElement`); the agent itself runs in the background.

## Commands, for support

```
"$HOME/Library/Application Support/PulseAgent/pulse-agent.sh" status     # where things stand
"$HOME/Library/Application Support/PulseAgent/pulse-agent.sh" selftest   # check the Mac can run it
"$HOME/Library/Application Support/PulseAgent/pulse-agent.sh" unpair     # forget the account
```

Log: `~/Library/Logs/PulseAgent.log`

## Why the times can be trusted

The agent sends *how long ago* an event happened, not a wall-clock time, and the server subtracts
that from its own clock — so changing the Mac's clock cannot move a check-in. Events recorded while
offline wait in `~/Library/Application Support/PulseAgent/queue` and are sent later with their
original times.
