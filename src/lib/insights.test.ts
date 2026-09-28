import { describe, expect, it } from "vitest";
import type { DayResult, DayStatus } from "./engine";
import { reliabilityScore, signalsFor, type SignalContext } from "./insights";

const CTX: SignalContext = { targetMin: 480, allowanceMin: 90, today: "2026-09-28" };

/** A day, described only by what a signal cares about. */
function day(date: string, status: DayStatus, over: Partial<DayResult> = {}): DayResult {
  return {
    date,
    status,
    late: false,
    lateMin: 0,
    earlyMin: 0,
    overtimeMin: 0,
    workedMin: status === "PRESENT" ? 480 : 0,
    breakMin: 60,
    firstIn: null,
    lastOut: null,
    sessions: [],
    flags: [],
    leaveHalf: false,
    ...over,
  };
}

/** N working days ending on `end`, weekends skipped, newest last. */
function run(count: number, end: string, make: (i: number, date: string) => DayResult): DayResult[] {
  const out: DayResult[] = [];
  const d = new Date(`${end}T00:00:00Z`);
  while (out.length < count) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(make(count - out.length - 1, iso));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe("signalsFor", () => {
  it("says nothing about a steady record", () => {
    const days = run(40, "2026-09-28", (_, date) => day(date, "PRESENT"));
    expect(signalsFor(days, CTX)).toEqual([]);
  });

  it("flags lateness that is getting worse, not lateness that is merely present", () => {
    const steady = run(40, "2026-09-28", (i, date) => day(date, "PRESENT", { late: i % 10 === 0, lateMin: i % 10 === 0 ? 5 : 0 }));
    expect(ids(signalsFor(steady, CTX))).not.toContain("LATE_TREND");

    const worsening = run(40, "2026-09-28", (i, date) => {
      const late = i >= 26; // only the last fortnight
      return day(date, "PRESENT", { late, lateMin: late ? 12 : 0 });
    });
    const s = signalsFor(worsening, CTX).find((x) => x.id === "LATE_TREND");
    expect(s?.severity).toBe("bad");
  });

  it("warns before the weekly allowance is spent, not after", () => {
    const days = run(20, "2026-09-28", (i, date) => day(date, "PRESENT", { late: i >= 15, lateMin: i >= 15 ? 14 : 0 }));
    const s = signalsFor(days, CTX).find((x) => x.id === "ALLOWANCE_RISK");
    expect(s).toBeTruthy();
    expect(s?.metric).toBe("78%");

    // once it is spent, the penalty has already been applied elsewhere, so this stops nagging
    const spent = run(20, "2026-09-28", (i, date) => day(date, "PRESENT", { late: i >= 15, lateMin: i >= 15 ? 30 : 0 }));
    expect(ids(signalsFor(spent, CTX))).not.toContain("ALLOWANCE_RISK");
  });

  it("calls out unreliable data when check-outs are missing", () => {
    const days = run(30, "2026-09-28", (i, date) =>
      day(date, "PRESENT", { flags: i % 7 === 0 ? ["MISSING_CHECKOUT"] : [] }),
    );
    const s = signalsFor(days, CTX).find((x) => x.id === "MISSING_CHECKOUT");
    expect(s?.detail).toContain("estimates");
  });

  it("measures short days against the shift", () => {
    const days = run(20, "2026-09-28", (_, date) => day(date, "PRESENT", { workedMin: 300 }));
    const s = signalsFor(days, CTX).find((x) => x.id === "SHORT_DAYS");
    expect(s?.severity).toBe("bad");
    expect(s?.metric).toBe("63%");
  });

  it("treats sustained overwork as a signal of its own", () => {
    const days = run(20, "2026-09-28", (i, date) => day(date, "PRESENT", { workedMin: i >= 14 ? 650 : 480 }));
    expect(ids(signalsFor(days, CTX))).toContain("OVERWORK");
  });

  it("finds an unexplained absence run", () => {
    const days = run(20, "2026-09-28", (i, date) => day(date, i >= 17 ? "ABSENT" : "PRESENT"));
    const s = signalsFor(days, CTX).find((x) => x.id === "ABSENCE_STREAK");
    expect(s?.metric).toBe("3 days");
    expect(s?.severity).toBe("bad");
  });

  it("compares attendance with the person's own earlier record", () => {
    const days = run(40, "2026-09-28", (i, date) => day(date, i >= 20 && i % 3 === 0 ? "ABSENT" : "PRESENT"));
    expect(ids(signalsFor(days, CTX))).toContain("ATTENDANCE_DROP");
  });

  it("ignores leave, holidays and weekends when judging attendance", () => {
    const days = run(30, "2026-09-28", (i, date) => day(date, i >= 20 ? "ON_LEAVE" : "PRESENT"));
    expect(signalsFor(days, CTX)).toEqual([]);
  });

  it("puts the worst thing first", () => {
    const days = run(40, "2026-09-28", (i, date) =>
      day(date, i >= 38 ? "ABSENT" : "PRESENT", { flags: i % 9 === 0 ? ["MISSING_CHECKOUT"] : [] }),
    );
    const rank = { bad: 0, warn: 1, info: 2 } as const;
    const order = signalsFor(days, CTX).map((x) => rank[x.severity]);
    expect(order.length).toBeGreaterThan(1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("reliabilityScore", () => {
  it("is 100 for a perfect record and drops with each kind of problem", () => {
    const perfect = run(20, "2026-09-28", (_, date) => day(date, "PRESENT"));
    expect(reliabilityScore(perfect, CTX)).toEqual({ score: 100, label: "Excellent" });

    const late = run(20, "2026-09-28", (i, date) => day(date, "PRESENT", { late: i % 2 === 0 }));
    expect(reliabilityScore(late, CTX).score).toBe(85);

    const absent = run(20, "2026-09-28", (i, date) => day(date, i % 2 === 0 ? "ABSENT" : "PRESENT"));
    expect(reliabilityScore(absent, CTX).label).toBe("Needs attention");
  });

  it("says so plainly when there is nothing to score", () => {
    expect(reliabilityScore([], CTX)).toEqual({ score: 0, label: "No record yet" });
  });
});
