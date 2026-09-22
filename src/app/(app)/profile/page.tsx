import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { getPrefs } from "@/lib/prefs";
import { shiftLabel } from "@/lib/view";
import { changePassword } from "@/actions/auth";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Avatar, Card, PageHeader } from "@/components/ui";
import { PasswordCell } from "../employees/password-cell";
import { passwordViewEnabled } from "@/lib/passwords";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const me = await requireUser();
  const { t } = await getPrefs();
  const pw = get<{ password_set_by: string | null; password_changed_at: number | null }>(
    "SELECT password_set_by, password_changed_at FROM users WHERE id = ?",
    me.id,
  );
  const manager = me.manager_id ? get<{ name: string }>("SELECT name FROM users WHERE id = ?", me.manager_id)?.name : null;
  const sessions = all<{ created_at: number; ip: string | null; user_agent: string | null }>(
    "SELECT created_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 10",
    me.id,
    Date.now(),
  );

  const info: [string, string][] = [
    ["Employee code", me.emp_code],
    ["Email", me.email],
    ["Role", me.role],
    ["Department", me.department ?? "—"],
    ["Designation", me.designation ?? "—"],
    ["Manager", manager ?? "—"],
    ["Shift", shiftLabel(me.shift_id)],
    ["Check-in rules", [me.require_geofence ? "Geofence" : null, me.require_selfie ? "Selfie" : null].filter(Boolean).join(" + ") || "Standard"],
  ];

  return (
    <>
      <PageHeader title={t("Profile")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-4 border-b border-line p-5">
            <Avatar name={me.name} size="size-14" />
            <div>
              <div className="text-lg font-semibold">{me.name}</div>
              <div className="text-sm capitalize text-muted">{me.designation ?? me.role}</div>
            </div>
          </div>
          <dl className="divide-y divide-line">
            {info.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-5 py-3 text-sm">
                <dt className="text-muted">{t(k)}</dt>
                <dd className="text-end capitalize text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <div className="space-y-4">
          <Card title={t("My password")}>
            <div className="px-5 py-4">
              <PasswordCell userId={me.id} setBy={pw?.password_set_by ?? null} changedAt={pw?.password_changed_at ?? null} enabled={passwordViewEnabled()} />
              <p className="mt-2 text-xs text-muted">Only you, admins and your manager can see this.</p>
            </div>
          </Card>
          <Card title={t("Change password")}>
            <ActionForm action={changePassword} className="space-y-3 p-5">
              <Field label="Current password">
                <input type="password" name="current" required className="input" autoComplete="current-password" />
              </Field>
              <Field label="New password">
                <input type="password" name="next" required minLength={8} className="input" autoComplete="new-password" />
              </Field>
              <SubmitButton>{t("Save")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Active sessions">
            <ul className="divide-y divide-line text-sm">
              {sessions.map((s, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="truncate text-ink-2">{s.user_agent || "Unknown device"}</div>
                  <div className="text-xs text-muted">
                    {s.ip} · {new Date(s.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
