import { getSetting } from "@/lib/db";
import { ipAllowed } from "@/lib/geo";
import { redeemDeviceLink, startDeviceLink } from "@/lib/device-link";

export const dynamic = "force-dynamic";
const attempts = new Map<string, { n: number; until: number }>();
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().replace(/^::ffff:/, "");
  if (!ipAllowed(ip, getSetting("allowed_ips"))) return reply({ error: "This network is not allowed." }, 403);
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || !/^[a-f0-9]{64}$/.test(body.secret ?? "")) return reply({ error: "Invalid request" }, 400);
  if (body.code) {
    if (!/^[a-f0-9]{32}$/.test(body.code)) return reply({ error: "Invalid link" }, 400);
    return reply(redeemDeviceLink(body.code, body.secret));
  }
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const entry = attempts.get(ip) ?? { n: 0, until: now + 15 * 60_000 };
  if (entry.n >= 20 || attempts.size > 10000) return reply({ error: "Too many linking attempts. Try again later." }, 429);
  entry.n++; attempts.set(ip, entry);
  return reply(startDeviceLink(body.secret, String(body.device ?? "Desktop app"), String(body.version ?? "")));
}
