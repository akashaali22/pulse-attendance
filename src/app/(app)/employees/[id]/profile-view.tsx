"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, Coffee, LogIn, LogOut } from "lucide-react";
import clsx from "clsx";
import { SERIES } from "@/lib/chart-series";
import { Legend } from "@/components/charts";
import { Card, Empty, StatusBadge } from "@/components/ui";
import { usePrefs } from "@/components/providers";
import { EditDay } from "../../team/edit-day";

export interface DayCell {
  date: string;
  weekday: string;
  status: string;
  late: boolean;
  lateMin: number;
  earlyMin: number;
  worked: string;
  workedMin: number;
  breakLabel: string;
  firstIn: string;
  lastOut: string;
  inT: string;
  outT: string;
  flags: string[];
  sessions: { in: string; out: string; breaks: { start: string; end: string }[] }[];
}

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // Jan
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  leave: number;
}

const FILL: Record<string, string> = {
  PRESENT: "var(--good)",
  WORKING: "var(--good)",
  HALF_DAY: "var(--serious)",
  ABSENT: "var(--bad)",
  INCOMPLETE: "var(--warn)",
  ON_BREAK: "var(--warn)",
  ON_LEAVE: "var(--info)",
  HOLIDAY: "var(--accent)",
};

/** Twelve stacked months; clicking one opens that month's calendar. */
function YearBars({ data, month, href }: { data: MonthPoint[]; month: string; href: (m: string) => string }) {
  const { t } = usePrefs();
  const max = Math.max(1, ...data.map((d) => SERIES.reduce((s, k) => s + d[k.key], 0)));
  const ticks = [max, Math.round(max / 2), 0];
  return (
    <div className="flex gap-3 px-5 pb-8 pt-4">
      <div className="flex flex-col justify-between text-end text-[10px] text-muted tabular" style={{ height: 190 }}>
        {ticks.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
      <div className="flex flex-1 items-end gap-1.5" style={{ height: 190 }}>
        {data.map((d) => {
          const total = SERIES.reduce((s, k) => s + d[k.key], 0);
          return (
            <Link
              key={d.month}
              href={href(d.month)}
              scroll={false}
              aria-label={`${d.label}: ${total ? SERIES.map((s) => `${t(s.label)} ${d[s.key]}`).join(", ") : t("No records")}`}
              title={total ? `${d.label}: ${SERIES.map((s) => `${t(s.label)} ${d[s.key]}`).join(" · ")}` : `${d.label}: ${t("No records")}`}
              className={clsx(
                "relative flex h-full flex-1 flex-col-reverse items-center rounded-md pt-1 transition hover:bg-accent-soft",
                d.month === month && "bg-accent-soft",
              )}
            >
              <span className="absolute -bottom-6 text-[10px] text-muted">{d.label}</span>
              {total === 0 ? (
                // A month with nothing recorded gets a flat rule, so it cannot be mistaken for a bad month.
                <div className="h-px w-[70%] max-w-8 bg-line" />
              ) : (
                <div className="flex w-[70%] max-w-8 flex-col-reverse gap-[2px]" style={{ height: `${(total / max) * 100}%` }}>
                  {SERIES.map((s) =>
                    d[s.key] ? <div key={s.key} style={{ height: `${(d[s.key] / Math.max(1, total)) * 100}%`, background: s.color }} className="w-full first:rounded-t-[4px]" /> : null,
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Month calendar where a day opens its own timings next to it. */
export function EmployeeCalendar({
  cells,
  months,
  month,
  monthLabel,
  basePath,
  today,
  yearNote,
  employee,
}: {
  cells: DayCell[];
  months: MonthPoint[];
  month: string;
  monthLabel: string;
  basePath: string;
  today: string;
  employee: { id: number; name: string; canEdit: boolean };
  /** Set when the year only has records from this date on, so the chart cannot imply absences. */
  yearNote?: string | null;
}) {
  const { t } = usePrefs();
  const href = (value: string) => `${basePath}?month=${encodeURIComponent(value)}`;
  const worked = useMemo(() => cells.filter((c) => c.date <= today && c.sessions.length > 0), [cells, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const day = cells.find((c) => c.date === picked) ?? worked[worked.length - 1] ?? cells.find((c) => c.date === today) ?? cells.find((c) => c.date <= today) ?? null;

  const [y, m] = (cells[0]?.date ?? `${month}-01`).split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // weeks start Monday

  return (
    <>
      <Card title={`${monthLabel} · ${t("Calendar")}`}>
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <div>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium text-muted">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((n) => (
                <div key={n}>{t(n)}</div>
              ))}
              {Array.from({ length: lead }).map((_, i) => (
                <div key={`l${i}`} />
              ))}
              {cells.map((c) => {
                const bg = FILL[c.status];
                const on = day?.date === c.date;
                return (
                  <button
                    type="button"
                    key={c.date}
                    onClick={() => setPicked(c.date)}
                    aria-pressed={on}
                    aria-label={`${c.date}: ${t(c.status)}`}
                    className={clsx(
                      "heat-cell relative aspect-square border text-[11px] font-medium tabular",
                      bg ? "border-transparent" : "border-line text-muted",
                      on && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]",
                    )}
                    style={bg ? { background: `color-mix(in srgb, ${bg} 14%, var(--surface))`, color: bg, borderColor: `color-mix(in srgb, ${bg} 25%, transparent)` } : undefined}
                  >
                    {Number(c.date.slice(8))}
                    {c.late && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-warn" />}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">{t("Pick a day to see its timings")}</p>
          </div>

          {/* the picked day */}
          {day ? (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-semibold text-ink">
                  {day.date} <span className="text-sm font-normal text-muted">{day.weekday}</span>
                </span>
                <StatusBadge status={day.status as never} label={t(day.status)} />
                {employee.canEdit && day.date <= today && (
                  <EditDay key={`${employee.id}:${day.date}`} userId={employee.id} name={employee.name} date={day.date} inT={day.inT} outT={day.outT} label="Edit attendance" />
                )}
                {day.late && <span className="text-xs text-warn">{day.lateMin}m {t("Late").toLowerCase()}</span>}
                {day.earlyMin > 0 && <span className="text-xs text-warn">{t("Early leave")} {day.earlyMin}m</span>}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  [<LogIn key="i" className="size-3.5" />, t("First in"), day.firstIn],
                  [<LogOut key="o" className="size-3.5" />, t("Last out"), day.lastOut],
                  [<Clock key="w" className="size-3.5" />, t("Worked"), day.worked],
                  [<Coffee key="b" className="size-3.5" />, t("Break"), day.breakLabel],
                ].map(([icon, label, value]) => (
                  <div key={label as string} className="rounded-xl border border-line p-3">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">{icon}{label}</div>
                    <div className="mt-1 text-base font-semibold tabular text-ink">{value}</div>
                  </div>
                ))}
              </div>

              {day.sessions.length > 0 ? (
                <ol className="mt-4 space-y-2">
                  {day.sessions.map((s, i) => (
                    <li key={i} className="rounded-xl border border-line p-3 text-sm">
                      <div className="flex items-center gap-2 text-ink">
                        <span className="size-2 rounded-full bg-good" />
                        <span className="tabular">{s.in}</span>
                        <span className="text-muted">→</span>
                        <span className="tabular">{s.out}</span>
                        <span className="text-xs text-muted">{t("Session")} {i + 1}</span>
                      </div>
                      {s.breaks.map((b, j) => (
                        <div key={j} className="mt-1.5 flex items-center gap-2 ps-4 text-xs text-ink-2">
                          <Coffee className="size-3.5 text-warn" />
                          <span className="tabular">{b.start} → {b.end}</span>
                          <span className="text-muted">{t("Break")}</span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-muted">{t("No punches on this day")}</p>
              )}

              {day.flags.length > 0 && <p className="mt-3 text-xs text-warn">{day.flags.join(" · ")}</p>}
            </div>
          ) : (
            <Empty text={t("No records")} />
          )}
        </div>
      </Card>

      <Card
        className="mt-4"
        title={
          <span className="flex items-center gap-2">
            <CalendarDays className="size-4 text-accent" /> {month.slice(0, 4)} · {t("Month")}
          </span>
        }
        action={<Legend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />}
      >
        <YearBars data={months} month={month} href={href} />
        {yearNote && <p className="px-5 pb-4 text-xs text-muted">{t("Counted from")} {yearNote} — {t("nothing was recorded before that")}</p>}
      </Card>
    </>
  );
}
