import fs from "node:fs";
import path from "node:path";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "agent", "mac", "install.sh");

/** The one-line macOS installer, with this server's address baked in. */
export async function GET(req: Request) {
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });
  if (!fs.existsSync(FILE)) return new Response("Installer not found", { status: 404 });
  const origin = new URL(req.url).origin;
  const script = fs.readFileSync(FILE, "utf8").replace("__SERVER_URL__", origin);
  return new Response(script, {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
