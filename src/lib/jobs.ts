import "server-only";
import { all, get, setSetting } from "./db";
import { computeRange, getTz, shiftRules, todayLocal } from "./data";
import { notify } from "./notify";
import { syncRecentPenalties } from "./penalty";
import { autoCloseAgentSessions } from "./agent";
import { dayOfWeek, hhmmToMinutes, localMinutes } from "./time";

const g = globalThis as unknown as { __attendanceJobs?: boolean };

export function startJobs() {
  if (g.__attendanceJobs) return;
  g.__attendanceJobs = true;
  safe(() => syncRecentPenalties(), "late penalty sync");
  setInterval(() => {
    safe(breakAlerts, "break alerts");
    safe(autoCloseAgentSessions, "agent auto-close");
  }, 30_000);
  safe(breakAlerts, "break alerts");
}

function safe(fn: () => void, name: string) {
  try {
    fn();
  } catch (e) {
    console.error(`[jobs] ${name} failed:`, e);
  }
}

/** At each shift's break start, notify everyone of that shift who is currently checked in (once per day). */
function breakAlerts() {
  const tz = getTz();
  const today = todayLocal();
  const nowMin = localMinutes(Date.now(), tz);
  const rules = shiftRules();
  const defaultId = get<{ id: number }>("SELECT id FROM shifts ORDER BY is_default DESC, id LIMIT 1")?.id;

  for (const [shiftId, rule] of rules) {
    if (!rule.break_start || !rule.break_end || !rule.working_days.includes(dayOfWeek(today))) continue;
    const bs = hhmmToMinutes(rule.break_start);
    const be = hhmmToMinutes(rule.break_end);
    if (nowMin < bs || nowMin >= be) continue;
    const key = `break_alert:${today}:${shiftId}`;
    if (get("SELECT 1 FROM settings WHERE key = ?", key)) continue;
    setSetting(key, String(Date.now()));

    const users = all<{ id: number; shift_id: number | null }>(
      "SELECT id, shift_id FROM users WHERE status = 'active' AND (shift_id = ? OR (shift_id IS NULL AND ? = 1))",
      shiftId,
      shiftId === defaultId ? 1 : 0,
    );
    const days = computeRange(users, today, today);
    for (const u of users) {
      const d = days.get(u.id)![0];
      if (d.status === "WORKING" || d.status === "ON_BREAK") {
        notify(u.id, `Break started (${fmt12(rule.break_start)} – ${fmt12(rule.break_end)})`, "Break time is deducted automatically. No need to press any button.", "/dashboard");
      }
    }
  }
}

function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
