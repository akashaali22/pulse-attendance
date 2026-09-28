import fs from "node:fs";
import path from "node:path";
export const dynamic = "force-dynamic";

const EXE = path.join(process.cwd(), "agent", "bin", "PulseAgent.exe");

/**
 * Public, like the macOS installer: the file holds no secrets and the agent still needs the
 * employee's own email and password to pair, so /download can offer it before anyone signs in.
 */
export async function GET() {
  if (!fs.existsSync(EXE)) return new Response("Agent has not been built. Run: npm run build:agent", { status: 404 });
  return new Response(fs.readFileSync(EXE), {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="PulseAgent.exe"' },
  });
}
