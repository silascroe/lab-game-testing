import * as THREE from "three";
import {
  clamp,
  createCanvas,
  fbm,
  hashi,
  mix,
  noise2,
  radialSprite,
  ridged,
  roundRect,
  shaftSprite,
  smoothstep,
  surfaceMaps,
} from "./noise";

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const canvasCache = new Map<string, HTMLCanvasElement>();

function cached(key: string, gen: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) {
    c = gen();
    canvasCache.set(key, c);
  }
  return c;
}

function paintCanvas(w: number, h: number, painter: Painter): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  painter(ctx, w, h);
  return c;
}

function toTexture(canvas: HTMLCanvasElement, srgb = true, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ */
/* PBR surface generators                                              */
/* ------------------------------------------------------------------ */

/** Board-formed concrete: mottled, stained, spalled, with formwork seams. */
function concreteWallMaps(size = 512) {
  return surfaceMaps(
    size,
    (u, v) => {
      const x = u * 6;
      const y = v * 6;
      const base = fbm(x, y, 5, 11);
      const fine = fbm(x * 12, y * 12, 3, 29);
      const blotch = ridged(x * 1.6 + 3, y * 1.6 - 2, 3, 7);
      let lum = 0.3 + base * 0.16 + fine * 0.06;
      const grime = smoothstep(0.78, 1.0, v) * 0.55 + smoothstep(0.16, 0.0, v) * 0.25;
      lum -= grime * (0.35 + blotch * 0.5);
      const seam = Math.abs(((v * 3) % 1) - 0.5);
      if (seam > 0.485) lum -= 0.12;
      const vseam = Math.abs(((u * 2) % 1) - 0.5);
      if (vseam > 0.492) lum -= 0.08;
      const pit = smoothstep(0.62, 0.78, fbm(x * 9 + 40, y * 9 - 17, 3, 91));
      lum -= pit * 0.35;
      const tint = 0.5 + (hashi(Math.floor(u * 64), Math.floor(v * 64), 5) - 0.5) * 0.06;
      const c: [number, number, number] = [lum * tint * 1.04, lum * tint, lum * tint * 0.95];
      const h = clamp(base * 0.6 + fine * 0.3 - pit * 0.5 - grime * 0.2);
      const r = clamp(0.82 - base * 0.12 + pit * 0.1);
      return { c, h, r };
    },
    1.6,
  );
}

/** Painted steel wall panel: cream/olive paint, scratches, rust bleed from the edges. */
function paintedMetalMaps(size = 512, hue: [number, number, number] = [0.62, 0.63, 0.58]) {
  return surfaceMaps(
    size,
    (u, v) => {
      const x = u * 8;
      const y = v * 8;
      const base = fbm(x, y, 4, 3);
      const grain = fbm(x * 26, y * 26, 2, 71);
      const sc = Math.pow(noise2(u * 220, v * 9, 13), 12) + Math.pow(noise2(u * 9, v * 210, 17), 12);
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const rustField = fbm(x * 2.2 + 11, y * 2.2 + 5, 4, 23);
      const rust = smoothstep(0.58, 0.86, rustField) * smoothstep(0.42, 0.02, edge + base * 0.25);
      let lum = 0.3 + base * 0.22 + grain * 0.05;
      lum += sc * 0.5;
      const rustCol: [number, number, number] = [0.34, 0.17, 0.08];
      const paint: [number, number, number] = [hue[0] * lum, hue[1] * lum, hue[2] * lum];
      const c: [number, number, number] = [
        mix(paint[0], rustCol[0], rust),
        mix(paint[1], rustCol[1], rust),
        mix(paint[2], rustCol[2], rust),
      ];
      const grime = smoothstep(0.6, 1.0, v) * 0.4;
      c[0] *= 1 - grime * 0.5;
      c[1] *= 1 - grime * 0.5;
      c[2] *= 1 - grime * 0.45;
      const h = clamp(base * 0.5 + grain * 0.25 + sc * 0.5 - rust * 0.4);
      const r = clamp(0.62 + base * 0.2 + rust * 0.25 - sc * 0.1);
      return { c, h, r };
    },
    2.2,
  );
}

/** Speckled vinyl/rubber lab flooring with grout, scuffs and cracks. */
function tileFloorMaps(size = 512, tiles = 4) {
  return surfaceMaps(
    size,
    (u, v) => {
      const tu = u * tiles;
      const tv = v * tiles;
      const fx = tu - Math.floor(tu);
      const fy = tv - Math.floor(tv);
      const groutW = 0.035;
      const isGrout = fx < groutW || fx > 1 - groutW || fy < groutW || fy > 1 - groutW;
      const speck = fbm(u * 190, v * 190, 3, 5);
      const stain = smoothstep(0.55, 0.9, fbm(u * 5 + 9, v * 5 - 4, 4, 61));
      let lum = 0.17 + speck * 0.12 + (hashi(Math.floor(tu), Math.floor(tv), 3) - 0.5) * 0.05;
      lum -= stain * 0.1;
      const cellSeed = hashi(Math.floor(tu), Math.floor(tv), 41);
      const crack = cellSeed > 0.9 ? smoothstep(0.35, 0.75, fbm(tu * 3, tv * 3, 3, 77)) : 0;
      lum -= crack * 0.5;
      if (isGrout) lum *= 0.45;
      const c: [number, number, number] = [lum * 1.0, lum * 1.02, lum * 1.06];
      const h = isGrout ? 0.12 : clamp(0.45 + speck * 0.3 - crack * 0.5);
      const r = isGrout ? 0.95 : clamp(0.55 + speck * 0.2 - stain * 0.15);
      return { c, h, r };
    },
    1.2,
  );
}

/** Coarse poured concrete floor with expansion joints and oil staining. */
function concreteFloorMaps(size = 512) {
  return surfaceMaps(
    size,
    (u, v) => {
      const x = u * 7;
      const y = v * 7;
      const base = fbm(x, y, 5, 17);
      const fine = fbm(x * 30, y * 30, 3, 43);
      const joint = Math.abs(((v * 2) % 1) - 0.5) > 0.47 || Math.abs(((u * 2) % 1) - 0.5) > 0.47;
      let lum = 0.22 + base * 0.16 + fine * 0.07;
      if (joint) lum *= 0.5;
      const pool = smoothstep(0.6, 0.95, fbm(u * 3.2 - 5, v * 3.2 + 8, 4, 91));
      lum -= pool * 0.22;
      const sheen = smoothstep(0.72, 0.95, fbm(u * 6 + 2, v * 6 + 2, 3, 55));
      const c: [number, number, number] = [lum * 1.02, lum, lum * 0.98];
      const h = clamp(base * 0.5 + fine * 0.35 - (joint ? 0.5 : 0));
      const r = clamp(0.9 - sheen * 0.35 - base * 0.08);
      return { c, h, r };
    },
    1.8,
  );
}

/** Heavy rust scale on steel - the utility room and the tank cradle. */
function rustMaps(size = 512) {
  return surfaceMaps(
    size,
    (u, v) => {
      const x = u * 7;
      const y = v * 7;
      const flake = ridged(x * 3, y * 3, 5, 19);
      const pit = fbm(x * 14, y * 14, 4, 37);
      const deep = smoothstep(0.55, 0.85, pit);
      let lum = 0.14 + flake * 0.3 + pit * 0.1;
      lum -= deep * 0.12;
      const c: [number, number, number] = [lum * 1.5, lum * 0.95, lum * 0.6];
      const h = clamp(flake * 0.7 + pit * 0.3 - deep * 0.5);
      const r = clamp(0.7 + flake * 0.25);
      return { c, h, r };
    },
    2.6,
  );
}

/** Brushed stainless steel. */
function stainlessMaps(size = 512) {
  return surfaceMaps(
    size,
    (u, v) => {
      const streak = fbm(u * 400, v * 6, 2, 7) * 0.5 + fbm(u * 90, v * 14, 2, 23) * 0.5;
      const smudge = smoothstep(0.45, 0.8, fbm(u * 4 + 3, v * 4 + 6, 4, 53));
      let lum = 0.42 + streak * 0.22;
      lum -= smudge * 0.1;
      const c: [number, number, number] = [lum * 1.0, lum * 1.02, lum * 1.06];
      const h = clamp(streak * 0.5 + smudge * 0.1);
      const r = clamp(0.24 + streak * 0.16 + smudge * 0.22);
      return { c, h, r };
    },
    0.8,
  );
}

/** Diamond checkerplate floor for the utility room. */
function checkerPlateMaps(size = 512) {
  return surfaceMaps(
    size,
    (u, v) => {
      const n = 8;
      const cu = (u * n) % 1;
      const cv = (v * n) % 1;
      const cell = Math.floor(u * n) + Math.floor(v * n);
      const raised = cell % 2 === 0;
      const bump = raised ? 0.5 + 0.5 * Math.hypot(cu - 0.5, cv - 0.5) : 0.5 - 0.5 * Math.hypot(cu - 0.5, cv - 0.5);
      const grit = fbm(u * 260, v * 260, 2, 13);
      let lum = 0.2 + bump * 0.12 + grit * 0.08;
      const rust =
        smoothstep(0.55, 0.9, fbm(u * 3 + 2, v * 3 - 3, 4, 71)) *
        smoothstep(0.55, 0.1, Math.min(u, v, 1 - u, 1 - v));
      const c: [number, number, number] = [
        mix(lum * 1.02, 0.3, rust),
        mix(lum * 1.0, 0.15, rust),
        mix(lum * 0.96, 0.07, rust),
      ];
      const h = clamp(bump * 0.6 + grit * 0.3 - rust * 0.4);
      const r = clamp(0.55 + grit * 0.2 + rust * 0.25);
      return { c, h, r };
    },
    2.4,
  );
}

/* ------------------------------------------------------------------ */
/* symbols                                                             */
/* ------------------------------------------------------------------ */

function biohazardSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.arc(0, -r * 0.42, r * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -r * 0.42, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3 + Math.PI / 3);
    ctx.beginPath();
    ctx.arc(0, -r * 0.85, r * 0.44, -0.5, 0.5);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function radiationSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3 - Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.2);
    ctx.arc(0, -r * 0.2, r * 0.72, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function lightningSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-r * 0.28, -r);
  ctx.lineTo(r * 0.36, -r * 0.1);
  ctx.lineTo(r * 0.02, -r * 0.05);
  ctx.lineTo(r * 0.3, r);
  ctx.lineTo(-r * 0.36, r * 0.08);
  ctx.lineTo(-r * 0.02, r * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function arrowSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, dir = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, 0);
  ctx.lineTo(r * 0.45, 0);
  ctx.moveTo(r * 0.1, -r * 0.42);
  ctx.lineTo(r * 0.5, 0);
  ctx.lineTo(r * 0.1, r * 0.42);
  ctx.stroke();
  ctx.restore();
}

