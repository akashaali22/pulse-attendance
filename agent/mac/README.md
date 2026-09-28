# Pulse Attendance — macOS agent

The Mac counterpart of the Windows agent. It turns ordinary macOS events — login, unlock, wake,
lock, sleep, logout, shutdown — into attendance, and employees press nothing.

It uses only what already ships with macOS (bash, curl, `ioreg`, `security`), so nothing has to be
installed and no admin password is ever asked for. Everything lives under the employee's own home
folder, and the device token is kept in the login Keychain rather than a file.

## Two ways to install, one agent underneath

| | For whom | How |
|---|---|---|
| **PulseAgent.dmg** | Everyone | Drag to Applications, right-click → Open, sign in |
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

`--server` only pre-fills the address in the first-run dialog; employees can still change it.

## Gatekeeper

The app is signed ad-hoc, not with an Apple Developer certificate, so macOS does not recognise the
publisher. The first launch must be **right-click → Open**; after that it opens normally. Buying a
Developer ID ($99/year) and notarising the image would remove that step — nothing else about the
agent would change.

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
