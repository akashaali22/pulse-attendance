// Compiles the Windows desktop agent with the C# compiler bundled in .NET Framework 4.x (no SDK needed).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const fw = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319";
const csc = path.join(fw, "csc.exe");
if (!fs.existsSync(csc)) {
  console.error("csc.exe not found. The agent can only be built on Windows with .NET Framework 4.x.");
  process.exit(1);
}
const root = path.join(process.cwd(), "agent");
fs.mkdirSync(path.join(root, "bin"), { recursive: true });
const refs = ["System.dll", "System.Drawing.dll", "System.Windows.Forms.dll", "System.Web.Extensions.dll", "System.Security.dll"];
const out = execFileSync(
  csc,
  [
    "/nologo",
    "/target:winexe",
    "/optimize+",
    "/platform:anycpu",
    `/out:${path.join(root, "bin", "PulseAgent.exe")}`,
    ...refs.map((r) => `/reference:${path.join(fw, r)}`),
    path.join(root, "src", "PulseAgent.cs"),
  ],
  { encoding: "utf8" },
);
if (out.trim()) console.log(out);
console.log("Built agent/bin/PulseAgent.exe");
