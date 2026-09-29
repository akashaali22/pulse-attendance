import { getSetting } from "@/lib/db";
import { ipAllowed } from "@/lib/geo";
import { agentStatus, authDevice, handleAgentEvent, type AgentEvent } from "@/lib/agent";

export const dynamic = "force-dynamic";

const TYPES = ["IN", "OUT", "HEARTBEAT"];

/** Batch of agent events (oldest first). Always answers with the fresh status. */
export async function POST(req: Request) {
  const auth = authDevice(req);
  if (!auth) return Response.json({ error: "Device not paired or revoked" }, { status: 401 });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().replace(/^::ffff:/, "");
  if (!ipAllowed(ip, getSetting("allowed_ips"))) return Response.json({ error: `This network (${ip}) is not allowed.` }, { status: 403 });

  let body: { events?: AgentEvent[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!Array.isArray(body?.events) || body.events.length > 200 || body.events.some((e) => !TYPES.includes(e?.type) || (e.id !== undefined && (typeof e.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(e.id))))) {
    return Response.json({ error: "Send at most 200 valid events per batch" }, { status: 400 });
  }
  const events = body.events;
  const results = events
    .filter((e) => TYPES.includes(e?.type))
    // Oldest first so replayed offline events keep their order.
    .sort((a, b) => (Number(b.ageMs) || 0) - (Number(a.ageMs) || 0))
    .map((e) => handleAgentEvent(auth.user, auth.device, e, ip));
  return Response.json({ results, accepted: events.length, status: agentStatus(auth.user) });
}

export async function GET(req: Request) {
  const auth = authDevice(req);
  if (!auth) return Response.json({ error: "Device not paired or revoked" }, { status: 401 });
  return Response.json({ status: agentStatus(auth.user) });
}
