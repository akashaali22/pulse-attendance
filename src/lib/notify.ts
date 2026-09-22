import "server-only";
import { all, run } from "./db";

export function notify(userId: number, title: string, body?: string, link?: string) {
  run("INSERT INTO notifications(user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)", userId, title, body ?? null, link ?? null, Date.now());
}

/** Notify the approvers of a user: their manager, or every admin when they have none. */
export function notifyApprovers(userId: number, managerId: number | null, title: string, body: string, link: string) {
  const targets = managerId
    ? [managerId]
    : all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id != ?", userId).map((r) => r.id);
  for (const id of targets) notify(id, title, body, link);
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (error: string): ActionResult => ({ ok: false, error });
