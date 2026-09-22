---
title: Pulse Attendance
emoji: 🕘
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 3000
pinned: false
license: mit
short_description: Self-hosted attendance, leave and time tracking
---

# Pulse Attendance

Running from [github.com/akashaali22/pulse-attendance](https://github.com/akashaali22/pulse-attendance).

This Space has no permanent disk, so the database is snapshotted to a private GitHub repository and
restored on every start. Set these in **Settings → Variables and secrets**:

| Name | Type | Value |
|---|---|---|
| `BACKUP_REPO` | Variable | `your-username/pulse-attendance-data` (a private repo you own) |
| `BACKUP_TOKEN` | **Secret** | GitHub token with *Contents: read and write* on that repo |
| `ATTENDANCE_DATA_DIR` | Variable | `/tmp/pulse-data` |
| `COOKIE_SECURE` | Variable | `true` |
| `TZ` | Variable | `Asia/Karachi` |
| `DEMO_MODE` | Variable | `0` (use `1` for a sample-data demo) |

Sign in with `admin@company.com` / `Admin@123` and change the password immediately.
