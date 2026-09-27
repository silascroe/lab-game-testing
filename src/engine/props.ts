import * as THREE from "three";
import { createCanvas, radialSprite, roundRect } from "./noise";
import {
  addBox,
  addMesh,
  boxGeo,
  cylinderGeo,
  emissive,
  makeSeed,
  planeGeo,
  rand,
  type BuildCtx,
} from "./gfx";

/* ------------------------------------------------------------------ */
/* shared material shortcuts                                           */
/* ------------------------------------------------------------------ */

const steel = (ctx: BuildCtx): THREE.MeshStandardMaterial =>
  ctx.tex.paintedMetal(0x8f9086) as THREE.MeshStandardMaterial;
const darkSteel = (ctx: BuildCtx): THREE.MeshStandardMaterial =>
  ctx.tex.paintedMetal(0x55584f) as THREE.MeshStandardMaterial;
const plastic = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0 });
const shardMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: 0xbcd8e2,
    roughness: 0.08,
    metalness: 0.05,
    transparent: true,
    opacity: 0.28,
  });

function stainTexture(): THREE.Texture {
  const c = createCanvas(128);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(20,26,20,0.85)");
  g.addColorStop(0.45, "rgba(24,32,26,0.5)");
  g.addColorStop(1, "rgba(30,36,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.1 + Math.random() * 0.2;
    ctx.fillStyle = "#10160f";
    ctx.beginPath();
    ctx.ellipse(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 26, 5 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const stainCache = new Map<string, THREE.MeshStandardMaterial>();
function stainMaterial(key: string, color = 0x1a221c, opacity = 0.75): THREE.MeshStandardMaterial {
  let m = stainCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: stainTexture(),
      color,
      transparent: true,
      opacity,
      roughness: 0.18,
      metalness: 0.0,
      depthWrite: false,
    });
    stainCache.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* architecture details                                                */
/* ------------------------------------------------------------------ */

/** Ceiling-suspended fluorescent fixture with a steel housing and reflector. */
export function fluorescentFixture(
  ctx: BuildCtx,
  x: number,
  z: number,
  y: number,
  len = 2.4,
  dead = false,
): { tube: THREE.Mesh; light: THREE.PointLight } {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  ctx.scene.add(g);
  const housing = addBox(ctx, steel(ctx), len, 0.12, 0.34, { y: 0.06, parent: g, uvScale: 0.5 });
  housing.castShadow = true;
  addBox(ctx, darkSteel(ctx), len * 0.98, 0.06, 0.3, { y: -0.06, parent: g, uvScale: 0.5 });
  // end caps + suspension stubs
  addBox(ctx, darkSteel(ctx), 0.1, 0.1, 0.36, { x: -len / 2, y: 0.06, parent: g });
  addBox(ctx, darkSteel(ctx), 0.1, 0.1, 0.36, { x: len / 2, y: 0.06, parent: g });
  const tubeMat = dead ? plastic(0x2a2d2a) : emissive(0xdfe8ff, 2.8);
  const tube = addBox(ctx, tubeMat, len * 0.92, 0.07, 0.1, { y: -0.09, parent: g });
  const light = new THREE.PointLight(dead ? 0x223044 : 0xcfe0ff, dead ? 0.0 : 30, 15, 2);
  light.position.set(0, -0.15, 0);
  g.add(light);
  return { tube, light };
}

/** Wall / ceiling mounted emergency light with a coloured dome. */
export function emergencyLight(
  ctx: BuildCtx,
  x: number,
  y: number,
  z: number,
  color: 0xff3322 | 0xffaa33 = 0xff3322,
  ry = 0,
): { dome: THREE.Mesh; light: THREE.PointLight } {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addBox(ctx, darkSteel(ctx), 0.24, 0.1, 0.14, { parent: g, y: 0.05 });
  const dome = addMesh(
    ctx,
    new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    emissive(color, 2.6),
    { parent: g, y: 0.02, rx: Math.PI, castShadow: false },
  );
  const light = new THREE.PointLight(color, 17, 11, 2);
  light.position.set(0, -0.05, 0.25);
  g.add(light);
  return { dome, light };
}

/** A hinged interior door. Rotates in and registers a doorway collider. */
export function hingedDoor(
  ctx: BuildCtx,
  x: number,
  z: number,
  y: number,
  width: number,
  height: number,
  opts: { ry?: number; openInward?: boolean; color?: number; window?: boolean; locked?: boolean } = {},
): {
  group: THREE.Group;
  collider: THREE.Box3;
  setOpen: (v: boolean) => void;
  isOpen: () => boolean;
  update: (t: number, dt: number) => void;
} {
  const ry = opts.ry ?? 0;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = ry;
  ctx.scene.add(group);

  const hinge = new THREE.Group();
  // hinge sits on one jamb
  hinge.position.set(-width / 2, 0, 0);
  group.add(hinge);

  const panelMat = opts.color !== undefined ? ctx.tex.paintedMetal(opts.color) : steel(ctx);
  addBox(ctx, panelMat, width, height, 0.09, { x: width / 2, y: height / 2, parent: hinge, collider: false, castShadow: true, uvScale: 0.3 });
  // door furniture
  addBox(ctx, darkSteel(ctx), 0.08, height * 0.9, 0.11, { x: width - 0.1, y: height / 2, parent: hinge });
  const handle = addMesh(ctx, new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), plastic(0x1a1c20), {
    x: width - 0.12,
    y: height * 0.45,
    z: 0.09,
    parent: hinge,
  });
  handle.rotation.x = Math.PI / 2;
  if (opts.window !== false) {
    const win = addBox(ctx, ctx.tex.glass(0x9fc4d0, 0.18), width * 0.42, height * 0.34, 0.02, {
      x: width / 2,
      y: height * 0.62,
      z: 0.05,
      parent: hinge,
    });
    win.castShadow = false;
    addBox(ctx, darkSteel(ctx), width * 0.46, 0.05, 0.06, { x: width / 2, y: height * 0.62 + height * 0.17, z: 0.05, parent: hinge });
    addBox(ctx, darkSteel(ctx), width * 0.46, 0.05, 0.06, { x: width / 2, y: height * 0.62 - height * 0.17, z: 0.05, parent: hinge });
  }
  // kick plate
  addBox(ctx, darkSteel(ctx), width, 0.16, 0.02, { x: width / 2, y: 0.09, z: 0.055, parent: hinge });

  const collider = new THREE.Box3();
  let open = false;
  let angle = 0;

  const doorwayCollider = () => {
    const hw = width / 2;
    const hd = 0.1;
    const ca = Math.cos(ry);
    const sa = Math.sin(ry);
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(-hw, 0, -hd),
      new THREE.Vector3(hw, 0, -hd),
      new THREE.Vector3(-hw, 0, hd),
      new THREE.Vector3(hw, 0, hd),
    ].map((v) => new THREE.Vector3(x + v.x * ca + v.z * sa, y, z - v.x * sa + v.z * ca));
    collider.setFromPoints(corners);
    collider.max.y = y + height;
  };

  const refreshCollider = () => {
    if (open) {
      collider.makeEmpty();
    } else {
      const hw = width / 2;
      const hd = 0.1;
      const ca = Math.cos(ry);
      const sa = Math.sin(ry);
      const corners: THREE.Vector3[] = [
        new THREE.Vector3(-hw, 0, -hd),
        new THREE.Vector3(hw, 0, -hd),
        new THREE.Vector3(-hw, 0, hd),
        new THREE.Vector3(hw, 0, hd),
      ].map((v) => new THREE.Vector3(x + v.x * ca + v.z * sa, y, z - v.x * sa + v.z * ca));
      collider.setFromPoints(corners);
      collider.max.y = y + height;
    }
  };
  refreshCollider();
  ctx.doorColliders.push(collider);

  const inward = opts.openInward ?? true;
  const dir = inward ? 1 : -1;
  const update = (_t: number, dt: number) => {
    const want = open ? (dir * Math.PI) / 2 : 0;
    angle += (want - angle) * Math.min(1, dt * 6.5);
    hinge.rotation.y = angle;
    if (Math.abs(angle - want) < 0.002 && angle !== want) {
      angle = want;
      hinge.rotation.y = angle;
    }
    // the doorway stays solid until the panel has swung clear of it
    const clear = Math.abs(angle) > 1.15;
    const shouldBeSolid = !clear;
    const isSolid = !collider.isEmpty();
    if (shouldBeSolid !== isSolid) {
      if (shouldBeSolid) doorwayCollider();
      else collider.makeEmpty();
    }
  };
  ctx.anims.push(update);

  return {
    group,
    collider,
    setOpen: (v: boolean) => {
      if (open !== v) {
        open = v;
        refreshCollider();
      }
    },
    isOpen: () => open,
    update,
  };
}

