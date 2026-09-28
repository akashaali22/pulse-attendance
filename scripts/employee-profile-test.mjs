// The public download page and the admin's per-employee profile.
// Usage: BASE=http://localhost:3300 ADMIN_PW='…' node scripts/employee-profile-test.mjs

import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@company.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Admin@123";
const results = [];
const check = (n, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? ` — ${extra}` : ""}`); };
const seen = (l, ms = 30000) => l.first().waitFor({ timeout: ms }).then(() => true, () => false);

const b = await chromium.launch({ channel: "msedge" });

// ── signed out: the download page ──
const anon = await (await b.newContext()).newPage();
await anon.goto(`${BASE}/login`, { timeout: 120000 });
check("sign-in page offers the app", await seen(anon.getByRole("link", { name: /Get the app/ })));
await anon.getByRole("link", { name: /Get the app/ }).click();
await anon.waitForURL(/download/, { timeout: 60000 }).catch(() => {});
check("download page opens signed out", await seen(anon.getByText("Windows PC")));
await anon.getByRole("heading", { name: "Phone", exact: true }).waitFor();
check("all three platforms are offered", await anon.getByRole("heading", {name: /Windows PC/}).isVisible() && await anon.getByRole("heading", {name: "Mac", exact: true}).isVisible() && await anon.getByRole("heading", {name: "Phone", exact: true}).isVisible());
check("this device is marked", await seen(anon.getByText("Your device")));
const exe = await anon.request.get(`${BASE}/api/agent/download`);
check("Windows agent downloads without signing in", exe.ok() && (await exe.body()).length > 10000, `${exe.status()} · ${((await exe.body()).length / 1024).toFixed(0)} KB`);
const mac = await anon.request.get(`${BASE}/api/agent/download/mac`);
check("Mac installer is served", mac.ok() && (await mac.text()).includes(BASE));

// ── admin: the employee profile ──
const p = await (await b.newContext()).newPage();
await p.goto(`${BASE}/login`, { timeout: 120000 });
await p.fill("#email", ADMIN_EMAIL);
await p.fill("#password", ADMIN_PW);
await p.click("button[type=submit]");
check("admin signs in", await p.waitForURL(/dashboard/, { timeout: 90000 }).then(() => true, () => false));

await p.goto(`${BASE}/employees`, { timeout: 60000 });
const firstName = await p.locator("tbody tr").first().locator("a").first().innerText();
await p.locator("tbody tr").first().locator("a").first().click();
check("clicking an employee opens their profile", await p.waitForURL(/employees\/\d+/, { timeout: 60000 }).then(() => true, () => false), firstName);
check("the month calendar is there", await seen(p.getByText(/Calendar/)));
check("month stats are shown", await seen(p.getByText("Present", { exact: true })));
check("the year graph is there", await seen(p.getByText("Jan", { exact: true })));
check("leave balance is shown", await seen(p.getByText(/Leave balance/)));

// a day opens its timings
const days = p.locator("button[aria-pressed]");
const n = await days.count();
check("calendar has day buttons", n >= 28, `${n} days`);
let opened = false;
for (let i = 0; i < n; i++) {
  await days.nth(i).click();
  if (await p.getByText(/Session 1/).first().isVisible().catch(() => false)) { opened = true; break; }
}
check("clicking a worked day shows its in/out times", opened);
check("worked and break totals are shown for that day", await seen(p.getByText("First in").first()));

// month navigation, both ways
const url = p.url();
// Month bars are labelled with what they contain ("Feb: On time 12, …" or "Feb: No records").
// Bring the year chart into view and let the entrance animation settle: clicking a bar that is
// still sliding makes Playwright wait for stability until it times out.
const feb = p.getByRole("link", { name: /^Feb/ });
await feb.scrollIntoViewIfNeeded();
await p.waitForTimeout(600);
await feb.click();
await p.waitForTimeout(2500);
check("clicking a month in the graph switches the calendar", /month=\d{4}-02/.test(p.url()), p.url().split("?")[1] ?? "");
await p.goto(url);
await p.getByRole("link", { name: "Previous month" }).click();
await p.waitForTimeout(2500);
check("previous month works", /month=/.test(p.url()));

// the complete record, not just the month on screen
await p.goto(url);
await p.waitForTimeout(600);
check("reliability is scored", await seen(p.getByText(/\/100/)));
check("signals panel is present", await seen(p.locator(".card", { hasText: /Signals/i })));
const monthTable = p.locator(".card", { hasText: "Month by month" });
check("month by month table is there", await seen(monthTable));
const rows = monthTable.locator("tbody tr");
check("it lists the months that have records", (await rows.count()) >= 2, `${await rows.count()} rows`);
check("it ends with a lifetime total", await seen(monthTable.getByText("Lifetime")));
const sepRow = rows.filter({ hasText: "Sep" }).first();
check("a month row carries the counts", /\d/.test(await sepRow.innerText().catch(() => "")), (await sepRow.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80));
check("years can be switched", await seen(monthTable.getByRole("link", { name: /^20\d\d$/ })));
check("leave history is shown", await seen(p.getByText(/Leave history/)));
check("correction history is shown", await seen(p.getByText(/Correction history/)));

// a manager cannot open someone else's profile
const emp = await (await b.newContext()).newPage();
await emp.goto(`${BASE}/login`, { timeout: 60000 });
await emp.fill("#email", process.env.EMPLOYEE_EMAIL ?? "fatima.khan@demo.local");
await emp.fill("#password", process.env.EMPLOYEE_PW ?? "Demo@1234");
await emp.click("button[type=submit]");
await emp.waitForURL(/dashboard/, { timeout: 60000 }).catch(() => {});
await emp.goto(`${BASE}/employees/1`, { timeout: 60000 });
await emp.waitForURL(/dashboard/);
check("an employee cannot open a profile", !/employees\/1/.test(emp.url()) || (await emp.getByText(/Sign in|not found/i).first().isVisible().catch(() => false)));

await b.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
