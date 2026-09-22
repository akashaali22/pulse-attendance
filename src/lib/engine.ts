// Deterministic attendance calculation engine.
// Port of core/services/calculation_engine.py, fixed for local timezones, split sessions and live days.
// AttendanceDay = F(punches, shift, policy, leave, holiday, now)

import { dayOfWeek, hhmmToMinutes, localMinutes, zonedToUtc } from "./time";

export type PunchType = "IN" | "OUT" | "BREAK_START" | "BREAK_END";
export interface PunchInput {
  type: PunchType;
  ts: number;
}

export interface ShiftRule {
  start_time: string; // HH:MM local
  end_time: string;
  grace_minutes: number;
  half_day_minutes: number;
  full_day_minutes: number;
  working_days: number[]; // 0 = Sunday
  break_start?: string | null; // fixed daily break, deducted automatically (HH:MM local)
  break_end?: string | null;
}

export type DayStatus =
  | "PRESENT"
  | "HALF_DAY"
  | "ABSENT"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKEND"
  | "INCOMPLETE"
  | "WORKING"
  | "ON_BREAK"
  | "NOT_STARTED"
  | "UPCOMING"
  | "NOT_JOINED";

export interface Session {
  start: number;
  end: number | null;
  breaks: { start: number; end: number | null }[];
}

export interface DayResult {
  date: string;
  status: DayStatus;
  late: boolean;
  lateMin: number;
  earlyMin: number;
  overtimeMin: number;
  workedMin: number;
  breakMin: number;
  firstIn: number | null;
  lastOut: number | null;
  sessions: Session[];
  flags: string[];
  leaveHalf: boolean;
}

export interface DayInput {
  date: string;
  today: string;
  now: number;
  tz: string;
  punches: PunchInput[];
  shift: ShiftRule;
  holiday?: boolean;
  leave?: { half: boolean } | null;
  joinedOn?: string | null;
}

export const DEFAULT_SHIFT: ShiftRule = {
  start_time: "09:00",
  end_time: "18:00",
  grace_minutes: 0,
  half_day_minutes: 240,
  full_day_minutes: 480,
  working_days: [1, 2, 3, 4, 5],
  break_start: "13:15",
  break_end: "14:15",
};

const ORDER: Record<PunchType, number> = { IN: 0, BREAK_END: 1, BREAK_START: 2, OUT: 3 };

/** Replays punches through a small state machine, ignoring impossible transitions. */
export function buildSessions(punches: PunchInput[]): { sessions: Session[]; flags: string[] } {
  const sorted = [...punches].sort((a, b) => a.ts - b.ts || ORDER[a.type] - ORDER[b.type]);
  const sessions: Session[] = [];
  const flags: string[] = [];
  let cur: Session | null = null;

  for (const p of sorted) {
    const onBreak = cur && cur.breaks.length > 0 && cur.breaks[cur.breaks.length - 1].end === null;
    switch (p.type) {
      case "IN":
        if (cur) flags.push("DUPLICATE_IN");
        else cur = { start: p.ts, end: null, breaks: [] };
        break;
      case "BREAK_START":
        if (!cur || onBreak) flags.push("INVALID_BREAK");
        else cur.breaks.push({ start: p.ts, end: null });
        break;
      case "BREAK_END":
        if (!cur || !onBreak) flags.push("INVALID_BREAK");
        else cur.breaks[cur.breaks.length - 1].end = p.ts;
        break;
      case "OUT":
        if (!cur) {
          flags.push("ORPHAN_OUT");
          break;
        }
        if (onBreak) cur.breaks[cur.breaks.length - 1].end = p.ts;
        cur.end = p.ts;
        sessions.push(cur);
        cur = null;
        break;
    }
  }
  if (cur) sessions.push(cur);
  return { sessions, flags: [...new Set(flags)] };
}

const minutes = (a: number, b: number) => Math.max(0, (b - a) / 60000);

