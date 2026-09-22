import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { todayLocal } from "@/lib/data";
import { getPrefs } from "@/lib/prefs";
import { cancelCorrection, requestCorrection } from "@/actions/requests";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Corrections" };

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await requireUser();
  const { t } = await getPrefs();
  const today = todayLocal();
  const { date } = await searchParams;
  const rows = all<{
    id: number;
    work_date: string;
    check_in: string | null;
    check_out: string | null;
    reason: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    reviewer: string | null;
    review_note: string | null;
  }>(
    `SELECT r.id, r.work_date, r.check_in, r.check_out, r.reason, r.status, u.name AS reviewer, r.review_note
     FROM regularizations r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 100`,
    me.id,
  );

  return (
    <>
      <PageHeader title={t("Corrections")} subtitle={t("Missed punch or wrong time? Request a correction for manager approval.")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <Card title={<span id="apply">{t("Request correction")}</span>}>
          <ActionForm action={requestCorrection} className="space-y-3 p-5">
            <Field label="Date">
              <input type="date" name="work_date" className="input" required max={today} defaultValue={date} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in time">
                <input type="time" name="check_in" className="input" />
              </Field>
              <Field label="Check-out time">
                <input type="time" name="check_out" className="input" />
              </Field>
            </div>
            <Field label="Reason">
              <textarea name="reason" className="input min-h-20" required maxLength={500} />
            </Field>
            <SubmitButton className="w-full">{t("Submit")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("My requests")}>
          {rows.length === 0 ? (
            <Empty text={t("No records")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("Date")}</th>
                    <th>{t("Check In")}</th>
                    <th>{t("Check Out")}</th>
                    <th>{t("Reason")}</th>
                    <th>{t("Status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-ink tabular">{r.work_date}</td>
                      <td className="tabular">{r.check_in ?? "—"}</td>
                      <td className="tabular">{r.check_out ?? "—"}</td>
                      <td className="max-w-64">
                        <div className="truncate">{r.reason}</div>
                        {r.review_note && <div className="truncate text-xs text-muted">↳ {r.reviewer}: {r.review_note}</div>}
                      </td>
                      <td><StatusBadge status={r.status} label={t(r.status)} /></td>
                      <td className="text-end">
                        {r.status === "pending" && (
                          <ActionButton run={cancelCorrection.bind(null, r.id)} confirm="Cancel request">
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
