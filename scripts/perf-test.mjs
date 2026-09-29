// What the interface feels like: how fast a page becomes usable, and whether it holds 60fps
// while being scrolled. Run against a production build, not a dev server.
// Usage: BASE=http://localhost:3301 ADMIN_PW='…' node scripts/perf-test.mjs

import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PAGES = ["/dashboard", "/employees", "/team", "/attendance", "/reports", "/settings"];
const BUDGET = { load: 1200, fps: 50 };
const rows = [];

const b = await chromium.launch({ channel: "msedge" });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await p.goto(`${BASE}/login`, { timeout: 120000 });
await p.fill("#email", process.env.ADMIN_EMAIL ?? "admin@company.com");
await p.fill("#password", process.env.ADMIN_PW ?? "Admin@123");
await p.click("button[type=submit]");
await p.waitForURL(/dashboard/, { timeout: 90000 });

for (const path of PAGES) {
  const t0 = Date.now();
  await p.goto(BASE + path, { waitUntil: "load", timeout: 60000 });
  const load = Date.now() - t0;
  // Scroll for two seconds and count the frames the browser actually produced.
  const fps = await p.evaluate(async () => {
    let frames = 0;
    const started = performance.now();
    const tick = () => { frames++; if (performance.now() - started < 2000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const id = setInterval(() => window.scrollBy(0, 40), 16);
    await new Promise((r) => setTimeout(r, 2050));
    clearInterval(id);
    return Math.round(frames / 2);
  });
  const ok = load <= BUDGET.load && fps >= BUDGET.fps;
  rows.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${path.padEnd(12)} load ${String(load).padStart(5)}ms · scroll ${fps} fps`);
}

await b.close();
const failed = rows.filter((x) => !x).length;
console.log(`\n${rows.length - failed}/${rows.length} pages within budget (load ≤ ${BUDGET.load}ms, scroll ≥ ${BUDGET.fps}fps)`);
process.exit(failed ? 1 : 0);
