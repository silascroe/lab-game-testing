/**
 * End-to-end playthrough harness.
 *
 * Drives the game with REAL player input only: keyboard events for movement and
 * interaction, mousemove events for looking. No teleporting, no forcePower, no
 * direct state mutation - the only reads are getState()/DOM text used for decisions.
 *
 *   node tools/playthrough.mjs <url> [runs]
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../.testkit/package.json", import.meta.url));
const { chromium } = require("playwright");

const appUrl = new URL(process.argv[2] || "http://127.0.0.1:4173/");
appUrl.searchParams.set("test", "1");
appUrl.searchParams.set("quality", "low");
const TARGET_URL = appUrl.toString();
const RUNS = Number(process.argv[3] || 2);
const W = 420;
const H = 260;

const sleep = (ms) => page.waitForTimeout(ms);

const results = [];
let failures = 0;
function check(cond, label, extra = "") {
  const ok = !!cond;
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -- " + extra : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -- " + extra : ""}`);
}

const browser = await chromium.launch({
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox", "--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist",
  ],
});

const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text()}`);
});

const state = () => page.evaluate(() => window.__lab.getState());
const turn = (dx, dy = 0) =>
  page.evaluate(
    ([mx, my]) =>
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: mx, movementY: my, bubbles: true })),
    [dx, dy],
  );

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

async function face(tx, tz, label = "target") {
  for (let i = 0; i < 120; i++) {
    const s = await state();
    const dx = tx - s.x;
    const dz = tz - s.z;
    if (Math.hypot(dx, dz) < 0.2) return true;
    const want = Math.atan2(-dx, -dz);
    const diff = angleDiff(s.yaw, want);
    if (Math.abs(diff) < 0.015) return true;
    const px = Math.abs(diff) / 0.0022;
    await turn(-Math.sign(diff) * Math.min(60, px));
    await sleep(20);
  }
  const s = await state();
  console.log(`  ! could not face ${label}: at (${s.x.toFixed(2)},${s.z.toFixed(2)}) yaw=${s.yaw.toFixed(3)} want=${Math.atan2(-(tx - s.x), -(tz - s.z)).toFixed(3)} locked=${s.locked}`);
  return false;
}

async function walkTo(tx, tz, label, timeoutMs = 120000) {
  const t0 = Date.now();
  let last = null;
  let stuck = 0;
  await page.keyboard.down("w");
  try {
    while (Date.now() - t0 < timeoutMs) {
      const s = await state();
      const d = Math.hypot(tx - s.x, tz - s.z);
      if (d < 0.8) return true;
      if (last && Math.hypot(s.x - last.x, s.z - last.z) < 0.03) {
        stuck++;
        if (stuck > 6) {
          // nudge sideways to clear a doorway edge or a prop
          const side = s.x < tx ? "d" : "a";
          await page.keyboard.down(side);
          await sleep(500);
          await page.keyboard.up(side);
          stuck = 0;
        }
      } else stuck = 0;
      last = { x: s.x, z: s.z };
      await face(tx, tz, label);
      await sleep(160);
    }
  } finally {
    await page.keyboard.up("w");
  }
  const s = await state();
  console.log(`  ! walkTo ${label} timed out at (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) dist=${Math.hypot(tx - s.x, tz - s.z).toFixed(2)} zone=${s.zone}`);
  return false;
}

/** Aim the camera (yaw + pitch) at a world point, the way a player would. */
async function aimAt(px, py, pz, label) {
  for (let i = 0; i < 90; i++) {
    const s = await state();
    const dx = px - s.x, dy = py - 1.68, dz = pz - s.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 0.15) return true;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, horiz);
    const dyaw = angleDiff(s.yaw, wantYaw);
    const dpitch = wantPitch - s.pitch;
    if (Math.abs(dyaw) < 0.012 && Math.abs(dpitch) < 0.012) return true;
    if (Math.abs(dyaw) >= 0.012) {
      await turn(-Math.sign(dyaw) * Math.min(60, Math.abs(dyaw) / 0.0022));
    }
    if (Math.abs(dpitch) >= 0.012) {
      await page.evaluate(
        (my) => document.dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: my, bubbles: true })),
        Math.sign(dpitch) * -1 * Math.min(60, Math.abs(dpitch) / 0.0022),
      );
    }
    await sleep(20);
  }
  console.log(`  ! could not aim at ${label}`);
  return false;
}

/** Walk to the world position of a named interactable, then look straight at it. */
async function approach(label, standOff = 1.4, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const list = await page.evaluate(() => window.__lab.interactables());
    const it = list.find((i) => i.label === label);
    if (!it) {
      console.log(`  ! no interactable labelled ${label}`);
      return false;
    }
    const s = await state();
    const d = Math.hypot(it.x - s.x, it.z - s.z);
    if (d <= it.range * 0.72) {
      await aimAt(it.x, it.y, it.z, label);
      return true;
    }
    // step to just short of it
    const nx = s.x + ((it.x - s.x) / d) * Math.max(0.35, d - standOff);
    const nz = s.z + ((it.z - s.z) / d) * Math.max(0.35, d - standOff);
    if (!(await walkTo(nx, nz, `${label} approach`, 30000))) return false;
  }
  return false;
}

