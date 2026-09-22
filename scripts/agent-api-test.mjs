// Integration test of the desktop-agent API against a running server (simulates a PC).
// Usage: BASE=http://localhost:3300 node scripts/agent-api-test.mjs
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new DatabaseSync(path.join(process.cwd(), "data", "attendance.db"));
const results = [];
const check = (name, cond, extra = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};
const post = async (p, body, token) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

const email = "sana.javed@demo.local";
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
// Clean slate for this test user today.
db.prepare("UPDATE punches SET voided = 1 WHERE user_id = ? AND work_date = ?").run(user.id, today);
db.prepare("DELETE FROM agent_presence WHERE user_id = ?").run(user.id);
const punches = () => db.prepare("SELECT type, source, flagged, flag_reason, ts FROM punches WHERE user_id = ? AND work_date = ? AND voided = 0 ORDER BY ts").all(user.id, today);

// 1. Pairing
const bad = await post("/api/agent/pair", { email, password: "wrong", device: "TEST-PC" });
check("pair rejects wrong password", bad.status === 401);
const pair = await post("/api/agent/pair", { email, password: "Demo@1234", device: "TEST-PC \\ sana", version: "test" });
check("pair returns device token", pair.status === 200 && pair.json.token);
const token = pair.json.token;
check("unauthenticated event rejected", (await post("/api/agent/event", { events: [] })).status === 401);

// 2. PC turned on WITHOUT internet 40 min ago; logon queued; now internet is back and the queue is sent.
const offlineIn = await post("/api/agent/event", { events: [{ type: "IN", reason: "logon", ageMs: 40 * 60_000, queued: true, trusted: true }, { type: "HEARTBEAT", ageMs: 0, upMs: 40 * 60_000, maxGapMs: 60_000 }] }, token);
let ps = punches();
check("offline logon synced later as check-in", offlineIn.status === 200 && ps.length === 1 && ps[0].type === "IN");
check("check-in time is when PC was switched on (not when synced)", Math.abs(Date.now() - 40 * 60_000 - ps[0].ts) < 5000);
check("trusted offline event is not flagged", ps[0].flagged === 0);
check("status returned to agent", offlineIn.json.status?.status === "WORKING" || offlineIn.json.status?.status === "ON_BREAK");

// 3. Duplicate unlock → no second check-in
await post("/api/agent/event", { events: [{ type: "IN", reason: "unlock", ageMs: 0 }] }, token);
check("unlock while checked in adds nothing", punches().length === 1);

// 4. Internet drops for 15 min → server auto-closes; agent reconnects proving it ran → close is voided
db.prepare("UPDATE agent_presence SET last_seen = ? WHERE user_id = ? AND work_date = ?").run(Date.now() - 15 * 60_000, user.id, today);
await new Promise((r) => setTimeout(r, 32_000)); // wait for the server's 30 s job
ps = punches();
check("server closes session when PC goes silent", ps.at(-1)?.type === "OUT" && /offline/.test(ps.at(-1)?.flag_reason ?? ""));
await post("/api/agent/event", { events: [{ type: "HEARTBEAT", ageMs: 0, upMs: 45 * 60_000, maxGapMs: 60_000 }] }, token);
ps = punches();
check("reconnect from running agent restores the session", ps.length === 1 && ps[0].type === "IN");

// 5. Untrusted replay (agent restarted while offline) is flagged for review
await post("/api/agent/event", { events: [{ type: "OUT", reason: "shutdown", ageMs: 1000, queued: true, trusted: false }] }, token);
ps = punches();
check("shutdown checks out", ps.at(-1)?.type === "OUT");
check("untrusted replay flagged", ps.at(-1)?.flagged === 1);

// 6. Revoked device cannot post
const dev = db.prepare("SELECT id FROM devices WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(user.id);
db.prepare("UPDATE devices SET revoked = 1 WHERE id = ?").run(dev.id);
check("revoked PC rejected", (await post("/api/agent/event", { events: [{ type: "HEARTBEAT", ageMs: 0 }] }, token)).status === 401);

// Cleanup test punches
db.prepare("UPDATE punches SET voided = 1 WHERE user_id = ? AND work_date = ?").run(user.id, today);
db.prepare("DELETE FROM devices WHERE id = ?").run(dev.id);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
