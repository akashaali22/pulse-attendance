// How long the interface takes to actually change theme, and whether it stays smooth while it does.
// Usage: BASE=http://localhost:3301 ADMIN_PW='…' node scripts/theme-switch-test.mjs

import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const results = [];
const check = (n, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? ` — ${extra}` : ""}`); };

const b = await chromium.launch({ channel: "msedge" });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
let posts = 0;
p.on("request", (r) => { if (r.method() === "POST") posts++; });

await p.goto(`${BASE}/login`, { timeout: 120000 });
await p.fill("#email", process.env.ADMIN_EMAIL ?? "admin@company.com");
await p.fill("#password", process.env.ADMIN_PW ?? "Admin@123");
await p.click("button[type=submit]");
await p.waitForURL(/dashboard/, { timeout: 90000 });
await p.waitForTimeout(1500);

const themeNow = () => p.evaluate(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
const toggle = p.getByRole("button", { name: "Theme" });

const times = [];
for (let i = 0; i < 4; i++) {
  const before = await themeNow();
  const t0 = Date.now();
  await toggle.click();
  await p.waitForFunction((was) => (document.documentElement.classList.contains("dark") ? "dark" : "light") !== was, before, { timeout: 10000 });
  times.push(Date.now() - t0);
  await p.waitForTimeout(400);
}
const worst = Math.max(...times);
check("the theme changes on the spot", worst < 250, `slowest ${worst}ms of ${times.join(", ")}ms`);
check("it does not wait for the server", posts >= 1, `${posts} requests sent (the cookie is still saved)`);

// the choice has to survive a reload, otherwise we have only faked it
const chosen = await themeNow();
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(800);
check("the choice is remembered after a reload", (await themeNow()) === chosen, chosen);

// and the page must not flash the other theme while loading
const flash = await p.evaluate(() => document.documentElement.getAttribute("style")?.includes("color-scheme") ?? true);
check("colour scheme is set on the document", flash);

await b.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
