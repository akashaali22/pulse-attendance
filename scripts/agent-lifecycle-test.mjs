// Real-world lifecycle test of the Windows desktop agent on THIS PC, including a full restart.
//
//   Start:   node scripts/agent-lifecycle-test.mjs --email someone@company.com
//   Resume:  runs automatically at Windows logon after the restart (or: --resume)
//
// Progress is saved in test-run/state.json and results in test-run/report.md, so the test
// survives the reboot without anyone watching. Takes roughly 45 minutes.

import { DatabaseSync } from "node:sqlite";
import { execFileSync, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_FILE = path.join(WEB, "data", "attendance.db");
const RUN_DIR = path.join(WEB, "test-run");
const STATE = path.join(RUN_DIR, "state.json");
const REPORT = path.join(RUN_DIR, "report.md");
const AGENT_EXE = path.join(WEB, "agent", "bin", "PulseAgent.exe");
const AGENT_DIR = path.join(process.env.LOCALAPPDATA ?? "", "PulseAgent");
const SERVER_VBS = path.join(WEB, "scripts", "start-server.vbs");
const BASE = "http://localhost:3300";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const TZ = "Asia/Karachi";

const MIN = 60_000;
const SEC = 1000;

// ───────────────────────── helpers ─────────────────────────

const fmt = (ms) => (ms ? new Date(ms).toLocaleTimeString("en-GB", { timeZone: TZ }) : "—");
const log = (msg) => console.log(`[${new Date().toLocaleTimeString("en-GB")}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wait(ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const left = Math.ceil((end - Date.now()) / SEC);
    process.stdout.write(`\r   ⏳ ${label} — ${Math.floor(left / 60)}m ${String(left % 60).padStart(2, "0")}s   `);
    await sleep(Math.min(5 * SEC, end - Date.now()));
  }
  process.stdout.write("\r" + " ".repeat(90) + "\r");
}

async function until(fn, timeoutMs, label, everyMs = 5 * SEC) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    process.stdout.write(`\r   ⏳ ${label} (${Math.ceil((end - Date.now()) / SEC)}s left)   `);
    await sleep(everyMs);
  }
  process.stdout.write("\r" + " ".repeat(90) + "\r");
  return null;
}

function q(sql, ...params) {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    return db.prepare(sql).all(...params).map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}
function exec(sql, ...params) {
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA busy_timeout = 10000");
  try {
    return db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null);
function saveState(s) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  writeReport(s);
}

function record(s, name, pass, details) {
  s.results = s.results.filter((r) => r.name !== name);
  s.results.push({ name, pass, details, at: Date.now() });
  log(`${pass === true ? "✅ PASS" : pass === false ? "❌ FAIL" : "➖ INFO"}  ${name} — ${details}`);
  saveState(s);
}

function writeReport(s) {
  const passed = s.results.filter((r) => r.pass === true).length;
  const failed = s.results.filter((r) => r.pass === false).length;
  const lines = [
    `# Pulse Attendance — desktop agent lifecycle test`,
    ``,
    `- Employee: **${s.email}** (id ${s.userId})`,
    `- PC: ${os.hostname()}`,
    `- Started: ${new Date(s.startedAt).toLocaleString("en-GB", { timeZone: TZ })}`,
    `- Current step: **${s.step}**`,
    `- Result so far: **${passed} passed, ${failed} failed**`,
    ``,
    `| # | Test | Result | Details |`,
    `|---|---|---|---|`,
    ...s.results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.pass === true ? "✅ PASS" : r.pass === false ? "❌ FAIL" : "➖ info"} | ${String(r.details).replace(/\|/g, "/")} |`),
    ``,
    `## Punches recorded for this employee during the test`,
    ``,
    `| Time | Type | Source | Voided | Flagged | Reason |`,
    `|---|---|---|---|---|---|`,
    ...(s.userId ? q("SELECT type, ts, source, voided, flagged, flag_reason FROM punches WHERE user_id = ? AND created_at >= ? ORDER BY ts", s.userId, s.startedAt - MIN) : []).map(
      (p) => `| ${fmt(p.ts)} | ${p.type} | ${p.source} | ${p.voided ? "yes" : ""} | ${p.flagged ? "⚠" : ""} | ${p.flag_reason ?? ""} |`,
    ),
  ];
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(REPORT, lines.join("\n") + "\n");
}

