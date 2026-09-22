import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, ArrowUpRight, CalendarCheck2, Clock3, Coffee, Palmtree, UserCheck, UserX, Users } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth";
import { computeRange, getTz, leaveBalances, listPeople, pendingApprovalsCount, todayLocal } from "@/lib/data";
import { summarize, weekStart, weeklyLate, type DayResult } from "@/lib/engine";
import { lateAllowance } from "@/lib/penalty";
import { addDays, fmtDuration, fmtTime } from "@/lib/time";
import { getPrefs } from "@/lib/prefs";
import { shiftLabel, toClockState, toHeat } from "@/lib/view";
import { ClockCard } from "@/components/clock-card";
import { Legend, MonthHeatmap, RateBars, Ring, TrendBars } from "@/components/charts";
import { SERIES, type TrendPoint } from "@/lib/chart-series";
import { Avatar, Card, Empty, PageHeader, StatCard, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const me = await requireUser();
  const { t } = await getPrefs();
  const tz = getTz();
  const today = todayLocal();
  const monthStart = today.slice(0, 8) + "01";

  // Full month so future days render as upcoming in the heatmap.
  const heat = computeRange([me], monthStart, lastDayOfMonth(today)).get(me.id)!;
  const mine = heat.filter((d) => d.date <= today);
  const todayMine = mine[mine.length - 1];
  const monthSummary = summarize(mine.filter((d) => d.date < today || d.status !== "NOT_STARTED"));
  const balances = leaveBalances(me.id, today.slice(0, 4));
  const allowance = lateAllowance();
  const ws = weekStart(today);
  const thisWeek = weeklyLate(computeRange([me], ws, today).get(me.id)!, allowance)[0] ?? { lateMin: 0, exceeded: false };
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${t(greet)}, ${me.name.split(" ")[0]}`}
        subtitle={new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 lg:row-span-2">
          <ClockCard state={toClockState(todayMine, tz, me.shift_id)} shiftLabel={shiftLabel(me.shift_id)} requireSelfie={!!me.require_selfie} />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:col-span-8 lg:grid-cols-4">
          <StatCard label={t("Attendance rate")} value={`${monthSummary.attendanceRate}%`} sub={t("This month")} icon={<CalendarCheck2 className="size-4" />} />
          <StatCard label={t("Punctuality")} value={`${monthSummary.punctualityRate}%`} sub={`${monthSummary.late} × ${t("Late")}`} icon={<AlarmClock className="size-4" />} tone="warn" />
          <StatCard label={t("Worked")} value={fmtDuration(monthSummary.workedMin)} sub={t("This month")} icon={<Clock3 className="size-4" />} tone="info" />
          <StatCard
            label={t("Late this week")}
            value={
              <span className={thisWeek.exceeded ? "text-bad" : ""}>
                {thisWeek.lateMin}
                <span className="text-base font-normal text-muted"> / {allowance}m</span>
              </span>
            }
            sub={thisWeek.exceeded ? t("Limit crossed — 1 leave deducted") : `${Math.max(0, allowance - thisWeek.lateMin)}m ${t("Remaining")}`}
            icon={<Coffee className="size-4" />}
            tone={thisWeek.exceeded ? "bad" : thisWeek.lateMin >= allowance * 0.7 ? "warn" : "good"}
          />
        </div>

        <Card title={t("This month")} className="lg:col-span-5" action={<Link href="/attendance" className="text-xs text-accent">{t("View all")}</Link>}>
          <div className="p-5">
            <MonthHeatmap days={toHeat(heat, tz)} />
          </div>
        </Card>

        <Card title={t("Leave balance")} className="lg:col-span-3" action={<Link href="/leave#apply" className="text-xs text-accent">{t("Apply for leave")}</Link>}>
          <ul className="space-y-4 p-5">
            {balances.map((b) => (
              <li key={b.id}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: b.color }} />
                    {b.name}
                  </span>
                  <span className="font-semibold tabular">{b.quota > 0 ? `${b.remaining}/${b.quota}` : "∞"}</span>
                </div>
                {b.quota > 0 && (
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(b.remaining / b.quota) * 100}%`, background: b.color }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {isManager(me) && <TeamSection />}
    </>
  );
}

