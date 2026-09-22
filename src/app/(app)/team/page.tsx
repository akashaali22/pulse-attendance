import Link from "next/link";
import type { Metadata } from "next";
import { Camera, MapPin, QrCode, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { computeRange, getTz, listPeople, todayLocal } from "@/lib/data";
import { fmtDuration, fmtTime, isIsoDate, localMinutes, minutesToHhmm } from "@/lib/time";
import { getPrefs } from "@/lib/prefs";
import { Avatar, Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { EditDay } from "./edit-day";

export const metadata: Metadata = { title: "Team Live" };
export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ date?: string; dept?: string; status?: string }> }) {
  const me = await requireUser(["admin", "manager"]);
  const { t } = await getPrefs();
  const tz = getTz();
  const today = todayLocal();
  const sp = await searchParams;
  const date = isIsoDate(sp.date) && sp.date <= today ? sp.date : today;
  const dept = Number(sp.dept) || null;

  const people = listPeople(me, { departmentId: dept }).filter((p) => me.role === "admin" || p.id !== me.id);
  const days = computeRange(people, date, date);
  const punches = all<{ user_id: number; type: string; source: string; flagged: number; flag_reason: string | null; selfie_path: string | null; id: number; lat: number | null }>(
    "SELECT id, user_id, type, source, flagged, flag_reason, selfie_path, lat FROM punches WHERE work_date = ? AND voided = 0 ORDER BY ts",
    date,
  );
  const depts = all<{ id: number; name: string }>("SELECT id, name FROM departments ORDER BY name");

  let rows = people.map((p) => ({ p, d: days.get(p.id)![0], ps: punches.filter((x) => x.user_id === p.id) }));
  if (sp.status) rows = rows.filter((r) => r.d.status === sp.status || (sp.status === "LATE" && r.d.late));

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.d.status] = (counts[r.d.status] ?? 0) + 1;
  const filterHref = (status?: string) => `/team?date=${date}${dept ? `&dept=${dept}` : ""}${status ? `&status=${status}` : ""}`;

  return (
    <>
      <PageHeader title={t("Team Live")} subtitle={date === today ? t("Today") : date}>
        <form className="flex flex-wrap gap-2">
          <input type="date" name="date" defaultValue={date} max={today} className="input w-auto" />
          <select name="dept" defaultValue={dept ?? ""} className="input w-auto">
            <option value="">{t("All")} — {t("Department")}</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button className="btn btn-ghost">{t("Filter")}</button>
        </form>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={filterHref()} className={`btn btn-sm ${!sp.status ? "btn-primary" : "btn-ghost"}`}>{t("All")} · {people.length}</Link>
        {Object.entries(counts).map(([s, n]) => (
          <Link key={s} href={filterHref(s)} className={`btn btn-sm ${sp.status === s ? "btn-primary" : "btn-ghost"}`}>
            {t(s)} · {n}
          </Link>
        ))}
        <Link href={filterHref("LATE")} className={`btn btn-sm ${sp.status === "LATE" ? "btn-primary" : "btn-ghost"}`}>{t("Late")}</Link>
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty text={t("No records")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("Employee")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("First in")}</th>
                  <th>{t("Last out")}</th>
                  <th>{t("Worked")}</th>
                  <th>{t("Late")}</th>
                  <th>Evidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, d, ps }) => {
                  const flagged = ps.filter((x) => x.flagged);
                  const selfie = ps.find((x) => x.selfie_path);
                  const sources = [...new Set(ps.map((x) => x.source))];
                  const open = d.status === "WORKING" || d.status === "ON_BREAK";
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/attendance?user=${p.id}&month=${date.slice(0, 7)}`} className="flex items-center gap-3">
                          <Avatar name={p.name} />
                          <span>
                            <span className="block font-medium text-ink">{p.name}</span>
                            <span className="block text-xs text-muted">{p.emp_code} · {p.department ?? "—"}</span>
                          </span>
                        </Link>
                      </td>
                      <td><StatusBadge status={d.status} label={t(d.status)} /></td>
                      <td className="tabular">{fmtTime(d.firstIn, tz)}</td>
                      <td className="tabular">{open ? "—" : fmtTime(d.lastOut, tz)}</td>
                      <td className="tabular">{d.workedMin ? fmtDuration(d.workedMin) : "—"}</td>
                      <td className={d.late ? "text-warn tabular" : "tabular"}>{d.late ? `${d.lateMin}m` : "—"}</td>
                      <td>
                        <div className="flex items-center gap-2 text-muted">
                          {sources.map((s) => (
                            <span key={s} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold">
                              {s === "QR" ? <QrCode className="size-3" /> : ps.some((x) => x.lat != null) ? <MapPin className="size-3" /> : null}
                              {s}
                            </span>
                          ))}
                          {selfie && (
                            <a href={`/api/selfie/${selfie.id}`} target="_blank" className="text-accent" title="Selfie">
                              <Camera className="size-4" />
                            </a>
                          )}
                          {flagged.length > 0 && (
                            <span title={flagged.map((x) => x.flag_reason).join("\n")} className="text-bad">
                              <ShieldAlert className="size-4" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-end">
                        {(p.id !== me.id) && (
                          <EditDay
                            userId={p.id}
                            name={p.name}
                            date={date}
                            inT={d.firstIn ? minutesToHhmm(localMinutes(d.firstIn, tz)) : ""}
                            outT={d.lastOut && !open ? minutesToHhmm(localMinutes(d.lastOut, tz)) : ""}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
