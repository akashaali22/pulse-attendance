"use server";

import { revalidatePath } from "next/cache";
import { all, get, run, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canManage, requireUser } from "@/lib/auth";
import { computeRange, getTz, leaveBalances, todayLocal } from "@/lib/data";
import { isHhmm, isIsoDate, zonedToUtc } from "@/lib/time";
import { fail, notify, notifyApprovers, ok, type ActionResult } from "@/lib/notify";
import { syncLatePenalty } from "@/lib/penalty";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ───────────────────────── Leave ─────────────────────────

export async function applyLeave(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const typeId = Number(form.get("leave_type_id"));
  const start = str(form, "start_date");
  const end = str(form, "end_date") || start;
  const half = form.get("half_day") === "on";
  const reason = str(form, "reason");
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return fail("Choose a valid date range");
  if (half && start !== end) return fail("Half-day leave must be a single date");
  if (reason.length < 3) return fail("Please give a reason");
  const type = get<{ id: number; name: string; annual_quota: number }>("SELECT id, name, annual_quota FROM leave_types WHERE id = ? AND active = 1", typeId);
  if (!type) return fail("Choose a leave type");
  if (start.slice(0, 4) !== end.slice(0, 4)) return fail("Split leave that crosses a year into two requests");

  const overlap = get("SELECT id FROM leave_requests WHERE user_id = ? AND status IN ('pending','approved') AND start_date <= ? AND end_date >= ?", me.id, end, start);
  if (overlap) return fail("You already have leave on these dates");

  // Count only scheduled working days that are not holidays.
  const days = computeRange([{ id: me.id, shift_id: me.shift_id }], start, end)
    .get(me.id)!
    .filter((d) => d.status !== "WEEKEND" && d.status !== "HOLIDAY").length;
  const count = half ? 0.5 : days;
  if (count === 0) return fail("Those dates are all weekends or holidays");

  if (type.annual_quota > 0) {
    const bal = leaveBalances(me.id, start.slice(0, 4)).find((b) => b.id === type.id);
    if (bal && count > bal.remaining) return fail(`Not enough ${type.name} balance (${bal.remaining} day(s) left)`);
  }

  const r = run(
    "INSERT INTO leave_requests(user_id, leave_type_id, start_date, end_date, days, half_day, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    me.id,
    type.id,
    start,
    end,
    count,
    half ? 1 : 0,
    reason.slice(0, 500),
    Date.now(),
  );
  audit(me.id, "LEAVE_REQUESTED", "leave_request", Number(r.lastInsertRowid), { type: type.name, start, end, days: count });
  notifyApprovers(me.id, me.manager_id, "New leave request", `${me.name}: ${type.name}, ${start}${end !== start ? ` → ${end}` : ""} (${count} day)`, "/approvals");
  revalidatePath("/leave");
  return ok("Leave request submitted");
}

export async function cancelLeave(id: number): Promise<ActionResult> {
  const me = await requireUser();
  const r = get<{ status: string; start_date: string }>("SELECT status, start_date FROM leave_requests WHERE id = ? AND user_id = ?", id, me.id);
  if (!r) return fail("Request not found");
  if (r.status === "approved" && r.start_date <= todayLocal()) return fail("Leave that has started can only be changed by your manager");
  if (r.status !== "pending" && r.status !== "approved") return fail("This request can no longer be cancelled");
  run("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?", id);
  audit(me.id, "LEAVE_CANCELLED", "leave_request", id);
  revalidatePath("/leave");
  return ok("Request cancelled");
}

export async function reviewLeave(id: number, decision: "approved" | "rejected", note: string): Promise<ActionResult> {
  const me = await requireUser(["admin", "manager"]);
  const r = get<{ user_id: number; status: string; start_date: string; end_date: string }>(
    "SELECT user_id, status, start_date, end_date FROM leave_requests WHERE id = ?",
    id,
  );
  if (!r) return fail("Request not found");
  if (r.user_id === me.id || !canManage(me, r.user_id)) return fail("You cannot review this request");
  if (r.status !== "pending") return fail("Already reviewed");
  run("UPDATE leave_requests SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?", decision, me.id, note.slice(0, 300) || null, Date.now(), id);
  audit(me.id, decision === "approved" ? "LEAVE_APPROVED" : "LEAVE_REJECTED", "leave_request", id, { note });
  if (decision === "approved" && r.start_date <= todayLocal()) syncLatePenalty(r.user_id, r.start_date);
  notify(r.user_id, `Leave ${decision}`, `${r.start_date}${r.end_date !== r.start_date ? ` → ${r.end_date}` : ""} by ${me.name}${note ? `: ${note}` : ""}`, "/leave");
  revalidatePath("/", "layout");
  return ok(decision === "approved" ? "Leave approved" : "Leave rejected");
}

// ───────────────────── Regularization ─────────────────────

