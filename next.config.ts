import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate verification builds from a running local server's output.
  distDir: process.env.PULSE_DIST_DIR || ".next",
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // The download routes read these off disk at request time, so nothing in the code points at them
  // and the tracer would otherwise leave them out of the standalone bundle.
  outputFileTracingIncludes: {
    "/api/agent/download": ["./agent/bin/PulseAgent.exe"],
    "/api/agent/download/mac-dmg": ["./agent/bin/PulseAgent.dmg"],
    "/api/agent/download/mac": ["./agent/mac/install.sh"],
    "/api/agent/download/mac-agent": ["./agent/mac/pulse-agent.sh"],
  },
};

export default nextConfig;
