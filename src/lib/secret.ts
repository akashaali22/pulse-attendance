import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

// Company policy: admins can view employee passwords. They are kept ALONGSIDE the bcrypt hash
// (login still uses the hash), encrypted with AES-256-GCM. The key lives in its own file, so a
// copied database alone does not reveal passwords. Back up `data/password.key` with the database.

const KEY_FILE = path.join(DATA_DIR, "password.key");
let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  // Hosts without a persistent disk must set PASSWORD_KEY (64 hex chars), otherwise a new key would
  // be generated on every restart and previously stored passwords could no longer be read.
  const fromEnv = (process.env.PASSWORD_KEY ?? "").trim();
  if (fromEnv) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnv)) throw new Error("PASSWORD_KEY must be 64 hex characters");
    cached = Buffer.from(fromEnv, "hex");
    return cached;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  cached = Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
  return cached;
}

export function encryptPassword(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptPassword(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const [v, iv, tag, data] = stored.split(":");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
