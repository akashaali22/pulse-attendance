// E2E: admin updates/reveals passwords; employee self-change notifies admins.
// Usage: BASE=http://localhost:3300 node scripts/password-test.mjs [screenshotDir]
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const dir = process.argv[2];
const results = [];
const check = (name, cond, extra = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const b = await chromium.launch({ channel: "msedge" });
const login = async (email, password) => {
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", password);
  await p.click("button[type=submit]");
  await p.waitForURL(/dashboard/, { timeout: 20000 });
  return p;
};
const row = (p, name) => p.locator("tbody tr", { hasText: name });

// 1. Admin sets Omar's password
const admin = await login("admin@company.com", "Admin@123");
await admin.goto(`${BASE}/employees?q=Omar`);
await row(admin, "Omar Farooq").getByRole("button", { name: "Update password" }).click();
await admin.fill("input[autocomplete=new-password]", "Omar@2026");
await admin.getByRole("button", { name: "Update", exact: true }).click();
check("admin update shows new password", await admin.getByText("Omar@2026").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
if (dir) await admin.screenshot({ path: `${dir}/pw-1-admin-set.png` });
await admin.getByRole("button", { name: "Done" }).click();

await row(admin, "Omar Farooq").getByRole("button", { name: "Show password" }).click();
check("admin can reveal password", await row(admin, "Omar Farooq").getByText("Omar@2026").waitFor({ timeout: 10000 }).then(() => true, () => false));
check("shows who set it", await row(admin, "Omar Farooq").getByText(/Admin: System Admin/).isVisible());
if (dir) await admin.screenshot({ path: `${dir}/pw-2-revealed.png` });

// 2. Employee logs in with it and changes their own password
const emp = await login("omar.farooq@demo.local", "Omar@2026");
check("employee logs in with admin-set password", true);
await emp.goto(`${BASE}/profile`);
await emp.fill("input[name=current]", "Omar@2026");
await emp.fill("input[name=next]", "MyOwn#Pass9");
await emp.locator("form", { has: emp.locator("input[name=next]") }).getByRole("button").click();
check("employee changes password", await emp.getByText("Password changed").waitFor({ timeout: 10000 }).then(() => true, () => false));

// 3. Admin gets a notification and sees the new password
await admin.goto(`${BASE}/dashboard`);
await admin.getByRole("button", { name: "Notifications" }).click();
check("admin notified of change", await admin.getByText("Omar Farooq changed their password").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
if (dir) await admin.screenshot({ path: `${dir}/pw-3-notification.png` });
await admin.goto(`${BASE}/employees?q=Omar`);
await row(admin, "Omar Farooq").getByRole("button", { name: "Show password" }).click();
check("admin sees employee's new password", await row(admin, "Omar Farooq").getByText("MyOwn#Pass9").waitFor({ timeout: 10000 }).then(() => true, () => false));
check("marked as set by employee", await row(admin, "Omar Farooq").getByText(/Employee \(self\)/).isVisible());

// 4. Non-admin cannot use the reveal action (page blocked) and views are audited
await emp.goto(`${BASE}/employees`);
check("employee blocked from Employees page", emp.url().includes("/dashboard"));
await admin.goto(`${BASE}/audit?q=PASSWORD_VIEWED`);
check("password views audited", (await admin.locator("tbody tr").count()) >= 2);

// 5. Visibility rules
const pwVisibleOn = (p) => p.locator("tbody tr", { hasText: "Omar Farooq" }).getByText("MyOwn#Pass9").waitFor({ timeout: 10000 }).then(() => true, () => false);
const manager = await login("manager@demo.local", "Demo@1234");
await manager.goto(`${BASE}/dashboard`);
await manager.getByRole("button", { name: "Notifications" }).click();
check("employee's manager notified", await manager.getByText("Omar Farooq's password was changed").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
await manager.goto(`${BASE}/employees?q=Omar`);
await manager.locator("tbody tr", { hasText: "Omar Farooq" }).getByRole("button", { name: "Show password" }).click();
check("manager can see own team member's password", await pwVisibleOn(manager));
check("manager cannot add/edit employees", (await manager.getByRole("button", { name: /Add Employee/ }).count()) === 0);
await manager.goto(`${BASE}/employees?q=System`);
check("manager does not see admin/other teams", (await manager.locator("tbody tr", { hasText: "System Admin" }).count()) === 0);

await emp.goto(`${BASE}/profile`);
await emp.getByRole("button", { name: "Show password" }).click();
check("employee sees own password on profile", await emp.getByText("MyOwn#Pass9").waitFor({ timeout: 10000 }).then(() => true, () => false));

const colleague = await login("fatima.khan@demo.local", "Demo@1234");
await colleague.goto(`${BASE}/dashboard`);
await colleague.getByRole("button", { name: "Notifications" }).click();
check("colleague NOT notified", (await colleague.getByText(/Omar Farooq/).count()) === 0);
await colleague.goto(`${BASE}/employees`);
check("colleague cannot open employees", colleague.url().includes("/dashboard"));

// restore demo password
await admin.goto(`${BASE}/employees?q=Omar`);
await row(admin, "Omar Farooq").getByRole("button", { name: "Update password" }).click();
await admin.fill("input[autocomplete=new-password]", "Demo@1234");
await admin.getByRole("button", { name: "Update", exact: true }).click();
await admin.getByRole("button", { name: "Done" }).click();

await b.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
