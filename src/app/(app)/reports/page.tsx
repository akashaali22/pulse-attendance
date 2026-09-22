import Link from "next/link";
import type { Metadata } from "next";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { fmtDuration } from "@/lib/time";
import { getPrefs } from "@/lib/prefs";
import { buildReport, parseReportParams } from "@/lib/report";
import { Avatar, Card, Empty, PageHeader, StatCard } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser(["admin", "manager"]);
  const { t } = await getPrefs();
  const sp = await searchParams;
  const p = parseReportParams(sp);
  const report = buildReport(me, p);
  const depts = all<{ id: number; name: string }>("SELECT id, name FROM departments ORDER BY name");

  const agg = report.summary.reduce(
    (a, { s, penalties }) => ({
      present: a.present + s.present,
      absent: a.absent + s.absent,
      late: a.late + s.late,
      leave: a.leave + s.leave,
      worked: a.worked + s.workedMin,
      penalties: a.penalties + penalties,
      rate: a.rate + s.attendanceRate,
    }),
    { present: 0, absent: 0, late: 0, leave: 0, worked: 0, penalties: 0, rate: 0 },
  );
  const avgRate = report.summary.length ? agg.rate / report.summary.length : 0;
  const qs = new URLSearchParams({ from: p.from, to: p.to, ...(p.dept ? { dept: String(p.dept) } : {}) }).toString();

  return (
    <>
      <PageHeader title={t("Reports")} subtitle={`${p.from} → ${p.to}`}>
        <Link href={`/api/export?${qs}&kind=summary&format=xlsx`} prefetch={false} className="btn btn-ghost btn-sm">
          <FileSpreadsheet className="size-4" /> {t("Download Excel")}
        </Link>
        <Link href={`/api/export?${qs}&kind=daily&format=xlsx`} prefetch={false} className="btn btn-ghost btn-sm">
          <FileSpreadsheet className="size-4" /> {t("Attendance register")}
        </Link>
        <Link href={`/api/export?${qs}&kind=daily&format=csv`} prefetch={false} className="btn btn-ghost btn-sm">
          <FileText className="size-4" /> {t("Download CSV")}
        </Link>
      </PageHeader>

      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label>
          <span className="label">{t("From")}</span>
          <input type="date" name="from" defaultValue={p.from} className="input" />
        </label>
        <label>
          <span className="label">{t("To")}</span>
          <input type="date" name="to" defaultValue={p.to} className="input" />
        </label>
        <label>
          <span className="label">{t("Department")}</span>
          <select name="dept" defaultValue={p.dept ?? ""} className="input">
            <option value="">{t("All")}</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary">{t("Filter")}</button>
      </form>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("Total employees")} value={report.people.length} />
        <StatCard label={t("Attendance rate")} value={`${avgRate.toFixed(1)}%`} tone="good" />
        <StatCard label={t("PRESENT")} value={agg.present} sub={t("Days")} tone="good" />
        <StatCard label={t("ABSENT")} value={agg.absent} sub={t("Days")} tone="bad" />
        <StatCard label={t("Late")} value={agg.late} tone="warn" />
        <StatCard label={t("Late penalties")} value={agg.penalties} sub={t("Leaves deducted")} tone="bad" />
      </div>

      <Card className="mt-4" title={t("Attendance register")}>
        {report.summary.length === 0 ? (
          <Empty text={t("No records")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("Employee")}</th>
                  <th>{t("PRESENT")}</th>
                  <th>{t("HALF_DAY")}</th>
                  <th>{t("ABSENT")}</th>
                  <th>{t("INCOMPLETE")}</th>
                  <th>{t("ON_LEAVE")}</th>
                  <th>{t("Late")}</th>
                  <th>{t("Late minutes")}</th>
                  <th>{t("Late penalties")}</th>
                  <th>{t("Worked")}</th>
                  <th>{t("Attendance rate")}</th>
                  <th>{t("Punctuality")}</th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map(({ person, s, penalties }) => (
                  <tr key={person.id}>
                    <td>
                      <Link href={`/attendance?user=${person.id}&month=${p.to.slice(0, 7)}`} className="flex items-center gap-3">
                        <Avatar name={person.name} />
                        <span>
                          <span className="block font-medium text-ink">{person.name}</span>
                          <span className="block text-xs text-muted">{person.department ?? "—"}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="tabular">{s.present}</td>
                    <td className="tabular">{s.halfDay}</td>
                    <td className="tabular">{s.absent}</td>
                    <td className="tabular">{s.incomplete}</td>
                    <td className="tabular">{s.leave}</td>
                    <td className="tabular">{s.late}</td>
                    <td className="tabular">{s.lateMin ? `${s.lateMin}m` : "—"}</td>
                    <td className={penalties ? "font-semibold text-bad tabular" : "tabular"}>{penalties || "—"}</td>
                    <td className="tabular">{fmtDuration(s.workedMin)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-info" style={{ width: `${Math.min(100, s.attendanceRate)}%` }} />
                        </div>
                        <span className="text-ink tabular">{s.attendanceRate}%</span>
                      </div>
                    </td>
                    <td className="tabular">{s.punctualityRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
