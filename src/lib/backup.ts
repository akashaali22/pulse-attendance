import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

/**
 * Keeps the SQLite database alive on hosts with no persistent disk (Render free plan and friends).
 *
 * The database file is snapshotted to a **private GitHub repository** and restored on boot, so the
 * container can be thrown away at any time. Set:
 *   BACKUP_REPO   owner/repo of a PRIVATE repo you own      (e.g. akashaali22/pulse-attendance-data)
 *   BACKUP_TOKEN  a GitHub token with "Contents: read/write" on that repo
 *   BACKUP_PATH   optional, defaults to db/attendance.db
 *
 * Snapshots are written at most once every BACKUP_INTERVAL_SEC (default 30) after a change, and
 * once more when the server shuts down. Worst case after a hard crash: the last half minute.
 */

const REPO = process.env.BACKUP_REPO ?? "";
const TOKEN = process.env.BACKUP_TOKEN ?? "";
const REMOTE_PATH = process.env.BACKUP_PATH ?? "db/attendance.db";
const INTERVAL = Math.max(10, Number(process.env.BACKUP_INTERVAL_SEC ?? 30)) * 1000;
const DB_FILE = path.join(DATA_DIR, "attendance.db");
const SNAPSHOT_FILE = path.join(DATA_DIR, "snapshot.db");

export const backupEnabled = () => !!REPO && !!TOKEN;

const api = (p: string, init?: RequestInit) =>
  fetch(`https://api.github.com/repos/${REPO}/contents/${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

let remoteSha: string | null = null;

/** Downloads the newest snapshot. Runs before anything opens the database. */
export async function restoreFromBackup(): Promise<"restored" | "kept-local" | "none" | "failed"> {
  if (!backupEnabled()) return "none";
  try {
    if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) return "kept-local";
    const r = await api(`${REMOTE_PATH}?ref=HEAD`);
    if (r.status === 404) {
      console.log("[backup] no snapshot yet — starting with a fresh database");
      return "none";
    }
    if (!r.ok) throw new Error(`GitHub ${r.status} ${await r.text()}`);
    const meta = (await r.json()) as { sha: string; content?: string; download_url?: string; size: number };
    remoteSha = meta.sha;
    const bytes = meta.content
      ? Buffer.from(meta.content, "base64")
      : Buffer.from(await (await fetch(meta.download_url!, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, bytes);
    console.log(`[backup] restored ${(bytes.length / 1024).toFixed(0)} KB from ${REPO}/${REMOTE_PATH}`);
    return "restored";
  } catch (e) {
    console.error("[backup] restore failed — starting with a fresh database:", e);
    return "failed";
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;
let uploading = false;
let dirty = false;

/** Called after every write. Uploads at most once per interval. */
export function scheduleBackup() {
  if (!backupEnabled()) return;
  dirty = true;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void uploadSnapshot();
  }, INTERVAL);
}

export async function uploadSnapshot(reason = "change"): Promise<boolean> {
  if (!backupEnabled() || uploading || !dirty) return false;
  uploading = true;
  dirty = false;
  try {
    // VACUUM INTO makes a consistent copy while the database is in use.
    const { db } = await import("./db");
    fs.rmSync(SNAPSHOT_FILE, { force: true });
    db().exec(`VACUUM INTO '${SNAPSHOT_FILE.replace(/\\/g, "/").replace(/'/g, "''")}'`);
    const bytes = fs.readFileSync(SNAPSHOT_FILE);
    fs.rmSync(SNAPSHOT_FILE, { force: true });

    const body = {
      message: `snapshot (${reason}) ${new Date().toISOString()}`,
      content: bytes.toString("base64"),
      ...(remoteSha ? { sha: remoteSha } : {}),
    };
    let r = await api(REMOTE_PATH, { method: "PUT", body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) {
      // Someone/something else wrote it — refresh the sha and retry once.
      const cur = await api(`${REMOTE_PATH}?ref=HEAD`);
      remoteSha = cur.ok ? ((await cur.json()) as { sha: string }).sha : null;
      r = await api(REMOTE_PATH, { method: "PUT", body: JSON.stringify({ ...body, sha: remoteSha ?? undefined }) });
    }
    if (!r.ok) throw new Error(`GitHub ${r.status} ${await r.text()}`);
    remoteSha = ((await r.json()) as { content: { sha: string } }).content.sha;
    console.log(`[backup] snapshot uploaded (${(bytes.length / 1024).toFixed(0)} KB, ${reason})`);
    return true;
  } catch (e) {
    dirty = true; // try again on the next change
    console.error("[backup] upload failed:", e);
    return false;
  } finally {
    uploading = false;
  }
}

/** Last snapshot before the container is stopped (Render/Fly send SIGTERM). */
export function installShutdownHook() {
  if (!backupEnabled()) return;
  let done = false;
  const flush = async (signal: string) => {
    if (done) return;
    done = true;
    dirty = true;
    await uploadSnapshot(`shutdown:${signal}`);
    process.exit(0);
  };
  process.on("SIGTERM", () => void flush("SIGTERM"));
  process.on("SIGINT", () => void flush("SIGINT"));
}
