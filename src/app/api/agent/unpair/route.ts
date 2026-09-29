import { authDevice } from "@/lib/agent";
import { run } from "@/lib/db";
import { audit } from "@/lib/audit";
export async function POST(req: Request) {
  const auth = authDevice(req);
  if (!auth) return Response.json({ ok: true }); // Idempotent, including already revoked devices.
  run("UPDATE devices SET revoked = 1 WHERE id = ?", auth.device.id);
  audit(auth.user.id, "AGENT_UNPAIRED", "device", auth.device.id);
  return Response.json({ ok: true });
}
