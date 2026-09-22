"use client";

import { useState } from "react";
import { Pencil, UserPlus, X } from "lucide-react";
import { saveEmployee } from "@/actions/admin";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { usePrefs } from "@/components/providers";
import { Portal } from "@/components/portal";

export interface EmployeeInput {
  id?: number;
  emp_code: string;
  name: string;
  email: string;
  role: string;
  department_id: number | null;
  shift_id: number | null;
  manager_id: number | null;
  designation: string | null;
  phone: string | null;
  joined_on: string | null;
  require_geofence: number;
  require_selfie: number;
}

type Opt = { id: number; name: string };

export function EmployeeDialog({
  initial,
  departments,
  shifts,
  managers,
  nextCode,
}: {
  initial?: EmployeeInput;
  departments: Opt[];
  shifts: Opt[];
  managers: Opt[];
  nextCode?: string;
}) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const e = initial;
  return (
    <>
      {e ? (
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label={t("Edit")}>
          <Pencil className="size-3.5" />
        </button>
      ) : (
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" /> {t("Add")} {t("Employee")}
        </button>
      )}
      {open && (
        <Portal>
        <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="card rise my-auto w-full max-w-2xl text-start shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h3 className="font-semibold">{e ? `${t("Edit")} · ${e.name}` : `${t("Add")} ${t("Employee")}`}</h3>
              <button onClick={() => setOpen(false)} aria-label={t("Close")}>
                <X className="size-4 text-muted" />
              </button>
            </div>
            <ActionForm action={saveEmployee} className="grid gap-3 p-5 sm:grid-cols-2" onSuccess={() => setOpen(false)} resetOnSuccess={!e}>
              {e?.id && <input type="hidden" name="id" value={e.id} />}
              <Field label="Name">
                <input name="name" required defaultValue={e?.name} className="input" />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required defaultValue={e?.email} className="input" />
              </Field>
              <Field label="Employee code">
                <input name="emp_code" required defaultValue={e?.emp_code ?? nextCode} className="input" />
              </Field>
              <Field label="Role">
                <select name="role" defaultValue={e?.role ?? "employee"} className="input">
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="Department">
                <select name="department_id" defaultValue={e?.department_id ?? ""} className="input">
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Designation">
                <input name="designation" defaultValue={e?.designation ?? ""} className="input" />
              </Field>
              <Field label="Shift">
                <select name="shift_id" defaultValue={e?.shift_id ?? ""} className="input">
                  <option value="">Default</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Manager">
                <select name="manager_id" defaultValue={e?.manager_id ?? ""} className="input">
                  <option value="">—</option>
                  {managers.filter((m) => m.id !== e?.id).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Phone">
                <input name="phone" defaultValue={e?.phone ?? ""} className="input" />
              </Field>
              <Field label="Joining date">
                <input name="joined_on" type="date" defaultValue={e?.joined_on ?? ""} className="input" />
              </Field>
              {!e && (
                <Field label="Password" className="sm:col-span-2">
                  <input name="password" type="text" minLength={8} placeholder="Leave empty to generate a temporary password" className="input" />
                </Field>
              )}
              <div className="flex flex-wrap gap-5 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" name="require_geofence" defaultChecked={!!e?.require_geofence} /> Require office geofence for check-in
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" name="require_selfie" defaultChecked={!!e?.require_selfie} /> Require selfie for check-in
                </label>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{t("Cancel")}</button>
                <SubmitButton>{t("Save")}</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}