/** Heavy bulkhead door: two panels that slide apart into the wall reveals. */
export function blastDoor(
  ctx: BuildCtx,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  opts: { ry?: number; color?: number; label?: string } = {},
): {
  group: THREE.Group;
  collider: THREE.Box3;
  setOpen: (v: boolean) => void;
  isOpen: () => boolean;
  update: (t: number, dt: number) => void;
} {
  const ry = opts.ry ?? 0;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = ry;
  ctx.scene.add(group);

  const mat = ctx.tex.paintedMetal(opts.color ?? 0x6d6f66);
  const half = width / 2;
  const panelGeo = boxGeo(half, height, 0.24, 0.3);
  const left = new THREE.Mesh(panelGeo, mat);
  left.position.set(-half / 2, height / 2, 0);
  left.castShadow = true;
  left.receiveShadow = true;
  group.add(left);
  const right = new THREE.Mesh(panelGeo, mat);
  right.position.set(half / 2, height / 2, 0);
  right.castShadow = true;
  group.add(right);

  // ribbed detail + warning stripe
  for (let i = 0; i < 4; i++) {
    addBox(ctx, darkSteel(ctx), half * 0.9, 0.07, 0.28, { x: -half / 2, y: height * (0.25 + i * 0.16), parent: group });
    addBox(ctx, darkSteel(ctx), half * 0.9, 0.07, 0.28, { x: half / 2, y: height * (0.25 + i * 0.16), parent: group });
  }
  const stripe = addBox(ctx, ctx.tex.hazard(), half * 0.8, 0.16, 0.3, { y: height * 0.88, parent: group });
  stripe.position.z = 0;

  const collider = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(x, y + height / 2, z),
    new THREE.Vector3(Math.abs(Math.cos(ry)) * width + Math.abs(Math.sin(ry)) * 0.3, height, Math.abs(Math.sin(ry)) * width + Math.abs(Math.cos(ry)) * 0.3),
  );
  ctx.doorColliders.push(collider);

  let open = false;
  let t = 0;
  const update = (_time: number, dt: number) => {
    const want = open ? 1 : 0;
    t += (want - t) * Math.min(1, dt * 2.6);
    left.position.x = -half / 2 - t * (half + 0.02);
    right.position.x = half / 2 + t * (half + 0.02);
    if (open && t > 0.75) collider.makeEmpty();
    else if (!open && t < 0.3) {
      collider.setFromCenterAndSize(
        new THREE.Vector3(x, y + height / 2, z),
        new THREE.Vector3(
          Math.abs(Math.cos(ry)) * width + Math.abs(Math.sin(ry)) * 0.3,
          height,
          Math.abs(Math.sin(ry)) * width + Math.abs(Math.cos(ry)) * 0.3,
        ),
      );
    }
  };
  ctx.anims.push(update);

  return {
    group,
    collider,
    setOpen: (v: boolean) => {
      open = v;
    },
    isOpen: () => open,
    update,
  };
}

/* ------------------------------------------------------------------ */
/* signage & wall dressing                                             */
/* ------------------------------------------------------------------ */

/**
 * Mounts a sign flush against a wall face. The plane is pushed `offset` metres along
 * its own normal so it can never z-fight with, or sink into, the wall behind it.
 * `ry` is the direction the sign faces: 0 => +Z, PI => -Z, PI/2 => +X, -PI/2 => -X.
 */
export function wallSign(
  ctx: BuildCtx,
  spec: Parameters<BuildCtx["tex"]["sign"]>[0],
  x: number,
  y: number,
  z: number,
  ry: number,
  w = 0.9,
  h = 0.45,
  offset = 0.035,
): THREE.Mesh {
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  const depth = 0.035;

  // Treat signage as an actual mounted object instead of a decal. The shallow
  // backplate keeps it off rough walls, makes the silhouette read in raking light,
  // and prevents the "half swallowed by the wall" look that flat planes produced.
  const backing = addBox(ctx, ctx.tex.paintedMetal(0x24282b), w + 0.07, h + 0.07, depth, {
    x: x + nx * (offset + depth * 0.5),
    y,
    z: z + nz * (offset + depth * 0.5),
    ry,
    castShadow: true,
    receiveShadow: true,
    uvScale: 0.5,
  });
  backing.userData.kind = "signBackplate";
  backing.userData.signKey = spec.key;

  const mesh = new THREE.Mesh(planeGeo(w, h, 1), ctx.tex.sign(spec));
  mesh.position.set(x + nx * (offset + depth + 0.004), y, z + nz * (offset + depth + 0.004));
  mesh.rotation.y = ry;
  mesh.receiveShadow = true;
  mesh.userData.kind = "sign";
  mesh.userData.signKey = spec.key;
  mesh.renderOrder = 2;
  ctx.scene.add(mesh);
  return mesh;
}

