import { describe, expect, it } from "vitest";
import { computeDay, DEFAULT_SHIFT, summarize, weekStart, weeklyLate, type PunchInput } from "./engine";
import { localDate, zonedToUtc } from "./time";

// Company policy under test: 09:00–18:00, fixed break 13:15–14:15, no grace (weekly 90-minute allowance),
// half-day leave = afternoon after the break, no overtime.
const TZ = "Asia/Karachi"; // UTC+5
const D = "2026-09-07"; // Monday
const at = (hhmm: string, date = D) => zonedToUtc(date, hhmm, TZ);
const p = (type: PunchInput["type"], hhmm: string, date = D): PunchInput => ({ type, ts: at(hhmm, date) });
const pastDay = { date: D, today: "2026-09-10", now: at("12:00", "2026-09-10"), tz: TZ, shift: DEFAULT_SHIFT };

describe("time helpers", () => {
  it("converts local wall-clock to UTC and back", () => {
    expect(new Date(at("09:00")).toISOString()).toBe("2026-09-07T04:00:00.000Z");
    expect(localDate(at("23:30"), TZ)).toBe(D);
  });
});

describe("computeDay", () => {
  it("full day is PRESENT, fixed break deducted, no overtime for late sitting", () => {
    const r = computeDay({ ...pastDay, punches: [p("IN", "08:55"), p("OUT", "19:30")] });
    expect(r.status).toBe("PRESENT");
    expect(r.late).toBe(false);
    expect(r.breakMin).toBe(60);
    expect(r.workedMin).toBe(635 - 60);
    expect(r.overtimeMin).toBe(0);
  });

  it("any minute after 09:00 counts as late, in local time", () => {
    expect(computeDay({ ...pastDay, punches: [p("IN", "09:00"), p("OUT", "18:00")] }).late).toBe(false);
    const late = computeDay({ ...pastDay, punches: [p("IN", "09:40"), p("OUT", "18:00")] });
    expect(late.late).toBe(true);
    expect(late.lateMin).toBe(40);
  });

  it("merges manual breaks with the fixed break and supports split sessions", () => {
    const r = computeDay({
      ...pastDay,
      punches: [p("IN", "09:00"), p("BREAK_START", "13:00"), p("BREAK_END", "14:00"), p("OUT", "15:00"), p("IN", "16:00"), p("OUT", "19:00")],
    });
    expect(r.sessions).toHaveLength(2);
    expect(r.breakMin).toBe(75); // 13:00–14:15 union
    expect(r.workedMin).toBe(285 + 180);
    expect(r.status).toBe("HALF_DAY");
  });

  it("classifies half day and short days", () => {
    expect(computeDay({ ...pastDay, punches: [p("IN", "09:00"), p("OUT", "14:00")] }).status).toBe("HALF_DAY");
    const short = computeDay({ ...pastDay, punches: [p("IN", "09:00"), p("OUT", "11:00")] });
    expect(short.status).toBe("ABSENT");
    expect(short.flags).toContain("INSUFFICIENT_HOURS");
  });

  it("flags missing checkout on past days", () => {
    const r = computeDay({ ...pastDay, punches: [p("IN", "09:00")] });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.flags).toContain("MISSING_CHECKOUT");
  });

  it("counts live time for today and is automatically on break 13:15–14:15", () => {
    const today = { date: D, today: D, tz: TZ, shift: DEFAULT_SHIFT };
    const working = computeDay({ ...today, now: at("11:00"), punches: [p("IN", "09:00")] });
    expect(working.status).toBe("WORKING");
    expect(working.workedMin).toBe(120);
    const lunch = computeDay({ ...today, now: at("13:45"), punches: [p("IN", "09:00")] });
    expect(lunch.status).toBe("ON_BREAK");
    expect(lunch.workedMin).toBe(255);
    const after = computeDay({ ...today, now: at("15:15"), punches: [p("IN", "09:00")] });
    expect(after.status).toBe("WORKING");
    expect(after.workedMin).toBe(315);
    expect(computeDay({ ...today, now: at("11:00"), punches: [] }).status).toBe("NOT_STARTED");
  });

  it("does not mark days before joining as absent", () => {
    const r = computeDay({ ...pastDay, punches: [], joinedOn: "2026-09-08" });
    expect(r.status).toBe("NOT_JOINED");
    expect(summarize([r]).absent).toBe(0);
  });

  it("applies leave, holiday and weekend precedence", () => {
    expect(computeDay({ ...pastDay, punches: [], leave: { half: false } }).status).toBe("ON_LEAVE");
    expect(computeDay({ ...pastDay, punches: [], holiday: true }).status).toBe("HOLIDAY");
    expect(computeDay({ ...pastDay, date: "2026-09-06", punches: [] }).status).toBe("WEEKEND");
    expect(computeDay({ ...pastDay, punches: [] }).status).toBe("ABSENT");
  });

  it("working during approved leave counts as worked, and is flagged", () => {
    const today = { date: D, today: D, now: at("11:00"), tz: TZ, shift: DEFAULT_SHIFT, leave: { half: false } };
    const working = computeDay({ ...today, punches: [p("IN", "09:00")] });
    expect(working.status).toBe("WORKING");
    expect(working.flags).toContain("PUNCHED_ON_LEAVE");
    const done = computeDay({ ...pastDay, leave: { half: false }, punches: [p("IN", "09:00"), p("OUT", "18:00")] });
    expect(done.status).toBe("PRESENT");
    expect(done.workedMin).toBe(480);
  });

  it("half-day leave: morning 09:00–13:15 required, lateness still counts", () => {
    const ok = computeDay({ ...pastDay, leave: { half: true }, punches: [p("IN", "09:00"), p("OUT", "13:15")] });
    expect(ok.status).toBe("PRESENT");
    expect(ok.earlyMin).toBe(0);
    const late = computeDay({ ...pastDay, leave: { half: true }, punches: [p("IN", "09:20"), p("OUT", "13:15")] });
    expect(late.late).toBe(true);
    expect(late.lateMin).toBe(20);
    const early = computeDay({ ...pastDay, leave: { half: true }, punches: [p("IN", "09:00"), p("OUT", "12:00")] });
    expect(early.earlyMin).toBe(75);
    expect(early.status).toBe("ABSENT");
  });

  it("ignores impossible transitions", () => {
    const r = computeDay({ ...pastDay, punches: [p("OUT", "08:00"), p("IN", "09:00"), p("IN", "09:05"), p("OUT", "18:00")] });
    expect(r.flags).toEqual(expect.arrayContaining(["ORPHAN_OUT", "DUPLICATE_IN"]));
    expect(r.workedMin).toBe(480);
  });

  it("off-day work is present but never overtime", () => {
    const r = computeDay({ ...pastDay, date: "2026-09-06", punches: [p("IN", "10:00", "2026-09-06"), p("OUT", "12:00", "2026-09-06")] });
    expect(r.status).toBe("PRESENT");
    expect(r.overtimeMin).toBe(0);
  });
});

