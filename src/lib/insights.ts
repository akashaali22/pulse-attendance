// Signals: the things a manager would notice if they read one person's attendance carefully,
// found by arithmetic rather than by anyone reading anything.
//
// Everything here is pure and compares a person against their own recent history, never against
// their colleagues — a slow starter with a consistent record should not be flagged for being
// different from the team. No thresholds are absolute: they are all "compared with your own
// normal", so the same rules work for a 9-to-6 office and a split-shift site.

import type { DayResult } from "./engine";

export type Severity = "info" | "warn" | "bad";

export interface Signal {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The number that triggered it, already rounded for display. */
  metric?: string;
}

export interface SignalContext {
  /** Working minutes a full day is expected to be, from the shift. */
  targetMin: number;
  /** Weekly late allowance in minutes, from company settings. */
  allowanceMin: number;
  /** Today in company time, so "recent" means recent to the reader. */
  today: string;
}

const ATTENDED = new Set(["PRESENT", "HALF_DAY", "INCOMPLETE", "WORKING", "ON_BREAK"]);
/** Days the person was expected in: weekends, holidays, leave and pre-joining days are not judged. */
const COUNTED = new Set(["PRESENT", "HALF_DAY", "INCOMPLETE", "ABSENT", "WORKING", "ON_BREAK"]);

const counted = (days: DayResult[]) => days.filter((d) => COUNTED.has(d.status));
const attended = (days: DayResult[]) => days.filter((d) => ATTENDED.has(d.status));

/** Minutes past midnight of a check-in, in the reader's timezone offset-free comparison. */
function startMinutes(d: DayResult): number | null {
  if (d.firstIn == null) return null;
  const t = new Date(d.firstIn);
  return t.getHours() * 60 + t.getMinutes();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);

/**
 * Reads a person's history (oldest first) and returns what stands out, worst first.
 * `days` should cover at least the last two months for the comparisons to mean anything.
 */
