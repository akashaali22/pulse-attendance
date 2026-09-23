// Proves that two instances sharing one snapshot cannot lose each other's data.
// A deploy briefly runs two containers; the newer one must never overwrite the older one's newer
// snapshot. Runs two local servers against a scratch path in the backup repo.
//
//   node scripts/backup-race-test.mjs --repo owner/repo --token <github token>

import { DatabaseSync } from "node:sqlite";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const REPO = arg("repo");
const TOKEN = arg("token");
const REMOTE_PATH = arg("path", `test/race-${Date.now()}.db`);
const STANDALONE = path.join(process.cwd(), ".next", "standalone");
const results = [];
const check = (n, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? ` — ${extra}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (p, init) =>
  fetch(`https://api.github.com/repos/${REPO}/contents/${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", ...(init?.headers ?? {}) },
  });

const servers = [];
function startServer(port, dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  const logFile = path.join(os.tmpdir(), `race-${port}.log`);
  fs.writeFileSync(logFile, "");
  const out = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      PORT: String(port),
      ATTENDANCE_DATA_DIR: dataDir,
      BACKUP_REPO: REPO,
      BACKUP_TOKEN: TOKEN,
      BACKUP_PATH: REMOTE_PATH,
      BACKUP_INTERVAL_SEC: "5",
      BACKUP_FIRST_DELAY_SEC: "0",
      DEMO_MODE: "0",
    },
  });
  servers.push({ child, logFile, port });
  return { child, logFile };
}
const logOf = (port) => fs.readFileSync(servers.find((s) => s.port === port).logFile, "utf8");
const waitUp = async (port) => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/login`)).ok) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
};

const browser = await chromium.launch({ channel: "msedge" });
async function addEmployee(port, name) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${port}/login`, { timeout: 60000 });
  await p.fill("#email", "admin@company.com");
  await p.fill("#password", "Admin@123");
  await p.click("button[type=submit]");
  await p.waitForURL(/dashboard/, { timeout: 60000 });
  await p.goto(`http://localhost:${port}/employees`);
  await p.getByRole("button", { name: /Add Employee/ }).click();
  await p.fill("input[name=name]", name);
  await p.fill("input[name=email]", `${name.toLowerCase()}@race.test`);
  await p.fill("input[name=password]", "RaceTest#1");
  await p.locator("form button[type=submit]").click();
  await p.getByText("Employee created").first().waitFor({ timeout: 30000 });
  await ctx.close();
}

async function snapshotUsers() {
  const r = await api(`${REMOTE_PATH}?ref=HEAD`);
  if (!r.ok) return null;
  const meta = await r.json();
  const bytes = meta.content
    ? Buffer.from(meta.content, "base64")
    : Buffer.from(await (await fetch(meta.download_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
  const f = path.join(os.tmpdir(), `race-check-${Date.now()}.db`);
  fs.writeFileSync(f, bytes);
  const db = new DatabaseSync(f, { readOnly: true });
  const names = db.prepare("SELECT name FROM users ORDER BY id").all().map((u) => u.name);
  const serial = db.prepare("SELECT value FROM settings WHERE key = 'snapshot_serial'").get()?.value ?? "0";
  db.close();
  fs.rmSync(f, { force: true });
  return { names, serial };
}

try {
  const dirA = path.join(os.tmpdir(), "race-a");
  const dirB = path.join(os.tmpdir(), "race-b");

  // ── instance A: fresh database, first snapshot ──
  startServer(3501, dirA);
  check("A starts", await waitUp(3501));
  await addEmployee(3501, "Alpha");
  await sleep(12000);
  let snap = await snapshotUsers();
  check("A's employee is in the snapshot", snap?.names.includes("Alpha"), `serial ${snap?.serial}, users: ${snap?.names.join(", ")}`);

  // ── instance B starts (like a new container during a deploy) and restores that snapshot ──
  startServer(3502, dirB);
  check("B starts and restores", (await waitUp(3502)) && /restored .* from/.test(logOf(3502)));

  // ── A keeps working and writes a newer snapshot ──
  await addEmployee(3501, "Bravo");
  await sleep(12000);
  snap = await snapshotUsers();
  check("A's newer change is in the snapshot", snap?.names.includes("Bravo"), `serial ${snap?.serial}`);

  // ── B now writes: it must NOT clobber A's newer snapshot ──
  await addEmployee(3502, "Charlie");
  await sleep(15000);
  snap = await snapshotUsers();
  check("B did not erase A's data", snap?.names.includes("Alpha") && snap?.names.includes("Bravo"), `users: ${snap?.names.join(", ")}`);
  check("B noticed the newer snapshot and adopted it", /adopted a newer snapshot/.test(logOf(3502)));
  check("B's own change was not silently kept as the truth", !snap?.names.includes("Charlie") || /adopted/.test(logOf(3502)));
} finally {
  await browser.close();
  for (const s of servers) {
    try { execFileSync("taskkill", ["/PID", String(s.child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
  try {
    const r = await api(`${REMOTE_PATH}?ref=HEAD`);
    if (r.ok) {
      const meta = await r.json();
      await api(REMOTE_PATH, { method: "DELETE", body: JSON.stringify({ message: "remove race-test snapshot", sha: meta.sha }) });
    }
  } catch {}
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
