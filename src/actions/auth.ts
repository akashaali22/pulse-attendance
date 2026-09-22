"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { get, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, createSession, destroySession, requireUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/notify";
import { notifyPasswordChange, rememberPasswordOnLogin, setUserPassword, validatePassword } from "@/lib/passwords";

// Simple in-memory brute-force throttle: 8 failures per email+IP per 15 minutes.
const attempts = new Map<string, { n: number; until: number }>();

export async function login(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const key = `${email}|${await clientIp()}`;
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) return fail("Too many attempts. Try again in 15 minutes.");

  const u = get<{ id: number; password_hash: string; status: string }>(
    "SELECT id, password_hash, status FROM users WHERE email = ?",
    email,
  );
  const valid = !!u && u.status === "active" && (await bcrypt.compare(password, u.password_hash));
  if (!valid) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    audit(u?.id ?? null, "LOGIN_FAILED", "user", u?.id ?? null, { email });
    return fail("Invalid email or password");
  }
  attempts.delete(key);
  rememberPasswordOnLogin(u.id, password);
  await createSession(u.id);
  audit(u.id, "LOGIN", "user", u.id);
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function changePassword(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const invalid = validatePassword(next);
  if (invalid) return fail(invalid);
  const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", me.id)!;
  if (!(await bcrypt.compare(current, row.password_hash))) return fail("Current password is incorrect");
  await setUserPassword(me.id, next, "Employee (self)");
  run("DELETE FROM sessions WHERE user_id = ?", me.id);
  await createSession(me.id);
  audit(me.id, "PASSWORD_CHANGED", "user", me.id);
  // Only admins and this employee's manager are told; the password is viewable (audited) by them alone.
  notifyPasswordChange(me.id, me);
  return ok("Password changed");
}

export async function setPreference(name: "lang" | "theme", value: string) {
  const allowed = { lang: ["en", "ur"], theme: ["dark", "light"] }[name];
  if (!allowed?.includes(value)) return;
  (await cookies()).set(name, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
