import * as THREE from "three";

export type InteractKind = "door" | "breaker" | "keypad" | "monitor" | "terminal" | "flavor" | "tank";

export type Interactable = {
  id: string;
  kind: InteractKind;
  label: string;
  object: THREE.Object3D;
  /** called when the player presses the interact key */
  onUse?: () => void;
  /** called every frame with the distance to the player */
  onProximity?: (dist: number, dt: number) => void;
  enabled?: boolean;
  range?: number;
};

export type AnimFn = (t: number, dt: number) => void;

export type BuildCtx = {
  scene: THREE.Scene;
  tex: TextureLibraryLike;
  /** static world colliders: walls, floors, props */
  colliders: THREE.Box3[];
  /** moving door panel colliders, kept apart so geometry audits can ignore them */
  doorColliders: THREE.Box3[];
  interactables: Interactable[];
  anims: AnimFn[];
  lights: THREE.Light[];
};

// Minimal structural type so props.ts does not need the concrete class.
export type TextureLibraryLike = {
  concreteWall(): THREE.Material;
  concreteFloor(): THREE.Material;
  paintedMetal(color?: number): THREE.Material;
  tileFloor(): THREE.Material;
  rust(): THREE.Material;
  stainless(): THREE.Material;
  checkerPlate(): THREE.Material;
  organism(): THREE.Material;
  paper(): THREE.Material;
  facilityMap(): THREE.Material;
  hazard(): THREE.Material;
  whiteboard(): THREE.Material;
  cork(): THREE.Material;
  crt(kind: "waveform" | "specimen" | "status" | "map" | "static" | "boot"): THREE.Material;
  crtOffMaterial(): THREE.Material;
  glass(tint?: number, opacity?: number): THREE.Material;
  dustSprite(): THREE.Texture;
  glowSprite(): THREE.Texture;
  shaftSprite(): THREE.Texture;
  sign(spec: {
    key: string;
    title: string;
    lines?: string[];
    bg?: string;
    fg?: string;
    accent?: string;
    symbol?: "bio" | "rad" | "bolt" | "arrowL" | "arrowR" | "none";
    width?: number;
    height?: number;
  }): THREE.Material;
};

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** BoxGeometry whose UVs are scaled per-face so tiled textures keep a constant world density. */
export function boxGeo(w: number, h: number, d: number, uvScale = 0.35): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su * uvScale, uv.getY(idx) * sv * uvScale);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function planeGeo(w: number, h: number, uvScale = 0.35): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * h * uvScale);
  }
  uv.needsUpdate = true;
  return geo;
}

export function cylinderGeo(rTop: number, rBot: number, h: number, seg = 16, uvScale = 0.35): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * Math.PI * rBot * 2 * uvScale, uv.getY(i) * h * uvScale);
  }
  uv.needsUpdate = true;
  return geo;
}

export type SolidOptions = {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  collider?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  parent?: THREE.Object3D;
  uvScale?: number;
};

/** Adds a box mesh to the scene and (optionally) a matching AABB collider. */
export function addBox(
  ctx: BuildCtx,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  opts: SolidOptions = {},
): THREE.Mesh {
  const geo = boxGeo(w, h, d, opts.uvScale ?? 0.35);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  mesh.rotation.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
  mesh.castShadow = opts.castShadow ?? false;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  (opts.parent ?? ctx.scene).add(mesh);
  if (opts.collider) {
    ctx.colliders.push(new THREE.Box3().setFromObject(mesh));
  }
  return mesh;
}

export function addMesh(
  ctx: BuildCtx,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  opts: SolidOptions & { colliderRadius?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  mesh.rotation.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
  mesh.castShadow = opts.castShadow ?? false;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  (opts.parent ?? ctx.scene).add(mesh);
  if (opts.collider) {
    if (opts.colliderRadius !== undefined) {
      const r = opts.colliderRadius;
      const p = mesh.position;
      ctx.colliders.push(new THREE.Box3(new THREE.Vector3(p.x - r, p.y - r, p.z - r), new THREE.Vector3(p.x + r, p.y + r, p.z + r)));
    } else {
      ctx.colliders.push(new THREE.Box3().setFromObject(mesh));
    }
  }
  return mesh;
}

export function makeInteractable(
  ctx: BuildCtx,
  def: Omit<Interactable, "enabled"> & { enabled?: boolean },
): Interactable {
  const it: Interactable = { ...def, enabled: def.enabled ?? true };
  ctx.interactables.push(it);
  return it;
}

export function rand(seed: { v: number }): number {
  // xorshift for deterministic scattering
  seed.v ^= seed.v << 13;
  seed.v ^= seed.v >>> 17;
  seed.v ^= seed.v << 5;
  return ((seed.v >>> 0) % 100000) / 100000;
}

export function makeSeed(n: number) {
  return { v: n | 0 || 1 };
}

/* ------------------------------------------------------------------ */
/* small emissive material factory                                     */
/* ------------------------------------------------------------------ */

const emissiveCache = new Map<string, THREE.MeshStandardMaterial>();

export function emissive(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
  const key = `${color}:${intensity}`;
  let m = emissiveCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.5,
      metalness: 0.0,
    });
    emissiveCache.set(key, m);
  }
  return m;
}

export function plainMaterial(color: number, roughness = 0.8, metalness = 0.0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function disposeEmissiveCache() {
  emissiveCache.forEach((m) => m.dispose());
  emissiveCache.clear();
}