/** Room number stencil, mounted flush like `wallSign`. */
export function roomStencil(
  ctx: BuildCtx,
  text: string,
  x: number,
  y: number,
  z: number,
  ry: number,
  offset = 0.026,
): THREE.Mesh {
  const c = createCanvas(256, 128);
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9c4b4";
  g.fillRect(0, 0, 256, 128);
  g.globalAlpha = 0.22;
  for (let i = 0; i < 200; i++) {
    g.fillStyle = "#4a4436";
    g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  g.globalAlpha = 1;
  g.fillStyle = "#20242a";
  g.font = '700 62px "Arial Narrow", Arial, sans-serif';
  g.textBaseline = "middle";
  g.fillText(text, 12, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  const mesh = new THREE.Mesh(planeGeo(0.36, 0.18, 1), m);
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  mesh.position.set(x + nx * offset, y, z + nz * offset);
  mesh.rotation.y = ry;
  ctx.scene.add(mesh);
  return mesh;
}

/** Framed board (whiteboard / cork / plan) mounted flat against a wall face. */
export function mountedBoard(
  ctx: BuildCtx,
  faceMaterial: THREE.Material,
  x: number,
  y: number,
  z: number,
  ry: number,
  w: number,
  h: number,
  opts: { frame?: boolean; frameColor?: number; frameDepth?: number } = {},
): THREE.Mesh {
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  const frameDepth = opts.frameDepth ?? 0.045;
  if (opts.frame !== false) {
    addBox(ctx, ctx.tex.paintedMetal(opts.frameColor ?? 0x3a3d38), w + 0.08, h + 0.08, frameDepth, {
      x: x - nx * frameDepth * 0.5,
      y,
      z: z - nz * frameDepth * 0.5,
      ry,
      castShadow: true,
      uvScale: 0.5,
    });
  }
  const mesh = new THREE.Mesh(planeGeo(w, h, 1), faceMaterial);
  mesh.position.set(x + nx * 0.012, y, z + nz * 0.012);
  mesh.rotation.y = ry;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  return mesh;
}

export function wallDecal(
  ctx: BuildCtx,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  ry: number,
  w: number,
  h: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(planeGeo(w, h, 1), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  ctx.scene.add(mesh);
  return mesh;
}

/** Stencilled room number on the wall next to a door. */
/* ------------------------------------------------------------------ */
/* lab furniture                                                       */
/* ------------------------------------------------------------------ */

export function labBench(ctx: BuildCtx, x: number, z: number, w: number, d: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const top = addBox(ctx, ctx.tex.stainless(), w, 0.06, d, { y: 0.9, parent: g, castShadow: true, receiveShadow: true, uvScale: 0.5, collider: true });
  top.receiveShadow = true;
  addBox(ctx, darkSteel(ctx), w, 0.05, d, { y: 0.845, parent: g });
  // apron + legs
  addBox(ctx, darkSteel(ctx), w, 0.16, 0.03, { y: 0.42, z: d / 2 - 0.02, parent: g });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(ctx, darkSteel(ctx), 0.06, 0.84, 0.06, { x: (sx * (w / 2 - 0.08)), z: sz * (d / 2 - 0.08), parent: g, castShadow: true });
    }
  }
  // lower shelf
  addBox(ctx, darkSteel(ctx), w - 0.2, 0.04, d - 0.2, { y: 0.3, parent: g });
  return g;
}

export function shelfRack(ctx: BuildCtx, x: number, z: number, w: number, ry = 0, shelves = 4): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  for (const sx of [-1, 1]) {
    addBox(ctx, darkSteel(ctx), 0.05, 2.1, 0.42, { x: sx * (w / 2 - 0.03), y: 1.05, parent: g, castShadow: true, collider: true });
  }
  for (let i = 0; i < shelves; i++) {
    addBox(ctx, steel(ctx), w, 0.04, 0.42, { y: 0.25 + i * 0.5, parent: g, receiveShadow: true });
  }
  return g;
}

const bottleColors = [0x2f7f5f, 0x7a3b8f, 0xa8452c, 0x2c5aa8, 0xb8a12c, 0x8f2f4f];

export function reagentBottles(ctx: BuildCtx, x: number, y: number, z: number, count = 6, seed = 1): void {
  const s = makeSeed(seed);
  for (let i = 0; i < count; i++) {
    const c = bottleColors[Math.floor(rand(s) * bottleColors.length)];
    const h = 0.13 + rand(s) * 0.12;
    const r = 0.032 + rand(s) * 0.02;
    const glass = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.15,
      metalness: 0.0,
      transparent: true,
      opacity: 0.72,
    });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), glass);
    b.position.set(x + (rand(s) - 0.5) * 0.5, y + h / 2, z + (rand(s) - 0.5) * 0.22);
    b.castShadow = true;
    ctx.scene.add(b);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.03, 8), plastic(0x1b1d20));
    cap.position.set(b.position.x, y + h + 0.015, b.position.z);
    ctx.scene.add(cap);
  }
}

export function fumeHood(ctx: BuildCtx, x: number, z: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const w = 1.6;
  const d = 0.85;
  const h = 2.3;
  addBox(ctx, steel(ctx), w, h, d, { y: h / 2, parent: g, castShadow: true, uvScale: 0.4, collider: true });
  // interior work surface
  addBox(ctx, ctx.tex.stainless(), w - 0.1, 0.04, d - 0.1, { y: 0.92, parent: g, uvScale: 0.5 });
  // open front (dark cavity)
  addBox(ctx, plastic(0x05070a), w - 0.16, 0.6, 0.06, { y: 0.62, z: d / 2 - 0.02, parent: g });
  // sash: broken, hanging at an angle
  const sash = new THREE.Group();
  sash.position.set(0, 1.05, d / 2);
  sash.rotation.z = -0.12;
  g.add(sash);
  const glassPane = new THREE.Mesh(planeGeo(w - 0.24, 0.72, 1), ctx.tex.glass(0xa8ccd8, 0.14));
  glassPane.position.set(0, 0.36, 0);
  sash.add(glassPane);
  addBox(ctx, darkSteel(ctx), w - 0.2, 0.05, 0.05, { y: 0.02, parent: sash });
  addBox(ctx, darkSteel(ctx), w - 0.2, 0.05, 0.05, { y: 0.7, parent: sash });
  // duct
  const duct = addMesh(ctx, cylinderGeo(0.2, 0.2, 2.2, 14, 0.4), steel(ctx), { y: h + 1.05, x: -w / 2 + 0.3, z: -d / 2 + 0.25, parent: g });
  duct.castShadow = true;
  // control panel with dead gauges
  addBox(ctx, darkSteel(ctx), 0.36, 0.26, 0.06, { x: w / 2 - 0.28, y: 1.5, z: d / 2 + 0.02, parent: g });
  for (let i = 0; i < 2; i++) {
    const gauge = addMesh(ctx, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), plastic(0xd8d4c8), {
      x: w / 2 - 0.35 + i * 0.14,
      y: 1.5,
      z: d / 2 + 0.05,
      rx: Math.PI / 2,
      parent: g,
    });
    gauge.rotation.z = 0;
  }
  return g;
}

