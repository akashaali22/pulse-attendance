import { chromium } from "playwright-core";
const BASE = "https://pulse-attendance.onrender.com";
const [adminPw, action, email] = process.argv.slice(2);
const b = await chromium.launch({ channel: "msedge" });
const p = await (await b.newContext()).newPage();
await p.goto(`${BASE}/login`, { timeout: 180000 });
await p.fill("#email", "admin@company.com");
await p.fill("#password", adminPw);
await p.click("button[type=submit]");
await p.waitForURL(/dashboard/, { timeout: 90000 });

if (action === "create") {
  await p.goto(`${BASE}/employees`);
  await p.getByRole("button", { name: /Add Employee/ }).click();
  await p.fill("input[name=name]", "Mac Agent Test");
  await p.fill("input[name=email]", email);
  await p.fill("input[name=password]", "MacTest#2026");
  await p.fill("input[name=joined_on]", new Date().toISOString().slice(0, 10));
  await p.locator("form button[type=submit]").click();
  await p.getByText("Employee created").first().waitFor({ timeout: 30000 });
  console.log("created", email, "/ MacTest#2026");
} else {
  await p.goto(`${BASE}/employees?q=${encodeURIComponent(email)}`);
  const row = p.locator("tbody tr", { hasText: "Mac Agent Test" });
  await row.getByRole("button", { name: "Inactive" }).click();
  await p.waitForTimeout(3000);
  console.log("deactivated", email);
}
await b.close();
