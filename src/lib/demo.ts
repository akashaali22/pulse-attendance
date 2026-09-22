import "server-only";
import { all, get, run, tx } from "./db";
import { setUserPassword } from "./passwords";
import { addDays, dayOfWeek, localDate, zonedToUtc } from "./time";
import { getTz, todayLocal } from "./data";

// Demo mode (DEMO_MODE=1): fills an empty database with a sample company so a public demo link is
// usable straight away. Free hosting has no persistent disk, so this runs again after every restart.

const PEOPLE: [string, string, string, number][] = [
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
];

export const demoMode = () => process.env.DEMO_MODE === "1";

export async function seedDemoIfEmpty() {
  if (!demoMode()) return;
  if (get("SELECT 1 FROM users WHERE email LIKE '%@demo.local' LIMIT 1")) return;

  const tz = getTz();
  const today = todayLocal();
  const now = Date.now();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  const dept = Object.fromEntries(all<{ id: number; name: string }>("SELECT id, name FROM departments").map((d) => [d.name, d.id]));
  const shift = get<{ id: number }>("SELECT id FROM shifts ORDER BY is_default DESC LIMIT 1")!.id;

  const add = async (name: string, email: string, role: string, department: number | null, title: string, manager: number | null, code: string) => {
    const r = run(
      `INSERT INTO users(emp_code, name, email, password_hash, role, department_id, shift_id, manager_id, designation, joined_on, created_at)
       VALUES (?, ?, ?, '!', ?, ?, ?, ?, ?, ?, ?)`,
      code,
      name,
      email,
      role,
      department,
      shift,
      manager,
      title,
      addDays(today, -400),
      now,
    );
    const id = Number(r.lastInsertRowid);
    await setUserPassword(id, "Demo@1234", "Demo data");
    return id;
  };

  const mgr = await add("Ayesha Siddiqui", "manager@demo.local", "manager", dept["Engineering"] ?? null, "Engineering Manager", null, "DEMO-100");
  const ids: number[] = [mgr];
  for (const [i, [name, d, title]] of PEOPLE.entries()) {
    ids.push(await add(name, `${name.toLowerCase().replace(/\s+/g, ".")}@demo.local`, "employee", dept[d] ?? null, title, mgr, `DEMO-${101 + i}`));
  }

  tx(() => {
    for (const [idx, uid] of ids.entries()) {
      const lateness = idx === 0 ? 0.1 : PEOPLE[idx - 1][3];
      for (let back = 30; back >= 0; back--) {
        const date = addDays(today, -back);
        if (![1, 2, 3, 4, 5].includes(dayOfWeek(date))) continue;
        if (rnd() < 0.05) continue; // absent
        const late = rnd() < lateness;
        const inMin = 9 * 60 + (late ? 16 + Math.floor(rnd() * 50) : -20 + Math.floor(rnd() * 32));
        const source = rnd() < 0.35 ? "AGENT" : rnd() < 0.5 ? "QR" : "WEB";
        const punch = (type: string, min: number) => {
          const ts = zonedToUtc(date, `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`, tz);
          if (ts > now) return false;
          run(
            "INSERT INTO punches(user_id, type, ts, work_date, source, lat, lng, accuracy, location_id, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)",
            uid,
            type,
            ts,
            localDate(ts, tz),
            source,
            24.8607 + (rnd() - 0.5) * 0.001,
            67.0011 + (rnd() - 0.5) * 0.001,
            15,
            now,
          );
          return true;
        };
        if (!punch("IN", inMin)) continue;
        if (back === 0 && rnd() < 0.4) continue; // still working today
        if (back > 0 && rnd() < 0.03) continue; // forgot to check out
        punch("OUT", rnd() < 0.05 ? 14 * 60 + 30 : 18 * 60 + Math.floor(rnd() * 70) - 10);
      }
    }

    const leave = (user: number, type: number, from: string, to: string, days: number, reason: string, status: string) =>
      run(
        "INSERT INTO leave_requests(user_id, leave_type_id, start_date, end_date, days, half_day, reason, status, reviewer_id, reviewed_at, created_at) VALUES (?,?,?,?,?,0,?,?,?,?,?)",
        user,
        type,
        from,
        to,
        days,
        reason,
        status,
        status === "approved" ? mgr : null,
        status === "approved" ? now : null,
        now,
      );
    leave(ids[3], 1, addDays(today, 5), addDays(today, 7), 3, "Family wedding in Lahore", "pending");
    leave(ids[6], 2, addDays(today, -9), addDays(today, -9), 1, "Fever", "approved");
    leave(ids[8], 3, addDays(today, 2), addDays(today, 2), 1, "Personal errand", "pending");
    run("INSERT INTO regularizations(user_id, work_date, check_in, check_out, reason, created_at) VALUES (?,?,?,?,?,?)", ids[4], addDays(today, -3), "09:05", "18:10", "Forgot to check out, was in a client meeting", now);
    run("INSERT OR IGNORE INTO holidays(date, name) VALUES (?, ?)", addDays(today, 14), "Public Holiday");
  });

  console.log(`[demo] sample company created: manager@demo.local / Demo@1234 (${ids.length} people)`);
}
