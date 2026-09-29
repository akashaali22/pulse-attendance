import "server-only";
import crypto from "node:crypto";
import { get, run, tx } from "./db";
import { agentStatus, createDevice, type AgentUser } from "./agent";
import { audit } from "./audit";

export const LINK_TTL = 5 * 60_000;
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export interface DeviceLink { code: string; name: string; version: string; expires_at: number; user_id: number | null; consumed: number }
export function findDeviceLink(code: string) {
  return get<DeviceLink>("SELECT code, name, version, expires_at, user_id, consumed FROM device_links WHERE code = ? AND expires_at > ?", code, Date.now());
}
export function startDeviceLink(secret: string, name: string, version: string) {
  run("DELETE FROM device_links WHERE expires_at <= ?", Date.now());
  const code = crypto.randomBytes(16).toString("hex");
  run("INSERT INTO device_links(code, secret_hash, name, version, expires_at) VALUES(?,?,?,?,?)", code, hash(secret), name.slice(0, 120), version.slice(0, 20), Date.now() + LINK_TTL);
  return { code, verificationPath: `/link-device?code=${code}`, expiresIn: LINK_TTL / 1000 };
}
export function approveDeviceLink(code: string, userId: number) {
  const r = run("UPDATE device_links SET user_id = ? WHERE code = ? AND expires_at > ? AND consumed = 0 AND user_id IS NULL", userId, code, Date.now());
  if (r.changes) audit(userId, "AGENT_LINK_APPROVED", "device", null);
  return !!r.changes;
}
export function redeemDeviceLink(code: string, secret: string) {
  return tx(() => {
    const link = get<DeviceLink>("SELECT * FROM device_links WHERE code = ? AND secret_hash = ? AND expires_at > ? AND consumed = 0", code, hash(secret), Date.now());
    if (!link) return { error: "Link expired or already used. Start again in the app." };
    if (!link.user_id) return { pending: true };
    const user = get<AgentUser>("SELECT id, name, emp_code, shift_id, status FROM users WHERE id = ? AND status = 'active'", link.user_id);
    if (!user) return { error: "This account is no longer active." };
    run("UPDATE device_links SET consumed = 1 WHERE code = ?", code);
    const token = createDevice(user.id, link.name, link.version);
    audit(user.id, "AGENT_PAIRED", "device", null, { name: link.name, method: "browser" });
    return { token, status: agentStatus(user) };
  });
}
