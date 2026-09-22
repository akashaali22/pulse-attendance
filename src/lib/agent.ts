import "server-only";
import crypto from "node:crypto";
import { all, get, getSetting, run, tx } from "./db";
import { audit } from "./audit";
import { computeUserDay, getTz, shiftRules, todayLocal } from "./data";
import { buildSessions, DEFAULT_SHIFT, type PunchType } from "./engine";
import { syncLatePenalty } from "./penalty";
import { localDate, zonedToUtc } from "./time";

// Windows desktop agent: the PC reports logon / unlock / heartbeat / shutdown and the server turns
// that into punches. Times are always derived from the SERVER clock (event age in ms), so changing
// the PC's clock cannot move a check-in.

export const MAX_EVENT_AGE_MS = 72 * 3600_000;
export const awayMinutes = () => Math.max(5, Number(getSetting("agent_away_minutes", "30")) || 30);
export const offlineMinutes = () => Math.max(3, Number(getSetting("agent_offline_minutes", "10")) || 10);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export interface AgentDevice {
  id: number;
  user_id: number;
  name: string;
  revoked: number;
}
export interface AgentUser {
  id: number;
  name: string;
  emp_code: string;
  shift_id: number | null;
  status: string;
}

export function createDevice(userId: number, name: string, version: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  run(
    "INSERT INTO devices(user_id, name, token_hash, agent_version, created_at) VALUES (?, ?, ?, ?, ?)",
    userId,
    name.slice(0, 120),
    sha256(token),
    version.slice(0, 20),
    Date.now(),
  );
  return token;
}

export function authDevice(req: Request): { device: AgentDevice; user: AgentUser } | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const device = get<AgentDevice>("SELECT id, user_id, name, revoked FROM devices WHERE token_hash = ?", sha256(token));
  if (!device || device.revoked) return null;
  const user = get<AgentUser>("SELECT id, name, emp_code, shift_id, status FROM users WHERE id = ?", device.user_id);
  if (!user || user.status !== "active") return null;
  return { device, user };
}

function openSession(userId: number, workDate: string) {
  const punches = all<{ type: PunchType; ts: number }>(
    "SELECT type, ts FROM punches WHERE user_id = ? AND work_date = ? AND voided = 0",
    userId,
    workDate,
  );
  const { sessions } = buildSessions(punches);
  const last = punches.reduce((m, p) => Math.max(m, p.ts), 0);
  return { open: sessions.find((s) => s.end === null) ?? null, lastTs: last };
}

