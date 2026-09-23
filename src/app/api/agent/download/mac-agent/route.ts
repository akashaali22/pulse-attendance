import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "agent", "mac", "pulse-agent.sh");

/** The macOS agent itself; the installer downloads this. Public for the same reason as the installer. */
export async function GET() {
  if (!fs.existsSync(FILE)) return new Response("Agent not found", { status: 404 });
  return new Response(fs.readFileSync(FILE, "utf8"), {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
