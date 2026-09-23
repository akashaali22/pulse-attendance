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
  // Behind a proxy (Render, Fly) req.url is the internal bind address, so trust the forwarded host.
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const script = fs.readFileSync(FILE, "utf8").replace("__SERVER_URL__", origin);
  return new Response(script, {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
