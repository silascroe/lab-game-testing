/* Probe: does pointer lock + real mouse-look work under headless chromium? */
import { createRequire } from "node:module";
const require = createRequire(new URL("../.testkit/package.json", import.meta.url));
const { chromium } = require("playwright");

const appUrl = new URL(process.argv[2] || "http://127.0.0.1:4173/");
appUrl.searchParams.set("test", "1");
const TARGET_URL = appUrl.toString();
const browser = await chromium.launch({
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox", "--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text()); });

await page.goto(TARGET_URL, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => window.__lab && window.__lab.isReady, { timeout: 300000, polling: 500 });
console.log("ready");

// enter via the real intro button
await page.getByText("Enter the facility").click();
await page.waitForTimeout(600);
await page.mouse.click(512, 320);
await page.waitForTimeout(800);

const lock = await page.evaluate(() => ({
  el: document.pointerLockElement ? document.pointerLockElement.tagName : null,
  locked: window.__lab.getState().locked,
}));
console.log("pointer lock:", JSON.stringify(lock));

const before = await page.evaluate(() => window.__lab.getState().yaw);
await page.mouse.move(512 + 200, 320);
await page.waitForTimeout(300);
const after = await page.evaluate(() => window.__lab.getState().yaw);
console.log(`yaw before=${before.toFixed(4)} after=${after.toFixed(4)} delta=${(after - before).toFixed(4)}`);

const kb = await page.evaluate(async () => {
  const p0 = window.__lab.getState();
  return { x: p0.x, z: p0.z };
});
await page.keyboard.down("w");
await page.waitForTimeout(1200);
await page.keyboard.up("w");
await page.waitForTimeout(300);
const moved = await page.evaluate(() => window.__lab.getState());
console.log(`walk: (${kb.x.toFixed(2)},${kb.z.toFixed(2)}) -> (${moved.x.toFixed(2)},${moved.z.toFixed(2)}) dist=${Math.hypot(moved.x - kb.x, moved.z - kb.z).toFixed(2)}`);

await browser.close();
