import fs from "node:fs";
import path from "node:path";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "agent", "mac", "pulse-agent.sh");

/** The macOS agent itself; the installer downloads this. */
export async function GET() {
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });
  if (!fs.existsSync(FILE)) return new Response("Agent not found", { status: 404 });
  return new Response(fs.readFileSync(FILE, "utf8"), {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
