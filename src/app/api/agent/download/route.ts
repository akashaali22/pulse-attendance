import fs from "node:fs";
import path from "node:path";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EXE = path.join(process.cwd(), "agent", "bin", "PulseAgent.exe");

export async function GET() {
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });
  if (!fs.existsSync(EXE)) return new Response("Agent has not been built. Run: npm run build:agent", { status: 404 });
  return new Response(fs.readFileSync(EXE), {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="PulseAgent.exe"' },
  });
}
