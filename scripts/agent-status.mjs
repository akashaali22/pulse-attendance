// Shows linked PCs and today's agent punches (quick diagnostics).
// Usage: node scripts/agent-status.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/attendance.db", { readOnly: true });
const tz = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value ?? "Asia/Karachi";
const fmt = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { timeZone: tz }) : "—");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

console.log("Linked PCs:");
for (const d of db.prepare("SELECT d.id, u.name, u.email, d.name AS pc, d.last_seen, d.revoked FROM devices d JOIN users u ON u.id = d.user_id ORDER BY d.id").all()) {
  const online = !d.revoked && d.last_seen && Date.now() - d.last_seen < 3 * 60_000;
  console.log(`  #${d.id} ${d.name} <${d.email}> on "${d.pc}" · last signal ${fmt(d.last_seen)} · ${d.revoked ? "UNLINKED" : online ? "ONLINE" : "offline"}`);
}

console.log(`\nAgent punches today (${today}):`);
for (const p of db
  .prepare(
    `SELECT u.name, p.type, p.ts, p.voided, p.flagged, p.flag_reason FROM punches p JOIN users u ON u.id = p.user_id
     WHERE p.source = 'AGENT' AND p.work_date = ? ORDER BY p.ts`,
  )
  .all(today)) {
  console.log(`  ${fmt(p.ts)}  ${p.name.padEnd(18)} ${p.type.padEnd(4)}${p.voided ? " (voided)" : ""}${p.flagged ? " [FLAGGED]" : ""}${p.flag_reason ? ` — ${p.flag_reason}` : ""}`);
}