export async function requestCorrection(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await requireUser();
  const date = str(form, "work_date");
  const inT = str(form, "check_in");
  const outT = str(form, "check_out");
  const reason = str(form, "reason");
  if (!isIsoDate(date) || date > todayLocal()) return fail("Choose today or a past date");
  if (!inT && !outT) return fail("Enter a check-in or check-out time");
  if ((inT && !isHhmm(inT)) || (outT && !isHhmm(outT))) return fail("Use HH:MM times");
  if (inT && outT && outT <= inT) return fail("Check-out must be after check-in");
  if (reason.length < 3) return fail("Please give a reason");
  if (get("SELECT id FROM regularizations WHERE user_id = ? AND work_date = ? AND status = 'pending'", me.id, date))
    return fail("You already have a pending correction for this date");

  const r = run(
    "INSERT INTO regularizations(user_id, work_date, check_in, check_out, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    me.id,
    date,
    inT || null,
    outT || null,
    reason.slice(0, 500),
    Date.now(),
  );
  audit(me.id, "CORRECTION_REQUESTED", "regularization", Number(r.lastInsertRowid), { date, inT, outT });
  notifyApprovers(me.id, me.manager_id, "Attendance correction request", `${me.name} · ${date} · ${inT || "—"} → ${outT || "—"}`, "/approvals");
  revalidatePath("/corrections");
  return ok("Correction request submitted");
}

export async function cancelCorrection(id: number): Promise<ActionResult> {
  const me = await requireUser();
  const r = run("UPDATE regularizations SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'", id, me.id);
  if (!r.changes) return fail("Only pending requests can be cancelled");
  audit(me.id, "CORRECTION_CANCELLED", "regularization", id);
  revalidatePath("/corrections");
  return ok("Request cancelled");
}

export async function reviewCorrection(id: number, decision: "approved" | "rejected", note: string): Promise<ActionResult> {
  const me = await requireUser(["admin", "manager"]);
  const r = get<{ user_id: number; status: string; work_date: string; check_in: string | null; check_out: string | null }>(
    "SELECT user_id, status, work_date, check_in, check_out FROM regularizations WHERE id = ?",
    id,
  );
  if (!r) return fail("Request not found");
  if (r.user_id === me.id || !canManage(me, r.user_id)) return fail("You cannot review this request");
  if (r.status !== "pending") return fail("Already reviewed");

  tx(() => {
    run("UPDATE regularizations SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?", decision, me.id, note.slice(0, 300) || null, Date.now(), id);
    if (decision !== "approved") return;
    applyCorrection(r.user_id, r.work_date, r.check_in, r.check_out, "REGULARIZED");
  });
  audit(me.id, decision === "approved" ? "CORRECTION_APPROVED" : "CORRECTION_REJECTED", "regularization", id, { note, ...r });
  if (decision === "approved") syncLatePenalty(r.user_id, r.work_date);
  notify(r.user_id, `Correction ${decision}`, `${r.work_date} by ${me.name}${note ? `: ${note}` : ""}`, "/corrections");
  revalidatePath("/", "layout");
  return ok(decision === "approved" ? "Correction applied" : "Correction rejected");
}

/**
 * Both times → the day is replaced by one clean session.
 * Only check-in → replaces the earliest IN. Only check-out → replaces the latest OUT.
 * Old punches are voided (never deleted) so the evidence remains.
 */
function applyCorrection(userId: number, date: string, inT: string | null, outT: string | null, source: string) {
  const tz = getTz();
  const now = Date.now();
  const existing = all<{ id: number; type: string; ts: number }>(
    "SELECT id, type, ts FROM punches WHERE user_id = ? AND work_date = ? AND voided = 0 ORDER BY ts",
    userId,
    date,
  );
  const voidIds: number[] = [];
  if (inT && outT) voidIds.push(...existing.map((p) => p.id));
  else if (inT) {
    const firstIn = existing.find((p) => p.type === "IN");
    if (firstIn) voidIds.push(firstIn.id);
  } else if (outT) {
    const lastOut = [...existing].reverse().find((p) => p.type === "OUT");
    if (lastOut) voidIds.push(lastOut.id);
  }
  for (const id of voidIds) run("UPDATE punches SET voided = 1 WHERE id = ?", id);
  const ins = (type: string, hhmm: string) =>
    run(
      "INSERT INTO punches(user_id, type, ts, work_date, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      userId,
      type,
      zonedToUtc(date, hhmm, tz),
      date,
      source,
      now,
    );
  if (inT) ins("IN", inT);
  if (outT) ins("OUT", outT);
}

/** Direct edit by an admin/manager (no request needed) — always audited. */
export async function adminCorrectDay(userId: number, date: string, inT: string, outT: string, reason: string): Promise<ActionResult> {
  const me = await requireUser(["admin", "manager"]);
  if (!canManage(me, userId) || userId === me.id) return fail("You cannot edit this employee");
  if (!isIsoDate(date) || date > todayLocal()) return fail("Choose today or a past date");
  if ((inT && !isHhmm(inT)) || (outT && !isHhmm(outT)) || (!inT && !outT)) return fail("Use HH:MM times");
  if (inT && outT && outT <= inT) return fail("Check-out must be after check-in");
  if (reason.trim().length < 3) return fail("Please give a reason");
  tx(() => applyCorrection(userId, date, inT || null, outT || null, "ADMIN"));
  audit(me.id, "ATTENDANCE_EDITED", "punch", `${userId}:${date}`, { inT, outT, reason });
  syncLatePenalty(userId, date);
  notify(userId, "Attendance updated", `${date} was edited by ${me.name}: ${reason}`, "/attendance");
  revalidatePath("/", "layout");
  return ok("Attendance updated");
}
