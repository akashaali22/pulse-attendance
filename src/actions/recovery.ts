"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { all, get, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canManage, clientIp, requireUser } from "@/lib/auth";
import { fail, notify, ok, type ActionResult } from "@/lib/notify";
import { setUserPassword, validatePassword } from "@/lib/passwords";

// Forgotten passwords, without an email server:
//  • an employee asks their admin from the login page — admins get a notification and reset it
//  • an admin who is locked out uses ADMIN_RECOVERY_CODE, which only whoever runs the server knows

const attempts = new Map<string, { n: number; until: number }>();
function throttled(key: string, limit = 5): boolean {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.n >= limit) return true;
  attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
  return false;
}

/** Public: "I forgot my password" → the admins (and the employee's manager) are told. */
export async function requestPasswordReset(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const note = String(form.get("note") ?? "").trim().slice(0, 200);
  const ip = await clientIp();
  const neutral = ok("If that account exists, your admin has been asked to reset the password.");
  if (throttled(`req|${ip}`, 8)) return fail("Too many requests. Try again in 15 minutes.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter a valid email");

  const user = get<{ id: number; name: string; emp_code: string; manager_id: number | null; status: string }>(
    "SELECT id, name, emp_code, manager_id, status FROM users WHERE email = ? COLLATE NOCASE",
    email,
  );
  // Same answer either way, so nobody can use this to find out who has an account.
  if (!user || user.status !== "active") return neutral;

  const existing = get<{ id: number }>("SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'", user.id);
  if (!existing) {
    run("INSERT INTO password_reset_requests(user_id, note, ip, created_at) VALUES (?, ?, ?, ?)", user.id, note || null, ip, Date.now());
    const targets = new Set<number>(all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id));
    if (user.manager_id) targets.add(user.manager_id);
    for (const id of targets) {
      notify(id, `${user.name} forgot their password`, `${user.emp_code}${note ? ` · "${note}"` : ""} — open Employees to set a new one`, `/employees?q=${encodeURIComponent(user.emp_code)}`);
    }
  }
  audit(null, "PASSWORD_RESET_REQUESTED", "user", user.id, { ip, repeat: !!existing });
  // No revalidatePath here: the caller is signed out, and refreshing the tree from a public
  // page wipes the confirmation before it is read. /employees is dynamic and reloads anyway.
  return neutral;
}

/** Admin locked out: prove it with the recovery code from the server's environment. */
export async function resetWithRecoveryCode(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const expected = (process.env.ADMIN_RECOVERY_CODE ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const code = String(form.get("code") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();

  if (!expected) return fail("Admin recovery is switched off. Set ADMIN_RECOVERY_CODE on the server to use it.");
  if (throttled(`code|${ip}`, 5)) return fail("Too many attempts. Try again in 15 minutes.");

  const user = get<{ id: number; name: string; role: string; status: string }>(
    "SELECT id, name, role, status FROM users WHERE email = ? COLLATE NOCASE",
    email,
  );
  const codeOk =
    code.length === expected.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected));
  if (!user || user.role !== "admin" || user.status !== "active" || !codeOk) {
    audit(user?.id ?? null, "ADMIN_RECOVERY_FAILED", "user", user?.id ?? null, { email, ip });
    return fail("That email and recovery code do not match an admin account.");
  }
  const invalid = validatePassword(password);
  if (invalid) return fail(invalid);

  await setUserPassword(user.id, password, "Admin recovery code");
  run("DELETE FROM sessions WHERE user_id = ?", user.id);
  run("UPDATE password_reset_requests SET status = 'done', handled_at = ? WHERE user_id = ? AND status = 'pending'", Date.now(), user.id);
  attempts.delete(`code|${ip}`);
  audit(user.id, "ADMIN_RECOVERY_USED", "user", user.id, { ip });
  for (const a of all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id != ?", user.id)) {
    notify(a.id, "Admin password was recovered", `${user.name} set a new password using the server recovery code.`, "/audit");
  }
  return ok("Password changed. Sign in with the new one.");
}

/** Admin/manager marks a request as handled without changing anything. */
export async function dismissResetRequest(id: number): Promise<ActionResult> {
  const me = await requireUser(["admin", "manager"]);
  const r = get<{ user_id: number }>("SELECT user_id FROM password_reset_requests WHERE id = ? AND status = 'pending'", id);
  if (!r) return fail("Request not found");
  if (me.role !== "admin" && !canManage(me, r.user_id)) return fail("That employee is not on your team");
  run("UPDATE password_reset_requests SET status = 'dismissed', handled_by = ?, handled_at = ? WHERE id = ?", me.id, Date.now(), id);
  audit(me.id, "PASSWORD_RESET_DISMISSED", "user", r.user_id);
  revalidatePath("/employees");
  return ok("Request dismissed");
}

export interface ResetRequest {
  id: number;
  user_id: number;
  name: string;
  emp_code: string;
  email: string;
  note: string | null;
  created_at: number;
}

export async function pendingResetRequests(): Promise<ResetRequest[]> {
  const me = await requireUser(["admin", "manager"]);
  const scope = me.role === "admin" ? "" : `AND u.manager_id = ${Number(me.id)}`;
  return all<ResetRequest>(
    `SELECT r.id, r.user_id, u.name, u.emp_code, u.email, r.note, r.created_at
     FROM password_reset_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' ${scope} ORDER BY r.created_at DESC LIMIT 50`,
  );
}