export type SignSpec = {
  key: string;
  title: string;
  lines?: string[];
  bg?: string;
  fg?: string;
  accent?: string;
  symbol?: "bio" | "rad" | "bolt" | "arrowL" | "arrowR" | "none";
  width?: number;
  height?: number;
};

function signTexture(spec: SignSpec): HTMLCanvasElement {
  const w = spec.width ?? 512;
  const h = spec.height ?? 256;
  return cached(`sign:${spec.key}`, () =>
    paintCanvas(w, h, (ctx) => {
      const bg = spec.bg ?? "#c8c2b2";
      const fg = spec.fg ?? "#1b1a18";
      const accent = spec.accent ?? "#8d1f1f";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(0,0,0,0.28)");
      grad.addColorStop(0.4, "rgba(0,0,0,0.02)");
      grad.addColorStop(1, "rgba(0,0,0,0.34)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.16;
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = Math.random() > 0.5 ? "#3a352c" : "#6d6656";
        ctx.fillRect(x, y, 1 + Math.random() * 2, 6 + Math.random() * 46);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fg;
      ctx.lineWidth = h * 0.035;
      ctx.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
      if (spec.symbol && spec.symbol !== "none") {
        const r = h * 0.24;
        const cx = h * 0.34;
        const cy = h * 0.5;
        ctx.save();
        if (spec.symbol === "bio") biohazardSymbol(ctx, cx, cy, r, accent);
        if (spec.symbol === "rad") radiationSymbol(ctx, cx, cy, r, accent);
        if (spec.symbol === "bolt") lightningSymbol(ctx, cx, cy, r, accent);
        if (spec.symbol === "arrowL") arrowSymbol(ctx, cx, cy, r, accent, -1);
        if (spec.symbol === "arrowR") arrowSymbol(ctx, cx, cy, r, accent, 1);
        ctx.restore();
      }
      const left = spec.symbol && spec.symbol !== "none" ? h * 0.62 : h * 0.12;
      ctx.fillStyle = fg;
      ctx.textBaseline = "middle";
      const hasLines = !!(spec.lines && spec.lines.length);
      ctx.font = `700 ${Math.floor(h * (hasLines ? 0.2 : 0.26))}px "Arial Narrow", Arial, sans-serif`;
      const maxTextWidth = Math.max(32, w - left - h * 0.12);
      ctx.fillText(spec.title.toUpperCase(), left, h * (hasLines ? 0.38 : 0.5), maxTextWidth);
      if (hasLines) {
        ctx.font = `500 ${Math.floor(h * 0.115)}px "Arial Narrow", Arial, sans-serif`;
        spec.lines!.forEach((l, i) => {
          ctx.fillText(l.toUpperCase(), left, h * (0.62 + i * 0.17), maxTextWidth);
        });
      }
    }),
  );
}

/* ------------------------------------------------------------------ */
/* CRT screens                                                         */
/* ------------------------------------------------------------------ */

function crtBody(kind: "waveform" | "specimen" | "status" | "map" | "static" | "boot"): HTMLCanvasElement {
  return cached(`crt:${kind}`, () =>
    paintCanvas(512, 384, (ctx) => {
      const w = 512;
      const h = 384;
      ctx.fillStyle = "#04070a";
      ctx.fillRect(0, 0, w, h);
      const amber = "#ffb257";
      const green = "#8ff0c0";
      const cyan = "#7fd8ff";
      const col = kind === "waveform" ? green : kind === "specimen" ? amber : kind === "status" ? cyan : green;

      ctx.save();
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 2;
      ctx.font = '500 20px "Courier New", monospace';

      if (kind === "waveform") {
        ctx.fillText("EEG / BIO-SIGNAL  ::  CH.04", 24, 34);
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(24, 52, w - 48, h - 100);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        for (let x = 0; x <= w - 48; x += 2) {
          const t = x / (w - 48);
          let y = h / 2 + 30;
          y += Math.sin(t * 42) * 16 * (0.4 + 0.6 * Math.abs(Math.sin(t * 3.1)));
          y += Math.sin(t * 130) * 6 * (0.3 + 0.7 * Math.abs(Math.cos(t * 7)));
          y += (Math.random() - 0.5) * 5;
          if (x === 0) ctx.moveTo(24 + x, y);
          else ctx.lineTo(24 + x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 0.85;
        ctx.fillText("GAIN 2.5mV   FILTER 0.5-70Hz", 24, h - 40);
        ctx.fillText("** ARTIFACT DETECTED **", 24, h - 18);
      } else if (kind === "specimen") {
        ctx.fillText("SPECIMEN LOG 44-B", 24, 34);
        ctx.globalAlpha = 0.4;
        ctx.strokeRect(24, 52, w - 48, 24);
        ctx.globalAlpha = 1;
        ctx.fillText("SUBJECT: UNCLASSIFIED / VIABLE", 32, 68);
        const lines = [
          "> cryo-stable at -42C",
          "> tissue regeneration: ABNORMAL",
          "> responds to acoustic 18-22Hz",
          "> DO NOT OPEN CHAMBER",
          "> containment rating: INSUFFICIENT",
        ];
        lines.forEach((l, i) => ctx.fillText(l, 32, 112 + i * 28));
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(Date.now() / 200);
        ctx.fillText("RECORDING...", 32, h - 26);
      } else if (kind === "status") {
        ctx.fillText("SYS STATUS", 24, 34);
        const rows: [string, string][] = [
          ["MAIN GRID", "OFFLINE"],
          ["AUX BUS A", "ONLINE"],
          ["AUX BUS B", "ONLINE"],
          ["CHILLER LOOP", "FAULT"],
          ["CONTAINMENT", "SEALED"],
          ["ATMOSPHERE", "NOMINAL"],
        ];
        rows.forEach((r, i) => {
          const y = 74 + i * 30;
          ctx.globalAlpha = 0.85;
          ctx.fillText(r[0], 32, y);
          ctx.globalAlpha = r[1] === "OFFLINE" || r[1] === "FAULT" ? 0.55 : 1;
          ctx.fillStyle =
            r[1] === "ONLINE" || r[1] === "NOMINAL" ? green : r[1] === "SEALED" ? amber : "#ff6a5a";
          ctx.fillText(r[1], 260, y);
          ctx.fillStyle = col;
        });
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 14; i++) {
          const bh = 6 + Math.random() * 30;
          ctx.fillRect(360 + i * 10, h - 40 - bh, 8, bh);
        }
      } else if (kind === "map") {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = green;
        const ox = 120;
        const oy = 70;
        const s = 26;
        const cells = [
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 1],
          [2, 1],
          [1, 2],
          [0, 3],
          [1, 3],
          [2, 3],
        ];
        ctx.lineWidth = 2;
        cells.forEach(([cx, cy]) => ctx.strokeRect(ox + cx * s, oy + cy * s, s, s));
        ctx.fillStyle = "#ff5a4a";
        ctx.fillRect(ox + 1 * s + 4, oy + 2 * s + 4, s - 8, s - 8);
        ctx.globalAlpha = 1;
        ctx.fillStyle = green;
        ctx.fillText("SECTOR MAP - LEVEL 3", 24, 34);
        ctx.fillText("YOU ARE HERE", ox + s + 2, oy + 2 * s - 8);
      } else if (kind === "static") {
        for (let i = 0; i < 4200; i++) {
          ctx.fillStyle = `rgba(180,200,210,${Math.random() * 0.5})`;
          ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
        }
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#9fb4c0";
        ctx.fillText("NO SIGNAL", 24, 34);
      } else {
        ctx.fillText("HALCYON BIOSYS  BIOS v3.11", 24, 34);
        ctx.fillText("MEMORY TEST ......... 640K OK", 24, 74);
        ctx.fillText("CRYO LINK .......... OK", 24, 104);
        ctx.fillText("CONTAINMENT BUS .... LOST", 24, 134);
        ctx.globalAlpha = 0.8;
        ctx.fillText("AWAITING OPERATOR", 24, 190);
      }

      ctx.restore();

      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#000";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      ctx.globalAlpha = 1;
      const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.78);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.85)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
      glow.addColorStop(0, "rgba(255,255,255,0.05)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

function crtOff(): HTMLCanvasElement {
  return cached("crt:off", () =>
    paintCanvas(512, 384, (ctx) => {
      const w = 512;
      const h = 384;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#0d1114");
      g.addColorStop(0.5, "#151a1e");
      g.addColorStop(1, "#0a0d0f");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#8fb0c0";
      ctx.beginPath();
      ctx.moveTo(0, h * 0.75);
      ctx.lineTo(w, h * 0.35);
      ctx.lineTo(w, h * 0.55);
      ctx.lineTo(0, h * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.7)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

/* ------------------------------------------------------------------ */
/* misc decals                                                         */
/* ------------------------------------------------------------------ */

function paperTexture(): HTMLCanvasElement {
  return cached("paper", () =>
    paintCanvas(256, 256, (ctx) => {
      const w = 256;
      const h = 256;
      const img = ctx.getImageData(0, 0, w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const n = fbm(x * 0.09, y * 0.09, 4, 5);
          const v = 190 + n * 50;
          const i = (y * w + x) * 4;
          img.data[i] = v;
          img.data[i + 1] = v * 0.97;
          img.data[i + 2] = v * 0.88;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = "#2a2622";
      ctx.font = '400 13px "Courier New", monospace';
      const lines = [
        "HALCYON BIOSYS - INTERNAL",
        "------------------------",
        "RE: SECTOR C SEAL",
        "",
        "The board has authorised",
        "permanent closure of the",
        "sub-level three complex.",
        "",
        "All personnel are to be",
        "accounted for before the",
        "charges are set. Nothing",
        "leaves the shaft.",
        "",
        "- R. Vance, Site Dir.",
      ];
      lines.forEach((l, i) => ctx.fillText(l, 16, 26 + i * 15));
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "#6b6252";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (i * h) / 4);
        ctx.lineTo(w, (i * h) / 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }),
  );
}

function facilityMapTexture(): HTMLCanvasElement {
  return cached("facilitymap", () =>
    paintCanvas(512, 512, (ctx) => {
      const w = 512;
      ctx.fillStyle = "#d8d2bf";
      ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = "#20242a";
      ctx.lineWidth = 3;
      const rooms: [number, number, number, number, string][] = [
        [30, 30, 150, 150, "WET LAB"],
        [190, 30, 130, 150, "CONTAINMENT"],
        [330, 30, 150, 150, "CONTROL"],
        [30, 190, 450, 40, "CORRIDOR"],
        [30, 240, 150, 110, "AIRLOCK"],
        [190, 240, 130, 110, "SERVER"],
        [330, 240, 150, 110, "UTILITY"],
      ];
      rooms.forEach(([x, y, rw, rh, label]) => {
        ctx.strokeRect(x, y, rw, rh);
        ctx.font = '600 15px "Arial Narrow", Arial, sans-serif';
        ctx.fillStyle = "#20242a";
        ctx.fillText(label, x + 8, y + 20);
      });
      ctx.save();
      ctx.beginPath();
      ctx.rect(30, 360, 450, 120);
      ctx.clip();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#a03024";
      ctx.lineWidth = 2;
      for (let i = -120; i < 600; i += 14) {
        ctx.beginPath();
        ctx.moveTo(i, 480);
        ctx.lineTo(i + 120, 360);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#a03024";
      ctx.font = '700 22px "Arial Narrow", Arial, sans-serif';
      ctx.fillText("DECOMMISSIONED - LEVEL 4", 40, 430);
      ctx.fillStyle = "#20242a";
      ctx.font = '600 16px "Arial Narrow", Arial, sans-serif';
      ctx.fillText("HALCYON BIOSYS  ::  SITE ORPHEUS  ::  LEVEL 3", 30, 20);
      ctx.fillText("REV 4 - 1994", 30, 500);
      ctx.globalAlpha = 0.1;
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = "#4a4436";
        ctx.fillRect(Math.random() * w, Math.random() * w, 2, 2 + Math.random() * 8);
      }
      ctx.globalAlpha = 1;
    }),
  );
}

function hazardStripeTexture(): HTMLCanvasElement {
  return cached("hazard", () =>
    paintCanvas(256, 256, (ctx) => {
      const w = 256;
      ctx.fillStyle = "#14120f";
      ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = "#c8a21c";
      ctx.lineWidth = 26;
      for (let i = -w; i < w * 2; i += 52) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + w, w);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.28;
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? "#1c1a16" : "#5a5240";
        ctx.fillRect(Math.random() * w, Math.random() * w, 2, 2);
      }
      ctx.globalAlpha = 1;
    }),
  );
}

function whiteboardTexture(): HTMLCanvasElement {
  return cached("whiteboard", () =>
    paintCanvas(512, 320, (ctx) => {
      const w = 512;
      const h = 320;
      ctx.fillStyle = "#dfe0da";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1d2a3a";
      ctx.font = '600 26px "Comic Sans MS", "Segoe Print", cursive';
      ctx.fillText("DOOR CODE", 30, 46);
      ctx.font = '700 64px "Comic Sans MS", cursive';
      ctx.fillStyle = "#8d1f1f";
      ctx.fillText("7 4 1 9", 30, 120);
      ctx.fillStyle = "#1d2a3a";
      ctx.font = '500 20px "Comic Sans MS", cursive';
      ctx.fillText("records room - do not reset", 30, 156);
      ctx.font = '500 22px "Comic Sans MS", cursive';
      ctx.fillText("44-B still moving at -42C", 30, 210);
      ctx.fillText("acoustic trigger 18-22 Hz", 30, 240);
      ctx.fillStyle = "#2f6b3a";
      ctx.font = '600 24px "Comic Sans MS", cursive';
      ctx.fillText("if grid drops -> AUX BUS A + B", 30, 285);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#8a8f88";
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 8 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }),
  );
}

function corkBoardTexture(): HTMLCanvasElement {
  return cached("cork", () =>
    paintCanvas(512, 512, (ctx) => {
      const w = 512;
      const img = ctx.getImageData(0, 0, w, w);
      for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
          const n = fbm(x * 0.5, y * 0.5, 3, 9);
          const v = 96 + n * 60;
          const i = (y * w + x) * 4;
          img.data[i] = v * 1.05;
          img.data[i + 1] = v * 0.9;
          img.data[i + 2] = v * 0.66;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const notes: [number, number, string, string][] = [
        [40, 40, "#e8e2cd", "SHIFT LOG"],
        [300, 60, "#cfd9e8", "SAMPLE 44B"],
        [70, 300, "#e8d6c8", "CHILLER FAULT"],
        [320, 320, "#d8e8d0", "CALL VANCE"],
      ];
      notes.forEach(([x, y, col, text]) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((Math.random() - 0.5) * 0.2);
        ctx.fillStyle = col;
        ctx.fillRect(0, 0, 150, 110);
        ctx.fillStyle = "#33302a";
        ctx.font = '500 16px "Courier New", monospace';
        text.split("").forEach((ch, i) => ctx.fillText(ch, 10 + (i % 12) * 11, 26 + Math.floor(i / 12) * 18));
        ctx.restore();
      });
    }),
  );
}

function organismTexture(): HTMLCanvasElement {
  return cached("organism", () =>
    paintCanvas(256, 256, (ctx) => {
      const w = 256;
      const img = ctx.getImageData(0, 0, w, w);
      for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const v = y / w;
          const veins = Math.pow(1 - Math.abs(fbm(u * 5, v * 5, 5, 13) * 2 - 1), 3);
          const flesh = fbm(u * 9 + 4, v * 9 - 2, 4, 31);
          const r = mix(0.1, 0.42, flesh) + veins * 0.25;
          const g = mix(0.06, 0.16, flesh) + veins * 0.1;
          const b = mix(0.05, 0.14, flesh) + veins * 0.12;
          const i = (y * w + x) * 4;
          img.data[i] = r * 255;
          img.data[i + 1] = g * 255;
          img.data[i + 2] = b * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }),
  );
}

/* ------------------------------------------------------------------ */
/* public texture library                                              */
/* ------------------------------------------------------------------ */

export class TextureLibrary {
  private mem = new Map<string, THREE.Material>();

  private mat<T extends THREE.Material>(key: string, gen: () => T): T {
    let t = this.mem.get(key) as T | undefined;
    if (!t) {
      t = gen();
      this.mem.set(key, t);
    }
    return t;
  }

  concreteWall() {
    return this.mat("concreteWall", () => {
      const m = concreteWallMaps(512);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 1.0,
        metalness: 0.0,
        color: 0x8a8a86,
      });
    });
  }

  concreteFloor() {
    return this.mat("concreteFloor", () => {
      const m = concreteFloorMaps(512);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 1.0,
        metalness: 0.0,
        color: 0x9a9a96,
      });
    });
  }

  paintedMetal(color = 0x9a9b90) {
    return this.mat(`paintedMetal:${color}`, () => {
      const m = paintedMetalMaps(512, [
        ((color >> 16) & 255) / 255,
        ((color >> 8) & 255) / 255,
        (color & 255) / 255,
      ]);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 1.0,
        metalness: 0.05,
      });
    });
  }

  tileFloor() {
    return this.mat("tileFloor", () => {
      const m = tileFloorMaps(512, 4);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughness: 1.0,
        metalness: 0.02,
        color: 0xb8b8b4,
      });
    });
  }

  rust() {
    return this.mat("rust", () => {
      const m = rustMaps(512);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(1.4, 1.4),
        roughness: 1.0,
        metalness: 0.35,
      });
    });
  }

  stainless() {
    return this.mat("stainless", () => {
      const m = stainlessMaps(512);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 1.0,
        metalness: 0.9,
      });
    });
  }

  checkerPlate() {
    return this.mat("checkerPlate", () => {
      const m = checkerPlateMaps(512);
      return new THREE.MeshStandardMaterial({
        map: toTexture(m.map),
        normalMap: toTexture(m.normalMap, false),
        roughnessMap: toTexture(m.roughnessMap, false),
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughness: 1.0,
        metalness: 0.55,
      });
    });
  }

  organism() {
    return this.mat("organism", () => {
      const c = organismTexture();
      return new THREE.MeshStandardMaterial({
        map: toTexture(c),
        roughness: 0.38,
        metalness: 0.0,
        color: 0x9a7a70,
        emissive: 0x2a0d0a,
        emissiveIntensity: 0.6,
      });
    });
  }

  sign(spec: SignSpec) {
    const t = toTexture(signTexture(spec));
    t.repeat.set(1, 1);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.0 });
  }

  crt(kind: "waveform" | "specimen" | "status" | "map" | "static" | "boot") {
    const t = toTexture(crtBody(kind));
    return new THREE.MeshStandardMaterial({
      map: t,
      emissiveMap: t,
      emissive: 0xffffff,
      emissiveIntensity: 1.6,
      roughness: 0.35,
      metalness: 0.0,
    });
  }

  crtOffMaterial() {
    const t = toTexture(crtOff());
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.2, metalness: 0.0 });
  }

  paper() {
    const t = toTexture(paperTexture());
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
  }

  facilityMap() {
    const t = toTexture(facilityMapTexture());
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0.0 });
  }

  hazard() {
    const t = toTexture(hazardStripeTexture());
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, metalness: 0.0 });
  }

  whiteboard() {
    const t = toTexture(whiteboardTexture());
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.0 });
  }

  cork() {
    const t = toTexture(corkBoardTexture());
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, metalness: 0.0 });
  }

  glass(tint = 0xbcd4d8, opacity = 0.16) {
    return new THREE.MeshPhysicalMaterial({
      color: tint,
      transparent: true,
      opacity,
      roughness: 0.06,
      metalness: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  private spriteCache = new Map<string, THREE.Texture>();
  sprite(key: string, gen: () => HTMLCanvasElement) {
    let t = this.spriteCache.get(key);
    if (!t) {
      t = toTexture(gen());
      t.repeat.set(1, 1);
      this.spriteCache.set(key, t);
    }
    return t;
  }

  dustSprite() {
    return this.sprite("dust", () => radialSprite(64, 2.2));
  }

  glowSprite() {
    return this.sprite("glow", () => radialSprite(128, 2.6));
  }

  shaftSprite() {
    return this.sprite("shaft", () => shaftSprite(64, 256));
  }

  dispose() {
    this.mem.forEach((t) => t.dispose());
    this.mem.clear();
    this.spriteCache.forEach((t) => t.dispose());
    this.spriteCache.clear();
  }
}

export { roundRect };
