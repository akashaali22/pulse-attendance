import "server-only";
import crypto from "node:crypto";
import { getSetting } from "./db";

export const KIOSK_WINDOW_MS = 15_000;

function sign(window: number): string {
  return crypto.createHmac("sha256", getSetting("kiosk_secret")).update(`kiosk:${window}`).digest("base64url").slice(0, 22);
}

/** Rotating token: valid for the current and the previous 15 s window only, so screenshots go stale. */
export function currentKioskToken(now = Date.now()): { token: string; expiresAt: number } {
  const w = Math.floor(now / KIOSK_WINDOW_MS);
  return { token: `${w}.${sign(w)}`, expiresAt: (w + 1) * KIOSK_WINDOW_MS };
}

/** `graceWindows` = how many past windows still count (1 when scanning; a few more when the punch is confirmed). */
export function verifyKioskToken(token: string, graceWindows = 1, now = Date.now()): boolean {
  const [ws, sig] = token.split(".");
  const w = Number(ws);
  if (!Number.isInteger(w) || !sig) return false;
  const cur = Math.floor(now / KIOSK_WINDOW_MS);
  if (w > cur || w < cur - graceWindows) return false;
  const expected = sign(w);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