function lastDayOfMonth(date: string) {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

async function TeamSection() {
  const me = await requireUser(["admin", "manager"]);
  const { t } = await getPrefs();
  const tz = getTz();
  const today = todayLocal();
  const from = addDays(today, -13);
  const people = listPeople(me).filter((p) => me.role === "admin" || p.id !== me.id);
  const range = computeRange(people, from, today);
  const pending = pendingApprovalsCount(me);

  const todays = people.map((p) => ({ p, d: range.get(p.id)!.at(-1)! }));
  const count = (f: (d: DayResult) => boolean) => todays.filter(({ d }) => f(d)).length;
  const present = count((d) => ["PRESENT", "WORKING", "ON_BREAK", "HALF_DAY"].includes(d.status) || (!!d.firstIn && d.status !== "ON_LEAVE"));
  const late = count((d) => d.late);
  const onLeave = count((d) => d.status === "ON_LEAVE");
  const onBreak = count((d) => d.status === "ON_BREAK");
  const working = count((d) => d.status === "WORKING");
  const notIn = count((d) => d.status === "NOT_STARTED" || d.status === "ABSENT");
  const scheduled = todays.filter(({ d }) => !["WEEKEND", "HOLIDAY"].includes(d.status)).length;
  const liveRate = scheduled - onLeave > 0 ? (present / (scheduled - onLeave)) * 100 : 0;

  const trend: TrendPoint[] = [];
  for (let i = 0; i < 14; i++) {
    const pt: TrendPoint = { date: addDays(from, i), present: 0, late: 0, halfDay: 0, absent: 0, leave: 0 };
    for (const p of people) {
      const d = range.get(p.id)![i];
      if (d.status === "ON_LEAVE") pt.leave++;
      else if (d.status === "ABSENT" || d.status === "INCOMPLETE") pt.absent++;
      else if (d.status === "HALF_DAY") pt.halfDay++;
      else if (d.firstIn && d.late) pt.late++;
      else if (d.firstIn) pt.present++;
    }
    trend.push(pt);
  }

  const depts = new Map<string, DayResult[]>();
  for (const p of people) {
    const k = p.department ?? "—";
    depts.set(k, [...(depts.get(k) ?? []), ...range.get(p.id)!.slice(0, -1)]);
  }
  const deptRows = [...depts.entries()]
    .map(([label, days]) => {
      const s = summarize(days);
      return { label, value: s.attendanceRate, sub: `${fmtDuration(s.days ? s.workedMin / Math.max(1, s.present + s.halfDay) : 0)} avg` };
    })
    .sort((a, b) => b.value - a.value);

  const attention = todays
    .filter(({ d }) => d.late || d.status === "ABSENT")
    .concat(people.map((p) => ({ p, d: range.get(p.id)!.at(-2)! })).filter(({ d }) => d?.status === "INCOMPLETE"))
    .slice(0, 8);

  const inNow = todays.filter(({ d }) => d.status === "WORKING" || d.status === "ON_BREAK");

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("Team Live")} <span className="ms-2 text-sm font-normal text-muted">{people.length} {t("Employees").toLowerCase()}</span>
        </h2>
        <Link href="/team" className="btn btn-ghost btn-sm">
          {t("View all")} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="card flex items-center gap-5 p-5 lg:col-span-4 rise">
          <Ring value={liveRate} label={t("Today")} />
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-good live-dot" /> {working} {t("Working now")}</div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-warn" /> {onBreak} {t("On break")}</div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-muted" /> {notIn} {t("NOT_STARTED")}</div>
            {pending > 0 && (
              <Link href="/approvals" className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
                {pending} {t("Pending approvals")}
              </Link>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:col-span-8 lg:grid-cols-4">
          <StatCard label={t("Present today")} value={present} sub={`/ ${scheduled}`} icon={<UserCheck className="size-4" />} tone="good" />
          <StatCard label={t("Late arrivals")} value={late} icon={<AlarmClock className="size-4" />} tone="warn" />
          <StatCard label={t("Absent today")} value={notIn} icon={<UserX className="size-4" />} tone="bad" />
          <StatCard label={t("On leave")} value={onLeave} icon={<Palmtree className="size-4" />} tone="info" />
        </div>

        <Card title={t("Last 14 days")} className="lg:col-span-8" action={<Legend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />}>
          <div className="p-5 pb-8">
            <TrendBars data={trend} />
          </div>
        </Card>

        <Card title={t("Department breakdown")} className="lg:col-span-4">
          <div className="p-5">{deptRows.length ? <RateBars rows={deptRows} /> : <Empty text={t("No records")} />}</div>
        </Card>

        <Card title={t("Who's in")} className="lg:col-span-6" action={<span className="text-xs text-muted">{inNow.length}</span>}>
          {inNow.length === 0 ? (
            <Empty text={t("No records")} />
          ) : (
            <ul className="divide-y divide-line">
              {inNow.slice(0, 8).map(({ p, d }) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted">{p.department ?? "—"} · {t("First in")} {fmtTime(d.firstIn, tz)}</div>
                  </div>
                  <span className="text-xs text-ink-2 tabular">{fmtDuration(d.workedMin)}</span>
                  <StatusBadge status={d.status} label={t(d.status)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("Needs attention")} className="lg:col-span-6">
          {attention.length === 0 ? (
            <Empty text={t("No records")} />
          ) : (
            <ul className="divide-y divide-line">
              {attention.map(({ p, d }) => (
                <li key={`${p.id}-${d.date}`} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted">
                      {d.date}
                      {d.late && ` · ${t("Late")} ${d.lateMin}m`}
                      {d.status === "INCOMPLETE" && " · missing check-out"}
                    </div>
                  </div>
                  <StatusBadge status={d.late && d.status !== "ABSENT" ? "INCOMPLETE" : d.status} label={d.late && d.status !== "ABSENT" ? t("Late") : t(d.status)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <Users className="size-3.5" /> {me.role === "admin" ? "All active employees" : "Your direct reports"}
      </p>
    </div>
  );
}
