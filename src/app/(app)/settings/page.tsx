import type { Metadata } from "next";
import { MapPin, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all, getSetting } from "@/lib/db";
import { getPrefs } from "@/lib/prefs";
import { clientIp } from "@/lib/auth";
import { removeItem, revokeDevice, saveAgentSettings, saveCompany, saveDepartment, saveHoliday, saveLeaveType, saveLocation, saveShift } from "@/actions/admin";
import { listDevices } from "@/lib/agent";
import { getTz } from "@/lib/data";
import { ActionButton, ActionForm, Field, SubmitButton, Tabs } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import type { ShiftRow } from "@/lib/data";
import { UseMyLocation } from "./use-location";

export const metadata: Metadata = { title: "Settings" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ShiftForm({ s }: { s?: ShiftRow }) {
  const wd = (s?.working_days ?? "1,2,3,4,5").split(",").map(Number);
  return (
    <ActionForm action={saveShift} resetOnSuccess={!s} className="grid gap-3 sm:grid-cols-3">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Name"><input name="name" required defaultValue={s?.name} className="input" /></Field>
      <Field label="Start"><input type="time" name="start_time" required defaultValue={s?.start_time ?? "09:00"} className="input" /></Field>
      <Field label="End"><input type="time" name="end_time" required defaultValue={s?.end_time ?? "18:00"} className="input" /></Field>
      <Field label="Break start"><input type="time" name="break_start" defaultValue={s?.break_start ?? "13:15"} className="input" /></Field>
      <Field label="Break end"><input type="time" name="break_end" defaultValue={s?.break_end ?? "14:15"} className="input" /></Field>
      <Field label="Daily grace (min)"><input type="number" name="grace_minutes" min={0} defaultValue={s?.grace_minutes ?? 0} className="input" /></Field>
      <Field label="Half day (min)"><input type="number" name="half_day_minutes" min={0} defaultValue={s?.half_day_minutes ?? 240} className="input" /></Field>
      <Field label="Full day (min)"><input type="number" name="full_day_minutes" min={0} defaultValue={s?.full_day_minutes ?? 480} className="input" /></Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        {DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1.5 text-sm text-ink-2">
            <input type="checkbox" name="working_days" value={i} defaultChecked={wd.includes(i)} /> {d}
          </label>
        ))}
        <label className="ms-auto flex items-center gap-1.5 text-sm text-ink-2">
          <input type="checkbox" name="is_default" defaultChecked={!!s?.is_default} /> Default shift
        </label>
      </div>
      <div className="sm:col-span-3"><SubmitButton>Save shift</SubmitButton></div>
    </ActionForm>
  );
}

function LocationForm({ l }: { l?: { id: number; name: string; lat: number; lng: number; radius_m: number; active: number } }) {
  return (
    <ActionForm action={saveLocation} resetOnSuccess={!l} className="grid gap-3 sm:grid-cols-4">
      {l && <input type="hidden" name="id" value={l.id} />}
      <Field label="Name"><input name="name" required defaultValue={l?.name} className="input" /></Field>
      <Field label="Latitude"><input name="lat" required defaultValue={l?.lat} className="input" inputMode="decimal" /></Field>
      <Field label="Longitude"><input name="lng" required defaultValue={l?.lng} className="input" inputMode="decimal" /></Field>
      <Field label="Radius (m)"><input type="number" name="radius_m" min={20} max={5000} defaultValue={l?.radius_m ?? 200} className="input" /></Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          <input type="checkbox" name="active" defaultChecked={l ? !!l.active : true} /> Active
        </label>
        <UseMyLocation />
        <SubmitButton className="ms-auto">Save location</SubmitButton>
      </div>
    </ActionForm>
  );
}

