import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-link-test-"));
let database: typeof import("./db");
let links: typeof import("./device-link");
let agents: typeof import("./agent");
let userId: number;
beforeAll(async () => {
  process.env.ATTENDANCE_DATA_DIR = dir;
  process.env.DEMO_MODE = "0";
  database = await import("./db");
  links = await import("./device-link");
  agents = await import("./agent");
  userId = database.get<{ id: number }>("SELECT id FROM users LIMIT 1")!.id;
});
afterAll(() => { database.resetConnection(); fs.rmSync(dir, { recursive: true, force: true }); });
describe("browser device linking", () => {
  it("requires browser approval and the original app secret, then consumes the link once", () => {
    const secret = "a".repeat(64);
    const link = links.startDeviceLink(secret, "Test desktop", "1.1.0");
    expect(links.redeemDeviceLink(link.code, secret)).toEqual({ pending: true });
    expect(links.approveDeviceLink(link.code, userId)).toBe(true);
    expect(links.approveDeviceLink(link.code, userId)).toBe(false);
    expect(links.redeemDeviceLink(link.code, "b".repeat(64))).toHaveProperty("error");
    const result = links.redeemDeviceLink(link.code, secret);
    expect(result).toHaveProperty("token");
    expect(links.redeemDeviceLink(link.code, secret)).toHaveProperty("error");
    expect(database.get("SELECT token_hash FROM devices WHERE name = ?", "Test desktop")).toBeTruthy();
  });
  it("rejects expired requests and inactive accounts", () => {
    const secret = "c".repeat(64);
    const expired = links.startDeviceLink(secret, "Expired desktop", "1.1.0");
    database.run("UPDATE device_links SET expires_at = 0 WHERE code = ?", expired.code);
    expect(links.approveDeviceLink(expired.code, userId)).toBe(false);
    expect(links.redeemDeviceLink(expired.code, secret)).toHaveProperty("error");
    const blocked = links.startDeviceLink(secret, "Blocked desktop", "1.1.0");
    links.approveDeviceLink(blocked.code, userId);
    database.run("UPDATE users SET status = 'inactive' WHERE id = ?", userId);
    expect(links.redeemDeviceLink(blocked.code, secret)).toHaveProperty("error");
    database.run("UPDATE users SET status = 'active' WHERE id = ?", userId);
  });
  it("does not replay a received event after a lost network response", () => {
    const token = agents.createDevice(userId, "Queue test", "1.1.0");
    const auth = agents.authDevice(new Request("http://localhost", { headers: { Authorization: `Bearer ${token}` } }))!;
    const event = { id: "retry-unique-event", type: "IN" as const, reason: "logon", ageMs: 0 };
    agents.handleAgentEvent(auth.user, auth.device, event, "127.0.0.1");
    expect(agents.handleAgentEvent(auth.user, auth.device, event, "127.0.0.1").note).toBe("already received");
    expect(database.get<{ n: number }>("SELECT COUNT(*) n FROM agent_receipts WHERE device_id = ?", auth.device.id)?.n).toBe(1);
  });
});
