import "server-only";
import { all, get, getSetting, run } from "./db";
import { audit } from "./audit";
import { computeRange, leaveBalances, todayLocal } from "./data";
import { weekStart, weeklyLate } from "./engine";
import { addDays } from "./time";
import { notify, notifyApprovers } from "./notify";

export const lateAllowance = () => Number(getSetting("weekly_late_allowance", "90")) || 90;

/**
 * Company rule: late minutes are summed per Monday–Sunday week. Above the allowance (90 min) one
 * full-day leave is deducted — Casual first, then Annual, else Unpaid. Re-evaluated whenever the
 * week's punches change, so an approved correction can also lift the penalty.
 */
export function syncLatePenalty(userId: number, date: string) {
  const user = get<{ id: number; name: string; shift_id: number | null; manager_id: number | null; status: string }>(
    "SELECT id, name, shift_id, manager_id, status FROM users WHERE id = ?",
    userId,
  );
  if (!user) return;
  const ws = weekStart(date);
  const today = todayLocal();
  const we = addDays(ws, 6) < today ? addDays(ws, 6) : today;
  if (we < ws) return;

  const days = computeRange([user], ws, we).get(user.id)!;
  const allowance = lateAllowance();
  const week = weeklyLate(days, allowance)[0];
  const existing = get<{ id: number; late_minutes: number }>("SELECT id, late_minutes FROM late_penalties WHERE user_id = ? AND week_start = ?", user.id, ws);

  if (week?.exceeded && !existing) {
    const type = pickPenaltyType(user.id, ws.slice(0, 4));
    if (!type) return;
    run(
      "INSERT INTO late_penalties(user_id, week_start, late_minutes, leave_type_id, days, created_at) VALUES (?, ?, ?, ?, 1, ?)",
      user.id,
      ws,
      week.lateMin,
      type.id,
      Date.now(),
    );
    audit(null, "LATE_PENALTY_APPLIED", "late_penalty", `${user.id}:${ws}`, { lateMin: week.lateMin, allowance, leaveType: type.name });
    const body = `Week of ${ws}: ${week.lateMin} late minutes (allowed ${allowance}). 1 day deducted from ${type.name}.`;
    notify(user.id, "Late limit crossed — 1 leave deducted", body, "/attendance");
    notifyApprovers(user.id, user.manager_id, `Late penalty: ${user.name}`, body, "/team");
  } else if (week?.exceeded && existing && existing.late_minutes !== week.lateMin) {
    run("UPDATE late_penalties SET late_minutes = ? WHERE id = ?", week.lateMin, existing.id);
  } else if (!week?.exceeded && existing) {
    run("DELETE FROM late_penalties WHERE id = ?", existing.id);
    audit(null, "LATE_PENALTY_REVERSED", "late_penalty", `${user.id}:${ws}`, { lateMin: week?.lateMin ?? 0, allowance });
    notify(user.id, "Late penalty reversed", `Week of ${ws} is back within ${allowance} minutes; the deducted leave was restored.`, "/leave");
  }
}

function pickPenaltyType(userId: number, year: string) {
  const order = getSetting("late_penalty_order", "CL,AL,UL").split(",").map((s) => s.trim());
  const balances = leaveBalances(userId, year);
  for (const code of order) {
    const b = balances.find((x) => x.code === code);
    if (!b) continue;
    if (b.quota === 0 || b.remaining >= 1) return { id: b.id, name: b.name };
  }
  const any = get<{ id: number; name: string }>("SELECT id, name FROM leave_types WHERE active = 1 AND annual_quota = 0 LIMIT 1");
  return any ?? null;
}

/** Re-evaluates recent weeks for every active user (run at server start). */
export function syncRecentPenalties(weeks = 6) {
  const today = todayLocal();
  const users = all<{ id: number }>("SELECT id FROM users WHERE status = 'active'");
  for (const u of users) {
    for (let i = 0; i < weeks; i++) syncLatePenalty(u.id, addDays(today, -7 * i));
  }
}

export function penaltiesFor(userId: number) {
  return all<{ week_start: string; late_minutes: number; days: number; leave_type: string; created_at: number }>(
    `SELECT p.week_start, p.late_minutes, p.days, lt.name AS leave_type, p.created_at
     FROM late_penalties p JOIN leave_types lt ON lt.id = p.leave_type_id WHERE p.user_id = ? ORDER BY p.week_start DESC LIMIT 52`,
    userId,
  );
}