// Windows control
const serverUp = async () => {
  try {
    return (await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
};
function serverPids() {
  const out = execSync("netstat -ano", { encoding: "utf8" });
  return [...new Set(out.split(/\r?\n/).filter((l) => /:3300\s.*LISTENING/.test(l)).map((l) => l.trim().split(/\s+/).at(-1)))];
}
async function stopServer() {
  for (const pid of serverPids()) {
    try {
      execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
  await until(async () => !(await serverUp()), 30 * SEC, "waiting for server to stop", SEC);
}
async function startServer() {
  if (await serverUp()) return true;
  spawn("wscript.exe", [SERVER_VBS], { detached: true, stdio: "ignore" }).unref();
  return !!(await until(serverUp, 3 * MIN, "waiting for server to start", 3 * SEC));
}
const agentRunning = () => /PulseAgent\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq PulseAgent.exe"', { encoding: "utf8" }));
function killAgent() {
  try {
    execFileSync("taskkill", ["/IM", "PulseAgent.exe", "/F"], { stdio: "ignore" });
  } catch {}
}
function startAgent() {
  spawn(AGENT_EXE, [], { detached: true, stdio: "ignore" }).unref();
}
const isLocked = () => /LogonUI\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq LogonUI.exe"', { encoding: "utf8" }));
const bootTime = () =>
  Number(execSync('powershell -NoProfile -Command "[DateTimeOffset]::new((Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToUnixTimeMilliseconds()"', { encoding: "utf8" }).trim());
const regAdd = (name, value) => execFileSync("reg", ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], { stdio: "ignore" });
const regDel = (name) => {
  try {
    execFileSync("reg", ["delete", RUN_KEY, "/v", name, "/f"], { stdio: "ignore" });
  } catch {}
};

// Attendance queries
const punchesSince = (s, since) => q("SELECT id, type, ts, voided, flagged, flag_reason, source FROM punches WHERE user_id = ? AND ts >= ? ORDER BY ts, id", s.userId, since);
const lastLive = (s) => q("SELECT id, type, ts, flag_reason, flagged FROM punches WHERE user_id = ? AND voided = 0 ORDER BY ts DESC, id DESC LIMIT 1", s.userId)[0];
const isOpen = (s) => lastLive(s)?.type === "IN";

async function ensureOpenSession(s) {
  if (!(await serverUp())) await startServer();
  if (!agentRunning()) startAgent();
  if (isOpen(s)) return true;
  killAgent();
  const t = Date.now();
  startAgent();
  return !!(await until(() => punchesSince(s, t - 10 * SEC).some((p) => p.type === "IN" && !p.voided), 2 * MIN, "waiting for agent check-in"));
}

function banner(text) {
  console.log("\n" + "═".repeat(78));
  console.log("  " + text);
  console.log("═".repeat(78));
}

// ───────────────────────── test steps ─────────────────────────

const STEPS = {
  async setup(s) {
    banner("SETUP");
    if (!(await serverUp())) {
      log("Server not running — starting it");
      if (!(await startServer())) throw new Error("Server could not be started");
    }
    const user = q("SELECT id, name FROM users WHERE email = ? COLLATE NOCASE AND status = 'active'", s.email)[0];
    if (!user) throw new Error(`No active user ${s.email}`);
    s.userId = user.id;
    s.userName = user.name;

    const cfgFile = path.join(AGENT_DIR, "config.json");
    const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
    const linked = q("SELECT id FROM devices WHERE user_id = ? AND revoked = 0", s.userId).length > 0;
    record(s, "Agent is linked to this employee on this PC", !!cfg.ProtectedToken && linked && String(cfg.Employee ?? "").includes(user.name), `config employee: ${cfg.Employee ?? "none"}`);
    if (!cfg.ProtectedToken || !linked) throw new Error("Link the agent to this employee first (tray icon → Sign out this PC → sign in as the employee).");
    record(s, "Device token is not stored in plain text", !("Token" in cfg), "config.json contains only the DPAPI-encrypted token");

    s.originalSettings = Object.fromEntries(q("SELECT key, value FROM settings WHERE key IN ('agent_away_minutes','agent_offline_minutes')").map((r) => [r.key, r.value]));
    exec("UPDATE settings SET value = '5' WHERE key = 'agent_away_minutes'");
    exec("UPDATE settings SET value = '3' WHERE key = 'agent_offline_minutes'");
    record(s, "Test limits applied", null, `away 5 min, offline 3 min (restored at the end to ${JSON.stringify(s.originalSettings)})`);

    // Old links of other employees on this PC would keep reporting nothing; unlink them for a clean run.
    const stale = q("SELECT d.id, u.name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.revoked = 0 AND d.user_id != ? AND d.name LIKE ?", s.userId, `${os.hostname()}%`);
    for (const d of stale) exec("UPDATE devices SET revoked = 1 WHERE id = ?", d.id);
    if (stale.length) record(s, "Unlinked old PC links of other employees", null, stale.map((d) => d.name).join(", "));

    regAdd("PulseAttendanceServer", `wscript.exe "${SERVER_VBS}"`);
    regAdd("PulseAttendanceTest", `cmd.exe /c start "Pulse Attendance Test" /D "${WEB}" cmd.exe /k node scripts\\agent-lifecycle-test.mjs --resume`);
    record(s, "Server set to start with Windows", null, "HKCU Run → PulseAttendanceServer");

    const agentKey = execSync(`reg query "${RUN_KEY}"`, { encoding: "utf8" }).includes("PulseAttendanceAgent");
    record(s, "Agent set to start with Windows", agentKey, agentKey ? "HKCU Run → PulseAttendanceAgent" : "missing — the agent will not start after restart");
    return "crash";
  },

  async crash(s) {
    banner("TEST 1 — PC loses power / agent crashes (no clean shutdown)");
    if (!(await ensureOpenSession(s))) return record(s, "Crash → auto check-out", false, "could not get an open session"), "start";
    await wait(70 * SEC, "letting the agent send a heartbeat");
    const killAt = Date.now();
    killAgent();
    log(`Agent killed at ${fmt(killAt)} — server should close the session after 3 min without heartbeats`);
    const out = await until(
      () => punchesSince(s, killAt - 2 * MIN).find((p) => p.type === "OUT" && !p.voided && /offline/i.test(p.flag_reason ?? "")),
      7 * MIN,
      "waiting for automatic check-out",
      10 * SEC,
    );
    record(s, "Crash → automatic check-out at last heartbeat", !!out && out.ts <= killAt + 5 * SEC && out.ts >= killAt - 2 * MIN, out ? `OUT at ${fmt(out.ts)} (agent killed ${fmt(killAt)}) — ${out.flag_reason}` : "no OUT within 7 minutes");
    return "start";
  },

  async start(s) {
    banner("TEST 2 — PC switched on / agent starts → check-in");
    if (isOpen(s)) killAgent();
    if (isOpen(s)) await until(() => !isOpen(s), 7 * MIN, "waiting for the open session to close", 10 * SEC);
    const at = Date.now();
    startAgent();
    const inn = await until(() => punchesSince(s, at - 5 * SEC).find((p) => p.type === "IN" && !p.voided), 2 * MIN, "waiting for check-in");
    record(s, "Agent start → check-in at the right time", !!inn && Math.abs(inn.ts - at) < 30 * SEC, inn ? `IN at ${fmt(inn.ts)} (agent started ${fmt(at)})` : "no IN within 2 minutes");
    return "duplicate";
  },

  async duplicate(s) {
    banner("TEST 3 — agent restarted while already checked in → no duplicate");
    await ensureOpenSession(s);
    const before = punchesSince(s, s.startedAt - MIN).filter((p) => !p.voided).length;
    killAgent();
    startAgent();
    await wait(90 * SEC, "letting the agent re-sync");
    const after = punchesSince(s, s.startedAt - MIN).filter((p) => !p.voided).length;
    record(s, "No duplicate check-in while session is open", after === before && isOpen(s), `${before} punches before, ${after} after`);
    return "outage";
  },

  async outage(s) {
    banner("TEST 4 — internet/server outage while working → session must NOT be lost");
    await ensureOpenSession(s);
    await wait(70 * SEC, "letting the agent send a heartbeat");
    const at = Date.now();
    await stopServer();
    log(`Server stopped at ${fmt(at)} (simulates internet down). Waiting past the 3-min offline limit…`);
    await wait(4.5 * MIN, "outage in progress");
    await startServer();
    log("Server back — waiting for the agent heartbeat to prove it kept running");
    await wait(150 * SEC, "reconnecting");
    const outs = punchesSince(s, at - 2 * MIN).filter((p) => p.type === "OUT");
    const reverted = q("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'AGENT_OFFLINE_CLOSE_REVERTED' AND actor_id = ? AND ts >= ?", s.userId, at)[0].n;
    record(
      s,
      "Outage → session continues (false check-out cancelled)",
      isOpen(s) && outs.every((o) => o.voided),
      `still checked in: ${isOpen(s)}; auto check-outs during outage: ${outs.length} (voided: ${outs.filter((o) => o.voided).length}); reverted by agent proof: ${reverted}`,
    );
    return "offlineQueue";
  },

  async offlineQueue(s) {
    banner("TEST 5 — PC switched on with NO internet → saved locally, synced later with original time");
    await ensureOpenSession(s);
    killAgent();
    log("Closing the current session first (crash + offline limit)…");
    await until(() => !isOpen(s), 7 * MIN, "waiting for the session to close", 10 * SEC);
    await stopServer();
    const queueFile = path.join(AGENT_DIR, "queue.json");
    const at = Date.now();
    startAgent();
    log(`Agent started OFFLINE at ${fmt(at)}`);
    await wait(60 * SEC, "agent running without server");
    let queued = [];
    try {
      queued = JSON.parse(fs.readFileSync(queueFile, "utf8"));
    } catch {}
    record(s, "Offline check-in saved on the PC", queued.some((e) => e.Type === "IN"), `queue.json holds ${queued.length} event(s): ${queued.map((e) => `${e.Type}/${e.Reason}`).join(", ") || "none"}`);
    await wait(60 * SEC, "staying offline a bit longer");
    const serverBackAt = Date.now();
    await startServer();
    const inn = await until(() => punchesSince(s, at - 10 * SEC).find((p) => p.type === "IN" && !p.voided), 3 * MIN, "waiting for queued check-in to sync");
    record(
      s,
      "Offline check-in synced with the ORIGINAL time",
      !!inn && Math.abs(inn.ts - at) < 30 * SEC && inn.ts < serverBackAt - 60 * SEC,
      inn ? `IN recorded at ${fmt(inn.ts)}; agent started ${fmt(at)}; server came back ${fmt(serverBackAt)}` : "not synced within 3 minutes",
    );
    record(s, "Offline check-in not flagged as suspicious", !!inn && !inn.flagged, inn ? inn.flag_reason ?? "no flag" : "—");
    return "lock";
  },

  async lock(s) {
    banner("TEST 6 — PC locked (away)");
    await ensureOpenSession(s);
    console.log("\n  👉 The PC will LOCK in 20 seconds.");
    console.log("  👉 Wait AT LEAST 6 MINUTES, then unlock it with your Windows password.");
    console.log("     (Unlocking sooner is also fine — that tests a short lock instead.)\n");
    await wait(20 * SEC, "locking soon");
    const lockAt = Date.now();
    execSync("rundll32.exe user32.dll,LockWorkStation");
    await until(isLocked, 30 * SEC, "waiting for lock", SEC);
    s.lockAt = lockAt;
    saveState(s);
    await until(() => !isLocked(), 12 * 3600 * SEC, "PC is locked — unlock it after 6+ minutes", 5 * SEC);
    const unlockAt = Date.now();
    log(`Unlocked at ${fmt(unlockAt)} (locked ${Math.round((unlockAt - lockAt) / MIN)} min)`);
    await wait(100 * SEC, "letting the agent sync");
    const ps = punchesSince(s, lockAt - MIN).filter((p) => !p.voided);
    const out = ps.find((p) => p.type === "OUT");
    const inn = ps.find((p) => p.type === "IN" && p.ts >= unlockAt - 15 * SEC);
    if (out || unlockAt - lockAt >= 5.5 * MIN) {
      record(s, "Long lock → checked out at lock time", !!out && Math.abs(out.ts - lockAt) < 90 * SEC && /locked/i.test(out.flag_reason ?? ""), out ? `OUT at ${fmt(out.ts)} (locked ${fmt(lockAt)}) — ${out.flag_reason}` : "no OUT");
      record(s, "Unlock → checked in again", !!inn, inn ? `IN at ${fmt(inn.ts)} (unlocked ${fmt(unlockAt)})` : "no IN after unlock");
    } else {
      record(s, "Short lock → stays checked in", !out && isOpen(s), `locked only ${Math.round((unlockAt - lockAt) / SEC)} s; OUT punches: ${out ? 1 : 0}`);
    }
    return "reboot";
  },

  async reboot(s) {
    banner("TEST 7 — RESTART the PC");
    await ensureOpenSession(s);
    await wait(70 * SEC, "letting the agent send a heartbeat");
    console.log("\n  👉 SAVE YOUR WORK. The PC restarts in 60 seconds.");
    console.log("  👉 After restart, log in to Windows. This test continues by itself and opens the report.\n");
    s.rebootAt = Date.now();
    s.step = "afterReboot";
    saveState(s);
    execFileSync("shutdown", ["/r", "/t", "60", "/c", "Pulse Attendance test: restarting to test automatic check-out and check-in"]);
    log("Restart scheduled.");
    await sleep(10 * MIN);
    return "afterReboot";
  },

  async afterReboot(s) {
    banner("AFTER RESTART — verifying check-out at shutdown and check-in at logon");
    const boot = bootTime();
    if (boot < s.rebootAt) {
      log("The PC has not restarted yet (restart cancelled?). Re-running the restart step.");
      return "reboot";
    }
    record(s, "PC restarted", null, `restart requested ${fmt(s.rebootAt)}, Windows booted ${fmt(boot)}`);
    const up = await startServer();
    record(s, "Server started automatically after restart", up, up ? "reachable on port 3300" : "not reachable within 3 min");
    const agentUp = await until(() => agentRunning(), 3 * MIN, "waiting for agent to start with Windows");
    record(s, "Agent started automatically with Windows", !!agentUp, agentUp ? "PulseAgent.exe running" : "not running");
    if (!agentUp) startAgent();
    await wait(2 * MIN, "letting the agent sync");

    const ps = punchesSince(s, s.rebootAt - 5 * MIN);
    const out = ps.find((p) => p.type === "OUT" && !p.voided && p.ts >= s.rebootAt - 2 * MIN && p.ts <= boot);
    record(
      s,
      "Shutdown → check-out recorded",
      !!out,
      out ? `OUT at ${fmt(out.ts)} (${out.flag_reason ?? "clean shutdown event"}${out.flagged ? ", flagged: sent after restart" : ""})` : "no check-out between restart and boot",
    );
    const inn = ps.find((p) => p.type === "IN" && !p.voided && p.ts >= boot);
    record(s, "Logon after restart → check-in recorded", !!inn, inn ? `IN at ${fmt(inn.ts)} (Windows booted ${fmt(boot)})` : "no check-in after boot");
    record(s, "Currently checked in", isOpen(s), isOpen(s) ? "yes" : "no");
    return "finish";
  },

  async finish(s) {
    banner("FINISH");
    for (const [k, v] of Object.entries(s.originalSettings ?? {})) exec("UPDATE settings SET value = ? WHERE key = ?", v, k);
    record(s, "Original agent limits restored", null, JSON.stringify(s.originalSettings));
    regDel("PulseAttendanceTest");
    s.finishedAt = Date.now();
    return "done";
  },
};

// ───────────────────────── runner ─────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const emailArg = args[args.indexOf("--email") + 1];
  let s = loadState();
  if (args.includes("--email")) {
    s = { email: emailArg, step: "setup", startedAt: Date.now(), results: [] };
    saveState(s);
  }
  if (!s) {
    console.log("Usage: node scripts/agent-lifecycle-test.mjs --email employee@company.com");
    return;
  }
  if (s.step === "done") {
    log(`Test already finished. Report: ${REPORT}`);
    return;
  }
  banner(`Pulse Attendance agent test — ${s.email} — resuming at "${s.step}"`);
  if (s.step === "afterReboot") await wait(45 * SEC, "giving Windows time to finish starting");

  while (s.step !== "done") {
    try {
      const next = await STEPS[s.step](s);
      s.step = next;
      saveState(s);
    } catch (e) {
      record(s, `Step "${s.step}" crashed`, false, e.message);
      if (s.step === "setup") return;
      s.step = s.step === "finish" ? "done" : "finish";
      saveState(s);
    }
  }
  const passed = s.results.filter((r) => r.pass === true).length;
  const failed = s.results.filter((r) => r.pass === false).length;
  banner(`DONE — ${passed} passed, ${failed} failed. Report: ${REPORT}`);
  spawn("notepad.exe", [REPORT], { detached: true, stdio: "ignore" }).unref();
}

main().catch((e) => {
  console.error("\nTest runner error:", e);
  process.exitCode = 1;
});
