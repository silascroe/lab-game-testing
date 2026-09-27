/**
 * Automated walkthrough + screenshot harness for Site Orpheus.
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/screenshot.mjs <outDir> <url> <views.json>
 *
 * views.json: [{ "name": "airlock", "x": -14, "z": 13.5, "yaw": 0, "pitch": 0,
 *                "power": false, "settle": 900 }]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Keep Playwright in the isolated test package so app installs stay lean.
const require = createRequire(new URL("../.testkit/package.json", import.meta.url));
const { chromium } = require("playwright");

const OUT = process.argv[2] || "screenshots";
const appUrl = new URL(process.argv[3] || "http://127.0.0.1:4173/");
appUrl.searchParams.set("test", "1");
const TARGET_URL = appUrl.toString();
const VIEWS = JSON.parse(fs.readFileSync(process.argv[4] || "tools/views.json", "utf8"));
const FAST_PREVIEW = process.env.ORPHEUS_PREVIEW === "1";
const USE_HARDWARE_GPU = process.env.ORPHEUS_GPU === "1";

const HIDE_UI = `
  const s = document.createElement('style');
  s.id = 'hide-ui';
  s.textContent = '#root > div > *:not(canvas){display:none !important;} #root > div > * > *:not(canvas){display:none !important;}';
  document.head.appendChild(s);
`;

const browserArgs = [
  "--use-gl=angle",
  "--disable-gpu-sandbox",
  "--no-sandbox",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
];
if (!USE_HARDWARE_GPU) {
  browserArgs.push("--use-angle=swiftshader", "--enable-unsafe-swiftshader");
}

const browser = await chromium.launch({ args: browserArgs });

const page = await browser.newPage({
  viewport: FAST_PREVIEW ? { width: 640, height: 360 } : { width: 1280, height: 720 },
});
page.setDefaultTimeout(180000);
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

fs.mkdirSync(OUT, { recursive: true });

console.log(
  "loading",
  TARGET_URL,
  USE_HARDWARE_GPU ? "(hardware GPU requested)" : "(SwiftShader)",
  FAST_PREVIEW ? "(compact review images)" : "(delivery images)",
);
await page.goto(TARGET_URL, { waitUntil: "load", timeout: 180000 });

try {
  await page.waitForFunction(() => window.__lab && window.__lab.isReady, {
    timeout: 300000,
    polling: 500,
  });
  console.log("engine ready");
} catch {
  console.log("ENGINE DID NOT BECOME READY");
  console.log(errors.slice(0, 40).join("\n") || "(no console output)");
  await page.screenshot({ path: path.join(OUT, "_failed.png") });
  await browser.close();
  process.exit(1);
}

const fps = await page.evaluate(async () => {
  let n = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const step = () => {
      n++;
      if (performance.now() - t0 > 3000) res();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return (n / (performance.now() - t0)) * 1000;
});
console.log("approx fps (software rasteriser):", fps.toFixed(2));

await page.evaluate(HIDE_UI);

for (const v of VIEWS) {
  if (v.power) {
    await page.evaluate(() => window.__lab.forcePower());
    await page.waitForTimeout(v.powerWait ?? 4200);
  }
  await page.evaluate(([x, z, yaw, pitch]) => window.__lab.teleport(x, z, yaw, pitch), [
    v.x,
    v.z,
    v.yaw,
    v.pitch ?? 0,
  ]);
  await page.waitForTimeout(v.settle ?? 900);
  await page.evaluate(() => window.__lab.renderNow());
  await page.waitForTimeout(150);
  const ext = FAST_PREVIEW ? "jpg" : "png";
  const file = path.join(OUT, `${v.name}.${ext}`);
  await page.screenshot(
    FAST_PREVIEW
      ? { path: file, type: "jpeg", quality: 72 }
      : { path: file, type: "png" },
  );
  console.log("shot", v.name, (fs.statSync(file).size / 1024).toFixed(0) + "kb");
}

console.log("---- console messages ----");
console.log(errors.slice(0, 60).join("\n") || "(none)");
await browser.close();
