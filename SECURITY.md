# Security

Pulse Attendance holds staff records, locations, selfies and — optionally — passwords in readable
form. Please read this before running it for a real company.

## Before you go live

1. **Change the default admin password** (`admin@company.com` / `Admin@123`). The app shows a red
   warning on every page until you do.
2. **Serve over HTTPS.** Put it behind a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) or use a
   host that gives you TLS, then set `COOKIE_SECURE=true`. Browsers also refuse camera and GPS on
   plain HTTP, so selfie and geofence check-in only work over HTTPS or localhost.
3. **Back up the data directory** (`./data` or the mounted `/data` volume). It holds
   `attendance.db`, the selfie images and `password.key`. Without `password.key`, stored passwords
   can no longer be decrypted (logins keep working).
4. **Restrict the network** if the server is only meant for the office: Settings → Company →
   allowed networks, and/or a firewall rule.

## Password visibility — read this

By default, **admins can view employee passwords**, and a manager can view their own team's. This is
a deliberate, requested feature for small offices where the admin hands out accounts. To make it
possible, each password is stored twice:

- a **bcrypt hash**, used for login — one-way, as usual
- an **AES-256-GCM encrypted copy**, used only for showing the password

The encryption key is `password.key` in the data directory, never in the database, so a stolen
database file alone does not reveal passwords.

Every view is written to the audit log (`PASSWORD_VIEWED`), and refused attempts as
`PASSWORD_VIEW_DENIED`. Only admins, the employee's own manager, and the employee can see it.

**This is still weaker than hashing alone**, and people reuse passwords elsewhere. If you do not
need it: **Settings → Company → uncheck "Let admins and managers view employee passwords"**. After
that nobody can read a password again, and only the login hash is kept for new passwords.

## What the app already does

- Sessions are random 32-byte tokens; only their SHA-256 hash is stored, and they expire in 14 days
- Login throttling: 8 failed attempts per email+IP locks that pair for 15 minutes
- Every role check runs on the server; the UI only hides what the server already refuses
- Server actions are CSRF-protected by Next.js; the agent API uses bearer device tokens
- Attendance punches are never deleted — corrections void the old record and keep the evidence
- The audit log is append-only (SQLite triggers block UPDATE and DELETE) and hash-chained, so a
  changed or removed entry breaks the chain, which Settings → Audit Log verifies
- Agent event times come from the server clock plus the event's age on the PC's monotonic timer, so
  changing the PC clock cannot move a punch; replays after an agent restart are flagged for review
- Device tokens on PCs are encrypted with Windows DPAPI for the logged-in user
- CSV exports are protected against spreadsheet formula injection

## What it does not do

- No two-factor authentication yet
- No encryption of the database file itself (use disk encryption if that matters)
- No rate limiting on the agent API beyond token validation
- No face matching or liveness detection — a selfie is evidence, not proof
- Location comes from the browser or the PC and can be faked by a determined user

## Reporting a vulnerability

Please open a GitHub issue for anything non-sensitive. For something that could expose data, contact
the repository owner directly instead of filing a public issue.
