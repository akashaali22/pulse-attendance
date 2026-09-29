import { DataTable } from "@/components/data-table";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, CalendarRange, ChevronLeft, ChevronRight, FileClock, Laptop, Mail, Phone, Plane, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { computeRange, getTz, leaveBalances, todayLocal } from "@/lib/data";
import { summarize, weekStart, weeklyLate } from "@/lib/engine";
import { lateAllowance, penaltiesFor } from "@/lib/penalty";
import { reliabilityScore, signalsFor } from "@/lib/insights";
import { fmtDuration, fmtTime, localMinutes, minutesToHhmm, monthBounds } from "@/lib/time";
import { getPrefs } from "@/lib/prefs";
import { shiftLabel } from "@/lib/view";
import { passwordViewEnabled } from "@/lib/passwords";
import { Avatar, Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { PasswordCell, SetPasswordButton } from "../password-cell";
import { EmployeeCalendar, type DayCell, type MonthPoint } from "./profile-view";

export const metadata: Metadata = { title: "Employee" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const me = await requireUser(["admin", "manager"]);
  const { t } = await getPrefs();
  const tz = getTz();
  const today = todayLocal();
  const { id } = await params;
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const year = month.slice(0, 4);

  const emp = get<{
    id: number;
    emp_code: string;
    name: string;
    email: string;
    role: string;
    phone: string | null;
    designation: string | null;
    joined_on: string | null;
    status: string;
    shift_id: number | null;
    manager_id: number | null;
    department: string | null;
    manager: string | null;
    password_set_by: string | null;
    password_changed_at: number | null;
  }>(
    `SELECT u.id, u.emp_code, u.name, u.email, u.role, u.phone, u.designation, u.joined_on, u.status, u.shift_id, u.manager_id,
            u.password_set_by, u.password_changed_at, d.name AS department, m.name AS manager
     FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
     WHERE u.id = ?`,
    Number(id),
  );
  // Managers see their own reports only; everything else is the admin's.
  if (!emp || (me.role !== "admin" && emp.manager_id !== me.id && emp.id !== me.id)) notFound();

  // ── the chosen month, day by day ──
  const { from, to } = monthBounds(month);
  const days = computeRange([emp], from, to).get(emp.id)!;
  const past = days.filter((d) => d.date <= today);
  const s = summarize(past.filter((d) => d.status !== "NOT_STARTED"));
  const cells: DayCell[] = days.map((d) => ({
    date: d.date,
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`)),
    status: d.status,
    late: d.late,
    lateMin: d.lateMin,
    earlyMin: d.earlyMin,
    worked: d.workedMin ? fmtDuration(d.workedMin) : "—",
    workedMin: d.workedMin,
    breakLabel: d.breakMin ? fmtDuration(d.breakMin) : "—",
    firstIn: fmtTime(d.firstIn, tz),
    inT: d.firstIn ? minutesToHhmm(localMinutes(d.firstIn, tz)) : "",
    outT: d.lastOut && d.status !== "WORKING" && d.status !== "ON_BREAK" ? minutesToHhmm(localMinutes(d.lastOut, tz)) : "",
    lastOut: d.status === "WORKING" || d.status === "ON_BREAK" ? "—" : fmtTime(d.lastOut, tz),
    flags: d.flags,
    sessions: d.sessions.map((x) => ({
      in: fmtTime(x.start, tz),
      out: x.end ? fmtTime(x.end, tz) : "—",
      breaks: x.breaks.map((b) => ({ start: fmtTime(b.start, tz), end: b.end ? fmtTime(b.end, tz) : "—" })),
    })),
  }));

  // ── the whole year, month by month ──
  // A day with no punches counts as ABSENT, which is right for a working employee but wrong for
  // the months before this company started recording anything: it would paint a full red year and
  // report hundreds of absences that never happened. So the year starts at the first day the
  // employee actually has a record (or their joining date, whichever comes first).
  const firstPunch = get<{ d: string }>("SELECT MIN(work_date) AS d FROM punches WHERE user_id = ?", emp.id)?.d ?? null;
  // The first punch, not the joining date: someone can be on the books for years before this
  // system recorded anything for them, and those months are not absences.
  const recordsFrom = firstPunch ?? emp.joined_on;
  const yearFrom = recordsFrom && recordsFrom > `${year}-01-01` ? recordsFrom : `${year}-01-01`;
  const yearTo = `${year}-12-31` < today ? `${year}-12-31` : today;
  const counted = recordsFrom !== null && yearFrom <= yearTo;
  const yearDays = counted ? computeRange([emp], yearFrom, yearTo).get(emp.id)! : [];
  const months: MonthPoint[] = MONTHS.map((label, i) => {
    const key = `${year}-${pad(i + 1)}`;
    const ms = summarize(yearDays.filter((d) => d.date.startsWith(key) && d.status !== "NOT_STARTED"));
    return { month: key, label, present: ms.present - ms.late, late: ms.late, halfDay: ms.halfDay, absent: ms.absent, leave: ms.leave };
  });
  const yearSummary = summarize(yearDays.filter((d) => d.status !== "NOT_STARTED"));
  const yearNote = counted && yearFrom > `${year}-01-01` ? yearFrom : null;

  // ── the complete record: every year on file, not just the one being viewed ──
  const years = all<{ y: string }>(
    "SELECT DISTINCT substr(work_date, 1, 4) AS y FROM punches WHERE user_id = ? ORDER BY y DESC",
    emp.id,
  ).map((r) => r.y);
  if (!years.includes(year)) years.unshift(year);
  const lastPunch = get<{ d: string }>("SELECT MAX(work_date) AS d FROM punches WHERE user_id = ?", emp.id)?.d ?? null;

  // Lifetime is computed from the first recorded day, so it never invents absences for the
  // months before this company started recording anything.
  const lifetimeDays = recordsFrom ? computeRange([emp], recordsFrom, today).get(emp.id)!.filter((d) => d.status !== "NOT_JOINED" && d.status !== "NOT_STARTED") : [];
  const lifetime = summarize(lifetimeDays);

  // Month by month for the chosen year — the answer to "how many days did they come in June?"
  const monthRows = MONTHS.map((label, i) => {
    const key = `${year}-${pad(i + 1)}`;
    const list = yearDays.filter((d) => d.date.startsWith(key) && d.status !== "NOT_STARTED");
    const ms = summarize(list);
    const worked = list.filter((d) => d.workedMin > 0);
    return {
      key,
      label,
      recorded: list.length,
      present: ms.present,
      halfDay: ms.halfDay,
      absent: ms.absent,
      leave: ms.leave,
      late: ms.late,
      lateMin: ms.lateMin,
      workedMin: ms.workedMin,
      avgMin: worked.length ? Math.round(ms.workedMin / worked.length) : 0,
      rate: ms.attendanceRate,
    };
  }).filter((m) => m.recorded > 0);

  // What the numbers are saying, found by arithmetic rather than by anyone reading the table.
  // Their shift if they have one, otherwise the company default.
  const targetMin =
    (emp.shift_id
      ? get<{ full_day_minutes: number }>("SELECT full_day_minutes FROM shifts WHERE id = ?", emp.shift_id)?.full_day_minutes
      : null) ??
    get<{ full_day_minutes: number }>("SELECT full_day_minutes FROM shifts ORDER BY is_default DESC, id LIMIT 1")?.full_day_minutes ??
    480;
  const signals = signalsFor(lifetimeDays, { targetMin, allowanceMin: lateAllowance(), today });
  const reliability = reliabilityScore(lifetimeDays, { targetMin, allowanceMin: lateAllowance(), today });

  const leaveHistory = all<{ id: number; type: string; start_date: string; end_date: string; days: number; half_day: number; status: string; reason: string; reviewer: string | null; created_at: number }>(
    `SELECT r.id, t.name AS type, r.start_date, r.end_date, r.days, r.half_day, r.status, r.reason, u.name AS reviewer, r.created_at
     FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id LEFT JOIN users u ON u.id = r.reviewer_id
     WHERE r.user_id = ? ORDER BY r.start_date DESC LIMIT 60`,
    emp.id,
  );
  const corrections = all<{ id: number; work_date: string; check_in: string | null; check_out: string | null; reason: string; status: string; reviewer: string | null }>(
    `SELECT c.id, c.work_date, c.check_in, c.check_out, c.reason, c.status, u.name AS reviewer
     FROM regularizations c LEFT JOIN users u ON u.id = c.reviewer_id
     WHERE c.user_id = ? ORDER BY c.work_date DESC LIMIT 60`,
    emp.id,
  );

  // ── weekly lateness, penalties, leave ──
  const allowance = lateAllowance();
  const weekFrom = weekStart(from);
  const weekTo = to < today ? to : today;
  const weeks = weekFrom <= weekTo ? weeklyLate(computeRange([emp], weekFrom, weekTo).get(emp.id)!, allowance).reverse() : [];
  const penalties = penaltiesFor(emp.id);
  const balances = leaveBalances(emp.id, year);
  const devices = all<{ id: number; name: string; agent_version: string | null; last_seen: number | null; revoked: number }>(
    "SELECT id, name, agent_version, last_seen, revoked FROM devices WHERE user_id = ? ORDER BY revoked, last_seen DESC",
    emp.id,
  );

  const q = (m: string) => `/employees/${emp.id}?month=${m}`;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <>
      <PageHeader title={emp.name} subtitle={`${emp.emp_code} · ${emp.designation ?? t("Employee")}${emp.department ? ` · ${emp.department}` : ""}`}>
        <Link href="/employees" className="btn btn-ghost btn-sm">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("Employees")}
        </Link>
        <Link href={q(shiftMonth(month, -1))} className="btn btn-ghost btn-sm" aria-label="Previous month">
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </Link>
        <Link href={q(today.slice(0, 7))} className="btn btn-ghost btn-sm">{t("This month")}</Link>
        <Link href={q(shiftMonth(month, 1))} className="btn btn-ghost btn-sm" aria-label="Next month">
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Link>
        <SetPasswordButton userId={emp.id} name={emp.name} />
      </PageHeader>

      {/* who they are */}
      <Card className="mb-4">
        {/* Stacks on a phone: side by side the password block was landing on top of the email line. */}
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar name={emp.name} size="size-14 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-ink">{emp.name}</span>
              <span className="rounded-full border border-line px-2 py-0.5 text-xs capitalize text-ink-2">{emp.role}</span>
              {emp.status !== "active" && <span className="rounded-full border border-bad/30 bg-bad/10 px-2 py-0.5 text-xs text-bad">{t("Inactive")}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span className="flex items-center gap-1.5"><Mail className="size-3.5" />{emp.email}</span>
              {emp.phone && <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{emp.phone}</span>}
              <span className="flex items-center gap-1.5"><CalendarRange className="size-3.5" />{t("Shift")}: {shiftLabel(emp.shift_id)}</span>
              <span>{t("Manager")}: {emp.manager ?? "—"}</span>
              {emp.joined_on && <span>{t("Joined")}: {emp.joined_on}</span>}
            </div>
          </div>
          <div className="shrink-0 border-t border-line pt-4 sm:border-s sm:border-t-0 sm:ps-5 sm:pt-0">
            <PasswordCell userId={emp.id} setBy={emp.password_set_by} changedAt={emp.password_changed_at} enabled={passwordViewEnabled()} />
          </div>
        </div>
      </Card>

      {/* the month in numbers */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("PRESENT")} value={s.present} tone="good" sub={`${year}: ${yearSummary.present}`} />
        <StatCard label={t("HALF_DAY")} value={s.halfDay} tone="serious" sub={`${year}: ${yearSummary.halfDay}`} />
        <StatCard label={t("ABSENT")} value={s.absent} tone="bad" sub={`${year}: ${yearSummary.absent}`} />
        <StatCard label={t("Late")} value={s.late} tone="warn" sub={`${s.lateMin}m ${t("Late minutes").toLowerCase()}`} />
        <StatCard label={t("ON_LEAVE")} value={s.leave} tone="info" sub={`${year}: ${yearSummary.leave}`} />
        <StatCard label={t("Worked")} value={fmtDuration(s.workedMin)} sub={`${year}: ${fmtDuration(yearSummary.workedMin)}`} />
      </div>

      {/* What the record is saying, before anyone has to read it */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <Card title={<span className="flex items-center gap-2"><Activity className="size-4 text-accent" /> {t("Reliability")}</span>}>
          <div className="p-5">
            <div className="metric-value text-4xl">{reliability.score}<span className="text-lg text-muted">/100</span></div>
            <div className="mt-1 text-sm text-ink-2">{t(reliability.label)}</div>
            <div className="mt-3 h-1.5 rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${reliability.score >= 92 ? "bg-good" : reliability.score >= 80 ? "bg-accent" : reliability.score >= 65 ? "bg-warn" : "bg-bad"}`}
                style={{ width: `${reliability.score}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-muted">
              {t("Attendance, punctuality and complete punches across their whole record")}
              {recordsFrom ? ` · ${recordsFrom} → ${lastPunch ?? today}` : ""}
            </p>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><TriangleAlert className="size-4 text-warn" /> {t("Signals")} · {signals.length}</span>}>
          {signals.length === 0 ? (
            <div className="empty-state"><p>{t("Nothing stands out in this record.")}</p></div>
          ) : (
            <ul className="divide-y divide-line">
              {signals.map((sig) => (
                <li key={sig.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${sig.severity === "bad" ? "bg-bad" : sig.severity === "warn" ? "bg-warn" : "bg-info"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{t(sig.title)}</div>
                    <div className="text-xs text-muted">{sig.detail}</div>
                  </div>
                  {sig.metric && <span className="readout shrink-0 text-sm text-ink-2">{sig.metric}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <EmployeeCalendar cells={cells} months={months} month={month} monthLabel={monthLabel} basePath={`/employees/${emp.id}`} today={today} yearNote={yearNote} employee={{ id: emp.id, name: emp.name, canEdit: emp.id !== me.id }} />
      </div>

      {/* The record itself: every month on file for the chosen year */}
      <Card
        className="mt-4"
        title={<span className="flex items-center gap-2"><CalendarRange className="size-4 text-accent" /> {t("Month by month")} · {year}</span>}
        action={
          <div className="flex flex-wrap gap-1.5">
            {years.map((y) => (
              <Link
                key={y}
                href={`/employees/${emp.id}?month=${y}-${y === today.slice(0, 4) ? today.slice(5, 7) : "01"}`}
                className={`btn btn-sm ${y === year ? "btn-primary" : "btn-ghost"}`}
              >
                {y}
              </Link>
            ))}
          </div>
        }
      >
        {monthRows.length === 0 ? (
          <div className="empty-state"><p>{t("No records")}</p></div>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("Month")}</th>
                  <th>{t("PRESENT")}</th>
                  <th>{t("HALF_DAY")}</th>
                  <th>{t("ON_LEAVE")}</th>
                  <th>{t("ABSENT")}</th>
                  <th>{t("Late")}</th>
                  <th>{t("Worked")}</th>
                  <th>{t("Average day")}</th>
                  <th>{t("Attendance rate")}</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((m) => (
                  <tr key={m.key}>
                    <td className="whitespace-nowrap font-medium text-ink">
                      <Link href={`/employees/${emp.id}?month=${m.key}`} className={m.key === month ? "text-accent" : "hover:underline"}>
                        {m.label} {year}
                      </Link>
                      <div className="text-xs text-muted">{m.recorded} {t("days recorded")}</div>
                    </td>
                    <td className="tabular text-good">{m.present}</td>
                    <td className="tabular">{m.halfDay || "—"}</td>
                    <td className="tabular">{m.leave || "—"}</td>
                    <td className={m.absent ? "tabular text-bad" : "tabular"}>{m.absent || "—"}</td>
                    <td className={m.late ? "tabular text-warn" : "tabular"}>{m.late ? `${m.late} · ${m.lateMin}m` : "—"}</td>
                    <td className="tabular">{fmtDuration(m.workedMin)}</td>
                    <td className="tabular">{m.avgMin ? fmtDuration(m.avgMin) : "—"}</td>
                    <td className="tabular">{Math.round(m.rate)}%</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="text-ink">{t("Lifetime")}<div className="text-xs font-normal text-muted">{recordsFrom ?? "—"} → {lastPunch ?? today}</div></td>
                  <td className="tabular text-good">{lifetime.present}</td>
                  <td className="tabular">{lifetime.halfDay || "—"}</td>
                  <td className="tabular">{lifetime.leave || "—"}</td>
                  <td className="tabular">{lifetime.absent || "—"}</td>
                  <td className="tabular">{lifetime.late ? `${lifetime.late} · ${lifetime.lateMin}m` : "—"}</td>
                  <td className="tabular">{fmtDuration(lifetime.workedMin)}</td>
                  <td className="tabular">—</td>
                  <td className="tabular">{Math.round(lifetime.attendanceRate)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={`${t("Weekly late limit")} · ${allowance} min`}>
          {weeks.length === 0 ? (
            <p className="p-5 text-sm text-muted">{t("No records")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {weeks.map((w) => {
                const pen = penalties.find((x) => x.week_start === w.weekStart);
                const pct = Math.min(100, (w.lateMin / allowance) * 100);
                return (
                  <li key={w.weekStart} className="px-5 py-3">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-ink-2 tabular">{t("Week")} {w.weekStart}</span>
                      <span className={`font-semibold tabular ${w.exceeded ? "text-bad" : "text-ink"}`}>{w.lateMin} / {allowance}m</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
                      <div className={`h-full rounded-full ${w.exceeded ? "bg-bad" : pct >= 70 ? "bg-warn" : "bg-good"}`} style={{ width: `${pct}%` }} />
                    </div>
                    {pen && <div className="mt-1 text-xs text-bad">−1 {pen.leave_type} ({t("Late penalty")})</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`${t("Leave balance")} · ${year}`}>
          <ul className="divide-y divide-line">
            {balances.map((b) => (
              <li key={b.code} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-ink-2">{b.name}</span>
                <span className="tabular text-ink">
                  {b.remaining} <span className="text-xs text-muted">/ {b.quota} {t("days")}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Laptop className="size-4 text-accent" /> {t("Linked PCs")}</span>}>
          {devices.length === 0 ? (
            <p className="p-5 text-sm text-muted">{t("No records")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {devices.map((d) => (
                <li key={d.id} className={`px-5 py-3 text-sm ${d.revoked ? "opacity-50" : ""}`}>
                  <div className="font-medium text-ink">{d.name}</div>
                  <div className="text-xs text-muted">
                    {d.agent_version ? `v${d.agent_version}` : "—"}
                    {d.last_seen ? ` · ${new Date(d.last_seen).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                    {d.revoked ? ` · ${"unlinked"}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* The paper trail: every leave request and every correction, not just the pending ones */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Plane className="size-4 text-accent" /> {t("Leave history")} · {leaveHistory.length}</span>}>
          {leaveHistory.length === 0 ? (
            <div className="empty-state"><p>{t("No records")}</p></div>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("Leave type")}</th>
                    <th>{t("From")}</th>
                    <th>{t("To")}</th>
                    <th>{t("Days")}</th>
                    <th>{t("Status")}</th>
                    <th>{t("Reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveHistory.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap text-ink">{l.type}{l.half_day ? <span className="ms-1 text-xs text-muted">· {t("Half day")}</span> : null}</td>
                      <td className="tabular">{l.start_date}</td>
                      <td className="tabular">{l.end_date}</td>
                      <td className="tabular">{l.days}</td>
                      <td><span className={`text-xs ${l.status === "approved" ? "text-good" : l.status === "rejected" ? "text-bad" : l.status === "pending" ? "text-warn" : "text-muted"}`}>{t(l.status)}</span>{l.reviewer ? <div className="text-[11px] text-muted">{l.reviewer}</div> : null}</td>
                      <td className="max-w-56 truncate text-xs text-muted" title={l.reason}>{l.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><FileClock className="size-4 text-accent" /> {t("Correction history")} · {corrections.length}</span>}>
          {corrections.length === 0 ? (
            <div className="empty-state"><p>{t("No records")}</p></div>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("Date")}</th>
                    <th>{t("Check-in time")}</th>
                    <th>{t("Check-out time")}</th>
                    <th>{t("Status")}</th>
                    <th>{t("Reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap tabular text-ink">{c.work_date}</td>
                      <td className="tabular">{c.check_in ?? "—"}</td>
                      <td className="tabular">{c.check_out ?? "—"}</td>
                      <td><span className={`text-xs ${c.status === "approved" ? "text-good" : c.status === "rejected" ? "text-bad" : c.status === "pending" ? "text-warn" : "text-muted"}`}>{t(c.status)}</span>{c.reviewer ? <div className="text-[11px] text-muted">{c.reviewer}</div> : null}</td>
                      <td className="max-w-56 truncate text-xs text-muted" title={c.reason}>{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* every day of the month */}
      <Card className="mt-4" title={monthLabel}>
        <DataTable>
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
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Card>
    </>
  );
}
