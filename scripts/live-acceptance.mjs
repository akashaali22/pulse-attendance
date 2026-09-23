// End-to-end acceptance test against a LIVE deployment.
// It creates its own throw-away employee, exercises every feature, then deactivates that employee.
//
//   node scripts/live-acceptance.mjs --base https://your-app.onrender.com --admin admin@company.com --password '...'
//
// Uses the Microsoft Edge that ships with Windows (no browser download).

import { chromium } from "playwright-core";
import fs from "node:fs";

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const ADMIN = arg("admin", "admin@company.com");
const ADMIN_PW = arg("password", "Admin@123");
const SHOTS = arg("shots");
const stamp = Date.now().toString().slice(-6);
const EMP = { name: `QA Test ${stamp}`, email: `qa.test.${stamp}@example.com`, pw: "QaTest#2026" };

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
const seen = (locator, ms = 20000) => locator.first().waitFor({ timeout: ms }).then(() => true, () => false);

const browser = await chromium.launch({ channel: "msedge" });
const jsErrors = [];
async function session(email, password, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1500, height: 950 },
    geolocation: { latitude: 24.8607, longitude: 67.0011, accuracy: 12 },
    permissions: ["geolocation"],
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => jsErrors.push(`${email}: ${e.message}`));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "ok" : undefined));
  await page.goto(`${BASE}/login`, { timeout: 180000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  const ok = await page.waitForURL(/dashboard/, { timeout: 90000 }).then(() => true, () => false);
  return { ctx, page, ok };
}

// ───────────────────────── 1. Access control ─────────────────────────
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/employees`, { timeout: 180000 });
  check("1.1 signed-out visitor is sent to login", p.url().includes("/login"));
  check("1.2 served over HTTPS", BASE.startsWith("https://"));
  await p.goto(`${BASE}/login`);
  await p.fill("#email", ADMIN);
  await p.fill("#password", "definitely-wrong");
  await p.click("button[type=submit]");
  check("1.3 wrong password refused", await seen(p.getByText("Invalid email or password")));
  const api = await p.request.get(`${BASE}/api/export?kind=summary&format=csv`);
  check("1.4 export API refuses anonymous callers", api.status() === 403);
  await ctx.close();
}

const admin = await session(ADMIN, ADMIN_PW);
check("1.5 admin signs in", admin.ok);
if (!admin.ok) { console.log("\nCannot continue without admin access."); await browser.close(); process.exit(1); }
await shot(admin.page, "live-01-dashboard");

// ───────────────────────── 2. Employee management ─────────────────────────
{
  const p = admin.page;
  await p.goto(`${BASE}/employees`);
  await p.getByRole("button", { name: /Add Employee/ }).click();
  await p.fill("input[name=name]", EMP.name);
  await p.fill("input[name=email]", EMP.email);
  await p.fill("input[name=designation]", "QA Engineer");
  await p.fill("input[name=password]", EMP.pw);
  await p.fill("input[name=joined_on]", new Date().toISOString().slice(0, 10));
  await p.locator("form button[type=submit]").click();
  check("2.1 admin creates an employee", await seen(p.getByText("Employee created")));

  await p.goto(`${BASE}/employees?q=${encodeURIComponent(stamp)}`);
  const row = p.locator("tbody tr", { hasText: EMP.name });
  check("2.2 employee appears in the list", await seen(row));
  await row.getByRole("button", { name: "Show password" }).click();
  check("2.3 admin can reveal the password", await seen(row.getByText(EMP.pw)));
  await shot(p, "live-02-employees");
}

// ───────────────────────── 3. Attendance (employee) ─────────────────────────
const emp = await session(EMP.email, EMP.pw);
check("3.1 new employee can sign in", emp.ok);
{
  const p = emp.page;
  const toast = (re) => p.getByText(re).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
  await p.getByRole("button", { name: "Check In" }).click();
  check("3.2 check-in with GPS", await toast(/Checked in/));
  await p.waitForTimeout(2500);
  const breakBtn = p.getByRole("button", { name: /Start Break|End Break/ }).first();
  if (await breakBtn.isVisible().catch(() => false)) {
    await breakBtn.click();
    check("3.3 break toggle", await toast(/Break started|Welcome back/));
    await p.waitForTimeout(2000);
    const back = p.getByRole("button", { name: "End Break" }).first();
    if (await back.isVisible().catch(() => false)) await back.click();
  } else {
    check("3.3 company lunch break shown automatically", await seen(p.getByText("Lunch break")));
  }
  await shot(p, "live-03-working");
  await p.goto(`${BASE}/attendance`);
  check("3.4 today's row appears in My Attendance", await seen(p.locator("tbody tr")));
  const statusText = await p.locator("tbody tr").first().innerText();
  check("3.5 status is a working state", /WORKING|ON_BREAK|کام|وقفے/.test(statusText.replace(/\s+/g, " ")), statusText.replace(/\s+/g, " ").slice(0, 80));
}

// ───────────────────────── 4. Leave ─────────────────────────
{
  const p = emp.page;
  const d = new Date(Date.now() + 9 * 86400000);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  const day = d.toISOString().slice(0, 10);
  await p.goto(`${BASE}/leave`);
  await p.selectOption("select[name=leave_type_id]", { label: "Casual Leave" });
  await p.fill("input[name=start_date]", day);
  await p.fill("input[name=end_date]", day);
  await p.fill("textarea[name=reason]", "Acceptance test leave");
  await p.locator("form button[type=submit]").click();
  check("4.1 employee applies for leave", await seen(p.getByText("Leave request submitted")));

  const a = admin.page;
  await a.goto(`${BASE}/approvals`);
  const card = a.locator("li", { hasText: EMP.name }).first();
  check("4.2 request reaches the approvals inbox", await seen(card));
  await card.getByRole("button", { name: "Approve" }).click();
  check("4.3 admin approves it", await seen(a.getByText(/approved/i)));
  await shot(a, "live-04-approvals");

  await p.goto(`${BASE}/leave`);
  await p.reload({ waitUntil: "load" });
  const leaveRow = p.locator("tbody tr", { hasText: "Acceptance test leave" });
  check("4.4 employee sees it approved", await seen(leaveRow) && /approved|منظور/.test(await leaveRow.innerText()), (await leaveRow.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 90));
}

// ───────────────────────── 5. Correction request ─────────────────────────
{
  const p = emp.page;
  const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await p.goto(`${BASE}/corrections`);
  await p.fill("input[name=work_date]", past);
  await p.fill("input[name=check_in]", "09:05");
  await p.fill("input[name=check_out]", "18:10");
  await p.fill("textarea[name=reason]", "Acceptance test correction");
  await p.locator("form button[type=submit]").click();
  check("5.1 employee requests a correction", await seen(p.getByText("Correction request submitted")));

  const a = admin.page;
  await a.goto(`${BASE}/approvals`);
  const card = a.locator("li", { hasText: past }).filter({ hasText: EMP.name }).first();
  check("5.2 correction reaches approvals", await seen(card));
  await card.getByRole("button", { name: "Approve" }).click();
  check("5.3 admin approves the correction", await seen(a.getByText(/applied|approved/i)));

  await p.goto(`${BASE}/attendance`);
  const row = p.locator("tbody tr", { hasText: past });
  check("5.4 corrected day now shows times", await seen(row) && /9:05|09:05/.test(await row.innerText()));
}

// ───────────────────────── 6. Manager views, reports, kiosk, audit ─────────────────────────
{
  const a = admin.page;
  await a.goto(`${BASE}/team`);
  check("6.1 Team Live lists the employee", await seen(a.locator("tbody tr", { hasText: EMP.name })));
  await shot(a, "live-05-team");

  await a.goto(`${BASE}/reports`);
  check("6.2 reports page renders", await seen(a.locator("tbody tr", { hasText: EMP.name })));
  const csv = await a.request.get(`${BASE}/api/export?kind=daily&format=csv`);
  const csvText = await csv.text();
  check("6.3 CSV export includes the employee", csv.ok() && csvText.includes(EMP.name), `${csvText.split("\n").length} rows`);
  const xlsx = await a.request.get(`${BASE}/api/export?kind=summary&format=xlsx`);
  const buf = await xlsx.body();
  check("6.4 Excel export is a real xlsx", xlsx.ok() && buf.subarray(0, 2).toString() === "PK", `${(buf.length / 1024).toFixed(0)} KB`);

  await a.goto(`${BASE}/kiosk`);
  check("6.5 QR kiosk renders a code", await seen(a.locator("img[alt='Check-in QR code']"), 30000));
  const token = await (await a.request.get(`${BASE}/api/kiosk/token`)).json();
  await emp.page.goto(`${BASE}/scan?t=${encodeURIComponent(token.token)}`);
  check("6.6 fresh QR accepted", !(await emp.page.getByText("Invalid or expired QR code").isVisible().catch(() => false)));
  await emp.page.goto(`${BASE}/scan?t=9.forged`);
  check("6.7 forged QR rejected", await emp.page.getByText("Invalid or expired QR code").isVisible());

  await a.goto(`${BASE}/audit`);
  check("6.8 audit chain verified", await seen(a.getByText("Integrity verified")));
  await a.goto(`${BASE}/audit?q=PUNCH_IN`);
  check("6.9 punches are audited", (await a.locator("tbody tr").count()) > 0);
  await shot(a, "live-06-audit");
}

// ───────────────────────── 7. Interface: language, theme, mobile ─────────────────────────
{
  const a = admin.page;
  await a.goto(`${BASE}/dashboard`);
  await a.getByRole("button", { name: /Search/ }).first().waitFor({ timeout: 30000 }).catch(() => {}); // wait for hydration
  await a.locator("body").click({ position: { x: 5, y: 5 } });
  await a.keyboard.press("Control+k");
  let palette = await seen(a.locator("[aria-label='Command palette']"), 8000);
  if (!palette) {
    await a.getByRole("button", { name: /Search/ }).first().click();
    palette = await seen(a.locator("[aria-label='Command palette']"), 8000);
  }
  check("7.1 command palette opens", palette);
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: /اردو/ }).click();
  await a.waitForTimeout(3000);
  check("7.2 Urdu switches to right-to-left", (await a.evaluate(() => document.documentElement.dir)) === "rtl");
  await shot(a, "live-07-urdu");
  await a.getByRole("button", { name: /English/ }).click();
  await a.waitForTimeout(3000);

  const mob = await browser.newContext({ viewport: { width: 400, height: 860 }, storageState: await emp.ctx.storageState() });
  const mp = await mob.newPage();
  await mp.goto(`${BASE}/dashboard`, { timeout: 90000 });
  check("7.3 no sideways scrolling on a phone", !(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await shot(mp, "live-08-mobile");
  await mob.close();
}

// ───────────────────────── 8. Employee changes own password ─────────────────────────
{
  const p = emp.page;
  await p.goto(`${BASE}/profile`);
  await p.fill("input[name=current]", EMP.pw);
  await p.fill("input[name=next]", "QaTest#2026b");
  await p.locator("form", { has: p.locator("input[name=next]") }).getByRole("button").click();
  check("8.1 employee changes their password", await seen(p.getByText("Password changed")));
  const a = admin.page;
  await a.goto(`${BASE}/employees?q=${encodeURIComponent(stamp)}`);
  const row = a.locator("tbody tr", { hasText: EMP.name });
  await row.getByRole("button", { name: "Show password" }).click();
  check("8.2 admin sees the new password", await seen(row.getByText("QaTest#2026b")));
}

// ───────────────────────── 9. Clean up ─────────────────────────
{
  const a = admin.page;
  await a.goto(`${BASE}/employees?q=${encodeURIComponent(stamp)}`);
  const row = a.locator("tbody tr", { hasText: EMP.name });
  await row.getByRole("button", { name: "Inactive" }).click().catch(() => {});
  await a.waitForTimeout(2500);
  check("9.1 test employee deactivated", await seen(a.getByText(/deactivated/i), 15000));
}

check("9.2 no client-side JavaScript errors", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (SHOTS) fs.writeFileSync(`${SHOTS}/live-acceptance.json`, JSON.stringify(results, null, 2));
if (failed.length) console.log("Failed:", failed.map((f) => f.name).join(", "));
process.exit(failed.length ? 1 : 0);
