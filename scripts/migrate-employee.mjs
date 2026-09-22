// Copies one employee — and their whole attendance history — from a local database into the
// snapshot that a disk-less host (Render free) restores on boot.
//
//   node scripts/migrate-employee.mjs --email someone@company.com \
//        --repo owner/pulse-attendance-data --token github_pat_... --key <live PASSWORD_KEY>
//
// Steps: download the live snapshot → insert the employee, punches, leave, corrections, penalties
// and linked PCs → upload it back. Restart the service afterwards so it restores the merged file.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const EMAIL = arg("email");
const REPO = arg("repo");
const TOKEN = arg("token");
const LIVE_KEY = arg("key");
const LOCAL_DB = arg("local", path.join(process.cwd(), "data", "attendance.db"));
const LOCAL_KEY_FILE = path.join(path.dirname(LOCAL_DB), "password.key");
const REMOTE_PATH = arg("path", "db/attendance.db");
if (!EMAIL || !REPO || !TOKEN) {
  console.error("Usage: node scripts/migrate-employee.mjs --email <email> --repo <owner/repo> --token <github token> [--key <PASSWORD_KEY>]");
  process.exit(1);
}

const api = (p, init) =>
  fetch(`https://api.github.com/repos/${REPO}/contents/${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init?.headers ?? {}) },
  });

// ── download the live snapshot ──
const meta = await api(`${REMOTE_PATH}?ref=HEAD`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub ${r.status}`))));
const bytes = meta.content
  ? Buffer.from(meta.content, "base64")
  : Buffer.from(await (await fetch(meta.download_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
const workFile = path.join(os.tmpdir(), `pulse-live-${Date.now()}.db`);
fs.writeFileSync(workFile, bytes);
console.log(`Downloaded live snapshot: ${(bytes.length / 1024).toFixed(0)} KB`);

const src = new DatabaseSync(LOCAL_DB, { readOnly: true });
const dst = new DatabaseSync(workFile);
const one = (db, sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? { ...r } : undefined; };
const many = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));

const user = one(src, "SELECT * FROM users WHERE email = ? COLLATE NOCASE", EMAIL);
if (!user) throw new Error(`No user ${EMAIL} in ${LOCAL_DB}`);
if (one(dst, "SELECT id FROM users WHERE email = ? COLLATE NOCASE", EMAIL)) throw new Error(`${EMAIL} already exists in the live database`);

// ── password: re-encrypt for the live key ──
function reEncrypt(stored) {
  if (!stored || !LIVE_KEY) return null;
  try {
    const localKey = Buffer.from(fs.readFileSync(LOCAL_KEY_FILE, "utf8").trim(), "hex");
    const [v, iv, tag, data] = stored.split(":");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", localKey, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]);
    const iv2 = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", Buffer.from(LIVE_KEY, "hex"), iv2);
    const enc = Buffer.concat([c.update(plain), c.final()]);
    return ["v1", iv2.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
  } catch (e) {
    console.warn("  (could not re-encrypt the stored password:", e.message + ")");
    return null;
  }
}

// ── map department / shift / leave types by name, creating what is missing ──
const srcDept = user.department_id ? one(src, "SELECT name FROM departments WHERE id = ?", user.department_id) : null;
let deptId = null;
if (srcDept) {
  deptId = one(dst, "SELECT id FROM departments WHERE name = ?", srcDept.name)?.id
    ?? Number(dst.prepare("INSERT INTO departments(name, created_at) VALUES (?, ?)").run(srcDept.name, Date.now()).lastInsertRowid);
}
const srcShift = user.shift_id ? one(src, "SELECT name FROM shifts WHERE id = ?", user.shift_id) : null;
const shiftId = (srcShift && one(dst, "SELECT id FROM shifts WHERE name = ?", srcShift.name)?.id) ?? one(dst, "SELECT id FROM shifts ORDER BY is_default DESC, id LIMIT 1")?.id ?? null;
const leaveTypeId = (srcId) => {
  const code = one(src, "SELECT code, name, annual_quota, color, paid FROM leave_types WHERE id = ?", srcId);
  if (!code) return null;
  return one(dst, "SELECT id FROM leave_types WHERE code = ?", code.code)?.id
    ?? Number(dst.prepare("INSERT INTO leave_types(name, code, annual_quota, color, paid) VALUES (?,?,?,?,?)").run(code.name, code.code, code.annual_quota, code.color, code.paid).lastInsertRowid);
};

let empCode = user.emp_code;
while (one(dst, "SELECT id FROM users WHERE emp_code = ?", empCode)) empCode += "-M";

dst.exec("BEGIN IMMEDIATE");
try {
  const newId = Number(
    dst
      .prepare(
        `INSERT INTO users(emp_code, name, email, password_hash, role, department_id, shift_id, manager_id, designation, phone,
         joined_on, status, require_geofence, require_selfie, created_at, password_enc, password_changed_at, password_set_by)
         VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        empCode, user.name, user.email, user.password_hash, user.role, deptId, shiftId, user.designation, user.phone,
        user.joined_on, user.status, user.require_geofence, user.require_selfie, user.created_at,
        reEncrypt(user.password_enc), user.password_changed_at, user.password_set_by,
      ).lastInsertRowid,
  );
  console.log(`Created ${user.name} <${user.email}> as id ${newId} (code ${empCode})`);

  const punches = many(src, "SELECT * FROM punches WHERE user_id = ?", user.id);
  const insP = dst.prepare(
    `INSERT INTO punches(user_id, type, ts, work_date, source, lat, lng, accuracy, location_id, ip, selfie_path, flagged, flag_reason, voided, created_at)
     VALUES (?,?,?,?,?,?,?,?,NULL,?,NULL,?,?,?,?)`,
  );
  for (const p of punches) insP.run(newId, p.type, p.ts, p.work_date, p.source, p.lat, p.lng, p.accuracy, p.ip, p.flagged, p.flag_reason, p.voided, p.created_at);
  console.log(`  punches: ${punches.length}`);

  const leaves = many(src, "SELECT * FROM leave_requests WHERE user_id = ?", user.id);
  const insL = dst.prepare(
    `INSERT INTO leave_requests(user_id, leave_type_id, start_date, end_date, days, half_day, reason, status, reviewer_id, review_note, reviewed_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)`,
  );
  for (const l of leaves) {
    const t = leaveTypeId(l.leave_type_id);
    if (t) insL.run(newId, t, l.start_date, l.end_date, l.days, l.half_day, l.reason, l.status, l.review_note, l.reviewed_at, l.created_at);
  }
  console.log(`  leave requests: ${leaves.length}`);

  const fixes = many(src, "SELECT * FROM regularizations WHERE user_id = ?", user.id);
  const insR = dst.prepare(
    `INSERT INTO regularizations(user_id, work_date, check_in, check_out, reason, status, reviewer_id, review_note, reviewed_at, created_at)
     VALUES (?,?,?,?,?,?,NULL,?,?,?)`,
  );
  for (const r of fixes) insR.run(newId, r.work_date, r.check_in, r.check_out, r.reason, r.status, r.review_note, r.reviewed_at, r.created_at);
  console.log(`  correction requests: ${fixes.length}`);

  const pens = many(src, "SELECT * FROM late_penalties WHERE user_id = ?", user.id);
  const insPen = dst.prepare("INSERT INTO late_penalties(user_id, week_start, late_minutes, leave_type_id, days, created_at) VALUES (?,?,?,?,?,?)");
  for (const p of pens) {
    const t = leaveTypeId(p.leave_type_id);
    if (t) insPen.run(newId, p.week_start, p.late_minutes, t, p.days, p.created_at);
  }
  console.log(`  late penalties: ${pens.length}`);

  const devices = many(src, "SELECT * FROM devices WHERE user_id = ? AND revoked = 0", user.id);
  const insD = dst.prepare("INSERT INTO devices(user_id, name, token_hash, agent_version, created_at, last_seen, last_ip, revoked) VALUES (?,?,?,?,?,?,?,0)");
  for (const d of devices) insD.run(newId, d.name, d.token_hash, d.agent_version, d.created_at, d.last_seen, d.last_ip);
  console.log(`  linked PCs: ${devices.length}`);

  dst.exec("COMMIT");
} catch (e) {
  dst.exec("ROLLBACK");
  throw e;
}

// ── upload the merged database back ──
const merged = path.join(os.tmpdir(), `pulse-merged-${Date.now()}.db`);
fs.rmSync(merged, { force: true });
dst.exec(`VACUUM INTO '${merged.replace(/\\/g, "/").replace(/'/g, "''")}'`);
dst.close();
src.close();
const outBytes = fs.readFileSync(merged);

const fresh = await api(`${REMOTE_PATH}?ref=HEAD`).then((r) => r.json());
if (fresh.sha !== meta.sha) throw new Error("The live server wrote a newer snapshot while migrating — run this again.");

const put = await api(REMOTE_PATH, {
  method: "PUT",
  body: JSON.stringify({ message: `migrate ${EMAIL} from local database`, content: outBytes.toString("base64"), sha: meta.sha }),
});
if (!put.ok) throw new Error(`Upload failed: GitHub ${put.status} ${await put.text()}`);
fs.rmSync(workFile, { force: true });
fs.rmSync(merged, { force: true });
console.log(`\nUploaded merged snapshot (${(outBytes.length / 1024).toFixed(0)} KB).`);
console.log("Now restart the service (Render → Manual Deploy → Restart service) so it loads this database.");
