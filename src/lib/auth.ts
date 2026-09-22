import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { get, run } from "./db";

export type Role = "admin" | "manager" | "employee";
export interface SessionUser {
  id: number;
  emp_code: string;
  name: string;
  email: string;
  role: Role;
  department_id: number | null;
  department: string | null;
  shift_id: number | null;
  manager_id: number | null;
  designation: string | null;
  require_geofence: number;
  require_selfie: number;
}

export const SESSION_COOKIE = "att_session";
const SESSION_DAYS = 14;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().replace(/^::ffff:/, "");
}

export async function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expires = now + SESSION_DAYS * 86400_000;
  const h = await headers();
  run(
    "INSERT INTO sessions(token_hash, user_id, expires_at, created_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    sha256(token),
    userId,
    expires,
    now,
    await clientIp(),
    (h.get("user-agent") ?? "").slice(0, 200),
  );
  run("DELETE FROM sessions WHERE expires_at < ?", now);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: new Date(expires),
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  jar.delete(SESSION_COOKIE);
}

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const u = get<SessionUser>(
    `SELECT u.id, u.emp_code, u.name, u.email, u.role, u.department_id, d.name AS department, u.shift_id,
            u.manager_id, u.designation, u.require_geofence, u.require_selfie
     FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    sha256(token),
    Date.now(),
  );
  return u ?? null;
});

/** Use in pages/actions. Redirects to login when signed out, and to the dashboard when the role is not allowed. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect("/dashboard");
  return u;
}

export const isManager = (u: SessionUser) => u.role === "admin" || u.role === "manager";

/** IDs of users this user may manage (admin: everyone; manager: direct reports; employee: none). */
export function managedUserFilter(u: SessionUser): { sql: string; params: number[] } {
  if (u.role === "admin") return { sql: "1=1", params: [] };
  if (u.role === "manager") return { sql: "(u.manager_id = ? OR u.id = ?)", params: [u.id, u.id] };
  return { sql: "u.id = ?", params: [u.id] };
}

export function canManage(actor: SessionUser, targetUserId: number): boolean {
  if (actor.role === "admin") return true;
  if (actor.role !== "manager") return false;
  const t = get<{ manager_id: number | null }>("SELECT manager_id FROM users WHERE id = ?", targetUserId);
  return t?.manager_id === actor.id;
}
