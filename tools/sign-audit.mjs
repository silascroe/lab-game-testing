import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../.testkit/package.json", import.meta.url));
const { chromium } = require("playwright");

const base = new URL(process.argv[2] || "http://127.0.0.1:4173/");
base.searchParams.set("test", "1");
const views = JSON.parse(fs.readFileSync(process.argv[3] || "tools/views-signs.json", "utf8"));

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

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
await page.goto(base.toString(), { waitUntil: "load" });
await page.waitForFunction(() => window.__lab?.isReady, { timeout: 300000, polling: 500 });

let failures = 0;
for (const view of views) {
  await page.evaluate(([x, z, yaw, pitch]) => window.__lab.teleport(x, z, yaw, pitch), [
    view.x,
    view.z,
    view.yaw,
    view.pitch ?? 0,
  ]);
  await page.waitForTimeout(250);
  const signs = await page.evaluate(() => window.__lab.auditSigns());

  for (const key of view.expect ?? []) {
    const sign = signs.find((s) => s.key === key);
    const ok = !!sign && sign.inViewport && sign.visible;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${view.name} :: ${key}`,
      sign ? JSON.stringify(sign) : "(missing sign)",
    );
    if (!ok) failures++;
  }
}

await browser.close();
if (failures) {
  console.error(`Sign visibility audit failed: ${failures} expected plaque(s) were hidden or off-screen.`);
  process.exit(1);
}
console.log("All expected wayfinding plaques are visible from their approach views.");