async function interact(label, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await state();
    if (s.prompt && s.prompt.label === label) {
      await page.keyboard.press("e");
      await sleep(250);
      return true;
    }
    await sleep(150);
  }
  const s = await state();
  console.log(`  ! interact(${label}) timed out; prompt=${JSON.stringify(s.prompt)}`);
  return false;
}

async function objectiveText() {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll("div")].filter((e) => e.className.includes("border-l"));
    return els.length ? els[els.length - 1].textContent : "";
  });
}

/* ------------------------------------------------------------------ */

for (let run = 1; run <= RUNS; run++) {
  console.log(`\n================= PLAYTHROUGH RUN ${run} =================`);
  await page.goto(TARGET_URL, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => window.__lab && window.__lab.isReady, { timeout: 300000, polling: 500 });

  // --- real spawn state, no debug helpers -----------------------------
  let s = await state();
  check(s.stage === 0 && !s.power, "starts at stage 0 with no power", `stage=${s.stage} power=${s.power}`);
  check(Math.abs(s.x + 14) < 0.01 && Math.abs(s.z - 13.5) < 0.01, "player spawns at the airlock", `(${s.x},${s.z})`);
  check(s.zone.includes("AIRLOCK"), "spawn zone is the airlock", s.zone);

  // --- enter through the real intro UI --------------------------------
  await page.getByText("Enter the facility").click();
  await sleep(400);
  await page.mouse.click(W / 2, H / 2);
  await sleep(600);
  s = await state();
  check(s.locked, "pointer lock acquired", `locked=${s.locked}`);
  check(s.audioRunning, "procedural audio started from the user's click");

  // --- 1. airlock -> hub ---------------------------------------------
  check(await walkTo(-16, 9.0, "airlock door approach"), "walked to the airlock door");
  check(await walkTo(-16, 3.5, "into the hub"), "walked through the airlock door into the hub");
  s = await state();
  check(s.zone.includes("CENTRAL HUB"), "arrived in the central hub", s.zone);
  let hintSeen = false;
  for (let i = 0; i < 60 && !hintSeen; i++) {
    const txt = await page.evaluate(() => document.body.innerText);
    hintSeen = /Utility east/i.test(txt);
    if (!hintSeen) await sleep(300);
  }
  check(hintSeen, "orientation hint shown on first hub visit");

  // --- 2. hub -> utility ---------------------------------------------
  check(await walkTo(14, 3.0, "utility door approach"), "walked east across the hub");
  check(await walkTo(14, 9.5, "into the utility room"), "walked through the utility door");
  s = await state();
  check(s.zone.includes("UTILITY"), "arrived in the utility room", s.zone);

  // --- 3. throw both auxiliary bus breakers ---------------------------
  check(await approach("AUX BUS A"), "walked to and faced breaker AUX BUS A");
  check(await interact("AUX BUS A"), "interacted with AUX BUS A");
  s = await state();
  check(!s.power, "power still off after the first breaker", `power=${s.power}`);

  check(await approach("AUX BUS B"), "walked to and faced breaker AUX BUS B");
  check(await interact("AUX BUS B"), "interacted with AUX BUS B");
  await sleep(1500);
  s = await state();
  check(s.power, "auxiliary power is now online", `power=${s.power}`);
  check(s.stage >= 1, "objective advanced to stage 1", `stage=${s.stage}`);
  const objAfterPower = await objectiveText();
  check(/containment seal/i.test(objAfterPower), "objective text updated for stage 1", objAfterPower);

  // --- 4. utility -> hub -> corridor ---------------------------------
  check(await walkTo(14, 9.0, "back out of utility"), "left the utility room");
  check(await walkTo(14, 3.2, "through utility door into the hub"), "walked through the utility doorway");
  s = await state();
  check(s.zone.includes("CENTRAL HUB"), "returned to the central hub", s.zone);
  check(await walkTo(-6, 3.0, "west side of the hub"), "walked west across the hub");
  check(await walkTo(-6, -2.25, "through the west archway"), "walked through the west archway into the corridor");
  s = await state();
  check(s.zone.includes("MAIN CORRIDOR"), "arrived in the main corridor", s.zone);

  // Movement sanity belongs before the terminal ending disables gameplay input.
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await sleep(700);
  const sprinting = await state();
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  check(sprinting.sprinting, "sprint engaged", `sprinting=${sprinting.sprinting}`);

  await page.keyboard.down("c");
  await sleep(350);
  const crouched = await state();
  await page.keyboard.up("c");
  check(crouched.crouching, "crouch engaged", `crouching=${crouched.crouching}`);

  // --- 5. corridor -> containment chamber ----------------------------
  check(await walkTo(0, -2.25, "containment bulkhead"), "walked to the containment bulkhead");
  await sleep(1200);
  s = await state();
  check(await walkTo(0, -6.2, "into the containment chamber"), "walked through the containment bulkhead");
  s = await state();
  check(s.zone.includes("CONTAINMENT CHAMBER"), "arrived in the containment chamber", s.zone);
  check(s.stage >= 2, "objective advanced to stage 2 on entering Sector C", `stage=${s.stage}`);

  // --- 6. specimen log terminal --------------------------------------
  check(await approach("Specimen log"), "walked to and faced the specimen log terminal");
  check(await interact("Specimen log"), "interacted with the specimen log");
  await sleep(600);
  const logOpen = await page.evaluate(() => document.body.innerText.includes("SPECIMEN 44-B"));
  check(logOpen, "final log panel opened");
  await page.keyboard.press("e");
  await sleep(400);
  s = await state();
  check(s.stage >= 3, "objective advanced to stage 3 after logging the record", `stage=${s.stage}`);
  check(!s.finished, "reading the record alone does not finish the facility");

  // Closing the log releases pointer lock; resume normally before using the terminal again.
  await page.mouse.click(W / 2, H / 2);
  await sleep(400);
  s = await state();
  check(s.locked, "pointer lock reacquired after closing the specimen log", `locked=${s.locked}`);

  // --- 7. explicitly log the chamber seal ----------------------------
  check(await approach("Log chamber seal"), "faced the chamber seal acknowledgement");
  check(await interact("Log chamber seal"), "logged the chamber seal");
  await sleep(500);
  s = await state();
  check(s.stage >= 4, "objective advanced to stage 4 after seal acknowledgement", `stage=${s.stage}`);
  check(!s.finished, "seal log alone does not end the facility");

  // The last beat is spatial: physically leave containment and let the bulkhead
  // close behind the player.
  check(await walkTo(0, -2.2, "clear of containment"), "cleared the containment bulkhead");
  await sleep(1900);
  s = await state();
  check(s.finished, "facility completion state reached after clearing the chamber", `finished=${s.finished} stage=${s.stage}`);
  const endText = await page.evaluate(() => document.body.innerText);
  check(/SEAL LOGGED/i.test(endText), "ending card displayed");

  // --- 8. did we ever leave the map? ---------------------------------
  s = await state();
  check(Math.abs(s.x) < 21 && Math.abs(s.z) < 17, "player stayed inside the facility", `(${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
}

/* ------------------------------------------------------------------ */

console.log(`\n================= KEYPAD RUN =================`);
await page.goto(TARGET_URL, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => window.__lab && window.__lab.isReady, { timeout: 300000, polling: 500 });
await page.getByText("Enter the facility").click();
await sleep(400);
await page.mouse.click(W / 2, H / 2);
await sleep(600);

check(await walkTo(-16, 9.0, "airlock door"), "walked to the airlock door");
check(await walkTo(-16, 3.5, "hub"), "entered the hub");

// Approach from the hub side of the wall instead of taking a straight-line route
// through the closed Records door/frame. The old generic approach could wedge the
// player on the doorway edge even though the keypad itself was reachable.
check(await walkTo(1.05, 4.25, "records keypad clear approach"), "walked to the clear side of the records keypad");
check(await aimAt(1.05, 1.27, 5.75, "Keypad"), "aimed at the records keypad");
check(await interact("Keypad"), "interacted with the keypad");
await sleep(400);
let kp = await page.evaluate(() => document.body.innerText.includes("RECORDS · ACCESS"));
check(kp, "keypad overlay opened");

// wrong code first, character by character
await page.keyboard.type("1111");
await sleep(600);
let denied = await page.evaluate(() => document.body.innerText.includes("DENIED"));
check(denied, "wrong code rejected character-by-character");
await sleep(1300);

await page.keyboard.type("7419");
await sleep(700);
const unlocked = await page.evaluate(() => !document.body.innerText.includes("RECORDS · ACCESS"));
check(unlocked, "correct code 7-4-1-9 accepted and keypad dismissed");
await page.mouse.click(W / 2, H / 2);
await sleep(400);
let s2 = await state();
check(s2.locked, "pointer lock reacquired after closing the keypad", `locked=${s2.locked}`);
check(await walkTo(0, 9.0, "into records"), "walked through the unlocked records door");
s2 = await state();
check(s2.zone.includes("RECORDS"), "arrived in the records room", s2.zone);
check(await approach("Terminal"), "walked to and faced a records terminal");
check(await interact("Terminal"), "interacted with a records terminal");
await sleep(500);
const termOpen = await page.evaluate(() => document.body.innerText.includes("SHIFT RECORD"));
check(termOpen, "records terminal log opened");
await page.keyboard.press("e");

console.log(`\n================= SUMMARY =================`);
console.log(results.filter((r) => r.startsWith("FAIL")).join("\n") || "no failures");
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length} passed, ${failures} failed`);
console.log(errors.length ? "console errors:\n" + errors.join("\n") : "no console errors");
await browser.close();
process.exit(failures === 0 ? 0 : 2);
