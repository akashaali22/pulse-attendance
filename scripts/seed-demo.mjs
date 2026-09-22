// Optional DEMO data: a manager, 11 employees and ~30 days of realistic punches.
// Run once after the app has started at least once:  npm run seed:demo
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";

const file = path.join(process.env.ATTENDANCE_DATA_DIR ?? path.join(process.cwd(), "data"), "attendance.db");
if (!fs.existsSync(file)) {
  console.error("Database not found. Start the app once (npm run dev) and open it in the browser first.");
  process.exit(1);
}
const db = new DatabaseSync(file);
if (db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE '%@demo.local'").get().n > 0) {
  console.log("Demo data already present.");
  process.exit(0);
}
const tz = db.prepare("SELECT value FROM settings WHERE key='timezone'").get()?.value ?? "Asia/Karachi";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const parts = (ts) => Object.fromEntries(fmt.formatToParts(new Date(ts)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
const offset = (ts) => { const p = parts(ts); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000; };
const toUtc = (date, min) => { const [y, m, d] = date.split("-").map(Number); const g = Date.UTC(y, m - 1, d, 0, min); return g - offset(g - offset(g)); };
const localDate = (ts) => { const p = parts(ts); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dow = (date) => new Date(date + "T00:00:00Z").getUTCDay();

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const now = Date.now();
const today = localDate(now);
const hash = bcrypt.hashSync("Demo@1234", 10);
const dept = Object.fromEntries(db.prepare("SELECT id, name FROM departments").all().map((d) => [d.name, d.id]));
const shift = db.prepare("SELECT id FROM shifts ORDER BY is_default DESC LIMIT 1").get().id;

const insUser = db.prepare(`INSERT INTO users(emp_code, name, email, password_hash, role, department_id, shift_id, manager_id, designation, joined_on, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const mgr = Number(insUser.run("DEMO-100", "Ayesha Siddiqui", "manager@demo.local", hash, "manager", dept["Engineering"], shift, null, "Engineering Manager", "2023-01-10", now).lastInsertRowid);

const people = [
  ["Muhammad Ali", "Engineering", "Software Engineer", 0.1],
  ["Fatima Khan", "Engineering", "Frontend Engineer", 0.05],
  ["Hamza Raza", "Engineering", "QA Engineer", 0.3],
  ["Zainab Hussain", "Human Resources", "HR Executive", 0.05],
  ["Usman Tariq", "Sales", "Sales Lead", 0.25],
  ["Maryam Iqbal", "Sales", "Account Executive", 0.15],
  ["Bilal Ahmed", "Operations", "Ops Coordinator", 0.4],
  ["Sana Javed", "Operations", "Logistics Officer", 0.1],
  ["Omar Farooq", "Engineering", "DevOps Engineer", 0.2],
  ["Hina Aslam", "Human Resources", "Recruiter", 0.1],
  ["Ali Hassan", "Sales", "Sales Associate", 0.35],
];
const insPunch = db.prepare("INSERT INTO punches(user_id, type, ts, work_date, source, lat, lng, accuracy, location_id, flagged, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
const ids = [mgr];
people.forEach(([name, d, title], i) => {
  const email = name.toLowerCase().replace(/\s+/g, ".") + "@demo.local";
  ids.push(Number(insUser.run(`DEMO-${101 + i}`, name, email, hash, "employee", dept[d], shift, mgr, title, "2024-03-01", now).lastInsertRowid));
});

db.exec("BEGIN");
ids.forEach((uid, idx) => {
  const lateness = idx === 0 ? 0.1 : people[idx - 1][3];
  for (let back = 30; back >= 0; back--) {
    const date = addDays(today, -back);
    if (![1, 2, 3, 4, 5].includes(dow(date))) continue;
    const r = rnd();
    if (r < 0.05) continue; // absent
    const late = rnd() < lateness;
    const inMin = 9 * 60 + (late ? 16 + Math.floor(rnd() * 50) : -20 + Math.floor(rnd() * 32));
    const src = rnd() < 0.3 ? "QR" : "WEB";
    const P = (type, min) => {
      const ts = toUtc(date, min);
      if (ts > now) return false;
      insPunch.run(uid, type, ts, date, src, 24.8607 + (rnd() - 0.5) * 0.001, 67.0011 + (rnd() - 0.5) * 0.001, 15, 1, 0, now);
      return true;
    };
    if (!P("IN", inMin)) continue;
    const bs = 13 * 60 + Math.floor(rnd() * 30);
    if (!P("BREAK_START", bs)) continue;
    if (!P("BREAK_END", bs + 30 + Math.floor(rnd() * 25))) continue;
    if (back === 0 && rnd() < 0.4) continue; // still working today
    const halfDay = rnd() < 0.04;
    const outMin = halfDay ? 14 * 60 + 30 : 18 * 60 + Math.floor(rnd() * 70) - 10;
    if (back > 0 && rnd() < 0.03) continue; // forgot to check out
    P("OUT", outMin);
  }
});

const insLeave = db.prepare("INSERT INTO leave_requests(user_id, leave_type_id, start_date, end_date, days, half_day, reason, status, reviewer_id, reviewed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
insLeave.run(ids[2], 1, addDays(today, 5), addDays(today, 7), 3, 0, "Family wedding in Lahore", "pending", null, null, now);
insLeave.run(ids[5], 2, addDays(today, -9), addDays(today, -9), 1, 0, "Fever", "approved", mgr, now, now);
insLeave.run(ids[7], 3, addDays(today, 2), addDays(today, 2), 1, 0, "Personal errand", "pending", null, null, now);
db.prepare("INSERT INTO regularizations(user_id, work_date, check_in, check_out, reason, created_at) VALUES (?,?,?,?,?,?)")
  .run(ids[3], addDays(today, -3), "09:05", "18:10", "Forgot to check out, was in client meeting", now);
db.prepare("INSERT OR IGNORE INTO holidays(date, name) VALUES (?, ?)").run(addDays(today, 14), "Demo Public Holiday");
db.exec("COMMIT");

console.log(`Demo data added: 1 manager + ${people.length} employees.`);
console.log("Manager login:  manager@demo.local / Demo@1234");
console.log("Employee login: muhammad.ali@demo.local / Demo@1234");