describe("weekly late allowance", () => {
  const day = (date: string, inAt: string) => computeDay({ ...pastDay, date, punches: [p("IN", inAt, date), p("OUT", "18:00", date)] });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-09-07")).toBe("2026-09-07");
    expect(weekStart("2026-09-13")).toBe("2026-09-07");
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
  });

  it("90 minutes is allowed, 91 exceeds", () => {
    const exactly = weeklyLate([day("2026-09-07", "09:30"), day("2026-09-08", "09:30"), day("2026-09-09", "09:30")], 90);
    expect(exactly[0].lateMin).toBe(90);
    expect(exactly[0].exceeded).toBe(false);
    const over = weeklyLate([day("2026-09-07", "09:30"), day("2026-09-08", "09:30"), day("2026-09-09", "09:31")], 90);
    expect(over[0].exceeded).toBe(true);
    expect(over[0].lateDays).toBe(3);
  });

  it("keeps weeks separate", () => {
    const w = weeklyLate([day("2026-09-11", "10:00"), day("2026-09-14", "10:00")], 90);
    expect(w.map((x) => [x.weekStart, x.lateMin])).toEqual([["2026-09-07", 60], ["2026-09-14", 60]]);
  });
});

describe("summarize", () => {
  it("computes attendance and punctuality rates", () => {
    const days = [
      computeDay({ ...pastDay, punches: [p("IN", "09:00"), p("OUT", "18:00")] }),
      computeDay({ ...pastDay, punches: [p("IN", "10:00"), p("OUT", "19:00")] }),
      computeDay({ ...pastDay, punches: [] }),
      computeDay({ ...pastDay, punches: [], leave: { half: false } }),
    ];
    const s = summarize(days);
    expect(s.present).toBe(2);
    expect(s.absent).toBe(1);
    expect(s.leave).toBe(1);
    expect(s.late).toBe(1);
    expect(s.attendanceRate).toBeCloseTo(66.7, 1);
    expect(s.punctualityRate).toBe(50);
  });
});
