# Pulse Attendance — Windows desktop agent

A tray app that turns ordinary Windows events into attendance. Employees press nothing.

It is a single ~50 KB executable built against the .NET Framework 4.x that ships with Windows 10 and
11, so office PCs need no runtime, no installer and no admin rights.

## What it records

| Windows event | Attendance |
|---|---|
| Windows logon, unlock, wake from sleep | Check-in (ignored if already checked in) |
| Shut down, log off, sleep | Check-out |
| Locked longer than the away limit (the lunch break is excluded) | Checked out at the lock time |
| No heartbeat for the offline limit — power cut, crash, killed process | Checked out at the last heartbeat |
| A session still open from a previous day | Closed at the last known presence |

It also shows a balloon reminder when the company break starts, and the tray tooltip shows today's
status and hours.

## Install

The company server is built into the app. Employees never enter its address.

1. Download the EXE from **Get the app** and open it.
2. It installs in `%LOCALAPPDATA%\PulseAgent` and opens the default browser.
3. Match the displayed code and choose **Continue as your name**. An existing browser login is reused.
4. Windows startup uses the installed copy, so the downloaded file can be removed.

For updates, use **Check for updates** in the tray. The package SHA-256 is checked before installation.
If an older 1.0 app is running, exit its tray icon before opening the new installer.

The versioned binary and checksum are committed. Rebuild with `npm run build:agent` on Windows.

Right-click the tray icon for status, "Sync now", "Open dashboard" or "Sign out this PC". Admins can
unlink any PC from Settings → Desktop agent.

## Offline attendance

Events are written to `%LOCALAPPDATA%\PulseAgent\queue.json` immediately and sent when the
connection returns — with their **original** times, not the sync time.

If the server stops hearing from a PC it assumes the PC is off and closes the session. When the
agent reconnects and proves it never stopped running (process uptime covers the gap, with no long
pause that would mean sleep), that automatic check-out is **voided** and the session continues.

## Why the times can be trusted

The agent never sends a wall-clock time. It sends *how long ago* an event happened, measured on
Windows' monotonic timer, and the server subtracts that from its own clock. Changing the PC clock
therefore cannot move a check-in.

The one exception is an event replayed after the agent itself restarted while offline — there the
age comes from the PC clock, so the server marks that punch as flagged for a manager to review.

## Security

- A five-minute, single-use browser approval issues a **device token**, stored encrypted with
  Windows DPAPI for that Windows user only. The password itself is never stored.
- The token is per PC and can be revoked at any time from Settings → Desktop agent.
- The agent only sends events. It cannot read other employees' data.

## Files it uses

| Path | Purpose |
|---|---|
| `%LOCALAPPDATA%\PulseAgent\config.json` | Server address, encrypted device token, autostart flag |
| `%LOCALAPPDATA%\PulseAgent\queue.json` | Events waiting for the server |
| `HKCU\…\CurrentVersion\Run\PulseAttendanceAgent` | Starts with Windows |

## The Mac

macOS has its own agent, same idea and same server API: see [mac/README.md](mac/README.md).

## Source

Everything is in [src/PulseAgent.cs](src/PulseAgent.cs) (C# 5 — keep it compatible with the compiler
shipped in `C:\Windows\Microsoft.NET\Framework64\v4.0.30319`).

Queue delivery uses acknowledged batches of at most 199 punches plus a heartbeat. Stable event IDs
prevent replay after a lost response. Unlink requires an online server acknowledgement; if offline,
the app retains the account and asks you to retry, rather than falsely claiming the device was revoked.