export function signalsFor(days: DayResult[], ctx: SignalContext): Signal[] {
  const history = days.filter((d) => d.date <= ctx.today).sort((a, b) => a.date.localeCompare(b.date));
  const out: Signal[] = [];
  if (history.length === 0) return out;

  const workdays = counted(history);
  const recent = workdays.slice(-14);
  const previous = workdays.slice(-28, -14);

  // ── Lateness that is getting worse, not lateness itself ──
  if (recent.length >= 5 && previous.length >= 5) {
    const now = recent.filter((d) => d.late).length;
    const before = previous.filter((d) => d.late).length;
    if (now >= 3 && now >= before * 2) {
      out.push({
        id: "LATE_TREND",
        severity: now >= 6 ? "bad" : "warn",
        title: "Arriving late more often",
        detail: `${now} late days in the last ${recent.length} working days, against ${before} in the ${previous.length} before that.`,
        metric: `${now} vs ${before}`,
      });
    }
  }

  // ── About to lose a leave day to the weekly allowance ──
  const week = workdays.slice(-5);
  const weekLate = week.reduce((s, d) => s + d.lateMin, 0);
  if (ctx.allowanceMin > 0 && weekLate >= ctx.allowanceMin * 0.7 && weekLate < ctx.allowanceMin) {
    out.push({
      id: "ALLOWANCE_RISK",
      severity: "warn",
      title: "Close to the weekly late limit",
      detail: `${weekLate} of ${ctx.allowanceMin} minutes used this week. Crossing it costs a full leave day.`,
      metric: `${Math.round((weekLate / ctx.allowanceMin) * 100)}%`,
    });
  }

  // ── Punches that were never closed: the data itself is unreliable ──
  const open = workdays.slice(-30).filter((d) => d.flags.includes("MISSING_CHECKOUT"));
  if (open.length >= 2) {
    out.push({
      id: "MISSING_CHECKOUT",
      severity: open.length >= 4 ? "warn" : "info",
      title: "Days without a check-out",
      detail: `${open.length} days in the last month ended without a check-out, so those hours are estimates. Latest: ${open[open.length - 1].date}.`,
      metric: `${open.length} days`,
    });
  }

  // ── Consistently short days against the shift, not against colleagues ──
  const workedRecent = attended(recent).map((d) => d.workedMin);
  if (workedRecent.length >= 5 && ctx.targetMin > 0) {
    const typical = median(workedRecent);
    if (typical < ctx.targetMin * 0.8) {
      out.push({
        id: "SHORT_DAYS",
        severity: typical < ctx.targetMin * 0.65 ? "bad" : "warn",
        title: "Short working days",
        detail: `A typical day is ${hm(typical)} against a ${hm(ctx.targetMin)} shift.`,
        metric: `${Math.round((typical / ctx.targetMin) * 100)}%`,
      });
    }
  }

  // ── Overwork, which is a retention problem long before it is an attendance one ──
  const longDays = attended(workdays.slice(-14)).filter((d) => d.workedMin > ctx.targetMin + 120);
  const weekendDays = history.slice(-30).filter((d) => d.status === "WEEKEND" && d.workedMin > 60);
  if (longDays.length >= 3 || weekendDays.length >= 2) {
    out.push({
      id: "OVERWORK",
      severity: longDays.length >= 6 || weekendDays.length >= 4 ? "bad" : "warn",
      title: "Working well past the shift",
      detail: [
        longDays.length >= 3 ? `${longDays.length} days over two hours past the shift in the last fortnight` : "",
        weekendDays.length >= 2 ? `${weekendDays.length} weekend days worked in the last month` : "",
      ]
        .filter(Boolean)
        .join(" · ") + ".",
      metric: longDays.length ? `${longDays.length} long days` : `${weekendDays.length} weekends`,
    });
  }

  // ── An absence run, which usually means something the manager has not been told ──
  let streak = 0;
  for (let i = workdays.length - 1; i >= 0 && workdays[i].status === "ABSENT"; i--) streak++;
  if (streak >= 2) {
    out.push({
      id: "ABSENCE_STREAK",
      severity: streak >= 3 ? "bad" : "warn",
      title: "Absent several days running",
      detail: `${streak} working days absent in a row, with no leave approved for them.`,
      metric: `${streak} days`,
    });
  }

  // ── Attendance falling against the person's own earlier record ──
  const rate = (list: DayResult[]) => (list.length === 0 ? null : (attended(list).length / list.length) * 100);
  const nowRate = rate(workdays.slice(-20));
  const beforeRate = rate(workdays.slice(-40, -20));
  if (nowRate !== null && beforeRate !== null && nowRate < 85 && beforeRate - nowRate >= 10) {
    out.push({
      id: "ATTENDANCE_DROP",
      severity: nowRate < 70 ? "bad" : "warn",
      title: "Attendance is dropping",
      detail: `${Math.round(nowRate)}% of recent working days attended, down from ${Math.round(beforeRate)}%.`,
      metric: `−${Math.round(beforeRate - nowRate)} pts`,
    });
  }

  // ── Start times all over the place: a scheduling conversation, not a discipline one ──
  const starts = attended(workdays.slice(-14)).map(startMinutes).filter((v): v is number => v !== null);
  if (starts.length >= 6) {
    const jitter = spread(starts);
    if (jitter >= 45) {
      out.push({
        id: "IRREGULAR_START",
        severity: "info",
        title: "Start time varies widely",
        detail: `Check-ins swing by about ${Math.round(jitter)} minutes around ${hm(median(starts) % 60 === 0 ? median(starts) : median(starts))} past midnight.`,
        metric: `±${Math.round(jitter)}m`,
      });
    }
  }

  const order: Record<Severity, number> = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** A one-line health read for a list of days, for the top of a profile. */
export function reliabilityScore(days: DayResult[], ctx: SignalContext): { score: number; label: string } {
  const workdays = counted(days.filter((d) => d.date <= ctx.today));
  if (workdays.length === 0) return { score: 0, label: "No record yet" };
  const present = attended(workdays).length / workdays.length; // 0..1
  const onTime = workdays.length ? 1 - workdays.filter((d) => d.late).length / workdays.length : 1;
  const complete = 1 - workdays.filter((d) => d.flags.includes("MISSING_CHECKOUT")).length / workdays.length;
  const score = Math.round((present * 0.55 + onTime * 0.3 + complete * 0.15) * 100);
  const label = score >= 92 ? "Excellent" : score >= 80 ? "Steady" : score >= 65 ? "Needs attention" : "At risk";
  return { score, label };
}
