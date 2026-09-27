/**
 * Static geometry audit: verifies every intended doorway really has a traversable gap
 * in the generated wall geometry, and that the spawn point is clear.
 *
 *   node tools/audit.mjs http://127.0.0.1:4173/
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../.testkit/package.json", import.meta.url));
const { chromium } = require("playwright");

const appUrl = new URL(process.argv[2] || "http://127.0.0.1:4173/");
appUrl.searchParams.set("test", "1");
const TARGET_URL = appUrl.toString();

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text()}`);
});

await page.goto(TARGET_URL, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => window.__lab && window.__lab.isReady, { timeout: 300000, polling: 500 });

const result = await page.evaluate(() => ({
  spawn: window.__lab.getState(),
  spawnClear: window.__lab.spawnClear(),
  colliders: window.__lab.colliderCount(),
  openings: window.__lab.auditOpenings(),
}));

console.log("spawn:", JSON.stringify(result.spawn));
console.log("spawn clear of colliders:", result.spawnClear);
console.log("collider count:", result.colliders);
console.log("");
let bad = 0;
for (const o of result.openings) {
  const ok = o.blocked.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${o.id.padEnd(14)} ${ok ? "traversable" : "BLOCKED at " + o.blocked.join(", ")}`);
}
console.log("");
console.log(bad === 0 ? "ALL DOORWAYS TRAVERSABLE" : `${bad} DOORWAY(S) BLOCKED`);
console.log(errors.length ? "console errors:\n" + errors.join("\n") : "no console errors");
await browser.close();
process.exit(bad === 0 ? 0 : 2);
