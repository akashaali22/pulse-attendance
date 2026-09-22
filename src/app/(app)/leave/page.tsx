import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { leaveBalances, todayLocal } from "@/lib/data";
import { getPrefs } from "@/lib/prefs";
import { penaltiesFor } from "@/lib/penalty";
import { applyLeave, cancelLeave } from "@/actions/requests";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Leave" };

interface LeaveRow {
  id: number;
  type: string;
  color: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewer: string | null;
  review_note: string | null;
}

export default async function LeavePage() {
  const me = await requireUser();
  const { t } = await getPrefs();
  const today = todayLocal();
  const balances = leaveBalances(me.id, today.slice(0, 4));
  const types = all<{ id: number; name: string }>("SELECT id, name FROM leave_types WHERE active = 1 ORDER BY id");
  const rows = all<LeaveRow>(
    `SELECT r.id, lt.name AS type, lt.color, r.start_date, r.end_date, r.days, r.reason, r.status, rv.name AS reviewer, r.review_note
     FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id LEFT JOIN users rv ON rv.id = r.reviewer_id
     WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 100`,
    me.id,
  );
  const penalties = penaltiesFor(me.id);
  const holidays = all<{ date: string; name: string }>("SELECT date, name FROM holidays WHERE date >= ? ORDER BY date LIMIT 6", today);

  return (
    <>
      <PageHeader title={t("Leave")} subtitle={`${today.slice(0, 4)} · ${t("Leave balance")}`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {balances.map((b) => (
          <div key={b.id} className="card relative overflow-hidden p-5 rise">
            <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: b.color }} />
            <div className="text-xs font-medium uppercase tracking-wider text-muted">{b.name}</div>
            <div className="mt-2 text-3xl font-semibold tabular">
              {b.quota > 0 ? b.remaining : "∞"}
              {b.quota > 0 && <span className="text-base font-normal text-muted"> / {b.quota}</span>}
            </div>
            <div className="mt-1 text-xs text-muted">
              {t("Used")} {b.used} · {t("Pending")} {b.pending}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card title={<span id="apply">{t("Apply for leave")}</span>}>
            <ActionForm action={applyLeave} className="space-y-3 p-5">
              <Field label="Leave type">
                <select name="leave_type_id" className="input" required>
                  {types.map((lt) => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <input type="date" name="start_date" className="input" required min={today} />
                </Field>
                <Field label="To">
                  <input type="date" name="end_date" className="input" min={today} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" name="half_day" className="accent-[var(--accent)]" /> {t("Half day")}
                <span className="text-xs text-muted">({t("after break, 2:15 – 6:00")})</span>
              </label>
              <Field label="Reason">
                <textarea name="reason" className="input min-h-20" required maxLength={500} />
              </Field>
              <SubmitButton className="w-full">{t("Submit")}</SubmitButton>
            </ActionForm>
          </Card>
          {penalties.length > 0 && (
            <Card title={t("Late penalties")}>
              <ul className="divide-y divide-line">
                {penalties.map((p) => (
                  <li key={p.week_start} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="text-ink-2">
                      {t("Week")} {p.week_start} · {p.late_minutes}m
                    </span>
                    <span className="text-bad">−{p.days} {p.leave_type}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {holidays.length > 0 && (
            <Card title={t("HOLIDAY")}>
              <ul className="divide-y divide-line">
                {holidays.map((h) => (
                  <li key={h.date} className="flex justify-between px-5 py-2.5 text-sm">
                    <span className="text-ink-2">{h.name}</span>
                    <span className="text-muted tabular">{h.date}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card title={t("My requests")}>
          {rows.length === 0 ? (
            <Empty text={t("No records")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("Leave type")}</th>
                    <th>{t("Date")}</th>
                    <th>{t("Days")}</th>
                    <th>{t("Reason")}</th>
                    <th>{t("Status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="flex items-center gap-2 font-medium text-ink">
                          <span className="size-2 rounded-full" style={{ background: r.color }} /> {r.type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap tabular">{r.start_date}{r.end_date !== r.start_date && ` → ${r.end_date}`}</td>
                      <td className="tabular">{r.days}</td>
                      <td className="max-w-64">
                        <div className="truncate">{r.reason}</div>
                        {r.review_note && <div className="truncate text-xs text-muted">↳ {r.reviewer}: {r.review_note}</div>}
                      </td>
                      <td><StatusBadge status={r.status} label={t(r.status)} /></td>
                      <td className="text-end">
                        {(r.status === "pending" || (r.status === "approved" && r.start_date > today)) && (
                          <ActionButton run={cancelLeave.bind(null, r.id)} confirm="Cancel request">
                            {t("Cancel")}
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