export function officeChair(ctx: BuildCtx, x: number, z: number, ry = 0, fallen = false): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  if (fallen) {
    g.rotation.z = Math.PI / 2.1;
    g.position.y = 0.16;
  }
  ctx.scene.add(g);
  addBox(ctx, plastic(0x22262c), 0.46, 0.07, 0.44, { y: 0.46, parent: g, castShadow: true });
  addBox(ctx, plastic(0x22262c), 0.44, 0.5, 0.07, { y: 0.74, z: -0.2, parent: g, rx: -0.1, castShadow: true });
  const post = addMesh(ctx, cylinderGeo(0.03, 0.04, 0.36, 10), plastic(0x2c3036), { y: 0.26, parent: g });
  post.castShadow = true;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = addBox(ctx, plastic(0x2c3036), 0.26, 0.04, 0.05, { x: Math.cos(a) * 0.13, z: Math.sin(a) * 0.13, y: 0.07, ry: -a, parent: g });
    leg.castShadow = true;
    const wheel = addMesh(ctx, new THREE.SphereGeometry(0.03, 8, 6), plastic(0x14161a), {
      x: Math.cos(a) * 0.24,
      z: Math.sin(a) * 0.24,
      y: 0.03,
      parent: g,
    });
    wheel.castShadow = true;
  }
  return g;
}

export function stool(ctx: BuildCtx, x: number, z: number, ry = 0, fallen = false): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  if (fallen) {
    g.rotation.x = Math.PI / 2;
    g.position.y = 0.2;
  }
  ctx.scene.add(g);
  addBox(ctx, plastic(0x2b2f36), 0.34, 0.05, 0.34, { y: 0.6, parent: g, castShadow: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    addBox(ctx, plastic(0x3a3f47), 0.03, 0.6, 0.03, { x: Math.cos(a) * 0.13, z: Math.sin(a) * 0.13, parent: g });
  }
  return g;
}

export function filingCabinet(ctx: BuildCtx, x: number, z: number, ry = 0, open = false): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addBox(ctx, darkSteel(ctx), 0.46, 1.3, 0.6, { y: 0.65, parent: g, castShadow: true, collider: true });
  const drawerMat = steel(ctx);
  for (let i = 0; i < 3; i++) {
    const d = addBox(ctx, drawerMat, 0.4, 0.34, 0.56, { y: 0.22 + i * 0.38, parent: g });
    if (i === 1 && open) d.position.z = 0.22;
    addBox(ctx, plastic(0x1b1e22), 0.16, 0.02, 0.02, { y: 0.22 + i * 0.38, z: 0.29, parent: g });
  }
  return g;
}

export function crate(ctx: BuildCtx, x: number, z: number, w: number, h: number, d: number, ry = 0, label = "HALCYON"): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const body = addBox(ctx, ctx.tex.paintedMetal(0x6f6a55), w, h, d, { y: h / 2, parent: g, castShadow: true, collider: true, uvScale: 0.5 });
  body.receiveShadow = true;
  addBox(ctx, darkSteel(ctx), w + 0.02, 0.05, 0.05, { y: h * 0.75, parent: g });
  addBox(ctx, darkSteel(ctx), w + 0.02, 0.05, 0.05, { y: h * 0.3, parent: g });
  const c = createCanvas(256, 128);
  const g2 = c.getContext("2d")!;
  g2.fillStyle = "#c8c2b2";
  g2.fillRect(0, 0, 256, 128);
  g2.fillStyle = "#20242a";
  g2.font = '700 40px "Arial Narrow", Arial, sans-serif';
  g2.fillText(label, 14, 52);
  g2.font = '500 24px "Arial Narrow", Arial, sans-serif';
  g2.fillText("SITE ORPHEUS", 14, 88);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  const decal = new THREE.Mesh(planeGeo(w * 0.8, h * 0.4, 1), m);
  decal.position.set(0, h * 0.55, d / 2 + 0.005);
  g.add(decal);
  return g;
}

export function barrel(ctx: BuildCtx, x: number, z: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const body = addMesh(ctx, cylinderGeo(0.3, 0.3, 0.9, 18, 0.5), ctx.tex.rust(), { y: 0.45, parent: g, castShadow: true, collider: true });
  body.receiveShadow = true;
  for (const y of [0.2, 0.45, 0.7]) {
    addMesh(ctx, new THREE.TorusGeometry(0.305, 0.02, 6, 18), darkSteel(ctx), { y, rx: Math.PI / 2, parent: g });
  }
  addMesh(ctx, new THREE.CylinderGeometry(0.31, 0.31, 0.04, 18), darkSteel(ctx), { y: 0.9, parent: g });
  return g;
}

export function trolleyCart(ctx: BuildCtx, x: number, z: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addBox(ctx, ctx.tex.stainless(), 0.8, 0.04, 0.55, { y: 0.85, parent: g, castShadow: true, uvScale: 0.6 });
  addBox(ctx, ctx.tex.stainless(), 0.8, 0.04, 0.55, { y: 0.45, parent: g, uvScale: 0.6 });
  for (const sx of [-1, 1]) {
    addBox(ctx, darkSteel(ctx), 0.04, 0.85, 0.5, { x: sx * 0.38, y: 0.45, parent: g, castShadow: true });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = addMesh(ctx, new THREE.SphereGeometry(0.06, 8, 6), plastic(0x14161a), { x: sx * 0.34, z: sz * 0.22, y: 0.06, parent: g });
      wheel.castShadow = true;
    }
  }
  reagentBottles(ctx, x, 0.89, z, 3, 7);
  return g;
}

export function lockerBank(ctx: BuildCtx, x: number, z: number, ry = 0, count = 4, openIndex = -1): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const w = 0.42;
  addBox(ctx, darkSteel(ctx), w * count + 0.06, 2.0, 0.5, { y: 1.0, parent: g, castShadow: true, collider: true });
  for (let i = 0; i < count; i++) {
    const door = new THREE.Group();
    door.position.set(-(w * count) / 2 + w / 2 + i * w, 1.0, 0.26);
    g.add(door);
    addBox(ctx, steel(ctx), w - 0.03, 0.9, 0.04, { parent: door, castShadow: true, uvScale: 0.5 });
    // vents
    for (let v = 0; v < 3; v++) {
      addBox(ctx, plastic(0x1b1e22), w - 0.14, 0.02, 0.02, { y: 0.3 + v * 0.06, z: 0.03, parent: door });
    }
    if (i === openIndex) {
      door.rotation.y = -0.9;
      addBox(ctx, plastic(0x0a0c0e), w - 0.1, 0.8, 0.02, { y: 0, z: -0.02, parent: door });
    }
  }
  return g;
}

