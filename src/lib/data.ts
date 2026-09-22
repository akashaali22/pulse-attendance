import "server-only";
import { all, get, getSetting } from "./db";
import { computeDay, DEFAULT_SHIFT, type DayResult, type PunchInput, type ShiftRule } from "./engine";
import { dateRange, localDate } from "./time";
import { managedUserFilter, type SessionUser } from "./auth";

export const getTz = () => getSetting("timezone", "Asia/Karachi");
export const todayLocal = () => localDate(Date.now(), getTz());

export interface ShiftRow extends Omit<ShiftRule, "working_days"> {
  id: number;
  name: string;
  working_days: string;
  is_default: number;
}

export function shiftRules(): Map<number, ShiftRule> {
  const rows = all<ShiftRow>("SELECT * FROM shifts");
  const m = new Map<number, ShiftRule>();
  for (const r of rows) m.set(r.id, { ...r, working_days: r.working_days.split(",").filter(Boolean).map(Number) });
  return m;
}

function defaultShift(rules: Map<number, ShiftRule>): ShiftRule {
  const d = get<{ id: number }>("SELECT id FROM shifts ORDER BY is_default DESC, id LIMIT 1");
  return (d && rules.get(d.id)) || DEFAULT_SHIFT;
}

export interface Person {
  id: number;
  emp_code: string;
  name: string;
  email: string;
  role: string;
  designation: string | null;
  department: string | null;
  department_id: number | null;
  shift_id: number | null;
  manager_id: number | null;
  manager_name: string | null;
  status: string;
}

export function listPeople(actor: SessionUser, opts: { includeInactive?: boolean; departmentId?: number | null } = {}): Person[] {
  const f = managedUserFilter(actor);
  const where = [f.sql];
  const params: (number | string)[] = [...f.params];
  if (!opts.includeInactive) where.push("u.status = 'active'");
  if (opts.departmentId) {
    where.push("u.department_id = ?");
    params.push(opts.departmentId);
  }
  return all<Person>(
    `SELECT u.id, u.emp_code, u.name, u.email, u.role, u.designation, d.name AS department, u.department_id, u.shift_id,
            u.manager_id, m.name AS manager_name, u.status
     FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
     WHERE ${where.join(" AND ")} ORDER BY u.name`,
    ...params,
  );
}

/** Computes attendance days for many users over a date range in one pass. */
export function computeRange(users: { id: number; shift_id: number | null }[], from: string, to: string): Map<number, DayResult[]> {
  const result = new Map<number, DayResult[]>();
  if (users.length === 0) return result;
  const tz = getTz();
  const now = Date.now();
  const today = localDate(now, tz);
  const rules = shiftRules();
  const fallback = defaultShift(rules);
  const ids = users.map((u) => u.id);
  const ph = ids.map(() => "?").join(",");

  const punches = all<{ user_id: number; work_date: string; type: PunchInput["type"]; ts: number }>(
    `SELECT user_id, work_date, type, ts FROM punches WHERE voided = 0 AND work_date BETWEEN ? AND ? AND user_id IN (${ph})`,
    from,
    to,
    ...ids,
  );
  const byKey = new Map<string, PunchInput[]>();
  for (const p of punches) {
    const k = `${p.user_id}|${p.work_date}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push({ type: p.type, ts: p.ts });
  }

  const holidays = new Set(all<{ date: string }>("SELECT date FROM holidays WHERE date BETWEEN ? AND ?", from, to).map((h) => h.date));

  const leaves = all<{ user_id: number; start_date: string; end_date: string; half_day: number }>(
    `SELECT user_id, start_date, end_date, half_day FROM leave_requests
     WHERE status = 'approved' AND end_date >= ? AND start_date <= ? AND user_id IN (${ph})`,
    from,
    to,
    ...ids,
  );
  const leaveKey = new Map<string, { half: boolean }>();
  for (const l of leaves) {
    for (const d of dateRange(l.start_date < from ? from : l.start_date, l.end_date > to ? to : l.end_date)) {
      leaveKey.set(`${l.user_id}|${d}`, { half: !!l.half_day });
    }
  }

  const joined = new Map(
    all<{ id: number; joined_on: string | null }>(`SELECT id, joined_on FROM users WHERE id IN (${ph})`, ...ids).map((r) => [r.id, r.joined_on]),
  );

  const dates = dateRange(from, to);
  for (const u of users) {
    const shift = (u.shift_id && rules.get(u.shift_id)) || fallback;
    result.set(
      u.id,
      dates.map((date) =>
        computeDay({
          date,
          today,
          now,
          tz,
          shift,
          punches: byKey.get(`${u.id}|${date}`) ?? [],
          holiday: holidays.has(date),
          leave: leaveKey.get(`${u.id}|${date}`) ?? null,
          joinedOn: joined.get(u.id) ?? null,
        }),
      ),
    );
  }
  return result;
}

export function computeUserDay(user: { id: number; shift_id: number | null }, date: string): DayResult {
  return computeRange([user], date, date).get(user.id)![0];
}

export interface LeaveBalance {
  id: number;
  name: string;
  code: string;
  color: string;
  quota: number;
  used: number;
  pending: number;
  remaining: number;
}

export function leaveBalances(userId: number, year: string): LeaveBalance[] {
  const types = all<{ id: number; name: string; code: string; color: string; annual_quota: number }>(
    "SELECT id, name, code, color, annual_quota FROM leave_types WHERE active = 1 ORDER BY id",
  );
  const agg = all<{ leave_type_id: number; status: string; days: number }>(
    `SELECT leave_type_id, status, SUM(days) AS days FROM leave_requests
     WHERE user_id = ? AND substr(start_date, 1, 4) = ? AND status IN ('approved','pending') GROUP BY leave_type_id, status`,
    userId,
    year,
  );
  const penalties = all<{ leave_type_id: number; days: number }>(
    "SELECT leave_type_id, SUM(days) AS days FROM late_penalties WHERE user_id = ? AND substr(week_start, 1, 4) = ? GROUP BY leave_type_id",
    userId,
    year,
  );
  return types.map((t) => {
    const used =
      (agg.find((a) => a.leave_type_id === t.id && a.status === "approved")?.days ?? 0) +
      (penalties.find((p) => p.leave_type_id === t.id)?.days ?? 0);
    const pending = agg.find((a) => a.leave_type_id === t.id && a.status === "pending")?.days ?? 0;
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      color: t.color,
      quota: t.annual_quota,
      used,
      pending,
      remaining: Math.max(0, t.annual_quota - used - pending),
    };
  });
}

export function lastPunch(userId: number, workDate: string) {
  return get<{ type: string; ts: number }>(
    "SELECT type, ts FROM punches WHERE user_id = ? AND work_date = ? AND voided = 0 ORDER BY ts DESC, id DESC LIMIT 1",
    userId,
    workDate,
  );
}

export function pendingApprovalsCount(actor: SessionUser): number {
  if (actor.role === "employee") return 0;
  const f = managedUserFilter(actor);
  const q = (table: string) =>
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' AND u.id != ? AND ${f.sql}`,
      actor.id,
      ...f.params,
    )!.n;
  return q("leave_requests") + q("regularizations");
}
