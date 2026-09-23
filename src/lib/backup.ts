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
const startedAt = Date.now();
// A deploy briefly runs two containers. The new one must not overwrite the snapshot the departing
// one is about to write, so every snapshot carries a serial number and we only ever move forward.
const SERIAL_KEY = "snapshot_serial";
const FIRST_UPLOAD_DELAY = Math.max(0, Number(process.env.BACKUP_FIRST_DELAY_SEC ?? 45)) * 1000;

async function latestRemote(): Promise<{ serial: number; sha: string | null }> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(REMOTE_PATH)}&per_page=1`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
    });
    if (!r.ok) return { serial: 0, sha: remoteSha };
    const [c] = (await r.json()) as { commit: { message: string } }[];
    const serial = Number(/snapshot #(\d+)/.exec(c?.commit?.message ?? "")?.[1] ?? 0);
    const meta = await api(`${REMOTE_PATH}?ref=HEAD`);
    const sha = meta.ok ? ((await meta.json()) as { sha: string }).sha : remoteSha;
    return { serial, sha };
  } catch {
    return { serial: 0, sha: remoteSha };
  }
}

/** Another container wrote a newer snapshot: take theirs, ours is stale. */
async function adoptRemote(serial: number) {
  const r = await api(`${REMOTE_PATH}?ref=HEAD`);
  if (!r.ok) return;
  const meta = (await r.json()) as { sha: string; content?: string; download_url?: string };
  const data = meta.content
    ? Buffer.from(meta.content, "base64")
    : Buffer.from(await (await fetch(meta.download_url!, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
  const { resetConnection } = await import("./db");
  resetConnection();
  fs.writeFileSync(DB_FILE, data);
  fs.rmSync(`${DB_FILE}-wal`, { force: true });
  fs.rmSync(`${DB_FILE}-shm`, { force: true });
  remoteSha = meta.sha;
  dirty = false;
  console.warn(`[backup] adopted a newer snapshot (#${serial}) written by another instance — local changes since boot were dropped`);
}

/** Downloads the newest snapshot. Runs before anything opens the database. */
/** Reports which GitHub account the token belongs to — the usual cause of a 404 is the wrong account. */
async function describeToken(): Promise<string> {
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
    });
    if (!r.ok) return `token rejected by GitHub (HTTP ${r.status})`;
    return `token belongs to GitHub user "${((await r.json()) as { login: string }).login}"`;
  } catch (e) {
    return `could not reach GitHub (${e instanceof Error ? e.message : e})`;
  }
}

export async function restoreFromBackup(): Promise<"restored" | "kept-local" | "none" | "failed"> {
  if (!backupEnabled()) return "none";
  try {
    if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) return "kept-local";
    const r = await api(`${REMOTE_PATH}?ref=HEAD`);
    if (r.status === 404 || r.status === 401 || r.status === 403) {
      // A private repository the token cannot see also answers 404, so say who the token is.
      console.log(`[backup] cannot read ${REPO}/${REMOTE_PATH} — HTTP ${r.status}; ${await describeToken()}`);
      console.log(
        r.status === 404
          ? "[backup] either no snapshot exists yet, or the token has no access to that PRIVATE repo (needs Contents: read and write, and must belong to the repo owner)"
          : "[backup] the token was rejected — create a new one and update BACKUP_TOKEN",
      );
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
  if (!dirty && process.env.BACKUP_DEBUG === "1") console.log("[backup] change detected, snapshot scheduled");
  dirty = true;
  if (pending) return;
  // Hold the first upload briefly so a container being replaced can flush its own final snapshot.
  const wait = Math.max(INTERVAL, startedAt + FIRST_UPLOAD_DELAY - Date.now());
  pending = setTimeout(() => {
    pending = null;
    void uploadSnapshot();
  }, wait);
}

export async function uploadSnapshot(reason = "change"): Promise<boolean> {
  if (process.env.BACKUP_DEBUG === "1") console.log(`[backup] upload attempt (${reason}): enabled=${backupEnabled()} uploading=${uploading} dirty=${dirty}`);
  if (!backupEnabled() || uploading || !dirty) return false;
  uploading = true;
  dirty = false;
  try {
    const { db, getSetting, setSetting } = await import("./db");
    const ours = Number(getSetting(SERIAL_KEY, "0")) || 0;
    const remote = await latestRemote();
    if (remote.serial > ours) {
      // Someone else (usually the container we are replacing) has newer data.
      await adoptRemote(remote.serial);
      return false;
    }
    const serial = Math.max(ours, remote.serial) + 1;
    setSetting(SERIAL_KEY, String(serial));
    remoteSha = remote.sha ?? remoteSha;

    // VACUUM INTO makes a consistent copy while the database is in use.
    fs.rmSync(SNAPSHOT_FILE, { force: true });
    db().exec(`VACUUM INTO '${SNAPSHOT_FILE.replace(/\\/g, "/").replace(/'/g, "''")}'`);
    const bytes = fs.readFileSync(SNAPSHOT_FILE);
    fs.rmSync(SNAPSHOT_FILE, { force: true });

    const body = {
      message: `snapshot #${serial} (${reason}) ${new Date().toISOString()}`,
      content: bytes.toString("base64"),
      ...(remoteSha ? { sha: remoteSha } : {}),
    };
    const r = await api(REMOTE_PATH, { method: "PUT", body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) {
      // The file moved under us: re-check the serial rather than overwriting blindly.
      const again = await latestRemote();
      if (again.serial >= serial) await adoptRemote(again.serial);
      else {
        remoteSha = again.sha;
        dirty = true;
      }
      return false;
    }
    if (!r.ok) throw new Error(`GitHub ${r.status} ${await r.text()}`);
    remoteSha = ((await r.json()) as { content: { sha: string } }).content.sha;
    console.log(`[backup] snapshot #${serial} uploaded (${(bytes.length / 1024).toFixed(0)} KB, ${reason})`);
    return true;
  } catch (e) {
    dirty = true; // try again on the next change
    console.error("[backup] upload failed:", e, "—", await describeToken());
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
