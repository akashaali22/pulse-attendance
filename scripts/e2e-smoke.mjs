// End-to-end smoke test against a running server using the system Edge browser.
// Usage: BASE=http://localhost:3200 node scripts/e2e-smoke.mjs [screenshotDir]
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@company.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Admin@123";
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];

async function session(email, password) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    geolocation: { latitude: 24.8607, longitude: 67.0011, accuracy: 10 },
    permissions: ["geolocation"],
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "ok" : undefined));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  return { ctx, page };
}
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const toast = (page, re) => page.waitForSelector(`text=${re}`, { timeout: 15000 }).then(() => true, () => false);

// Unauthenticated access is redirected
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/employees`);
  check("signed-out user redirected to login", p.url().includes("/login"));
  const r = await p.request.get(`${BASE}/api/export`);
  check("export API rejects anonymous", r.status() === 403);
  await p.goto(`${BASE}/login`);
  await p.fill("#email", ADMIN_EMAIL);
  await p.fill("#password", "wrong");
  await p.click("button[type=submit]");
  check("wrong password rejected", await toast(p, "Invalid email or password"));
  await ctx.close();
}

// Employee: check-in / break / out, leave, correction
const emp = await session("fatima.khan@demo.local", "Demo@1234");
{
  const { page } = emp;
  await shot(page, "01-employee-dashboard");
  const inBtn = page.getByRole("button", { name: "Check In" });
  if (await inBtn.isVisible()) {
    await inBtn.click();
    check("employee check-in", await toast(page, "Checked in"));
  } else check("employee already in today (demo data)", true);
  // During the company lunch break the card shows "Lunch break" instead of a break button.
  const breakBtn = page.getByRole("button", { name: /Start Break|End Break/ }).first();
  if (await breakBtn.isVisible().catch(() => false)) {
    await breakBtn.click();
    check("break toggled", await toast(page, /Break started|Welcome back/));
  } else {
    check("automatic lunch break shown instead of break button", await page.getByText("Lunch break").first().isVisible());
  }
  await page.waitForTimeout(800);
  await shot(page, "02-employee-working");

  await page.goto(`${BASE}/leave`);
  await page.selectOption("select[name=leave_type_id]", { label: "Casual Leave" });
  const future = new Date(Date.now() + 20 * 86400000);
  while ([0, 6].includes(future.getDay())) future.setDate(future.getDate() + 1);
  const d = future.toISOString().slice(0, 10);
  await page.fill("input[name=start_date]", d);
  await page.fill("input[name=end_date]", d);
  await page.fill("textarea[name=reason]", "E2E test leave");
  await page.click("form button[type=submit]");
  check("leave request submitted", await toast(page, /Leave request submitted|already have leave/));
  await shot(page, "03-leave");

  await page.goto(`${BASE}/corrections`);
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await page.fill("input[name=work_date]", past);
  await page.fill("input[name=check_in]", "09:00");
  await page.fill("input[name=check_out]", "18:00");
  await page.fill("textarea[name=reason]", "E2E correction");
  await page.click("form button[type=submit]");
  check("correction submitted", await toast(page, /Correction request submitted|already have a pending/));

  await page.goto(`${BASE}/employees`);
  check("employee blocked from admin page", page.url().includes("/dashboard"));
  const r = await page.request.get(`${BASE}/api/export`);
  check("employee blocked from export", r.status() === 403);

  await page.goto(`${BASE}/attendance`);
  await shot(page, "04-my-attendance");
}

// Manager: approvals, team, reports
const mgr = await session("manager@demo.local", "Demo@1234");
{
  const { page } = mgr;
  await shot(page, "05-manager-dashboard");
  await page.goto(`${BASE}/approvals`);
  await shot(page, "06-approvals");
  const approve = page.getByRole("button", { name: "Approve" }).first();
  await approve.click();
  check("manager approves a request", await toast(page, /approved|applied/));
  await page.goto(`${BASE}/team`);
  check("team live lists employees", (await page.locator("table.data tbody tr").count()) >= 10);
  await shot(page, "07-team-live");
  await page.goto(`${BASE}/reports`);
  await shot(page, "08-reports");
  const x = await page.request.get(`${BASE}/api/export?kind=daily&format=xlsx`);
  const body = await x.body();
  check("excel export is a valid xlsx", x.status() === 200 && body.subarray(0, 2).toString() === "PK", `${body.length} bytes`);
  const c = await page.request.get(`${BASE}/api/export?kind=summary&format=csv`);
  check("csv export has rows", (await c.text()).split("\n").length > 5);
  await page.goto(`${BASE}/kiosk`);
  check("kiosk shows QR", await page.waitForSelector("img[alt='Check-in QR code']", { timeout: 15000 }).then(() => true, () => false));
  await shot(page, "09-kiosk");

  // Employee scans the kiosk QR
  const token = await (await page.request.get(`${BASE}/api/kiosk/token`)).json();
  await emp.page.goto(`${BASE}/scan?t=${encodeURIComponent(token.token)}`);
  check("valid QR accepted on scan page", !(await emp.page.locator("text=Invalid or expired QR code").isVisible()));
  await emp.page.goto(`${BASE}/scan?t=1.forged`);
  check("forged QR rejected", await emp.page.locator("text=Invalid or expired QR code").isVisible());
}

// Admin: settings, audit, command palette, urdu
const adm = await session(ADMIN_EMAIL, ADMIN_PW);
{
  const { page } = adm;
  await shot(page, "10-admin-dashboard");
  await page.goto(`${BASE}/audit`);
  check("audit chain verified", await page.locator("text=Integrity verified").isVisible());
  await shot(page, "11-audit");
  await page.goto(`${BASE}/settings`);
  await shot(page, "12-settings");
  await page.goto(`${BASE}/employees`);
  await shot(page, "13-employees");
  await page.keyboard.press("Control+k");
  check("command palette opens", await page.locator("[aria-label='Command palette']").isVisible());
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /اردو/ }).click();
  await page.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 15000 }).catch(() => {});
  check("urdu RTL switch", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
  await page.goto(`${BASE}/dashboard`);
  await shot(page, "14-urdu-dashboard");
  await page.getByRole("button", { name: /English/ }).click();
  await page.waitForTimeout(1500);

  // light theme + mobile
  const mob = await browser.newContext({ viewport: { width: 400, height: 860 }, storageState: await adm.ctx.storageState() });
  const mp = await mob.newPage();
  await mp.goto(`${BASE}/dashboard`);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no horizontal overflow at 400px", !overflow);
  await shot(mp, "15-mobile");
}

check("no client-side JS errors", errors.length === 0, errors.join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
