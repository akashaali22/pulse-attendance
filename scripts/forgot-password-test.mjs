// Forgotten passwords: an employee asks the admin, and a locked-out admin uses the recovery code.
// Usage: BASE=http://localhost:3300 ADMIN_PW='…' RECOVERY_CODE='…' node scripts/forgot-password-test.mjs

import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@company.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Admin@123";
const RECOVERY = process.env.RECOVERY_CODE ?? "";
const EMPLOYEE = process.env.EMPLOYEE_EMAIL ?? "fatima.khan@demo.local";
const results = [];
const check = (n, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? ` — ${extra}` : ""}`); };
const seen = (l, ms = 30000) => l.first().waitFor({ timeout: ms }).then(() => true, () => false);

const b = await chromium.launch({ channel: "msedge" });
const open = async () => (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const login = async (email, pw) => {
  const p = await open();
  await p.goto(`${BASE}/login`, { timeout: 120000 });
  await p.fill("#email", email);
  await p.fill("#password", pw);
  await p.click("button[type=submit]");
  const ok = await p.waitForURL(/dashboard/, { timeout: 60000 }).then(() => true, () => false);
  return { p, ok };
};

// 1. The link is on the login page and the page opens without signing in
const anon = await open();
await anon.goto(`${BASE}/login`, { timeout: 120000 });
check("login page offers 'Forgot password?'", await seen(anon.getByRole("link", { name: /Forgot password/ })));
await anon.getByRole("link", { name: /Forgot password/ }).click();
await anon.waitForURL(/forgot/, { timeout: 60000 }).catch(() => {});
check("forgot page opens for a signed-out visitor", /\/forgot/.test(anon.url()) && (await seen(anon.getByRole("button", { name: "Ask my admin" }))));

// 2. Employee asks the admin
await anon.fill("input[name=email]", EMPLOYEE);
await anon.fill("input[name=note]", "Acceptance test request");
await anon.locator("form button[type=submit]").click();
check("request is accepted", await seen(anon.getByText(/your admin has been asked/i)));

// 3. An unknown address gets the same answer (no way to discover who has an account)
await anon.goto(`${BASE}/forgot`);
await anon.fill("input[name=email]", `nobody.${Date.now()}@example.com`);
await anon.locator("form button[type=submit]").click();
check("unknown email gets the same neutral answer", await seen(anon.getByText(/your admin has been asked/i)));

// 4. Admin sees it and can set a new password from there
const admin = await login(ADMIN_EMAIL, ADMIN_PW);
check("admin signs in", admin.ok);
await admin.p.goto(`${BASE}/employees`, { timeout: 60000 });
const card = admin.p.locator("li", { hasText: "Acceptance test request" });
check("request shows up for the admin", await seen(card));
await admin.p.getByRole("button", { name: "Notifications" }).click();
check("admin is notified", await seen(admin.p.getByText(/forgot their password/)));
await admin.p.keyboard.press("Escape");
await admin.p.goto(`${BASE}/employees`);
await admin.p.locator("li", { hasText: "Acceptance test request" }).getByRole("button", { name: "Update password" }).click();
const newPw = `Reset#${Date.now().toString().slice(-6)}`;
await admin.p.fill("input[autocomplete=new-password]", newPw);
await admin.p.getByRole("button", { name: "Update", exact: true }).click();
check("admin sets a new password from the request", await seen(admin.p.getByText(newPw)));
// The dialog lives inside the request card, so handling the request unmounts it — no Done to click.
await admin.p.reload();
check("the request disappears once handled", !(await admin.p.locator("li", { hasText: "Acceptance test request" }).first().isVisible().catch(() => false)));

// 5. The employee can sign in with it
const emp = await login(EMPLOYEE, newPw);
check("employee signs in with the new password", emp.ok);

// restore the demo employee's password
if (EMPLOYEE.endsWith("@demo.local")) {
  await admin.p.goto(`${BASE}/employees?q=${encodeURIComponent(EMPLOYEE.split("@")[0])}`);
  const row = admin.p.locator("tbody tr", { hasText: EMPLOYEE });
  await row.getByRole("button", { name: "Update password" }).click();
  await admin.p.fill("input[autocomplete=new-password]", "Demo@1234");
  await admin.p.getByRole("button", { name: "Update", exact: true }).click();
  await admin.p.getByRole("button", { name: "Done" }).click();
}

// 6. Admin recovery code
if (RECOVERY) {
  const page = await open();
  await page.goto(`${BASE}/forgot`);
  await page.getByRole("button", { name: "I am the admin" }).click();
  await page.fill("input[name=email]", ADMIN_EMAIL);
  await page.fill("input[name=code]", "definitely-the-wrong-code");
  await page.fill("input[name=password]", "SomeNewPass#1");
  await page.locator("form button[type=submit]").click();
  check("a wrong recovery code is refused", await seen(page.getByText(/do not match an admin account/i)));

  await page.fill("input[name=code]", RECOVERY);
  await page.fill("input[name=password]", ADMIN_PW); // set it back to the same password
  await page.locator("form button[type=submit]").click();
  check("the right recovery code sets a new admin password", await seen(page.getByText(/Password changed/i)));
  const again = await login(ADMIN_EMAIL, ADMIN_PW);
  check("admin can sign in after recovery", again.ok);
} else {
  const page = await open();
  await page.goto(`${BASE}/forgot`);
  await page.getByRole("button", { name: "I am the admin" }).click();
  check("recovery explains how to switch it on when unset", await seen(page.getByText(/ADMIN_RECOVERY_CODE/)));
}

await b.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
