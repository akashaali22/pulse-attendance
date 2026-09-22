import "server-only";
import crypto from "node:crypto";
import { all, get, run } from "./db";

const GENESIS = "0".repeat(64);

interface AuditRow {
  id: number;
  ts: number;
  actor_id: number | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
  prev_hash: string;
  hash: string;
}

function digest(r: Omit<AuditRow, "id" | "hash">): string {
  const canonical = JSON.stringify([r.ts, r.actor_id, r.action, r.entity, r.entity_id, r.details, r.prev_hash]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Append a tamper-evident entry. Each hash covers the previous one, so editing any row breaks the chain. */
export function audit(actorId: number | null, action: string, entity: string, entityId?: string | number | null, details?: unknown) {
  const prev = get<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")?.hash ?? GENESIS;
  const row = {
    ts: Date.now(),
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId == null ? null : String(entityId),
    details: details === undefined ? null : JSON.stringify(details),
    prev_hash: prev,
  };
  run(
    "INSERT INTO audit_log(ts, actor_id, action, entity, entity_id, details, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    row.ts,
    row.actor_id,
    row.action,
    row.entity,
    row.entity_id,
    row.details,
    row.prev_hash,
    digest(row),
  );
}

export function verifyAuditChain(): { ok: boolean; checked: number; brokenAt?: number } {
  const rows = all<AuditRow>("SELECT * FROM audit_log ORDER BY id");
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || digest(r) !== r.hash) return { ok: false, checked: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
