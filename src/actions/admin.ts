"use server";

import { revalidatePath } from "next/cache";
import { canViewPassword, generatePassword, notifyPasswordChange, passwordViewEnabled, setUserPassword, validatePassword } from "@/lib/passwords";
import { decryptPassword } from "@/lib/secret";
import { get, run, setSetting } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canManage, requireUser } from "@/lib/auth";
import { isHhmm, isIsoDate } from "@/lib/time";
import { fail, ok, type ActionResult } from "@/lib/notify";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOrNull = (f: FormData, k: string) => {
  const v = Number(f.get(k));
  return Number.isInteger(v) && v > 0 ? v : null;
};
const uniqueErr = (e: unknown, what: string) =>
  e instanceof Error && /UNIQUE/.test(e.message) ? fail(`${what} already exists`) : fail(e instanceof Error ? e.message : "Failed");

// ───────────────────────── Employees ─────────────────────────

export async function saveEmployee(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const id = intOrNull(form, "id");
  const data = {
    emp_code: str(form, "emp_code"),
    name: str(form, "name"),
    email: str(form, "email").toLowerCase(),
    role: str(form, "role"),
    department_id: intOrNull(form, "department_id"),
    shift_id: intOrNull(form, "shift_id"),
    manager_id: intOrNull(form, "manager_id"),
    designation: str(form, "designation") || null,
    phone: str(form, "phone") || null,
    joined_on: str(form, "joined_on") || null,
    require_geofence: form.get("require_geofence") === "on" ? 1 : 0,
    require_selfie: form.get("require_selfie") === "on" ? 1 : 0,
  };
  if (!data.emp_code || !data.name) return fail("Employee code and name are required");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return fail("Enter a valid email");
  if (!["admin", "manager", "employee"].includes(data.role)) return fail("Choose a role");
  if (data.joined_on && !isIsoDate(data.joined_on)) return fail("Invalid joining date");
  if (id && data.manager_id === id) return fail("An employee cannot manage themselves");
  if (id === me.id && data.role !== "admin") return fail("You cannot remove your own admin role");

  try {
    if (id) {
      run(
        `UPDATE users SET emp_code=?, name=?, email=?, role=?, department_id=?, shift_id=?, manager_id=?, designation=?, phone=?,
         joined_on=?, require_geofence=?, require_selfie=? WHERE id=?`,
        data.emp_code, data.name, data.email, data.role, data.department_id, data.shift_id, data.manager_id,
        data.designation, data.phone, data.joined_on, data.require_geofence, data.require_selfie, id,
      );
      audit(me.id, "EMPLOYEE_UPDATED", "user", id, data);
      revalidatePath("/employees");
      return ok("Employee updated");
    }
    const typed = str(form, "password");
    const password = typed || generatePassword();
    const invalid = validatePassword(password);
    if (invalid) return fail(invalid);
    const r = run(
      `INSERT INTO users(emp_code, name, email, password_hash, role, department_id, shift_id, manager_id, designation, phone,
       joined_on, require_geofence, require_selfie, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      data.emp_code, data.name, data.email, "!", data.role, data.department_id, data.shift_id,
      data.manager_id, data.designation, data.phone, data.joined_on, data.require_geofence, data.require_selfie, Date.now(),
    );
    await setUserPassword(Number(r.lastInsertRowid), password, typed ? `Admin: ${me.name}` : "System (generated)");
    audit(me.id, "EMPLOYEE_CREATED", "user", Number(r.lastInsertRowid), data);
    revalidatePath("/employees");
    return ok(str(form, "password") ? "Employee created" : `Employee created. Temporary password: ${password}`);
  } catch (e) {
    return uniqueErr(e, "Employee code or email");
  }
}

export async function setEmployeeStatus(id: number, status: "active" | "inactive"): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  if (id === me.id) return fail("You cannot deactivate yourself");
  run("UPDATE users SET status = ? WHERE id = ?", status, id);
  if (status === "inactive") run("DELETE FROM sessions WHERE user_id = ?", id);
  audit(me.id, status === "active" ? "EMPLOYEE_ACTIVATED" : "EMPLOYEE_DEACTIVATED", "user", id);
  revalidatePath("/employees");
  return ok(status === "active" ? "Employee activated" : "Employee deactivated");
}

/** Admin sets a password (or leaves it empty to generate one). The employee is signed out everywhere. */
/** Admin (anyone) or manager (own team only) sets a password; empty = generate one. The user is signed out everywhere. */
export async function setPasswordByAdmin(id: number, typed: string): Promise<ActionResult & { password?: string }> {
  const me = await requireUser(["admin", "manager"]);
  const target = get<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", id);
  if (!target) return fail("Employee not found");
  if (me.role !== "admin" && !canManage(me, id)) return fail("You can only change passwords of your own team");
  const password = typed.trim() || generatePassword();
  const invalid = validatePassword(password);
  if (invalid) return fail(invalid);
  const label = me.role === "admin" ? `Admin: ${me.name}` : `Manager: ${me.name}`;
  await setUserPassword(id, password, typed.trim() ? label : `System (generated by ${me.name})`);
  if (id !== me.id) run("DELETE FROM sessions WHERE user_id = ?", id);
  audit(me.id, "PASSWORD_SET_BY_ADMIN", "user", id, { generated: !typed.trim(), role: me.role });
  notifyPasswordChange(id, me);
  revalidatePath("/employees");
  return { ok: true, message: `Password updated for ${target.name}`, password };
}

/** Audited: decrypts a stored password for an admin, the user's own manager, or the user. */
export async function revealPassword(id: number): Promise<{ ok: boolean; password?: string | null; setBy?: string | null; changedAt?: number | null; error?: string }> {
  const me = await requireUser();
  if (!canViewPassword(me, id)) {
    audit(me.id, "PASSWORD_VIEW_DENIED", "user", id);
    return { ok: false, error: passwordViewEnabled() ? "You are not allowed to view this password" : "Password viewing is turned off for this company" };
  }
  const u = get<{ password_enc: string | null; password_set_by: string | null; password_changed_at: number | null }>(
    "SELECT password_enc, password_set_by, password_changed_at FROM users WHERE id = ?",
    id,
  );
  if (!u) return { ok: false, error: "Employee not found" };
  audit(me.id, "PASSWORD_VIEWED", "user", id);
  return { ok: true, password: decryptPassword(u.password_enc), setBy: u.password_set_by, changedAt: u.password_changed_at };
}

// ───────────────────────── Settings ─────────────────────────

export async function saveCompany(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const name = str(form, "company_name");
  const tz = str(form, "timezone");
  const ips = str(form, "allowed_ips");
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return fail("Unknown timezone");
  }
  if (!name) return fail("Company name is required");
  const allowance = Number(form.get("weekly_late_allowance"));
  if (!Number.isInteger(allowance) || allowance < 0 || allowance > 2400) return fail("Weekly late allowance must be 0–2400 minutes");
  const order = str(form, "late_penalty_order").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]+(,[A-Z0-9]+)*$/.test(order)) return fail("Penalty order must be leave codes like CL,AL,UL");
  setSetting("allow_password_view", form.get("allow_password_view") === "on" ? "1" : "0");
  setSetting("weekly_late_allowance", String(allowance));
  setSetting("late_penalty_order", order);
  setSetting("company_name", name);
  setSetting("timezone", tz);
  setSetting("allowed_ips", ips);
  audit(me.id, "SETTINGS_UPDATED", "settings", null, { name, tz, ips, allowance, order });
  revalidatePath("/", "layout");
  return ok("Settings saved");
}

export async function saveShift(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const id = intOrNull(form, "id");
  const start = str(form, "start_time");
  const end = str(form, "end_time");
  const days = form.getAll("working_days").map(Number).filter((d) => d >= 0 && d <= 6);
  const nums = ["grace_minutes", "half_day_minutes", "full_day_minutes"].map((k) => Number(form.get(k)));
  const name = str(form, "name");
  if (!name) return fail("Name is required");
  if (!isHhmm(start) || !isHhmm(end) || end <= start) return fail("End time must be after start time (overnight shifts are not supported yet)");
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return fail("Minutes must be positive numbers");
  if (nums[1] > nums[2]) return fail("Half-day threshold must be below full-day threshold");
  if (days.length === 0) return fail("Select at least one working day");
  const bStart = str(form, "break_start");
  const bEnd = str(form, "break_end");
  if ((bStart || bEnd) && (!isHhmm(bStart) || !isHhmm(bEnd) || bEnd <= bStart || bStart < start || bEnd > end))
    return fail("Break must be inside the shift and end after it starts");
  const isDefault = form.get("is_default") === "on" ? 1 : 0;
  if (isDefault) run("UPDATE shifts SET is_default = 0");
  const params = [name, start, end, nums[0], nums[1], nums[2], days.sort().join(","), isDefault, bStart || null, bEnd || null];
  if (id)
    run(
      "UPDATE shifts SET name=?, start_time=?, end_time=?, grace_minutes=?, half_day_minutes=?, full_day_minutes=?, working_days=?, is_default=?, break_start=?, break_end=? WHERE id=?",
      ...params,
      id,
    );
  else
    run(
      "INSERT INTO shifts(name, start_time, end_time, grace_minutes, half_day_minutes, full_day_minutes, working_days, is_default, break_start, break_end) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ...params,
    );
  audit(me.id, id ? "SHIFT_UPDATED" : "SHIFT_CREATED", "shift", id, { name, start, end, days });
  revalidatePath("/settings");
  return ok("Shift saved");
}

export async function saveLocation(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const id = intOrNull(form, "id");
  const name = str(form, "name");
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const radius = Number(form.get("radius_m"));
  if (!name) return fail("Name is required");
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return fail("Invalid coordinates");
  if (!(radius >= 20 && radius <= 5000)) return fail("Radius must be 20–5000 m");
  const active = form.get("active") === "on" ? 1 : 0;
  if (id) run("UPDATE locations SET name=?, lat=?, lng=?, radius_m=?, active=? WHERE id=?", name, lat, lng, radius, active, id);
  else run("INSERT INTO locations(name, lat, lng, radius_m, active) VALUES (?,?,?,?,?)", name, lat, lng, radius, active);
  audit(me.id, id ? "LOCATION_UPDATED" : "LOCATION_CREATED", "location", id, { name, lat, lng, radius, active });
  revalidatePath("/settings");
  return ok("Location saved");
}

export async function saveDepartment(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const name = str(form, "name");
  if (!name) return fail("Name is required");
  try {
    run("INSERT INTO departments(name, created_at) VALUES (?, ?)", name, Date.now());
  } catch (e) {
    return uniqueErr(e, "Department");
  }
  audit(me.id, "DEPARTMENT_CREATED", "department", null, { name });
  revalidatePath("/settings");
  return ok("Department added");
}

export async function saveHoliday(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const date = str(form, "date");
  const name = str(form, "name");
  if (!isIsoDate(date) || !name) return fail("Date and name are required");
  try {
    run("INSERT INTO holidays(date, name) VALUES (?, ?)", date, name);
  } catch (e) {
    return uniqueErr(e, "A holiday on this date");
  }
  audit(me.id, "HOLIDAY_CREATED", "holiday", null, { date, name });
  revalidatePath("/", "layout");
  return ok("Holiday added");
}

export async function saveLeaveType(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const id = intOrNull(form, "id");
  const name = str(form, "name");
  const code = str(form, "code").toUpperCase();
  const quota = Number(form.get("annual_quota"));
  const color = str(form, "color") || "#6366f1";
  if (!name || !code) return fail("Name and code are required");
  if (!(quota >= 0 && quota <= 365)) return fail("Quota must be 0–365 (0 = unlimited)");
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fail("Invalid color");
  const paid = form.get("paid") === "on" ? 1 : 0;
  try {
    if (id) run("UPDATE leave_types SET name=?, code=?, annual_quota=?, color=?, paid=? WHERE id=?", name, code, quota, color, paid, id);
    else run("INSERT INTO leave_types(name, code, annual_quota, color, paid) VALUES (?,?,?,?,?)", name, code, quota, color, paid);
  } catch (e) {
    return uniqueErr(e, "Leave code");
  }
  audit(me.id, id ? "LEAVE_TYPE_UPDATED" : "LEAVE_TYPE_CREATED", "leave_type", id, { name, code, quota });
  revalidatePath("/settings");
  return ok("Leave type saved");
}

type Removable = "shifts" | "locations" | "departments" | "holidays" | "leave_types";
export async function removeItem(table: Removable, id: number): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  if (!["shifts", "locations", "departments", "holidays", "leave_types"].includes(table)) return fail("Invalid item");
  if (table === "leave_types") {
    if (get("SELECT id FROM leave_requests WHERE leave_type_id = ? LIMIT 1", id)) {
      run("UPDATE leave_types SET active = 0 WHERE id = ?", id);
      audit(me.id, "LEAVE_TYPE_ARCHIVED", table, id);
      revalidatePath("/settings");
      return ok("Leave type archived (it has history)");
    }
  }
  if (table === "shifts" && get<{ n: number }>("SELECT COUNT(*) AS n FROM shifts")!.n <= 1) return fail("Keep at least one shift");
  run(`DELETE FROM ${table} WHERE id = ?`, id);
  audit(me.id, "DELETED", table, id);
  revalidatePath("/", "layout");
  return ok("Removed");
}

// ───────────────────────── Desktop agent ─────────────────────────

export async function saveAgentSettings(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const away = Number(form.get("agent_away_minutes"));
  const offline = Number(form.get("agent_offline_minutes"));
  if (!Number.isInteger(away) || away < 5 || away > 480) return fail("Away limit must be 5–480 minutes");
  if (!Number.isInteger(offline) || offline < 3 || offline > 240) return fail("Offline limit must be 3–240 minutes");
  setSetting("agent_away_minutes", String(away));
  setSetting("agent_offline_minutes", String(offline));
  audit(me.id, "AGENT_SETTINGS_UPDATED", "settings", null, { away, offline });
  revalidatePath("/settings");
  return ok("Settings saved");
}

export async function revokeDevice(id: number): Promise<ActionResult> {
  const me = await requireUser(["admin"]);
  const r = run("UPDATE devices SET revoked = 1 WHERE id = ? AND revoked = 0", id);
  if (!r.changes) return fail("Device not found");
  audit(me.id, "AGENT_DEVICE_REVOKED", "device", id);
  revalidatePath("/settings");
  return ok("PC unlinked");
}

// ───────────────────────── Notifications ─────────────────────────

export async function markNotificationsRead(id?: number): Promise<void> {
  const me = await requireUser();
  if (id) run("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", id, me.id);
  else run("UPDATE notifications SET read = 1 WHERE user_id = ?", me.id);
  revalidatePath("/", "layout");
}
