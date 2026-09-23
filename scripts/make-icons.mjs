// Renders public/icon.svg into the PNG sizes iOS and Android ask for, using the installed Edge.
// Run after changing the logo:  node scripts/make-icons.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const PUBLIC = path.join(process.cwd(), "public");
const svg = fs.readFileSync(path.join(PUBLIC, "icon.svg"), "utf8");
const sizes = [
  { file: "icon-192.png", size: 192, padding: 0 },
  { file: "icon-512.png", size: 512, padding: 0 },
  // iOS does not round the corners of a home-screen icon for you and shows it on a light
  // background, so the maskable version keeps a margin.
  { file: "apple-touch-icon.png", size: 180, padding: 0 },
  { file: "icon-maskable-512.png", size: 512, padding: 64 },
];

const b = await chromium.launch({ channel: "msedge" });
for (const { file, size, padding } of sizes) {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:#07080c">
       <div style="width:${size - padding * 2}px;height:${size - padding * 2}px">${svg}</div>
     </body></html>`,
  );
  await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: false });
  await page.close();
  console.log(`wrote public/${file} (${size}px)`);
}
await b.close();
