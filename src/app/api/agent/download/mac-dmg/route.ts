import fs from "node:fs";
import path from "node:path";
export const dynamic = "force-dynamic";

const DMG = path.join(process.cwd(), "agent", "bin", "PulseAgent.dmg");

/**
 * Public, like the Windows executable and the macOS installer: the image holds no secrets and the
 * agent still needs the employee's own email and password before it records anything.
 */
export async function GET() {
  if (!fs.existsSync(DMG)) {
    return new Response("The Mac app has not been built. On a Mac, run: npm run build:agent:mac", { status: 404 });
  }
  return new Response(fs.readFileSync(DMG), {
    headers: {
      "Content-Type": "application/x-apple-diskimage",
      "Content-Disposition": 'attachment; filename="PulseAgent.dmg"',
    },
  });
}
