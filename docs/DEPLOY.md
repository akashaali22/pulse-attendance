# Deploying Pulse Attendance

Everything the system knows lives in one folder: `attendance.db`, `selfies/` and `password.key`.
Wherever you deploy, that folder must be on **persistent storage** and included in your backups.

Serverless hosts (Vercel, Netlify, Cloudflare Workers) will **not** work: the app needs a normal
Node.js process with a disk, and background jobs that keep running between requests.

---

## Option 1 — Fly.io (free allowance, HTTPS included)

Best if employees check in from phones: HTTPS is required for camera and GPS, and Fly gives you a
certificate automatically.

```bash
# 1. Install flyctl and sign in
#    Windows PowerShell: iwr https://fly.io/install.ps1 -useb | iex
fly auth signup      # or: fly auth login

# 2. Create the app (does not deploy yet). Pick your own unique name.
fly launch --no-deploy --copy-config --name my-company-attendance

# 3. Create the disk that holds the database (1 GB is plenty)
fly volumes create pulse_data --size 1 --region sin

# 4. Deploy
fly deploy

# 5. Open it
fly open
```

Then sign in as `admin@company.com` / `Admin@123` and change that password immediately.

Useful afterwards:

```bash
fly logs                 # what the server is doing
fly ssh console          # a shell inside the machine
fly ssh sftp get /data/attendance.db ./backup.db      # download a backup
fly scale count 1        # NEVER more than 1 — SQLite is a single file on one volume
```

`fly.toml` keeps one machine always running so break reminders and automatic check-outs keep
working even when nobody has the site open.

---

## Option 2 — Docker on your own server

```bash
git clone https://github.com/akashaali98/pulse-attendance.git
cd pulse-attendance
docker compose up -d           # http://<server-ip>:3000
```

The database lives in the `pulse-data` Docker volume. Back it up with:

```bash
docker run --rm -v pulse-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/pulse-backup-$(date +%F).tar.gz -C /data .
```

For HTTPS, put Caddy in front (two lines of config gets you a free certificate):

```caddyfile
attendance.yourcompany.com {
    reverse_proxy pulse:3000
}
```

Then set `COOKIE_SECURE=true` in `docker-compose.yml` and restart.

---

## Option 3 — On an office Windows PC (no Docker)

Good when everything stays inside the office network.

```powershell
git clone https://github.com/akashaali98/pulse-attendance.git
cd pulse-attendance
npm ci
npm run build
npm start                      # http://<this-pc-ip>:3000
```

To start it automatically at logon, point a shortcut or a `Run` registry entry at
`scripts/start-server.vbs` (it launches the server hidden and logs to `data/server.log`).

Allow the port through the firewall once:

```powershell
New-NetFirewallRule -DisplayName "Pulse Attendance" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

Employees then use `http://<pc-ip>:3000`. Note that phone browsers block camera and GPS on plain
HTTP — either keep to the desktop agent and the QR kiosk, or put HTTPS in front (Caddy works on
Windows too).

---

## After deploying — the checklist

1. Change the admin password (the app nags you until you do)
2. Settings → Company: company name, timezone, weekly late allowance, and whether admins may view
   passwords ([SECURITY.md](../SECURITY.md))
3. Settings → Shift: hours, break window, working days
4. Settings → Locations: office geofence (use "Use my current location" while standing in the office)
5. Settings → Holidays and Leave types
6. Employees: add your staff
7. Settings → Desktop agent: download `PulseAgent.exe` for office PCs
8. Set up a backup of the data folder — weekly at minimum

## Upgrading

```bash
git pull
npm ci && npm run build && npm start      # or: fly deploy / docker compose up -d --build
```

Database migrations run automatically at startup and only add things, so your data is kept. Take a
backup of the data folder before a major upgrade anyway.
