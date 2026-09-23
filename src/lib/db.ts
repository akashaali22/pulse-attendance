import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const DATA_DIR = process.env.ATTENDANCE_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "attendance.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  half_day_minutes INTEGER NOT NULL DEFAULT 240,
  full_day_minutes INTEGER NOT NULL DEFAULT 480,
  working_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 200,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  emp_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','employee')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  designation TEXT,
  phone TEXT,
  joined_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  require_geofence INTEGER NOT NULL DEFAULT 0,
  require_selfie INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','BREAK_START','BREAK_END')),
  ts INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  source TEXT NOT NULL,
  lat REAL,
  lng REAL,
  accuracy REAL,
  location_id INTEGER,
  ip TEXT,
  selfie_path TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  flag_reason TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_punches_user_date ON punches(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_punches_date ON punches(work_date);
CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  annual_quota REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1',
  paid INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  half_day INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewer_id INTEGER REFERENCES users(id),
  review_note TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id, status);
CREATE TABLE IF NOT EXISTS regularizations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewer_id INTEGER REFERENCES users(id),
  review_note TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS late_penalties (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  late_minutes INTEGER NOT NULL,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  days REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, week_start)
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  agent_version TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  last_ip TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent_presence (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  locked_since INTEGER,
  PRIMARY KEY (user_id, work_date)
);
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dismissed')),
  handled_by INTEGER REFERENCES users(id),
  handled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_status ON password_reset_requests(status, created_at);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

function seed(db: DatabaseSync) {
  const now = Date.now();
  const has = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (has.n > 0) return;

  const setSetting = db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)");
  setSetting.run("company_name", "My Company");
  setSetting.run("timezone", "Asia/Karachi");
  setSetting.run("allowed_ips", "");
  setSetting.run("kiosk_secret", crypto.randomBytes(32).toString("hex"));
  setSetting.run("selfie_default", "0");

  for (const name of ["Engineering", "Human Resources", "Sales", "Operations"]) {
    db.prepare("INSERT INTO departments(name, created_at) VALUES (?, ?)").run(name, now);
  }
  db.prepare(
    `INSERT INTO shifts(name, start_time, end_time, grace_minutes, half_day_minutes, full_day_minutes, working_days, is_default)
     VALUES ('General (9-6)', '09:00', '18:00', 0, 240, 480, '1,2,3,4,5', 1)`,
  ).run();
  db.prepare(
    "INSERT INTO locations(name, lat, lng, radius_m, active) VALUES ('Head Office', 24.8607, 67.0011, 250, 1)",
  ).run();
  const lt = db.prepare("INSERT INTO leave_types(name, code, annual_quota, color, paid) VALUES (?, ?, ?, ?, ?)");
  lt.run("Annual Leave", "AL", 14, "#6366f1", 1);
  lt.run("Sick Leave", "SL", 8, "#f43f5e", 1);
  lt.run("Casual Leave", "CL", 10, "#f59e0b", 1);
  lt.run("Unpaid Leave", "UL", 0, "#64748b", 0);

  db.prepare(
    `INSERT INTO users(emp_code, name, email, password_hash, role, department_id, shift_id, designation, joined_on, created_at)
     VALUES ('EMP-0001', 'System Admin', 'admin@company.com', ?, 'admin', 2, 1, 'Administrator', ?, ?)`,
  ).run(bcrypt.hashSync("Admin@123", 10), new Date().toISOString().slice(0, 10), now);
}

/** Additive, idempotent schema upgrades for databases created by earlier versions. */
function migrate(db: DatabaseSync) {
  const cols = (db.prepare("PRAGMA table_info(shifts)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("break_start")) {
    db.exec("ALTER TABLE shifts ADD COLUMN break_start TEXT; ALTER TABLE shifts ADD COLUMN break_end TEXT;");
    // Company policy: 09:00â€“18:00 with a fixed 13:15â€“14:15 break; lateness is handled by the weekly allowance.
    db.exec("UPDATE shifts SET break_start = '13:15', break_end = '14:15'");
    db.exec("UPDATE shifts SET grace_minutes = 0 WHERE is_default = 1");
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('weekly_late_allowance', '90')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('late_penalty_order', 'CL,AL,UL')").run();
  const userCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!userCols.includes("password_enc")) {
    db.exec("ALTER TABLE users ADD COLUMN password_enc TEXT; ALTER TABLE users ADD COLUMN password_changed_at INTEGER; ALTER TABLE users ADD COLUMN password_set_by TEXT;");
  }
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('allow_password_view', '1')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('agent_away_minutes', '30')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('agent_offline_minutes', '10')").run();
}

function open(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(SCHEMA);
    seed(db);
    migrate(db);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return db;
}

// Opened lazily on first query so importing this module (e.g. during `next build`) never touches the file.
const g = globalThis as unknown as { __attendanceDb?: DatabaseSync };
function conn(): DatabaseSync {
  return g.__attendanceDb ?? (g.__attendanceDb = open());
}

/** Raw connection (used by the backup snapshotter). */
export const db = conn;

/** Closes the connection so the next query reopens the file (used after restoring a newer snapshot). */
export function resetConnection() {
  try {
    g.__attendanceDb?.close();
  } catch {
    /* already closed */
  }
  g.__attendanceDb = undefined;
}

// Set by the backup module when snapshotting is enabled; called after every write.
// Kept on globalThis because the production build loads this module more than once (the startup
// instrumentation and the request handlers get separate copies), and a module-level variable would
// only notify the copy that registered it â€” request writes would then never be snapshotted.
const gw = globalThis as unknown as { __attendanceOnWrite?: () => void };
export const setOnWrite = (fn: () => void) => {
  gw.__attendanceOnWrite = fn;
};
const onWrite = () => gw.__attendanceOnWrite?.();

export type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
  // node:sqlite returns null-prototype rows; copy to plain objects so they can cross to Client Components.
  return conn().prepare(sql).all(...params).map((r) => ({ ...r })) as T[];
}
export function get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
  const r = conn().prepare(sql).get(...params);
  return (r ? { ...r } : undefined) as T | undefined;
}
export function run(sql: string, ...params: SqlParam[]) {
  const r = conn().prepare(sql).run(...params);
  onWrite();
  return r;
}
export type SqlParam = string | number | null | bigint;

export function tx<T>(fn: () => T): T {
  const db = conn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    onWrite();
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSetting(key: string, fallback = ""): string {
  return get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value ?? fallback;
}
export function setSetting(key: string, value: string) {
  run("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}
