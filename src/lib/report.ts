import "server-only";
import type { SessionUser } from "./auth";
import { computeRange, getTz, listPeople, todayLocal } from "./data";
import { summarize, weekStart } from "./engine";
import { get } from "./db";
import { fmtTime, isIsoDate } from "./time";

export interface ReportParams {
  from: string;
  to: string;
  dept: number | null;
  user: number | null;
}

export function parseReportParams(sp: Record<string, string | undefined>): ReportParams {
  const today = todayLocal();
  let from = isIsoDate(sp.from) ? sp.from : today.slice(0, 8) + "01";
  let to = isIsoDate(sp.to) ? sp.to : today;
  if (to > today) to = today;
  if (from > to) from = to;
  // Keep a single report to about a year to bound the work.
  const maxFrom = new Date(Date.parse(to) - 366 * 86400_000).toISOString().slice(0, 10);
  if (from < maxFrom) from = maxFrom;
  return { from, to, dept: Number(sp.dept) || null, user: Number(sp.user) || null };
}

export function buildReport(actor: SessionUser, p: ReportParams) {
  const tz = getTz();
  let people = listPeople(actor, { departmentId: p.dept, includeInactive: true });
  if (p.user) people = people.filter((x) => x.id === p.user);
  const range = computeRange(people, p.from, p.to);

  const summary = people.map((person) => {
    const days = range.get(person.id)!.filter((d) => d.status !== "NOT_STARTED");
    const penalties = get<{ n: number }>(
      "SELECT COALESCE(SUM(days), 0) AS n FROM late_penalties WHERE user_id = ? AND week_start BETWEEN ? AND ?",
      person.id,
      weekStart(p.from),
      p.to,
    )!.n;
    return { person, s: summarize(days), penalties };
  });

  const daily = people.flatMap((person) =>
    range.get(person.id)!.map((d) => ({
      emp_code: person.emp_code,
      name: person.name,
      department: person.department ?? "",
      date: d.date,
      status: d.status,
      first_in: d.firstIn ? fmtTime(d.firstIn, tz) : "",
      last_out: d.lastOut ? fmtTime(d.lastOut, tz) : "",
      worked_hours: +(d.workedMin / 60).toFixed(2),
      break_minutes: d.breakMin,
      late_minutes: d.lateMin,
      early_leave_minutes: d.earlyMin,
      flags: d.flags.join(" "),
    })),
  );
  return { people, summary, daily };
}

export function summaryRows(report: ReturnType<typeof buildReport>) {
  return report.summary.map(({ person, s, penalties }) => ({
    emp_code: person.emp_code,
    name: person.name,
    department: person.department ?? "",
    present: s.present,
    half_day: s.halfDay,
    absent: s.absent,
    incomplete: s.incomplete,
    leave: s.leave,
    late_days: s.late,
    late_minutes: s.lateMin,
    late_penalty_leaves: penalties,
    worked_hours: +(s.workedMin / 60).toFixed(2),
    attendance_rate: s.attendanceRate,
    punctuality_rate: s.punctualityRate,
  }));
}
