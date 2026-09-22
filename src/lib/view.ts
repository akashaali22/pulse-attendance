import "server-only";
import type { DayResult } from "./engine";
import type { ClockState } from "@/components/clock-card";
import type { HeatDay } from "@/components/charts";
import { fmtDuration, fmtTime, zonedToUtc } from "./time";
import { get } from "./db";

interface ShiftTimes {
  name: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

function shiftFor(shiftId: number | null): ShiftTimes | undefined {
  return get<ShiftTimes>(
    `SELECT name, start_time, end_time, break_start, break_end FROM shifts WHERE id = ?
     UNION ALL SELECT name, start_time, end_time, break_start, break_end FROM (SELECT * FROM shifts ORDER BY is_default DESC, id LIMIT 1)
     LIMIT 1`,
    shiftId ?? -1,
  );
}

export function toClockState(d: DayResult, tz: string, shiftId: number | null): ClockState {
  const s = shiftFor(shiftId);
  const open = d.status === "WORKING" || d.status === "ON_BREAK";
  const openSession = d.sessions.find((x) => x.end === null);
  return {
    status: d.status,
    workedMin: d.workedMin,
    breakMin: d.breakMin,
    firstIn: fmtTime(d.firstIn, tz),
    lastOut: open ? "—" : fmtTime(d.lastOut, tz),
    late: d.late,
    lateMin: d.lateMin,
    renderedAt: Date.now(),
    manualBreak: !!openSession?.breaks.some((b) => b.end === null),
    breakStartTs: s?.break_start ? zonedToUtc(d.date, s.break_start, tz) : null,
    breakEndTs: s?.break_end ? zonedToUtc(d.date, s.break_end, tz) : null,
  };
}

export function toHeat(days: DayResult[], tz: string): HeatDay[] {
  return days.map((d) => ({
    date: d.date,
    status: d.status,
    late: d.late,
    worked: fmtDuration(d.workedMin),
    inOut: d.firstIn ? `${fmtTime(d.firstIn, tz)} → ${fmtTime(d.lastOut, tz)}` : "",
  }));
}

const to12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
};

export function shiftLabel(shiftId: number | null): string {
  const s = shiftFor(shiftId);
  if (!s) return "9:00 – 6:00";
  return `${to12(s.start_time)} – ${to12(s.end_time)}${s.break_start && s.break_end ? ` · Break ${to12(s.break_start)}–${to12(s.break_end)}` : ""}`;
}