export function deconStall(ctx: BuildCtx, x: number, z: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const w = 1.0;
  const d = 1.1;
  for (const sx of [-1, 1]) {
    addBox(ctx, darkSteel(ctx), 0.06, 2.3, d, { x: sx * w / 2, y: 1.15, parent: g, castShadow: true, collider: true });
  }
  addBox(ctx, darkSteel(ctx), w, 0.06, d, { y: 2.3, parent: g });
  // nozzles
  for (const sx of [-1, 1]) {
    addMesh(ctx, cylinderGeo(0.03, 0.03, 0.16, 8), plastic(0x2a2e34), { x: sx * 0.3, y: 2.1, rx: Math.PI / 2, parent: g });
  }
  const pipe = addMesh(ctx, cylinderGeo(0.025, 0.025, 0.9, 8), plastic(0x3a4048), { y: 2.36, rx: Math.PI / 2, parent: g });
  pipe.rotation.z = Math.PI / 2;
  // curtain, partly torn away
  const curtain = new THREE.Mesh(
    planeGeo(w - 0.1, 1.6, 1),
    new THREE.MeshStandardMaterial({ color: 0x3d4a4a, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  curtain.position.set(0, 1.0, d / 2 - 0.03);
  curtain.rotation.y = 0;
  g.add(curtain);
  const torn = new THREE.Mesh(
    planeGeo(0.5, 0.9, 1),
    new THREE.MeshStandardMaterial({ color: 0x35403f, roughness: 0.95, side: THREE.DoubleSide }),
  );
  torn.position.set(0.22, 0.55, d / 2 + 0.06);
  torn.rotation.set(0.2, 0.4, 0.3);
  g.add(torn);
  // drain grate
  const grate = addBox(ctx, ctx.tex.checkerPlate(), w - 0.14, 0.03, 0.5, { y: 0.02, z: -0.1, parent: g, uvScale: 0.6 });
  grate.receiveShadow = true;
  return g;
}

export function mopBucket(ctx: BuildCtx, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.scene.add(g);
  const body = addMesh(ctx, cylinderGeo(0.19, 0.15, 0.32, 14, 0.5), plastic(0x2a4a52), { y: 0.16, parent: g, castShadow: true, collider: true });
  body.receiveShadow = true;
  const water = addMesh(ctx, new THREE.CircleGeometry(0.17, 16), new THREE.MeshStandardMaterial({ color: 0x0d1a18, roughness: 0.05, metalness: 0.2 }), { y: 0.29, rx: -Math.PI / 2, parent: g });
  water.receiveShadow = true;
  const handle = addMesh(ctx, new THREE.TorusGeometry(0.14, 0.012, 5, 14, Math.PI), plastic(0x14161a), { y: 0.32, parent: g });
  handle.rotation.z = Math.PI;
  const mop = addMesh(ctx, cylinderGeo(0.05, 0.03, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 1 }), { x: 0.16, y: 0.5, rz: 0.2, parent: g });
  mop.castShadow = true;
  return g;
}

export function foldingChair(ctx: BuildCtx, x: number, z: number, ry = 0, fallen = false): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  if (fallen) {
    g.rotation.z = Math.PI / 2.2;
    g.position.y = 0.14;
  }
  ctx.scene.add(g);
  addBox(ctx, plastic(0x33383f), 0.42, 0.05, 0.42, { y: 0.45, parent: g, castShadow: true });
  addBox(ctx, plastic(0x33383f), 0.4, 0.42, 0.05, { y: 0.66, z: -0.19, parent: g, rx: 0.12 });
  for (const sx of [-1, 1]) {
    addBox(ctx, plastic(0x2a2e34), 0.03, 0.45, 0.03, { x: sx * 0.17, z: 0.17, parent: g });
    addBox(ctx, plastic(0x2a2e34), 0.03, 0.45, 0.03, { x: sx * 0.17, z: -0.17, parent: g });
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* equipment                                                           */
/* ------------------------------------------------------------------ */

export type MonitorUnit = {
  group: THREE.Group;
  setContent: (kind: "waveform" | "specimen" | "status" | "map" | "static" | "boot" | "off") => void;
  screenLight: THREE.PointLight | null;
};

export function crtMonitor(
  ctx: BuildCtx,
  x: number,
  y: number,
  z: number,
  ry: number,
  content: "waveform" | "specimen" | "status" | "map" | "static" | "boot" | "off" = "off",
  opts: { withLight?: boolean; scale?: number } = {},
): MonitorUnit {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const s = opts.scale ?? 1;
  const body = addBox(ctx, plastic(0x2a2d31), 0.34 * s, 0.28 * s, 0.32 * s, { parent: g, castShadow: true, uvScale: 0.7 });
  body.receiveShadow = true;
  // screen recess
  addBox(ctx, plastic(0x0c0e10), 0.28 * s, 0.22 * s, 0.02, { z: 0.16 * s, parent: g });
  const screenMat = content === "off" ? ctx.tex.crtOffMaterial() : ctx.tex.crt(content);
  const screen = new THREE.Mesh(planeGeo(0.26 * s, 0.2 * s, 1), screenMat);
  screen.position.set(0, 0, 0.171 * s);
  g.add(screen);
  // stand
  addBox(ctx, plastic(0x22252a), 0.1 * s, 0.06 * s, 0.12 * s, { y: -0.16 * s, parent: g });
  addBox(ctx, plastic(0x22252a), 0.22 * s, 0.02 * s, 0.18 * s, { y: -0.19 * s, parent: g });
  let screenLight: THREE.PointLight | null = null;
  if (opts.withLight !== false) {
    const light = new THREE.PointLight(0x9fd8ff, 0.0, 3.2, 2);
    light.position.set(0, 0, 0.4 * s);
    g.add(light);
    screenLight = light;
  }
  return {
    group: g,
    screenLight,
    setContent: (kind) => {
      screen.material = kind === "off" ? ctx.tex.crtOffMaterial() : ctx.tex.crt(kind);
      if (screenLight) screenLight.intensity = kind === "off" ? 0 : 1.1;
    },
  };
}

export function serverRack(ctx: BuildCtx, x: number, z: number, ry = 0, h = 2.1, leds = 12): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addBox(ctx, darkSteel(ctx), 0.62, h, 0.9, { y: h / 2, parent: g, castShadow: true, collider: true, uvScale: 0.5 });
  // vented front
  for (let i = 0; i < 8; i++) {
    addBox(ctx, plastic(0x0d0f11), 0.5, 0.015, 0.02, { y: 0.2 + i * 0.12, z: 0.452, parent: g });
  }
  // drive bays with blinking LEDs
  const ledMat = emissive(0x36ff9a, 2.2);
  const ledGeo = new THREE.BoxGeometry(0.03, 0.014, 0.01);
  const instanced = new THREE.InstancedMesh(ledGeo, ledMat, leds);
  instanced.position.set(0, 0, 0);
  g.add(instanced);
  const dummy = new THREE.Object3D();
  const phases: number[] = [];
  for (let i = 0; i < leds; i++) {
    dummy.position.set(-0.18 + (i % 6) * 0.072, 0.34 + Math.floor(i / 6) * 0.06, 0.456);
    dummy.updateMatrix();
    instanced.setMatrixAt(i, dummy.matrix);
    phases.push(Math.random() * Math.PI * 2);
  }
  instanced.instanceMatrix.needsUpdate = true;
  const ledMatRed = emissive(0xff5a3c, 2.0);
  const errGeo = new THREE.BoxGeometry(0.03, 0.014, 0.01);
  const errs = new THREE.InstancedMesh(errGeo, ledMatRed, 3);
  g.add(errs);
  for (let i = 0; i < 3; i++) {
    dummy.position.set(0.2, 1.2 + i * 0.1, 0.456);
    dummy.updateMatrix();
    errs.setMatrixAt(i, dummy.matrix);
  }
  errs.instanceMatrix.needsUpdate = true;

  ctx.anims.push((t) => {
    for (let i = 0; i < leds; i++) {
      const on = Math.sin(t * (1.5 + (i % 5) * 0.7) + phases[i]) > 0.1 ? 1 : 0;
      dummy.position.set(-0.18 + (i % 6) * 0.072, 0.34 + Math.floor(i / 6) * 0.06, 0.456);
      dummy.scale.set(1, 1, on ? 1 : 0.001);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
  });
  // cable bundle at the rear
  const cable = addMesh(ctx, new THREE.TorusGeometry(0.06, 0.018, 5, 10), plastic(0x101216), { y: 0.05, rx: Math.PI / 2, parent: g });
  cable.position.z = -0.4;
  return g;
}

export function breakerPanel(
  ctx: BuildCtx,
  x: number,
  y: number,
  z: number,
  ry: number,
  breakers: { id: string; label: string; state: boolean }[],
): { group: THREE.Group; levers: THREE.Mesh[] } {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const w = 0.7 + breakers.length * 0.02;
  const h = 0.5 + breakers.length * 0.16;
  addBox(ctx, ctx.tex.paintedMetal(0x5d6259), w, h, 0.24, { y: h / 2, parent: g, castShadow: true, uvScale: 0.6 });
  addBox(ctx, darkSteel(ctx), w + 0.06, 0.05, 0.3, { y: h, parent: g });
  addBox(ctx, darkSteel(ctx), w + 0.06, 0.05, 0.3, { y: 0.02, parent: g });
  const levers: THREE.Mesh[] = [];
  breakers.forEach((b, i) => {
    const yy = h - 0.16 - i * 0.2;
    addBox(ctx, plastic(0x14171a), w - 0.2, 0.13, 0.05, { y: yy, z: 0.13, parent: g });
    const lever = addBox(ctx, b.state ? plastic(0x1d2a1f) : plastic(0x2a1d1d), 0.07, 0.1, 0.07, { x: -0.1, y: yy + 0.02, z: 0.16, parent: g, castShadow: true });
    levers.push(lever);
    // label plate
    const c = createCanvas(128, 64);
    const cctx = c.getContext("2d")!;
    cctx.fillStyle = "#cfcabb";
    cctx.fillRect(0, 0, 128, 64);
    cctx.fillStyle = "#20242a";
    cctx.font = '700 26px "Arial Narrow", Arial, sans-serif';
    cctx.fillText(b.label, 8, 40);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(planeGeo(0.34, 0.14, 1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    plate.position.set(0.13, yy, 0.135);
    g.add(plate);
  });
  return { group: g, levers };
}

export function transformer(ctx: BuildCtx, x: number, z: number, ry = 0): { group: THREE.Group; hum: THREE.PointLight } {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const tank = addMesh(ctx, cylinderGeo(0.5, 0.5, 1.5, 20, 0.5), ctx.tex.paintedMetal(0x4a5248), { y: 0.75, parent: g, castShadow: true, collider: true });
  tank.receiveShadow = true;
  for (const y of [0.35, 0.75, 1.15]) {
    addMesh(ctx, new THREE.TorusGeometry(0.52, 0.03, 6, 20), darkSteel(ctx), { y, rx: Math.PI / 2, parent: g });
  }
  // cooling fins
  for (let i = 0; i < 10; i++) {
    addBox(ctx, darkSteel(ctx), 1.06, 0.03, 0.1, { y: 0.35 + i * 0.12, parent: g });
  }
  // bushings on top
  for (const sx of [-0.2, 0.2]) {
    addMesh(ctx, cylinderGeo(0.06, 0.08, 0.28, 10), plastic(0x1a1c20), { x: sx, y: 1.62, parent: g });
  }
  const hum = new THREE.PointLight(0x88a0c8, 0.0, 5, 2);
  hum.position.set(0, 1.2, 0.6);
  g.add(hum);
  return { group: g, hum };
}

export function pumpUnit(ctx: BuildCtx, x: number, z: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addBox(ctx, ctx.tex.checkerPlate(), 1.0, 0.12, 0.7, { y: 0.06, parent: g, receiveShadow: true, uvScale: 0.6, collider: true });
  const motor = addMesh(ctx, cylinderGeo(0.22, 0.22, 0.7, 16, 0.5), ctx.tex.paintedMetal(0x3f6b7a), { x: -0.2, y: 0.5, rz: Math.PI / 2, parent: g, castShadow: true });
  motor.receiveShadow = true;
  const volute = addMesh(ctx, new THREE.SphereGeometry(0.24, 16, 12), ctx.tex.paintedMetal(0x6b5a3f), { x: 0.25, y: 0.5, parent: g, castShadow: true });
  volute.receiveShadow = true;
  addMesh(ctx, cylinderGeo(0.09, 0.09, 0.5, 10), ctx.tex.rust(), { x: 0.55, y: 0.5, rz: Math.PI / 2, parent: g });
  // pressure gauge
  addBox(ctx, darkSteel(ctx), 0.03, 0.03, 0.16, { x: 0.25, y: 0.78, parent: g });
  const gauge = addMesh(ctx, new THREE.CylinderGeometry(0.09, 0.09, 0.04, 14), plastic(0xd8d4c8), { x: 0.25, y: 0.8, rx: Math.PI / 2, parent: g });
  gauge.rotation.z = 0.4;
  const needle = addBox(ctx, plastic(0x8d1f1f), 0.006, 0.07, 0.006, { x: 0.25, y: 0.81, z: 0.09, parent: g });
  needle.rotation.z = -0.6;
  return g;
}

export function workbench(ctx: BuildCtx, x: number, z: number, w: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const top = addBox(ctx, ctx.tex.rust(), w, 0.06, 0.7, { y: 0.88, parent: g, castShadow: true, collider: true, uvScale: 0.6 });
  top.receiveShadow = true;
  for (const sx of [-1, 1]) {
    addBox(ctx, darkSteel(ctx), 0.05, 0.88, 0.6, { x: sx * (w / 2 - 0.06), parent: g, castShadow: true });
  }
  addBox(ctx, darkSteel(ctx), w - 0.1, 0.04, 0.5, { y: 0.35, parent: g });
  // pegboard
  const peg = addBox(ctx, ctx.tex.paintedMetal(0x4a4d44), w - 0.1, 0.5, 0.02, { y: 1.5, z: -0.3, parent: g, uvScale: 1.2 });
  peg.castShadow = true;
  return g;
}

export function toolWall(ctx: BuildCtx, x: number, y: number, z: number, ry: number): void {
  const items: [number, number, number][] = [
    [0, 0.12, 0],
    [0.11, 0.1, 0],
    [-0.12, 0.16, 0],
    [0.03, -0.12, 0],
  ];
  items.forEach(([ox, oy], i) => {
    const tool = addBox(ctx, i % 2 ? plastic(0x8d3f2a) : plastic(0x2a3f8d), 0.03, 0.05, 0.16, { x: x + ox, y: y + oy, z, parent: undefined, ry });
    tool.castShadow = true;
  });
  const wrench = addMesh(ctx, cylinderGeo(0.012, 0.012, 0.28, 8), plastic(0x9a9da2), { x: x - 0.02, y: y - 0.02, z, rz: 0.4, ry });
  wrench.castShadow = true;
}

export function weldingScreen(ctx: BuildCtx, x: number, z: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const frame = addBox(ctx, darkSteel(ctx), 1.2, 1.4, 0.05, { y: 0.7, parent: g, castShadow: true, collider: true });
  frame.castShadow = true;
  const screen = new THREE.Mesh(
    planeGeo(1.1, 1.3, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a3a3a, roughness: 0.9, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  screen.position.set(0, 0.7, 0.03);
  g.add(screen);
  for (const sx of [-1, 1]) {
    addBox(ctx, darkSteel(ctx), 0.06, 0.06, 0.3, { x: sx * 0.55, y: 0.05, parent: g });
  }
  return g;
}

export function ladderAndHatch(ctx: BuildCtx, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.scene.add(g);
  for (const sx of [-0.22, 0.22]) {
    addBox(ctx, ctx.tex.rust(), 0.05, 3.0, 0.05, { x: sx, y: 1.5, parent: g, castShadow: true });
  }
  for (let i = 0; i < 8; i++) {
    addBox(ctx, ctx.tex.rust(), 0.44, 0.03, 0.03, { y: 0.4 + i * 0.34, parent: g });
  }
  return g;
}

export function fireExtinguisher(ctx: BuildCtx, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  ctx.scene.add(g);
  const body = addMesh(ctx, cylinderGeo(0.08, 0.08, 0.42, 12, 0.8), plastic(0x8d1f1f), { y: 0.21, parent: g, castShadow: true });
  body.receiveShadow = true;
  addMesh(ctx, cylinderGeo(0.03, 0.03, 0.08, 8), plastic(0x1b1e22), { y: 0.45, parent: g });
  addMesh(ctx, new THREE.TorusGeometry(0.05, 0.01, 5, 12), plastic(0x1b1e22), { y: 0.36, rx: Math.PI / 2, parent: g });
  return g;
}

export function wallClock(ctx: BuildCtx, x: number, y: number, z: number, ry: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addMesh(ctx, new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20), plastic(0xd8d4c8), { rx: Math.PI / 2, parent: g, castShadow: true });
  const face = addMesh(ctx, new THREE.CircleGeometry(0.14, 20), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }), { z: 0.028, parent: g });
  face.receiveShadow = true;
  const hour = addBox(ctx, plastic(0x14161a), 0.012, 0.07, 0.004, { y: 0.035, z: 0.032, parent: g });
  hour.rotation.z = -0.9;
  const minute = addBox(ctx, plastic(0x14161a), 0.01, 0.11, 0.004, { y: 0.05, z: 0.034, parent: g });
  minute.rotation.z = 2.2;
  return g;
}

export function rotaryPhone(ctx: BuildCtx, x: number, y: number, z: number, ry: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  addBox(ctx, plastic(0x1b1e22), 0.24, 0.09, 0.16, { parent: g, castShadow: true });
  const dial = addMesh(ctx, new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16), plastic(0x2a2e34), { y: 0.05, parent: g });
  dial.receiveShadow = true;
  const handset = addMesh(ctx, new THREE.BoxGeometry(0.22, 0.04, 0.06), plastic(0x14161a), { y: 0.09, z: 0.02, parent: g });
  handset.castShadow = true;
  return g;
}

/* ------------------------------------------------------------------ */
/* damage & atmosphere                                                 */
/* ------------------------------------------------------------------ */

export function glassShards(ctx: BuildCtx, x: number, z: number, radius: number, count = 40, seed = 3): void {
  const s = makeSeed(seed);
  const mat = shardMaterial();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.position.set(0, 0, 0);
  ctx.scene.add(inst);
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = rand(s) * Math.PI * 2;
    const r = Math.sqrt(rand(s)) * radius;
    d.position.set(x + Math.cos(a) * r, 0.008 + rand(s) * 0.01, z + Math.sin(a) * r);
    d.rotation.set(rand(s) * 0.4 - 0.2, rand(s) * Math.PI, rand(s) * 0.4 - 0.2);
    const sc = 0.02 + rand(s) * 0.06;
    d.scale.set(sc * (0.4 + rand(s)), 0.012, sc);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.receiveShadow = true;
}

export function floorStain(ctx: BuildCtx, x: number, z: number, size: number, color = 0x141a14, opacity = 0.8): THREE.Mesh {
  const m = new THREE.Mesh(
    planeGeo(size, size, 1),
    new THREE.MeshStandardMaterial({
      map: stainMaterial("stain", color, opacity).map,
      color,
      transparent: true,
      opacity,
      roughness: 0.1,
      metalness: 0.05,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.012, z);
  m.scale.set(1, 1, 1);
  ctx.scene.add(m);
  return m;
}

export function fallenCeilingTile(ctx: BuildCtx, x: number, z: number, count = 6, seed = 11): void {
  const s = makeSeed(seed);
  for (let i = 0; i < count; i++) {
    const w = 0.5 + rand(s) * 0.2;
    const tile = addBox(ctx, new THREE.MeshStandardMaterial({ color: 0xb8b4a6, roughness: 0.95 }), w, 0.03, w, {
      x: x + (rand(s) - 0.5) * 1.6,
      z: z + (rand(s) - 0.5) * 1.6,
      y: 0.02 + rand(s) * 0.02,
      ry: rand(s) * Math.PI,
      rx: (rand(s) - 0.5) * 0.1,
      castShadow: true,
      receiveShadow: true,
    });
    tile.material = new THREE.MeshStandardMaterial({ color: 0xa8a496, roughness: 0.95 });
  }
}

export function scatteredPapers(ctx: BuildCtx, x: number, z: number, count = 6, spread = 0.5, seed = 17): void {
  const s = makeSeed(seed);
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(planeGeo(0.21, 0.297, 1), ctx.tex.paper());
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = rand(s) * Math.PI * 2;
    p.position.set(x + (rand(s) - 0.5) * spread, 0.006, z + (rand(s) - 0.5) * spread);
    ctx.scene.add(p);
  }
}

export function cableRun(ctx: BuildCtx, x: number, y: number, z: number, len: number, ry: number, count = 4): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  // tray
  addBox(ctx, darkSteel(ctx), len, 0.04, 0.3, { parent: g, uvScale: 0.5 });
  addBox(ctx, darkSteel(ctx), len, 0.1, 0.02, { z: 0.14, parent: g });
  addBox(ctx, darkSteel(ctx), len, 0.1, 0.02, { z: -0.14, parent: g });
  const s = makeSeed(29);
  const colors = [0x14161a, 0x2a2e34, 0x3a2a20, 0x1a2a2a];
  for (let i = 0; i < count; i++) {
    const c = colors[i % colors.length];
    const cable = addMesh(ctx, new THREE.TorusGeometry(0.03 + i * 0.006, 0.012, 5, 24), plastic(c), {
      y: 0.06 + i * 0.02,
      rx: Math.PI / 2,
      parent: g,
    });
    cable.scale.set(len / 0.2, 1, 1);
    cable.position.y = 0.05 + i * 0.018;
  }
  // hanging slack
  for (let i = 0; i < 3; i++) {
    const slack = addMesh(ctx, new THREE.TorusGeometry(0.09, 0.014, 5, 16), plastic(colors[i]), {
      x: (rand(s) - 0.5) * len * 0.7,
      y: 0.02,
      parent: g,
      rx: Math.PI / 2.4,
      rz: rand(s),
    });
    slack.castShadow = true;
  }
}

export function pipeRun(
  ctx: BuildCtx,
  x: number,
  y: number,
  z: number,
  len: number,
  ry: number,
  radius = 0.07,
): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  ctx.scene.add(g);
  const pipe = addMesh(ctx, cylinderGeo(radius, radius, len, 12, 0.6), ctx.tex.rust(), { rx: Math.PI / 2, parent: g, castShadow: true });
  pipe.receiveShadow = true;
  for (let i = -1; i <= 1; i += 2) {
    const flange = addMesh(ctx, new THREE.TorusGeometry(radius + 0.02, 0.015, 5, 14), darkSteel(ctx), { x: i * (len / 2 - 0.02), rx: Math.PI / 2, parent: g });
    flange.castShadow = true;
  }
  // valve
  const valve = addMesh(ctx, new THREE.SphereGeometry(radius + 0.03, 12, 10), ctx.tex.rust(), { x: len * 0.2, parent: g, castShadow: true });
  valve.receiveShadow = true;
  addMesh(ctx, new THREE.TorusGeometry(radius + 0.05, 0.012, 5, 14), darkSteel(ctx), { x: len * 0.2, rz: Math.PI / 2, parent: g });
  addMesh(ctx, cylinderGeo(0.015, 0.015, 0.22, 8), plastic(0x8d1f1f), { x: len * 0.2, y: radius + 0.12, parent: g });
}

export function dustMotes(ctx: BuildCtx, x: number, y: number, z: number, w: number, h: number, d: number, count = 260): THREE.Points {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const s = makeSeed(97);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = x + (rand(s) - 0.5) * w;
    positions[i * 3 + 1] = y + (rand(s) - 0.5) * h;
    positions[i * 3 + 2] = z + (rand(s) - 0.5) * d;
    speeds[i] = 0.02 + rand(s) * 0.05;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.014,
    map: ctx.tex.dustSprite(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.5,
    sizeAttenuation: true,
    color: 0xbfd4e0,
  });
  const points = new THREE.Points(geo, mat);
  ctx.scene.add(points);
  const base = new Float32Array(positions);
  ctx.anims.push((t) => {
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const ph = i * 0.7;
      arr[i * 3 + 0] = base[i * 3 + 0] + Math.sin(t * speeds[i] + ph) * 0.12;
      arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * speeds[i] * 0.7 + ph * 1.3) * 0.08;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * speeds[i] * 0.8 + ph) * 0.12;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return points;
}

export function lightShaft(
  ctx: BuildCtx,
  x: number,
  z: number,
  topY: number,
  bottomY: number,
  radius: number,
  color = 0xbcd0ff,
  intensity = 0.5,
): THREE.Mesh {
  const h = topY - bottomY;
  const geo = new THREE.CylinderGeometry(radius * 0.35, radius, h, 20, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    map: ctx.tex.shaftSprite(),
    color,
    transparent: true,
    // These are atmosphere, not geometry. Keep them faint enough that the
    // cylinder silhouette never reads as a giant translucent cone.
    opacity: Math.min(0.11, intensity * 0.28),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, bottomY + h / 2, z);
  ctx.scene.add(mesh);
  return mesh;
}

export function organismTendrils(
  ctx: BuildCtx,
  x: number,
  z: number,
  radius: number,
  count = 7,
  seed = 5,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.scene.add(g);
  const s = makeSeed(seed);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(s) * 0.5;
    const r = radius * (0.3 + rand(s) * 0.6);
    const pts: THREE.Vector3[] = [];
    const height = 1.2 + rand(s) * 1.6;
    let cx = Math.cos(a) * r;
    let cz = Math.sin(a) * r;
    for (let j = 0; j <= 6; j++) {
      const t = j / 6;
      pts.push(new THREE.Vector3(cx, t * height, cz));
      cx += (rand(s) - 0.5) * 0.5;
      cz += (rand(s) - 0.5) * 0.5;
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.06 + rand(s) * 0.07, 7, false), ctx.tex.organism());
    tube.castShadow = true;
    tube.receiveShadow = true;
    g.add(tube);
  }
  return g;
}

export function scratchMarks(ctx: BuildCtx, x: number, y: number, z: number, ry: number, w: number, h: number): void {
  const c = createCanvas(256, 256);
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(30,26,24,0.75)";
  g.lineWidth = 2;
  const s = makeSeed(71);
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    let px = 20 + rand(s) * 216;
    let py = 20 + rand(s) * 216;
    g.moveTo(px, py);
    for (let j = 0; j < 4; j++) {
      px += (rand(s) - 0.5) * 60;
      py += (rand(s) - 0.5) * 40;
      g.lineTo(px, py);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    planeGeo(w, h, 1),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, depthWrite: false }),
  );
  m.position.set(x, y, z);
  m.rotation.y = ry;
  ctx.scene.add(m);
}

export function puddle(ctx: BuildCtx, x: number, z: number, size: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(size, 24),
    new THREE.MeshStandardMaterial({ color: 0x0a1014, roughness: 0.03, metalness: 0.55, transparent: true, opacity: 0.85 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.014, z);
  m.receiveShadow = true;
  ctx.scene.add(m);
  return m;
}

export { roundRect, radialSprite };
