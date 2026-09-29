// Exercises the real Mac queue sender with an offline/acknowledgement transport fixture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-queue-"));
try {
  const source = fs.readFileSync("agent/mac/pulse-agent.sh", "utf8");
  const functions = source.slice(source.indexOf("queue_add()"), source.indexOf("status_field()"));
  const script = `set -eu
APP_DIR="$1"; QUEUE="$1/queue"; LOG="$1/log"; SERVER="https://test.invalid"; VERSION="test"
${functions}
token_get() { echo fixture; }
log() { :; }
json_value() { node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).accepted));'; }
curl() {
  local payload=""; while [ $# -gt 0 ]; do if [ "$1" = "--data" ]; then payload="$2"; shift; fi; shift; done
  printf '%s' "$payload" >"$APP_DIR/sent.json"
  case "$MODE" in offline) return 1;; revoked) printf '{}\\n401';; badack) printf '{"accepted":1}\\n200';; *) printf '{"accepted":%s}\\n200' "$ACK";; esac
}
for ((i=0;i<450;i++)); do printf '%s|IN|logon|true|event-%s\\n' "$(date +%s)" "$i"; done >"$QUEUE"
MODE=offline; ACK=199
if send_events ""; then exit 1; fi
[ "$(wc -l <"$QUEUE" | tr -d ' ')" = 450 ]
MODE=badack
if send_events ""; then exit 1; fi
[ "$(wc -l <"$QUEUE" | tr -d ' ')" = 450 ]
MODE=ok; send_events ""
[ "$(wc -l <"$QUEUE" | tr -d ' ')" = 251 ]
node -e 'const x=require(process.argv[1]).events;if(x.length!==199||x[198].id!=="event-198")process.exit(1)' "$APP_DIR/sent.json"
send_events ""
[ "$(wc -l <"$QUEUE" | tr -d ' ')" = 52 ]
ACK=53; send_events '{"type":"HEARTBEAT","ageMs":0}'
[ ! -s "$QUEUE" ]
MODE=revoked
if send_events '{"type":"HEARTBEAT","ageMs":0}'; then exit 1; fi
[ -f "$APP_DIR/revoked" ]
echo 'PASS offline retention, missing acknowledgement, 450-event batching, stable IDs, revoked state'
`;
  const file = path.join(dir, "test.sh");
  fs.writeFileSync(file, script);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  process.stdout.write(execFileSync(bash, [file.replaceAll("\\", "/"), dir.replaceAll("\\", "/")], { encoding: "utf8" }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