/** Minutes of [start, end] covered by the union of the given intervals. */
function coveredMinutes(start: number, end: number, intervals: [number, number][]): number {
  const clipped = intervals
    .map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const iv of clipped) {
    if (cur && iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1]);
    else {
      if (cur) total += minutes(cur[0], cur[1]);
      cur = [iv[0], iv[1]];
    }
  }
  if (cur) total += minutes(cur[0], cur[1]);
  return total;
}

export function computeDay(input: DayInput): DayResult {
  const { date, today, now, tz, shift } = input;
  const isToday = date === today;
  const isFuture = date > today;
  const workingDay = shift.working_days.includes(dayOfWeek(date));
  const leaveHalf = !!input.leave?.half;
  const leaveFull = !!input.leave && !leaveHalf;

  const { sessions, flags } = buildSessions(input.punches);

  const base: DayResult = {
    date,
    status: "ABSENT",
    late: false,
    lateMin: 0,
    earlyMin: 0,
    overtimeMin: 0,
    workedMin: 0,
    breakMin: 0,
    firstIn: sessions[0]?.start ?? null,
    lastOut: null,
    sessions,
    flags,
    leaveHalf,
  };

  // Days before the joining date are never counted as absent.
  if (input.joinedOn && date < input.joinedOn && sessions.length === 0) return { ...base, status: "NOT_JOINED" };

  // Approved full-day leave, and the employee did not work: the day is leave.
  // If they did punch, the real work counts (flagged), so the clock and check-out still behave.
  if (leaveFull && sessions.length === 0) return { ...base, status: "ON_LEAVE" };
  if (leaveFull) base.flags.push("PUNCHED_ON_LEAVE");

  if (sessions.length === 0) {
    if (input.holiday) return { ...base, status: "HOLIDAY" };
    if (!workingDay) return { ...base, status: "WEEKEND" };
    if (isFuture) return { ...base, status: leaveHalf ? "ON_LEAVE" : "UPCOMING" };
    if (leaveHalf) return { ...base, status: "ON_LEAVE" };
    if (isToday && localMinutes(now, tz) < hhmmToMinutes(shift.end_time)) return { ...base, status: "NOT_STARTED" };
    return { ...base, status: "ABSENT" };
  }

  // Fixed company break (e.g. 13:15–14:15) is deducted automatically, merged with any manual breaks.
  const fixedBreak: [number, number] | null =
    shift.break_start && shift.break_end && shift.break_end > shift.break_start
      ? [zonedToUtc(date, shift.break_start, tz), zonedToUtc(date, shift.break_end, tz)]
      : null;

  // Durations. A still-open session counts up to "now" only on the current day.
  let worked = 0;
  let brk = 0;
  let open: Session | null = null;
  for (const s of sessions) {
    const end = s.end ?? (isToday ? now : null);
    if (end === null) {
      open = s;
      continue;
    }
    if (s.end === null) open = s;
    const ivs: [number, number][] = s.breaks.map((x) => [x.start, x.end ?? end]);
    if (fixedBreak) ivs.push(fixedBreak);
    const b = coveredMinutes(s.start, end, ivs);
    brk += b;
    worked += Math.max(0, minutes(s.start, end) - b);
  }

  const last = sessions[sessions.length - 1];
  const lastOut = last.end;
  const firstInMin = localMinutes(sessions[0].start, tz);
  const startMin = hhmmToMinutes(shift.start_time);
  const endMin = hhmmToMinutes(shift.end_time);
  const breakStartMin = shift.break_start ? hhmmToMinutes(shift.break_start) : endMin;
  const offDay = !workingDay || !!input.holiday;

  const res: DayResult = { ...base, workedMin: Math.round(worked), breakMin: Math.round(brk), lastOut };

  // Late arrival. Half-day leave is always the afternoon, so mornings still count for lateness.
  if (!offDay && firstInMin > startMin + shift.grace_minutes) {
    res.late = true;
    res.lateMin = Math.round(firstInMin - startMin);
  }

  if (open) {
    if (isToday) {
      const onBreak = open.breaks.some((b) => b.end === null) || (!!fixedBreak && now >= fixedBreak[0] && now < fixedBreak[1]);
      return { ...res, status: onBreak ? "ON_BREAK" : "WORKING" };
    }
    res.flags.push("MISSING_CHECKOUT");
    return { ...res, status: "INCOMPLETE" };
  }

  if (!offDay && lastOut !== null) {
    const outMin = localMinutes(lastOut, tz);
    // With half-day leave the working day ends when the break starts.
    const dayEnd = leaveHalf ? breakStartMin : endMin;
    if (outMin < dayEnd) res.earlyMin = Math.round(dayEnd - outMin);
  }
  // Company policy: late sitting is recorded but never counted as overtime.
  res.overtimeMin = 0;
  if (offDay) res.flags.push("WORKED_ON_OFF_DAY");

  if (offDay) res.status = "PRESENT";
  else if (leaveHalf) res.status = worked >= shift.half_day_minutes ? "PRESENT" : "ABSENT";
  else if (worked >= shift.full_day_minutes) res.status = "PRESENT";
  else if (worked >= shift.half_day_minutes) res.status = "HALF_DAY";
  else res.status = "ABSENT";
  if (res.status === "ABSENT") res.flags.push("INSUFFICIENT_HOURS");
  return res;
}