export default async function SettingsPage() {
  await requireUser(["admin"]);
  const { t } = await getPrefs();
  const shifts = all<ShiftRow>("SELECT * FROM shifts ORDER BY id");
  const locations = all<{ id: number; name: string; lat: number; lng: number; radius_m: number; active: number }>("SELECT * FROM locations ORDER BY id");
  const departments = all<{ id: number; name: string; n: number }>(
    "SELECT d.id, d.name, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.status = 'active') AS n FROM departments d ORDER BY d.name",
  );
  const holidays = all<{ id: number; date: string; name: string }>("SELECT * FROM holidays ORDER BY date DESC");
  const leaveTypes = all<{ id: number; name: string; code: string; annual_quota: number; color: string; paid: number; active: number }>("SELECT * FROM leave_types WHERE active = 1 ORDER BY id");
  const ip = await clientIp();
  const devices = listDevices();
  const fmtSeen = new Intl.DateTimeFormat("en-GB", { timeZone: getTz(), dateStyle: "medium", timeStyle: "short" });
  const agentTab = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Card title="Automatic attendance (Windows agent)">
          <div className="space-y-3 p-5 text-sm text-ink-2">
            <p>Install on each office PC. The employee links it once with their email and password; after that:</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>Windows log on / unlock / wake → check-in</li>
              <li>Shut down / log off / sleep → check-out</li>
              <li>Locked longer than the away limit → checked out at the lock time</li>
              <li>1:15 break notification; break is deducted automatically</li>
              <li>No internet → events are saved on the PC and sent when it reconnects</li>
            </ul>
            <a href="/api/agent/download" className="btn btn-primary w-full">Download PulseAgent.exe</a>
            <p className="text-xs text-muted">
              Tip: put a text file named <span className="font-mono">server.txt</span> next to the exe containing this server address so employees do not need to type it.
            </p>
          </div>
        </Card>
        <Card title="Agent rules">
          <ActionForm action={saveAgentSettings} resetOnSuccess={false} className="grid gap-3 p-5">
            <Field label="Away limit — PC locked longer than this counts as out (min)">
              <input type="number" name="agent_away_minutes" min={5} max={480} required defaultValue={getSetting("agent_away_minutes", "30")} className="input" />
            </Field>
            <Field label="Offline limit — no signal from PC for this long closes the session (min)">
              <input type="number" name="agent_offline_minutes" min={3} max={240} required defaultValue={getSetting("agent_offline_minutes", "10")} className="input" />
            </Field>
            <SubmitButton>{t("Save")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <Card title={`Linked PCs · ${devices.filter((d) => !d.revoked).length}`}>
        {devices.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No PCs linked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("Employee")}</th>
                  <th>PC</th>
                  <th>Last signal</th>
                  <th>IP</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const online = !d.revoked && d.last_seen && Date.now() - d.last_seen < 3 * 60_000;
                  return (
                    <tr key={d.id} className={d.revoked ? "opacity-50" : ""}>
                      <td className="text-ink">{d.user_name}<div className="text-xs text-muted">{d.emp_code}</div></td>
                      <td>{d.name}<div className="text-xs text-muted">v{d.agent_version}</div></td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${online ? "bg-good live-dot" : "bg-muted"}`} />
                          {d.revoked ? "Unlinked" : d.last_seen ? fmtSeen.format(new Date(d.last_seen)) : "Never"}
                        </span>
                      </td>
                      <td className="font-mono text-xs">{d.last_ip ?? "—"}</td>
                      <td className="text-end">
                        {!d.revoked && (
                          <ActionButton run={revokeDevice.bind(null, d.id)} confirm="Unlink this PC? It will stop recording attendance.">
                            <Trash2 className="size-3.5" />
                          </ActionButton>
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
    </div>
  );

  const company = (
    <Card title="Company">
      <ActionForm action={saveCompany} resetOnSuccess={false} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Company name"><input name="company_name" required defaultValue={getSetting("company_name")} className="input" /></Field>
        <Field label="Timezone (IANA)"><input name="timezone" required defaultValue={getSetting("timezone")} className="input" placeholder="Asia/Karachi" /></Field>
        <Field label="Weekly late allowance (minutes) — above this, 1 leave is deducted">
          <input type="number" name="weekly_late_allowance" min={0} max={2400} required defaultValue={getSetting("weekly_late_allowance", "90")} className="input" />
        </Field>
        <Field label="Penalty deducts from (leave codes in order)">
          <input name="late_penalty_order" required defaultValue={getSetting("late_penalty_order", "CL,AL,UL")} className="input font-mono" />
        </Field>
        <Field label="Allowed networks (IP or prefix, comma separated — empty = anywhere)" className="sm:col-span-2">
          <input name="allowed_ips" defaultValue={getSetting("allowed_ips")} className="input font-mono" placeholder="192.168.1., 10.0.0.5" />
        </Field>
        <label className="flex items-start gap-2 text-sm text-ink-2 sm:col-span-2">
          <input type="checkbox" name="allow_password_view" defaultChecked={getSetting("allow_password_view", "1") === "1"} className="mt-1" />
          <span>
            Let admins and managers view employee passwords
            <span className="block text-xs text-muted">
              Passwords are then also kept encrypted (AES-256) so they can be shown. Turn this off and only the one-way
              login hash is stored — nobody, including you, can read a password again.
            </span>
          </span>
        </label>
        <p className="text-xs text-muted sm:col-span-2">
          Your current IP as seen by the server: <span className="font-mono text-ink-2">{ip}</span>. Add it before enabling a restriction so you do not lock yourself out.
        </p>
        <div><SubmitButton>{t("Save")}</SubmitButton></div>
      </ActionForm>
    </Card>
  );

  const shiftTab = (
    <div className="space-y-4">
      {shifts.map((s) => (
        <Card key={s.id} title={`${s.name}${s.is_default ? " · default" : ""}`} action={<ActionButton run={removeItem.bind(null, "shifts", s.id)} confirm="Delete this shift?"><Trash2 className="size-3.5" /></ActionButton>}>
          <div className="p-5"><ShiftForm s={s} /></div>
        </Card>
      ))}
      <Card title={`${t("Add")} ${t("Shift")}`}><div className="p-5"><ShiftForm /></div></Card>
    </div>
  );

  const locTab = (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Check-ins record GPS and are matched against these geofences. Employees marked “require geofence” can only check in inside one.
      </p>
      {locations.map((l) => (
        <Card
          key={l.id}
          title={<span className="flex items-center gap-2"><MapPin className="size-4 text-accent" />{l.name}</span>}
          action={
            <div className="flex items-center gap-2">
              <a className="text-xs text-accent" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=17/${l.lat}/${l.lng}`}>Map</a>
              <ActionButton run={removeItem.bind(null, "locations", l.id)} confirm="Delete this location?"><Trash2 className="size-3.5" /></ActionButton>
            </div>
          }
        >
          <div className="p-5"><LocationForm l={l} /></div>
        </Card>
      ))}
      <Card title={`${t("Add")} location`}><div className="p-5"><LocationForm /></div></Card>
    </div>
  );

  const simpleList = (items: { id: number; label: React.ReactNode; sub?: string }[], table: "departments" | "holidays" | "leave_types") => (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm">
          <span className="flex-1 text-ink">{i.label}</span>
          {i.sub && <span className="text-xs text-muted tabular">{i.sub}</span>}
          <ActionButton run={removeItem.bind(null, table, i.id)} confirm="Delete?"><Trash2 className="size-3.5" /></ActionButton>
        </li>
      ))}
    </ul>
  );

  const deptTab = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t("Department")}>{simpleList(departments.map((d) => ({ id: d.id, label: d.name, sub: `${d.n} ${t("Employees").toLowerCase()}` })), "departments")}</Card>
      <Card title={`${t("Add")} ${t("Department")}`}>
        <ActionForm action={saveDepartment} className="flex gap-2 p-5">
          <input name="name" required className="input" placeholder={t("Name")} />
          <SubmitButton>{t("Add")}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );

  const holidayTab = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t("HOLIDAY")}>{simpleList(holidays.map((h) => ({ id: h.id, label: h.name, sub: h.date })), "holidays")}</Card>
      <Card title={`${t("Add")} ${t("HOLIDAY")}`}>
        <ActionForm action={saveHoliday} className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Date"><input type="date" name="date" required className="input" /></Field>
          <Field label="Name"><input name="name" required className="input" /></Field>
          <SubmitButton>{t("Add")}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );

  const leaveTab = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t("Leave type")}>
        {simpleList(
          leaveTypes.map((l) => ({
            id: l.id,
            label: <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: l.color }} />{l.name} <span className="text-xs text-muted">{l.code}{l.paid ? "" : " · unpaid"}</span></span>,
            sub: l.annual_quota ? `${l.annual_quota} ${t("days")}/yr` : "unlimited",
          })),
          "leave_types",
        )}
      </Card>
      <Card title={`${t("Add")} ${t("Leave type")}`}>
        <ActionForm action={saveLeaveType} className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Name"><input name="name" required className="input" /></Field>
          <Field label="Code"><input name="code" required maxLength={5} className="input uppercase" /></Field>
          <Field label="Days per year (0 = unlimited)"><input type="number" name="annual_quota" min={0} max={365} step="0.5" defaultValue={10} className="input" /></Field>
          <Field label="Color"><input type="color" name="color" defaultValue="#6366f1" className="input h-10 p-1" /></Field>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="paid" defaultChecked /> Paid</label>
          <div className="text-end"><SubmitButton>{t("Add")}</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );

  return (
    <>
      <PageHeader title={t("Settings")} subtitle="Company policy, shifts, geofences, holidays and leave" />
      <Tabs
        tabs={[
          { id: "company", label: "Company", content: company },
          { id: "shifts", label: "Shift", content: shiftTab },
          { id: "locations", label: "Locations", content: locTab },
          { id: "departments", label: "Department", content: deptTab },
          { id: "holidays", label: "HOLIDAY", content: holidayTab },
          { id: "leave", label: "Leave type", content: leaveTab },
          { id: "agent", label: "Desktop agent", content: agentTab },
        ]}
      />
    </>
  );
}
