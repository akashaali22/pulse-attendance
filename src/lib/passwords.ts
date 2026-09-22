import "server-only";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { all, get, getSetting, run } from "./db";
import { encryptPassword } from "./secret";
import { notify } from "./notify";

/**
 * Who may SEE a user's password: admins (everyone), that user's own manager, and the user.
 * Nobody else — not other managers, not colleagues.
 */
export const passwordViewEnabled = () => getSetting("allow_password_view", "1") === "1";

/** The seeded admin password. A fresh install warns until it is changed. */
export const DEFAULT_ADMIN_PASSWORD = "Admin@123";
export async function usesDefaultPassword(userId: number): Promise<boolean> {
  const u = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);
  return !!u && (await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, u.password_hash));
}

export function canViewPassword(viewer: { id: number; role: string }, targetId: number): boolean {
  if (!passwordViewEnabled()) return false;
  if (viewer.id === targetId || viewer.role === "admin") return true;
  if (viewer.role !== "manager") return false;
  return get<{ manager_id: number | null }>("SELECT manager_id FROM users WHERE id = ?", targetId)?.manager_id === viewer.id;
}

/** Notifies exactly the people allowed to see the password: admins, the user's manager, the user. Never the actor. */
export function notifyPasswordChange(userId: number, actor: { id: number; name: string }) {
  const user = get<{ id: number; name: string; emp_code: string; manager_id: number | null }>(
    "SELECT id, name, emp_code, manager_id FROM users WHERE id = ?",
    userId,
  );
  if (!user) return;
  const recipients = new Set<number>(all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id));
  if (user.manager_id) recipients.add(user.manager_id);
  recipients.add(user.id);
  recipients.delete(actor.id);

  const by = actor.id === user.id ? "themselves" : actor.name;
  for (const id of recipients) {
    if (id === user.id) notify(id, "Your password was changed", `Changed by ${by}. You can view it on your Profile.`, "/profile");
    else notify(id, `${user.name}'s password was changed`, `${user.emp_code} · changed by ${by}`, `/employees?q=${encodeURIComponent(user.emp_code)}`);
  }
}

export const generatePassword = () => {
  // Readable temporary password with the symbol in the middle so it is not missed: e.g. "Kmr@4821"
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const pick = (s: string) => s[crypto.randomInt(s.length)];
  return `${pick(letters)}${pick(lower)}${pick(lower)}@${crypto.randomInt(1000, 10000)}`;
};

export function validatePassword(p: string): string | null {
  if (p.length < 8) return "Password must be at least 8 characters";
  if (p.length > 100) return "Password is too long";
  return null;
}

/** Sets login hash + admin-viewable encrypted copy. `setBy` is shown to admins (e.g. "Employee", "Admin: Sara"). */
export async function setUserPassword(userId: number, plain: string, setBy: string) {
  run(
    "UPDATE users SET password_hash = ?, password_enc = ?, password_changed_at = ?, password_set_by = ? WHERE id = ?",
    await bcrypt.hash(plain, 10),
    encryptPassword(plain),
    Date.now(),
    setBy.slice(0, 60),
    userId,
  );
}

/** Users created before this feature: capture the password the first time they log in successfully. */
export function rememberPasswordOnLogin(userId: number, plain: string) {
  const u = get<{ password_enc: string | null }>("SELECT password_enc FROM users WHERE id = ?", userId);
  if (u && !u.password_enc) run("UPDATE users SET password_enc = ?, password_set_by = COALESCE(password_set_by, 'Captured at login') WHERE id = ?", encryptPassword(plain), userId);
}
