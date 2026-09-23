// Removes sample/demo employees (and everything attached to them) from a deployment that is kept
// in a snapshot repository. Real employees, settings, shifts and the audit log are left alone.
//
//   node scripts/remove-demo-data.mjs --repo owner/pulse-attendance-data --token github_pat_... \
//        [--match "%@demo.local,%@example.com"] [--dry-run]
//
// The running instance adopts the cleaned database the next time it writes (or restart it to be
// immediate).

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const REPO = arg("repo");
const TOKEN = arg("token");
const REMOTE_PATH = arg("path", "db/attendance.db");
const MATCH = arg("match", "%@demo.local,%@example.com").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry-run");
if (!REPO || !TOKEN) {
  console.error("Usage: node scripts/remove-demo-data.mjs --repo <owner/repo> --token <github token> [--match ...] [--dry-run]");
  process.exit(1);
}

const api = (p, init) =>
  fetch(`https://api.github.com/repos/${REPO}/contents/${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", ...(init?.headers ?? {}) },
  });

const meta = await api(`${REMOTE_PATH}?ref=HEAD`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub ${r.status}`))));
const bytes = meta.content
  ? Buffer.from(meta.content, "base64")
  : Buffer.from(await (await fetch(meta.download_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
const file = path.join(os.tmpdir(), `prune-${Date.now()}.db`);
fs.writeFileSync(file, bytes);
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON");

const where = MATCH.map(() => "email LIKE ?").join(" OR ");
const victims = db.prepare(`SELECT id, name, email FROM users WHERE ${where}`).all(...MATCH).map((r) => ({ ...r }));
if (victims.length === 0) {
  console.log("Nothing to remove — no employees match", MATCH.join(", "));
  process.exit(0);
}
console.log(`Removing ${victims.length} sample employee(s):`);
for (const v of victims) {
  const punches = db.prepare("SELECT COUNT(*) n FROM punches WHERE user_id = ?").get(v.id).n;
  console.log(`  ${v.name} <${v.email}> — ${punches} punches`);
}
const keep = db.prepare(`SELECT COUNT(*) n FROM users WHERE NOT (${where})`).get(...MATCH).n;
console.log(`Keeping ${keep} employee(s).`);
if (DRY) { console.log("\n--dry-run: nothing written."); process.exit(0); }

db.exec("BEGIN IMMEDIATE");
try {
  const ids = victims.map((v) => v.id);
  const ph = ids.map(() => "?").join(",");
  for (const table of ["punches", "leave_requests", "regularizations", "late_penalties", "notifications", "devices", "agent_presence", "sessions"]) {
    db.prepare(`DELETE FROM ${table} WHERE user_id IN (${ph})`).run(...ids);
  }
  db.prepare(`UPDATE users SET manager_id = NULL WHERE manager_id IN (${ph})`).run(...ids);
  db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
  const serial = Number(db.prepare("SELECT value FROM settings WHERE key = 'snapshot_serial'").get()?.value ?? 0) + 1;
  db.prepare("INSERT INTO settings(key, value) VALUES ('snapshot_serial', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(serial));
  db.exec("COMMIT");

  const out = path.join(os.tmpdir(), `prune-out-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${out.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  db.close();
  const outBytes = fs.readFileSync(out);

  const fresh = await api(`${REMOTE_PATH}?ref=HEAD`).then((r) => r.json());
  if (fresh.sha !== meta.sha) throw new Error("The server wrote a newer snapshot while cleaning — run this again.");
  const put = await api(REMOTE_PATH, {
    method: "PUT",
    body: JSON.stringify({ message: `snapshot #${serial} (remove sample data)`, content: outBytes.toString("base64"), sha: meta.sha }),
  });
  if (!put.ok) throw new Error(`Upload failed: GitHub ${put.status} ${await put.text()}`);
  fs.rmSync(file, { force: true });
  fs.rmSync(out, { force: true });
  console.log(`\nCleaned snapshot uploaded (#${serial}, ${(outBytes.length / 1024).toFixed(0)} KB).`);
  console.log("Restart the service to load it immediately.");
} catch (e) {
  try { db.exec("ROLLBACK"); } catch {}
  throw e;
}
