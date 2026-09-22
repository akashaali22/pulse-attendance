import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, FilePen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { computeRange, getTz, todayLocal } from "@/lib/data";
import { summarize, weekStart, weeklyLate } from "@/lib/engine";
import { lateAllowance, penaltiesFor } from "@/lib/penalty";
import { fmtDuration, fmtTime, monthBounds } from "@/lib/time";
import { getPrefs } from "@/lib/prefs";
import { toHeat } from "@/lib/view";
import { MonthHeatmap } from "@/components/charts";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { get } from "@/lib/db";

export const metadata: Metadata = { title: "My Attendance" };

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string; user?: string }> }) {
  const me = await requireUser();
  const { t } = await getPrefs();
  const tz = getTz();
  const today = todayLocal();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);

  // Managers can open an employee's calendar via ?user=
  let subject: { id: number; name: string; shift_id: number | null } = me;
  if (sp.user && Number(sp.user) !== me.id && me.role !== "employee") {
    const target = get<{ id: number; name: string; shift_id: number | null; manager_id: number | null }>(
      "SELECT id, name, shift_id, manager_id FROM users WHERE id = ?",
      Number(sp.user),
    );
    if (target && (me.role === "admin" || target.manager_id === me.id)) subject = target;
  }

  const { from, to } = monthBounds(month);
  const days = computeRange([subject], from, to).get(subject.id)!;
  const past = days.filter((d) => d.date <= today);
  const s = summarize(past.filter((d) => d.status !== "NOT_STARTED"));
  const allowance = lateAllowance();
  const weekFrom = weekStart(from);
  const weekTo = to < today ? to : today;
  const weeks = weekFrom <= weekTo ? weeklyLate(computeRange([subject], weekFrom, weekTo).get(subject.id)!, allowance).reverse() : [];
  const penalties = penaltiesFor(subject.id);
  const q = (m: string) => `/attendance?month=${m}${subject.id !== me.id ? `&user=${subject.id}` : ""}`;
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <>
      <PageHeader title={subject.id === me.id ? t("My Attendance") : subject.name} subtitle={label}>
        <Link href={q(shiftMonth(month, -1))} className="btn btn-ghost btn-sm" aria-label="Previous month">
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </Link>
        <Link href={q(today.slice(0, 7))} className="btn btn-ghost btn-sm">{t("This month")}</Link>
        <Link href={q(shiftMonth(month, 1))} className="btn btn-ghost btn-sm" aria-label="Next month">
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("PRESENT")} value={s.present} tone="good" />
        <StatCard label={t("HALF_DAY")} value={s.halfDay} tone="serious" />
        <StatCard label={t("ABSENT")} value={s.absent} tone="bad" />
        <StatCard label={t("Late")} value={s.late} tone="warn" />
        <StatCard label={t("ON_LEAVE")} value={s.leave} tone="info" />
        <StatCard label={t("Worked")} value={fmtDuration(s.workedMin)} sub={`${t("Late minutes")} ${s.lateMin}m`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card title={label}>
            <div className="p-5">
              <MonthHeatmap days={toHeat(days, tz)} />
            </div>
          </Card>
          <Card title={`${t("Weekly late limit")} · ${allowance} min`}>
            <ul className="divide-y divide-line">
              {weeks.map((w) => {
                const pen = penalties.find((x) => x.week_start === w.weekStart);
                const pct = Math.min(100, (w.lateMin / allowance) * 100);
                return (
                  <li key={w.weekStart} className="px-5 py-3">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-ink-2 tabular">{t("Week")} {w.weekStart}</span>
                      <span className={`font-semibold tabular ${w.exceeded ? "text-bad" : "text-ink"}`}>
                        {w.lateMin} / {allowance}m
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
                      <div className={`h-full rounded-full ${w.exceeded ? "bg-bad" : pct >= 70 ? "bg-warn" : "bg-good"}`} style={{ width: `${pct}%` }} />
                    </div>
                    {pen && <div className="mt-1 text-xs text-bad">−1 {pen.leave_type} ({t("Late penalty")})</div>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
        <Card>
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("Date")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("First in")}</th>
                  <th>{t("Last out")}</th>
                  <th>{t("Worked")}</th>
                  <th>{t("Break")}</th>
                  <th>{t("Late")}</th>
                  <th>{t("Early leave")}</th>
                  {subject.id === me.id && <th />}
                </tr>
              </thead>
              <tbody>
                {[...past].reverse().map((d) => (
                  <tr key={d.date}>
                    <td className="whitespace-nowrap font-medium text-ink tabular">
                      {d.date}
                      <span className="ms-2 text-xs text-muted">
                        {new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`))}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={d.status} label={t(d.status)} />
                      {d.flags.includes("MISSING_CHECKOUT") && <span className="ms-2 text-[11px] text-warn">no check-out</span>}
                    </td>
                    <td className="tabular">{fmtTime(d.firstIn, tz)}</td>
                    <td className="tabular">{d.status === "WORKING" || d.status === "ON_BREAK" ? "—" : fmtTime(d.lastOut, tz)}</td>
                    <td className="tabular">{d.workedMin ? fmtDuration(d.workedMin) : "—"}</td>
                    <td className="tabular">{d.breakMin ? fmtDuration(d.breakMin) : "—"}</td>
                    <td className={d.late ? "text-warn tabular" : "tabular"}>{d.late ? `${d.lateMin}m` : "—"}</td>
                    <td className="tabular">{d.earlyMin ? `${d.earlyMin}m` : "—"}</td>
                    {subject.id === me.id && (
                      <td>
                        {["ABSENT", "INCOMPLETE", "HALF_DAY", "PRESENT"].includes(d.status) && (
                          <Link href={`/corrections?date=${d.date}#apply`} className="inline-flex items-center gap-1 text-xs text-accent" title={t("Request correction")}>
                            <FilePen className="size-3.5" />
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