/** `note` is stored as the punch reason; `suspicious` marks it for manager review (red flag). */
function insertPunch(userId: number, type: PunchType, ts: number, source: string, ip: string | null, note: string | null, suspicious = false) {
  const flag = note;
  const tz = getTz();
  const workDate = localDate(ts, tz);
  const r = run(
    `INSERT INTO punches(user_id, type, ts, work_date, source, ip, flagged, flag_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    type,
    ts,
    workDate,
    source,
    ip,
    suspicious ? 1 : 0,
    flag,
    Date.now(),
  );
  audit(userId, `PUNCH_${type}`, "punch", Number(r.lastInsertRowid), { source, ip, flag });
  if (type === "IN") syncLatePenalty(userId, workDate);
  return workDate;
}

export type AgentEventType = "IN" | "OUT" | "HEARTBEAT";
export interface AgentEvent {
  type: AgentEventType;
  ageMs: number; // how long ago the event happened, measured on the PC's monotonic clock
  reason: string; // logon | unlock | resume | startup | shutdown | logoff | heartbeat | manual
  locked?: boolean;
  lockedMs?: number; // how long the session has been locked
  queued?: boolean; // sent later because the PC was offline
  trusted?: boolean; // age measured on the monotonic clock (agent not restarted), so the PC clock cannot skew it
  upMs?: number; // heartbeat: how long the agent has been running
  maxGapMs?: number; // heartbeat: longest pause between agent ticks since last sync (large = sleep/hibernate)
}

const OFFLINE_REASON = "Agent: PC offline";

export function handleAgentEvent(user: AgentUser, device: AgentDevice, ev: AgentEvent, ip: string): { applied: boolean; note: string } {
  const now = Date.now();
  const age = Math.min(Math.max(0, Math.round(Number(ev.ageMs) || 0)), MAX_EVENT_AGE_MS);
  const ts = now - age;
  const tz = getTz();
  const workDate = localDate(ts, tz);
  const reason = String(ev.reason ?? "").slice(0, 20);

  run("UPDATE devices SET last_seen = ?, last_ip = ? WHERE id = ?", now, ip, device.id);

  if (ev.type === "HEARTBEAT") {
    const lockedSince = ev.locked ? now - Math.min(Math.max(0, Number(ev.lockedMs) || 0), MAX_EVENT_AGE_MS) : null;
    run(
      `INSERT INTO agent_presence(user_id, work_date, last_seen, locked_since) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, work_date) DO UPDATE SET last_seen = excluded.last_seen,
         locked_since = CASE WHEN excluded.locked_since IS NULL THEN NULL ELSE COALESCE(agent_presence.locked_since, excluded.locked_since) END`,
      user.id,
      localDate(now, tz),
      now,
      lockedSince,
    );
    const reverted = revertOfflineCloses(user.id, now, Number(ev.upMs) || 0, Number(ev.maxGapMs) || 0);
    return { applied: true, note: reverted ? `heartbeat; restored ${reverted} session(s) closed while offline` : "heartbeat" };
  }

  return tx(() => {
    const { open, lastTs } = openSession(user.id, workDate);
    if (ts < lastTs) return { applied: false, note: "older than latest punch" };
    const flag = ev.queued ? `Sent later by agent (${reason}, offline)` : null;
    // Only untrusted replays (agent restarted while offline → time came from the PC clock) need review.
    const suspicious = !!ev.queued && !ev.trusted;
    if (ev.type === "IN") {
      if (open && /^(logon|resume)$/.test(reason)) {
        // The PC was restarted/woken but its check-out never arrived (e.g. lost at shutdown).
        // If nothing was heard from the PC for longer than the offline limit, close at the last signal first.
        const presence = get<{ last_seen: number }>("SELECT last_seen FROM agent_presence WHERE user_id = ? AND work_date = ?", user.id, workDate);
        const lastSeen = Math.max(presence?.last_seen ?? open.start, open.start);
        if (ts - lastSeen > offlineMinutes() * 60_000) {
          insertPunch(user.id, "OUT", lastSeen, "AGENT", ip, `${OFFLINE_REASON} (restarted before check-out arrived)`);
        } else return { applied: false, note: "already checked in" };
      } else if (open) return { applied: false, note: "already checked in" };
      // Mark presence immediately so a fresh check-in is not auto-closed as stale.
      run(
        `INSERT INTO agent_presence(user_id, work_date, last_seen, locked_since) VALUES (?, ?, ?, NULL)
         ON CONFLICT(user_id, work_date) DO UPDATE SET last_seen = excluded.last_seen, locked_since = NULL`,
        user.id,
        workDate,
        now,
      );
      insertPunch(user.id, "IN", ts, "AGENT", ip, flag, suspicious);
      return { applied: true, note: `checked in (${reason})` };
    }
    if (!open) return { applied: false, note: "not checked in" };
    insertPunch(user.id, "OUT", Math.max(ts, open.start), "AGENT", ip, flag, suspicious);
    return { applied: true, note: `checked out (${reason})` };
  });
}

/**
 * The server closes a session when heartbeats stop, because it cannot tell "PC switched off" from
 * "internet down". When the agent reconnects and proves it ran the whole time (process uptime covers
 * the close and it never paused long enough to have slept), that automatic check-out is voided.
 */
function revertOfflineCloses(userId: number, now: number, upMs: number, maxGapMs: number): number {
  if (upMs <= 0 || maxGapMs > 5 * 60_000) return 0;
  const runningSince = now - Math.min(upMs, MAX_EVENT_AGE_MS);
  const closes = all<{ id: number; ts: number; work_date: string }>(
    `SELECT id, ts, work_date FROM punches WHERE user_id = ? AND type = 'OUT' AND source = 'AGENT' AND voided = 0
       AND flag_reason LIKE ? AND ts >= ?`,
    userId,
    `${OFFLINE_REASON}%`,
    runningSince,
  );
  for (const c of closes) {
    // Only if nothing happened after it (no later punch on that day).
    const later = get("SELECT 1 FROM punches WHERE user_id = ? AND work_date = ? AND voided = 0 AND ts > ? LIMIT 1", userId, c.work_date, c.ts);
    if (later) continue;
    run("UPDATE punches SET voided = 1 WHERE id = ?", c.id);
    audit(userId, "AGENT_OFFLINE_CLOSE_REVERTED", "punch", c.id, { reason: "agent was running during the outage" });
  }
  return closes.length;
}

/** Today's status for the agent's tray tooltip and break reminders. */
export function agentStatus(user: AgentUser) {
  const tz = getTz();
  const today = todayLocal();
  const day = computeUserDay(user, today);
  const rule = (user.shift_id && shiftRules().get(user.shift_id)) || [...shiftRules().values()][0] || DEFAULT_SHIFT;
  return {
    serverNow: Date.now(),
    company: getSetting("company_name"),
    employee: `${user.name} (${user.emp_code})`,
    status: day.status,
    workedMin: day.workedMin,
    late: day.late,
    lateMin: day.lateMin,
    shift: `${rule.start_time}-${rule.end_time}`,
    breakStart: rule.break_start ? zonedToUtc(today, rule.break_start, tz) : null,
    breakEnd: rule.break_end ? zonedToUtc(today, rule.break_end, tz) : null,
    heartbeatSec: 60,
    awayMinutes: awayMinutes(),
  };
}

/**
 * Closes agent sessions that ended without a clean shutdown:
 *  - the PC stopped sending heartbeats (power cut, crash, sleep, network loss) → OUT at last heartbeat
 *  - the PC has been locked longer than the away limit (break time excluded) → OUT at lock time
 *  - a session is still open from a previous day → OUT at its last known presence
 */
export function autoCloseAgentSessions() {
  const now = Date.now();
  const tz = getTz();
  const today = todayLocal();
  const away = awayMinutes() * 60_000;
  const offline = offlineMinutes() * 60_000;
  const rules = shiftRules();

  const candidates = all<{ user_id: number; work_date: string; shift_id: number | null }>(
    `SELECT DISTINCT p.user_id, p.work_date, u.shift_id FROM punches p JOIN users u ON u.id = p.user_id
     WHERE p.source = 'AGENT' AND p.voided = 0 AND p.work_date >= ?
       AND EXISTS (SELECT 1 FROM devices d WHERE d.user_id = p.user_id AND d.revoked = 0)`,
    localDate(now - 7 * 86400_000, tz),
  );

  for (const c of candidates) {
    const { open } = openSession(c.user_id, c.work_date);
    if (!open) continue;
    const presence = get<{ last_seen: number; locked_since: number | null }>(
      "SELECT last_seen, locked_since FROM agent_presence WHERE user_id = ? AND work_date = ?",
      c.user_id,
      c.work_date,
    );
    const lastSeen = Math.max(presence?.last_seen ?? open.start, open.start);
    let closeAt: number | null = null;
    let why = "";

    if (c.work_date < today) {
      closeAt = presence?.locked_since && presence.locked_since > open.start ? presence.locked_since : lastSeen;
      why = "Agent: day ended without shutdown";
    } else if (now - lastSeen > offline) {
      closeAt = lastSeen;
      why = `${OFFLINE_REASON} for more than ${offlineMinutes()} min`;
    } else if (presence?.locked_since && presence.locked_since > open.start) {
      const rule = (c.shift_id && rules.get(c.shift_id)) || DEFAULT_SHIFT;
      let lockedFor = now - presence.locked_since;
      if (rule.break_start && rule.break_end) {
        const bs = zonedToUtc(c.work_date, rule.break_start, tz);
        const be = zonedToUtc(c.work_date, rule.break_end, tz);
        lockedFor -= Math.max(0, Math.min(now, be) - Math.max(presence.locked_since, bs));
      }
      if (lockedFor >= away) {
        closeAt = presence.locked_since;
        why = `Agent: PC locked for more than ${awayMinutes()} min`;
      }
    }

    if (closeAt !== null) {
      const at = closeAt;
      const reason = why;
      tx(() => {
        if (!openSession(c.user_id, c.work_date).open) return;
        insertPunch(c.user_id, "OUT", at, "AGENT", null, reason);
      });
    }
  }
}

export function listDevices() {
  return all<{ id: number; user_name: string; emp_code: string; name: string; agent_version: string | null; created_at: number; last_seen: number | null; last_ip: string | null; revoked: number }>(
    `SELECT d.id, u.name AS user_name, u.emp_code, d.name, d.agent_version, d.created_at, d.last_seen, d.last_ip, d.revoked
     FROM devices d JOIN users u ON u.id = d.user_id ORDER BY d.revoked, d.last_seen DESC`,
  );
}
