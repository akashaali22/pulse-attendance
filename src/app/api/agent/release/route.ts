import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export const dynamic = "force-dynamic";
export async function GET() {
  const dir = path.join(process.cwd(), "agent", "bin");
  const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex");
  return Response.json({
    windowsVersion: "1.1.0", windowsSha256: digest("PulseAgent-1.1.0.exe"),
    macVersion: fs.existsSync(path.join(dir, "PulseAgent.dmg.version")) ? fs.readFileSync(path.join(dir, "PulseAgent.dmg.version"), "utf8").trim() : "1.0.0",
    macSha256: digest("PulseAgent.dmg"),
  }, { headers: { "Cache-Control": "no-store" } });
}
