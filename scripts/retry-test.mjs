// A rejected submit must not jam the form: retrying with the right values has to work
// without a page reload. Regression test for forms that dispatched only once.
// Usage: BASE=http://localhost:3300 ADMIN_PW='…' node scripts/retry-test.mjs

import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@company.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Admin@123";
const results = [];
const check = (n, ok) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); };

const b = await chromium.launch({ channel: "msedge" });
const p = await (await b.newContext()).newPage();
let posts = 0;
p.on("request", (r) => { if (r.method() === "POST") posts++; });

await p.goto(`${BASE}/login`, { timeout: 120000 });
await p.fill("#email", ADMIN_EMAIL);
for (const pw of ["wrong-one", "wrong-two"]) {
  await p.fill("#password", pw);
  await p.click("button[type=submit]");
  await p.getByText(/Invalid email or password/i).first().waitFor({ timeout: 20000 }).catch(() => {});
}
check("every rejected attempt reaches the server", posts >= 2);

await p.fill("#password", ADMIN_PW);
await p.click("button[type=submit]");
check("the right password works after two wrong ones — no reload", await p.waitForURL(/dashboard/, { timeout: 60000 }).then(() => true, () => false));

// Same for an ActionForm: change-password is rejected twice in a row, then accepted.
await p.goto(`${BASE}/profile`, { timeout: 60000 });
const changePw = async (current, next) => {
  await p.fill("input[name=current]", current);
  await p.fill("input[name=next]", next);
  await p.locator("form:has(input[name=next]) button[type=submit]").click();
};
await changePw("wrong-password-1", "LongEnough#1");
check("a wrong current password is rejected", await p.getByText(/Current password is incorrect/i).first().waitFor({ timeout: 20000 }).then(() => true, () => false));
await p.getByText(/Current password is incorrect/i).first().waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
await changePw("wrong-password-2", "LongEnough#2");
check("the form still submits after that rejection", await p.getByText(/Current password is incorrect/i).first().waitFor({ timeout: 20000 }).then(() => true, () => false));
await p.getByText(/Current password is incorrect/i).first().waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
await changePw(ADMIN_PW, ADMIN_PW);
check("the right values go through afterwards", await p.getByText(/Password changed/i).first().waitFor({ timeout: 20000 }).then(() => true, () => false));

await b.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
