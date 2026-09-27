/**
 * Procedural noise + canvas helpers.
 * Everything in this project is generated at runtime - no external texture assets.
 */

export function hashi(i: number, j: number, seed = 0): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hashi(xi, yi, seed);
  const b = hashi(xi + 1, yi, seed);
  const c = hashi(xi, yi + 1, seed);
  const d = hashi(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

export function fbm(x: number, y: number, octaves = 4, seed = 0, lacunarity = 2.0, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq, seed + o * 131);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridged(x: number, y: number, octaves = 4, seed = 0): number {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq, seed + o * 197) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

export function clamp(v: number, a = 0, b = 1): number {
  return v < a ? a : v > b ? b : v;
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* canvas helpers                                                      */
/* ------------------------------------------------------------------ */

export function createCanvas(w: number, h = w): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export type SurfaceSample = {
  /** linear-ish rgb 0..1 */
  c: [number, number, number];
  /** height field 0..1 (used for the normal map) */
  h: number;
  /** roughness 0..1 */
  r: number;
  /** optional metalness 0..1 */
  m?: number;
};

/**
 * Generates albedo / normal / roughness canvases from a single height+colour field.
 */
export function surfaceMaps(
  size: number,
  fn: (u: number, v: number) => SurfaceSample,
  normalStrength = 2.0,
): { map: HTMLCanvasElement; normalMap: HTMLCanvasElement; roughnessMap: HTMLCanvasElement } {
  const map = createCanvas(size);
  const normalMap = createCanvas(size);
  const roughnessMap = createCanvas(size);
  const mctx = map.getContext("2d")!;
  const nctx = normalMap.getContext("2d")!;
  const rctx = roughnessMap.getContext("2d")!;
  const mImg = mctx.createImageData(size, size);
  const nImg = nctx.createImageData(size, size);
  const rImg = rctx.createImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const s = fn(x / size, y / size);
      mImg.data[i * 4 + 0] = clamp(s.c[0]) * 255;
      mImg.data[i * 4 + 1] = clamp(s.c[1]) * 255;
      mImg.data[i * 4 + 2] = clamp(s.c[2]) * 255;
      mImg.data[i * 4 + 3] = 255;
      height[i] = s.h;
      const rv = clamp(s.r) * 255;
      rImg.data[i * 4 + 0] = rv;
      rImg.data[i * 4 + 1] = rv;
      rImg.data[i * 4 + 2] = rv;
      rImg.data[i * 4 + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yu = height[((y - 1 + size) % size) * size + x];
      const yd = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * normalStrength;
      let ny = (yu - yd) * normalStrength;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const inv = 1 / len;
      nImg.data[i * 4 + 0] = (nx * 0.5 + 0.5) * 255;
      nImg.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nImg.data[i * 4 + 2] = (inv * 0.5 + 0.5) * 255;
      nImg.data[i * 4 + 3] = 255;
    }
  }

  mctx.putImageData(mImg, 0, 0);
  nctx.putImageData(nImg, 0, 0);
  rctx.putImageData(rImg, 0, 0);
  return { map, normalMap, roughnessMap };
}

/** Converts a luminance canvas into a tangent-space normal map. */
export function luminanceToNormal(src: HTMLCanvasElement, strength = 2.0): HTMLCanvasElement {
  const size = src.width;
  const sctx = src.getContext("2d")!;
  const data = sctx.getImageData(0, 0, size, size).data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    height[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  const out = createCanvas(size);
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yu = height[((y - 1 + size) % size) * size + x];
      const yd = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength;
      let ny = (yu - yd) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      img.data[i * 4 + 0] = (nx * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Radial soft sprite used for dust, glow and light shafts. */
export function radialSprite(size = 128, power = 2, inner = 0.0): HTMLCanvasElement {
  const c = createCanvas(size);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, power).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Streaky volumetric shaft sprite. */
export function shaftSprite(w = 128, h = 512): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.35, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // soft horizontal falloff
  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, "rgba(0,0,0,1)");
  g2.addColorStop(0.5, "rgba(0,0,0,0)");
  g2.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

/** Small rounded-corner brush used by the sign / screen painters. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
