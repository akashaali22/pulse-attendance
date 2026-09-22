import bcrypt from "bcryptjs";
import { get, getSetting } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ipAllowed } from "@/lib/geo";
import { agentStatus, createDevice, type AgentUser } from "@/lib/agent";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { n: number; until: number }>();
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().replace(/^::ffff:/, "");

/** Employee signs in once from the desktop agent; the PC receives a long-lived device token. */
export async function POST(req: Request) {
  const ip = ipOf(req);
  let body: { email?: string; password?: string; device?: string; version?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const key = `${email}|${ip}`;
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (!ipAllowed(ip, getSetting("allowed_ips"))) return Response.json({ error: `This network (${ip}) is not allowed.` }, { status: 403 });

  const u = get<AgentUser & { password_hash: string }>(
    "SELECT id, name, emp_code, shift_id, status, password_hash FROM users WHERE email = ?",
    email,
  );
  const valid = !!u && u.status === "active" && (await bcrypt.compare(String(body.password ?? ""), u.password_hash));
  if (!valid) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    audit(u?.id ?? null, "AGENT_PAIR_FAILED", "device", null, { email, ip });
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }
  attempts.delete(key);
  const name = String(body.device ?? "Windows PC").slice(0, 120);
  const token = createDevice(u.id, name, String(body.version ?? ""));
  audit(u.id, "AGENT_PAIRED", "device", null, { name, ip });
  return Response.json({ token, status: agentStatus(u) });
}
