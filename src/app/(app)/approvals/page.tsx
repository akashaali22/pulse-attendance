import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { managedUserFilter, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { getPrefs } from "@/lib/prefs";
import { reviewCorrection, reviewLeave } from "@/actions/requests";
import { ActionButton } from "@/components/forms";
import { Avatar, Card, Empty, PageHeader, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const me = await requireUser(["admin", "manager"]);
  const { t } = await getPrefs();
  const f = managedUserFilter(me);

  const leaves = all<{ id: number; name: string; department: string | null; type: string; color: string; start_date: string; end_date: string; days: number; reason: string; status: "pending" | "approved" | "rejected"; created_at: number }>(
    `SELECT r.id, u.name, d.name AS department, lt.name AS type, lt.color, r.start_date, r.end_date, r.days, r.reason, r.status, r.created_at
     FROM leave_requests r JOIN users u ON u.id = r.user_id JOIN leave_types lt ON lt.id = r.leave_type_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id != ? AND ${f.sql} AND (r.status = 'pending' OR r.reviewed_at > ?)
     ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 100`,
    me.id,
    ...f.params,
    Date.now() - 14 * 86400_000,
  );
  const fixes = all<{ id: number; name: string; department: string | null; work_date: string; check_in: string | null; check_out: string | null; reason: string; status: "pending" | "approved" | "rejected" }>(
    `SELECT r.id, u.name, d.name AS department, r.work_date, r.check_in, r.check_out, r.reason, r.status
     FROM regularizations r JOIN users u ON u.id = r.user_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id != ? AND ${f.sql} AND (r.status = 'pending' OR r.reviewed_at > ?)
     ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 100`,
    me.id,
    ...f.params,
    Date.now() - 14 * 86400_000,
  );

  const decide = (kind: "leave" | "fix", id: number) => (
    <div className="flex justify-end gap-1.5">
      <ActionButton
        className="btn btn-sm border border-good/30 bg-good/10 text-good hover:bg-good/20"
        run={(kind === "leave" ? reviewLeave : reviewCorrection).bind(null, id, "approved")}
        title={t("Approve")}
      >
        <Check className="size-3.5" /> {t("Approve")}
      </ActionButton>
      <ActionButton
        className="btn btn-sm border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20"
        run={(kind === "leave" ? reviewLeave : reviewCorrection).bind(null, id, "rejected")}
        promptNote="Reason"
        title={t("Reject")}
      >
        <X className="size-3.5" />
      </ActionButton>
    </div>
  );

  const pendingCount = leaves.filter((l) => l.status === "pending").length + fixes.filter((x) => x.status === "pending").length;

  return (
    <>
      <PageHeader title={t("Approvals")} subtitle={`${pendingCount} ${t("pending")}`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t("Leave")}>
          {leaves.length === 0 ? (
            <Empty text={t("No records")} />
          ) : (
            <ul className="divide-y divide-line">
              {leaves.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Avatar name={l.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{l.name}</span>
                      <span className="flex items-center gap-1 text-xs text-ink-2">
                        <span className="size-2 rounded-full" style={{ background: l.color }} /> {l.type}
                      </span>
                    </div>
                    <div className="text-xs text-muted tabular">
                      {l.start_date}
                      {l.end_date !== l.start_date && ` → ${l.end_date}`} · {l.days} {t("days")}
                    </div>
                    <div className="mt-1 text-xs text-ink-2">“{l.reason}”</div>
                  </div>
                  {l.status === "pending" ? decide("leave", l.id) : <StatusBadge status={l.status} label={t(l.status)} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("Corrections")}>
          {fixes.length === 0 ? (
            <Empty text={t("No records")} />
          ) : (
            <ul className="divide-y divide-line">
              {fixes.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Avatar name={x.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{x.name}</div>
                    <div className="text-xs text-muted tabular">
                      {x.work_date} · {x.check_in ?? "—"} → {x.check_out ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-ink-2">“{x.reason}”</div>
                  </div>
                  {x.status === "pending" ? decide("fix", x.id) : <StatusBadge status={x.status} label={t(x.status)} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
