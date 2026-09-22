"use server";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { all, DATA_DIR, getSetting, run } from "@/lib/db";
import { clientIp, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildSessions, type PunchType } from "@/lib/engine";
import { getTz } from "@/lib/data";
import { ipAllowed, matchFence, type Fence } from "@/lib/geo";
import { verifyKioskToken } from "@/lib/kiosk";
import { localDate } from "@/lib/time";
import { fail, ok, type ActionResult } from "@/lib/notify";
import { syncLatePenalty } from "@/lib/penalty";

export interface PunchPayload {
  type: PunchType;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  selfie?: string | null; // data:image/jpeg;base64,...
  kioskToken?: string | null;
}

const TYPES: PunchType[] = ["IN", "OUT", "BREAK_START", "BREAK_END"];

export async function punch(p: PunchPayload): Promise<ActionResult> {
  const me = await requireUser();
  if (!TYPES.includes(p.type)) return fail("Invalid punch type");

  const now = Date.now();
  const tz = getTz();
  const workDate = localDate(now, tz);

  // Only allow transitions that make sense from the current state.
  const todays = all<{ type: PunchType; ts: number }>(
    "SELECT type, ts FROM punches WHERE user_id = ? AND work_date = ? AND voided = 0",
    me.id,
    workDate,
  );
  const { sessions } = buildSessions(todays);
  const open = sessions.find((s) => s.end === null);
  const onBreak = !!open?.breaks.some((b) => b.end === null);
  const allowed: PunchType[] = !open ? ["IN"] : onBreak ? ["BREAK_END", "OUT"] : ["BREAK_START", "OUT"];
  if (!allowed.includes(p.type)) return fail("That action is not available right now. Refresh and try again.");

  const ip = await clientIp();
  if (!ipAllowed(ip, getSetting("allowed_ips"))) return fail(`Check-in is not allowed from this network (${ip}).`);

  let source = "WEB";
  if (p.kioskToken) {
    // Scan must be fresh (checked on /scan); allow ~2 minutes to press the button after scanning.
    if (!verifyKioskToken(p.kioskToken, 8)) return fail("Invalid or expired QR code");
    source = "QR";
  }

  // Geofence
  const hasCoords = Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const fences = all<Fence>("SELECT id, name, lat, lng, radius_m FROM locations WHERE active = 1");
  let locationId: number | null = null;
  const flags: string[] = [];
  if (hasCoords && fences.length) {
    const m = matchFence(p.lat!, p.lng!, p.accuracy ?? 0, fences);
    if (m.inside) locationId = m.nearest!.fence.id;
    else flags.push(`Outside geofence (${Math.round(m.nearest!.distance)} m from ${m.nearest!.fence.name})`);
  }
  if (me.require_geofence && fences.length && p.type === "IN") {
    if (!hasCoords) return fail("Location required");
    if (!locationId) return fail(`You are outside the allowed office area. ${flags[0] ?? ""}`.trim());
  }
  if (!hasCoords) flags.push("No location");

  // Selfie
  let selfiePath: string | null = null;
  if (p.selfie) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p.selfie);
    if (!m) return fail("Invalid selfie image");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 600_000) return fail("Selfie image is too large");
    const dir = path.join(DATA_DIR, "selfies");
    fs.mkdirSync(dir, { recursive: true });
    selfiePath = `${crypto.randomUUID()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    fs.writeFileSync(path.join(dir, selfiePath), buf);
  } else if (me.require_selfie && p.type === "IN") {
    return fail("Selfie required");
  }

  const flagged = flags.some((f) => f.startsWith("Outside")) ? 1 : 0;
  const r = run(
    `INSERT INTO punches(user_id, type, ts, work_date, source, lat, lng, accuracy, location_id, ip, selfie_path, flagged, flag_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    me.id,
    p.type,
    now,
    workDate,
    source,
    hasCoords ? p.lat! : null,
    hasCoords ? p.lng! : null,
    p.accuracy ?? null,
    locationId,
    ip,
    selfiePath,
    flagged,
    flags.length ? flags.join("; ") : null,
    now,
  );
  audit(me.id, `PUNCH_${p.type}`, "punch", Number(r.lastInsertRowid), { source, ip, locationId, flags });
  if (p.type === "IN") syncLatePenalty(me.id, workDate);
  revalidatePath("/", "layout");

  const msg: Record<PunchType, string> = {
    IN: "Checked in",
    OUT: "Checked out",
    BREAK_START: "Break started",
    BREAK_END: "Welcome back",
  };
  return ok(msg[p.type]);
}