/** Monday (YYYY-MM-DD) of the week containing `date`. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

export interface WeeklyLate {
  weekStart: string;
  lateMin: number;
  lateDays: number;
  exceeded: boolean;
}

/** Sums late minutes per Monday–Sunday week and marks weeks over the allowance. */
export function weeklyLate(days: DayResult[], allowanceMin: number): WeeklyLate[] {
  const m = new Map<string, WeeklyLate>();
  for (const d of days) {
    const k = weekStart(d.date);
    const w = m.get(k) ?? { weekStart: k, lateMin: 0, lateDays: 0, exceeded: false };
    if (d.late) {
      w.lateMin += d.lateMin;
      w.lateDays++;
    }
    w.exceeded = w.lateMin > allowanceMin;
    m.set(k, w);
  }
  return [...m.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface Summary {
  days: number;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  late: number;
  incomplete: number;
  workedMin: number;
  overtimeMin: number;
  lateMin: number;
  attendanceRate: number; // 0..100 over counted working days
  punctualityRate: number; // on-time share of attended days
}

export function summarize(days: DayResult[]): Summary {
  const s: Summary = {
    days: 0,
    present: 0,
    halfDay: 0,
    absent: 0,
    leave: 0,
    late: 0,
    incomplete: 0,
    workedMin: 0,
    overtimeMin: 0,
    lateMin: 0,
    attendanceRate: 0,
    punctualityRate: 0,
  };
  for (const d of days) {
    s.workedMin += d.workedMin;
    s.overtimeMin += d.overtimeMin;
    if (d.late) {
      s.late++;
      s.lateMin += d.lateMin;
    }
    switch (d.status) {
      case "PRESENT":
      case "WORKING":
      case "ON_BREAK":
        s.present++;
        s.days++;
        break;
      case "HALF_DAY":
        s.halfDay++;
        s.days++;
        break;
      case "ABSENT":
        s.absent++;
        s.days++;
        break;
      case "INCOMPLETE":
        s.incomplete++;
        s.days++;
        break;
      case "ON_LEAVE":
        s.leave++;
        s.days++;
        break;
    }
  }
  const attended = s.present + s.halfDay + s.incomplete;
  const counted = s.days - s.leave;
  s.attendanceRate = counted > 0 ? Math.round(((s.present + s.halfDay * 0.5 + s.incomplete) / counted) * 1000) / 10 : 0;
  s.punctualityRate = attended > 0 ? Math.round(((attended - s.late) / attended) * 1000) / 10 : 0;
  return s;
}
