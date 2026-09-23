import type { Metadata } from "next";
import { MapPin, Camera, KeyRound, Power } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { getPrefs } from "@/lib/prefs";
import { setEmployeeStatus } from "@/actions/admin";
import { PasswordCell, SetPasswordButton } from "./password-cell";
import { passwordViewEnabled } from "@/lib/passwords";
import { dismissResetRequest, pendingResetRequests } from "@/actions/recovery";
import { ActionButton } from "@/components/forms";
import { Avatar, Card, Empty, PageHeader } from "@/components/ui";
import { EmployeeDialog, type EmployeeInput } from "./employee-form";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const me = await requireUser(["admin", "manager"]);
  const isAdmin = me.role === "admin";
  const canSeePasswords = passwordViewEnabled();
  const resetRequests = await pendingResetRequests();
  const { t } = await getPrefs();
  const { q = "", show } = await searchParams;
  const like = `%${q.trim()}%`;
  // Managers only ever see (and can only reveal passwords of) their direct reports.
  const scope = isAdmin ? "" : `AND u.manager_id = ${Number(me.id)}`;
  const rows = all<EmployeeInput & { id: number; department: string | null; manager: string | null; shift: string | null; status: string; password_set_by: string | null; password_changed_at: number | null }>(
    `SELECT u.id, u.emp_code, u.name, u.email, u.role, u.department_id, u.shift_id, u.manager_id, u.designation, u.phone, u.joined_on,
            u.require_geofence, u.require_selfie, u.status, u.password_set_by, u.password_changed_at, d.name AS department, m.name AS manager, s.name AS shift
     FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id LEFT JOIN shifts s ON s.id = u.shift_id
     WHERE (u.name LIKE ? OR u.email LIKE ? OR u.emp_code LIKE ?) ${show === "all" ? "" : "AND u.status = 'active'"} ${scope}
     ORDER BY u.status, u.name`,
    like,
    like,
    like,
  );
  const departments = all<{ id: number; name: string }>("SELECT id, name FROM departments ORDER BY name");
  const shifts = all<{ id: number; name: string }>("SELECT id, name FROM shifts ORDER BY name");
  const managers = all<{ id: number; name: string }>("SELECT id, name FROM users WHERE role IN ('admin','manager') AND status = 'active' ORDER BY name");
  const maxCode = all<{ emp_code: string }>("SELECT emp_code FROM users").reduce((mx, r) => Math.max(mx, Number(r.emp_code.replace(/\D/g, "")) || 0), 0);
  const nextCode = `EMP-${String(maxCode + 1).padStart(4, "0")}`;
  const opts = { departments, shifts, managers };

  return (
    <>
      <PageHeader
        title={isAdmin ? t("Employees") : t("My Team")}
        subtitle={`${rows.length} ${t("Employees").toLowerCase()}${isAdmin ? "" : ` · ${t("reporting to you")}`}`}
      >
        {isAdmin && <EmployeeDialog {...opts} nextCode={nextCode} />}
      </PageHeader>
      {resetRequests.length > 0 && (
        <Card
          className="mb-4 border-warn/40"
          title={
            <span className="flex items-center gap-2 text-warn">
              <KeyRound className="size-4" /> {t("Password reset requests")} · {resetRequests.length}
            </span>
          }
        >
          <ul className="divide-y divide-line">
            {resetRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={r.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.name}</div>
                  <div className="truncate text-xs text-muted">
                    {r.emp_code} · {r.email}
                    {r.note ? ` · “${r.note}”` : ""} · {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </div>
                <SetPasswordButton userId={r.user_id} name={r.name} label={t("Set new password")} />
                <ActionButton run={dismissResetRequest.bind(null, r.id)} confirm="Dismiss this request?">
                  {t("Dismiss")}
                </ActionButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={`${t("Search")}…`} className="input max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="show" value="all" defaultChecked={show === "all"} /> {t("Inactive")}
        </label>
        <button className="btn btn-ghost">{t("Filter")}</button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <Empty text={t("No records")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("Employee")}</th>
                  <th>{t("Role")}</th>
                  <th>{t("Department")}</th>
                  <th>{t("Shift")}</th>
                  <th>{t("Manager")}</th>
                  <th>{t("Password")}</th>
                  <th>Rules</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.status === "inactive" ? "opacity-50" : ""}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} />
                        <span>
                          <span className="block font-medium text-ink">{r.name}</span>
                          <span className="block text-xs text-muted">{r.emp_code} · {r.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="capitalize">{r.role}</td>
                    <td>{r.department ?? "—"}<div className="text-xs text-muted">{r.designation}</div></td>
                    <td>{r.shift ?? "Default"}</td>
                    <td>{r.manager ?? "—"}</td>
                    <td>
                      <PasswordCell userId={r.id} setBy={r.password_set_by} changedAt={r.password_changed_at} enabled={canSeePasswords} />
                    </td>
                    <td>
                      <div className="flex gap-1.5 text-muted">
                        {!!r.require_geofence && <span title="Geofence required"><MapPin className="size-4 text-accent" /></span>}
                        {!!r.require_selfie && <span title="Selfie required"><Camera className="size-4 text-accent" /></span>}
                      </div>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {isAdmin && <EmployeeDialog {...opts} initial={r} />}
                        <SetPasswordButton userId={r.id} name={r.name} />
                        {isAdmin && r.id !== me.id && (
                          <ActionButton
                            run={setEmployeeStatus.bind(null, r.id, r.status === "active" ? "inactive" : "active")}
                            confirm={r.status === "active" ? "Deactivate this employee?" : "Activate this employee?"}
                            title={r.status === "active" ? t("Inactive") : t("Active")}
                          >
                            <Power className={`size-3.5 ${r.status === "active" ? "text-bad" : "text-good"}`} />
                          </ActionButton>
                        )}
                      </div>
                    </td>
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
