import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "agent", "mac", "install.sh");

/**
 * The one-line macOS installer, with this server's address baked in.
 * Public: `curl | bash` carries no session cookie, and the script holds no secrets —
 * the agent still needs the employee's email + password to pair.
 */
export async function GET(req: Request) {
  if (!fs.existsSync(FILE)) return new Response("Installer not found", { status: 404 });
  const origin = new URL(req.url).origin;
  const script = fs.readFileSync(FILE, "utf8").replace("__SERVER_URL__", origin);
  return new Response(script, {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
