import * as THREE from "three";
import type { TextureLibrary } from "./textures";
import {
  addBox,
  addMesh,
  cylinderGeo,
  emissive,
  makeInteractable,
  planeGeo,
  type BuildCtx,
} from "./gfx";
import * as P from "./props";

/* ------------------------------------------------------------------ */
/* layout constants                                                    */
/* ------------------------------------------------------------------ */

export const H = 3.4; // default ceiling height

export const ROOM = {
  wetLab: { x1: -21, z1: -17, x2: -7, z2: -4 },
  containment: { x1: -7, z1: -17, x2: 7, z2: -4 },
  control: { x1: 7, z1: -17, x2: 21, z2: -4 },
  corridor: { x1: -21, z1: -4, x2: 21, z2: -0.5 },
  hub: { x1: -21, z1: -0.5, x2: 21, z2: 6 },
  airlock: { x1: -21, z1: 6, x2: -7, z2: 17 },
  server: { x1: -7, z1: 6, x2: 7, z2: 17 },
  utility: { x1: 7, z1: 6, x2: 21, z2: 17 },
};

export const ZONES = [
  { name: "AIRLOCK · DECONTAMINATION", ...ROOM.airlock },
  { name: "CENTRAL HUB · SECTOR B", ...ROOM.hub },
  { name: "MAIN CORRIDOR · SECTOR B", ...ROOM.corridor },
  { name: "WET LAB · SPECIMEN PREP", ...ROOM.wetLab },
  { name: "CONTROL ROOM · SECTOR C", ...ROOM.control },
  { name: "CONTAINMENT CHAMBER · SECTOR C", ...ROOM.containment },
  { name: "RECORDS · SERVER", ...ROOM.server },
  { name: "UTILITY · POWER", ...ROOM.utility },
];

type Opening = { center: number; width: number; bottom?: number; top?: number };

/**
 * Inner faces of every wall in the facility (wall thickness is already accounted for).
 * Signs and boards are mounted against these so they can never float or clip.
 */
const F = {
  northZ: -16.75, // north perimeter, room is +Z side
  southZ: 16.75, // south perimeter, room is -Z side
  westX: -20.75, // west perimeter, room is +X side
  eastX: 20.75, // east perimeter, room is -X side
  partNorthZ: -3.85, // z=-4 partition, corridor side faces +Z
  partNorthBackZ: -4.15, // z=-4 partition, north-room side faces -Z
  partHubZ: 5.85, // z=6 partition, hub side faces -Z
  partSouthZ: 6.15, // z=6 partition, south-room side faces +Z
  partCorrZ: -0.35, // z=-0.5 partition, hub side faces +Z
  partCorrBackZ: -0.65, // z=-0.5 partition, corridor side faces +Z
  partWestX: -7.195, // x=-7 partition (north wing), wet-lab side faces -X
  partWestEastX: -6.805, // x=-7 partition (north wing), containment side faces +X
  partEastWestX: 6.805, // x=7 partition (north wing), containment side faces -X
  partEastEastX: 7.195, // x=7 partition (north wing), control side faces +X
  partSouthWestX: -7.17, // x=-7 partition (south wing), airlock side faces -X
  partSouthEastX: -6.83, // x=-7 partition (south wing), server side faces +X
  partUtilWestX: 6.83, // x=7 partition (south wing), server side faces -X
  partUtilEastX: 7.17, // x=7 partition (south wing), utility side faces +X
};

/** Rotation that makes a plane face the given world direction. */
const RY = { "+z": 0, "-z": Math.PI, "+x": Math.PI / 2, "-x": -Math.PI / 2 };

/* ------------------------------------------------------------------ */
/* world handle                                                        */
/* ------------------------------------------------------------------ */

export type Door = {
  id: string;
  setOpen: (v: boolean) => void;
  isOpen: () => boolean;
  locked: boolean;
  autoRange: number;
};

export type WorldHandle = {
  ctx: BuildCtx;
  hooks: {
    sound: ((name: string, arg?: number) => void) | null;
    power: (() => void) | null;
    log: ((id: string) => void) | null;
    seal: (() => void) | null;
    flavor: ((msg: string) => void) | null;
    keypad: ((doorId: string) => void) | null;
  };
  update: (t: number, dt: number) => void;
  doors: Map<string, Door>;
  setPower: (on: boolean) => void;
  power: boolean;
  playerStart: { x: number; z: number; yaw: number };
  zoneAt: (x: number, z: number) => string;
  spawnDrip: (x: number, y: number, z: number) => void;
  dispose: () => void;
};

/* ------------------------------------------------------------------ */
/* shell construction                                                  */
/* ------------------------------------------------------------------ */

function wallRun(
  ctx: BuildCtx,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  material: THREE.Material,
  height: number,
  thickness: number,
  openings: Opening[] = [],
): void {
  const horizontal = Math.abs(z2 - z1) < 0.001;
  const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  const dir = horizontal ? Math.sign(x2 - x1) || 1 : Math.sign(z2 - z1) || 1;
  // `origin` is the world coordinate the wall starts at; opening `center` values are
  // expressed in the SAME absolute world coordinate, never as a local offset.
  const origin = horizontal ? x1 : z1;
  const toLocal = (abs: number) => (dir > 0 ? abs - origin : origin - abs);

  const solid = (start: number, end: number, y0: number, y1: number) => {
    if (end - start <= 0.01 || y1 - y0 <= 0.01) return;
    const mid = (start + end) / 2;
    const size = end - start;
    if (horizontal) {
      addBox(ctx, material, size, y1 - y0, thickness, {
        x: x1 + dir * mid,
        y: (y0 + y1) / 2,
        z: z1,
        collider: true,
        receiveShadow: true,
        uvScale: 0.4,
      });
    } else {
      addBox(ctx, material, thickness, y1 - y0, size, {
        x: x1,
        y: (y0 + y1) / 2,
        z: z1 + dir * mid,
        collider: true,
        receiveShadow: true,
        uvScale: 0.4,
      });
    }
  };

  let cursor = 0;
  for (const o of [...openings].sort((a, b) => a.center - b.center)) {
    let a = toLocal(o.center - o.width / 2);
    let b = toLocal(o.center + o.width / 2);
    if (a > b) [a, b] = [b, a];
    // clamp into the wall run instead of silently discarding the opening
    a = Math.max(0, a);
    b = Math.min(len, b);
    if (b - a < 0.05) continue;
    solid(cursor, a, 0, height);
    solid(a, b, o.top ?? height - 0.2, height);
    solid(a, b, 0, o.bottom ?? 0);
    cursor = b;
  }
  solid(cursor, len, 0, height);
}

function floorRect(
  ctx: BuildCtx,
  material: THREE.Material,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  y = 0.002,
  uvScale = 0.32,
): THREE.Mesh {
  const w = Math.abs(x2 - x1);
  const d = Math.abs(z2 - z1);
  const mesh = new THREE.Mesh(planeGeo(w, d, uvScale), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  return mesh;
}

function ceilRect(
  ctx: BuildCtx,
  material: THREE.Material,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  y: number,
  uvScale = 0.4,
): THREE.Mesh {
  const w = Math.abs(x2 - x1);
  const d = Math.abs(z2 - z1);
  const mesh = new THREE.Mesh(planeGeo(w, d, uvScale), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  return mesh;
}

/** Dark rubber skirt running along the base of a wall. */
function skirt(ctx: BuildCtx, x1: number, z1: number, x2: number, z2: number, h = 0.14): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.95 });
  const horizontal = Math.abs(z2 - z1) < 0.001;
  const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  if (horizontal) {
    addBox(ctx, mat, len, h, 0.02, { x: (x1 + x2) / 2, y: h / 2, z: z1 + (z2 > z1 ? 0.15 : -0.15), uvScale: 0.6 });
  } else {
    addBox(ctx, mat, 0.02, h, len, { x: x1 + (x2 > x1 ? 0.15 : -0.15), y: h / 2, z: (z1 + z2) / 2, uvScale: 0.6 });
  }
}

/* ------------------------------------------------------------------ */
/* main build                                                          */
/* ------------------------------------------------------------------ */

export function buildWorld(scene: THREE.Scene, tex: TextureLibrary): WorldHandle {
  const ctx: BuildCtx = {
    scene,
    tex,
    colliders: [],
    doorColliders: [],
    interactables: [],
    anims: [],
    lights: [],
  };

  const doors = new Map<string, Door>();
  const bootLights: { light: THREE.Light; target: number; delay: number; kind: "on" | "dim"; base: number }[] = [];
  const flickerLights: { light: THREE.PointLight; base: number; rate: number; seed: number }[] = [];
  const beacons: { light: THREE.PointLight; base: number; phase: number }[] = [];
  const tankPulse: { light: THREE.PointLight; mat: THREE.MeshStandardMaterial }[] = [];
  const statusLeds: THREE.Mesh[] = [];
  const drips: { x: number; y: number; z: number }[] = [];
  let power = false;
  let bootT = 0;

  const monitorState = new Map<string, boolean>();
  const terminalState = new Map<string, boolean>();
  const breakerState = new Map<string, boolean>();
  type MonitorUnit = ReturnType<typeof P.crtMonitor>;
  type ScreenKind = "waveform" | "specimen" | "status" | "map" | "static" | "boot" | "off";
  const monitorBoot: { unit: MonitorUnit; kind: ScreenKind }[] = [];
  let termScreen: THREE.Mesh;
  let termLight: THREE.PointLight;

  /** Callbacks the engine installs so the world can talk to audio + UI. */
  const hooks: {
    sound: ((name: string, arg?: number) => void) | null;
    power: (() => void) | null;
    log: ((id: string) => void) | null;
    seal: (() => void) | null;
    flavor: ((msg: string) => void) | null;
    keypad: ((doorId: string) => void) | null;
  } = { sound: null, power: null, log: null, seal: null, flavor: null, keypad: null };

  const sound = (name: string, arg?: number) => hooks.sound?.(name, arg);

  const concrete = tex.concreteWall();
  const concreteFloor = tex.concreteFloor();
  const tileFloor = tex.tileFloor();
  const painted = tex.paintedMetal(0x9a9b90);
  const paintedDark = tex.paintedMetal(0x6f7168);
  const ceilingTile = tex.tileFloor();

  /* ---------------- floors ---------------- */
  floorRect(ctx, tileFloor, -21, -17, 21, -4, 0.002, 0.3); // north wing
  floorRect(ctx, tileFloor, -21, -4, 21, 6, 0.002, 0.3); // corridor + hub
  floorRect(ctx, concreteFloor, -21, 6, -7, 17, 0.002, 0.4); // airlock
  floorRect(ctx, tex.checkerPlate(), -7, 6, 7, 17, 0.002, 0.45); // server raised floor
  floorRect(ctx, tex.checkerPlate(), 7, 6, 21, 17, 0.002, 0.45); // utility
  floorRect(ctx, concreteFloor, -7, -17, 7, -4, 0.002, 0.4); // containment

  /* ---------------- ceilings ---------------- */
  ceilRect(ctx, ceilingTile, -21, -17, -7, -4, H, 0.5);
  ceilRect(ctx, ceilingTile, 7, -17, 21, -4, H, 0.5);
  // corridor ceiling with two collapsed sections
  ceilRect(ctx, ceilingTile, -21, -4, -8, -0.5, H, 0.5);
  ceilRect(ctx, ceilingTile, -3, -4, 4, -0.5, H, 0.5);
  ceilRect(ctx, ceilingTile, 9, -4, 21, -0.5, H, 0.5);
  // hub ceiling with a large collapse over the middle
  ceilRect(ctx, ceilingTile, -21, -0.5, -12, 6, H, 0.5);
  ceilRect(ctx, ceilingTile, -2, -0.5, 3, 6, H, 0.5);
  ceilRect(ctx, ceilingTile, 12, -0.5, 21, 6, H, 0.5);
  // airlock ceiling
  ceilRect(ctx, concrete, -21, 6, -7, 17, 2.9, 0.5);
  // server ceiling (low, full of tray)
  ceilRect(ctx, paintedDark, -7, 6, 7, 17, 2.55, 0.5);
  // utility ceiling
  ceilRect(ctx, concrete, 7, 6, 21, 17, 3.1, 0.5);
  // containment ceiling
  ceilRect(ctx, concrete, -7, -17, 7, -4, 4.0, 0.5);

  // dark voids above the collapsed ceiling sections
  const voidMat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1 });
  addBox(ctx, voidMat, 5, 1.2, 3.4, { x: -5.5, y: H + 0.5, z: -2.25, uvScale: 1 });
  addBox(ctx, voidMat, 7, 1.2, 3.4, { x: 7, y: H + 0.5, z: -2.25, uvScale: 1 });
  addBox(ctx, voidMat, 14, 1.2, 6.4, { x: 0.5, y: H + 0.5, z: 2.75, uvScale: 1 });

  /* ---------------- perimeter walls ---------------- */
  wallRun(ctx, -21, -17, 21, -17, concrete, H + 0.3, 0.5);
  wallRun(ctx, -21, 17, 21, 17, concrete, H + 0.3, 0.5);
  wallRun(ctx, -21, -17, -21, 17, concrete, H + 0.3, 0.5, [{ center: 13.5, width: 3.0, bottom: 0, top: 2.7 }]);
  wallRun(ctx, 21, -17, 21, 17, concrete, H + 0.3, 0.5);

  /* ---------------- interior partitions ---------------- */
  // north wing / corridor
  wallRun(ctx, -21, -4, -7, -4, painted, H, 0.3, [{ center: -16, width: 1.6, bottom: 0, top: 2.25 }]);
  wallRun(ctx, -7, -4, 7, -4, paintedDark, H, 0.35, [{ center: 0, width: 2.6, bottom: 0, top: 2.7 }]);
  wallRun(ctx, 7, -4, 21, -4, painted, H, 0.3, [{ center: 14, width: 1.6, bottom: 0, top: 2.25 }]);
  // containment | control : observation window
  wallRun(ctx, 7, -17, 7, -4, paintedDark, H, 0.35, [{ center: -9.5, width: 6.2, bottom: 1.15, top: 2.55 }]);
  // wetlab | containment
  wallRun(ctx, -7, -17, -7, -4, paintedDark, H, 0.35);
  // corridor | hub : two archways
  wallRun(ctx, -21, -0.5, 21, -0.5, painted, H, 0.3, [
    { center: -6, width: 6.0, bottom: 0, top: 2.85 },
    { center: 6, width: 6.0, bottom: 0, top: 2.85 },
  ]);
  // hub | south rooms
  wallRun(ctx, -21, 6, -7, 6, painted, H, 0.3, [{ center: -16, width: 1.6, bottom: 0, top: 2.25 }]);
  wallRun(ctx, -7, 6, 7, 6, painted, H, 0.3, [{ center: 0, width: 1.6, bottom: 0, top: 2.25 }]);
  wallRun(ctx, 7, 6, 21, 6, painted, H, 0.3, [{ center: 14, width: 1.6, bottom: 0, top: 2.25 }]);
  wallRun(ctx, -7, 6, -7, 17, painted, H, 0.3);
  wallRun(ctx, 7, 6, 7, 17, painted, H, 0.3);

  // skirts along the main interior walls
  skirt(ctx, -21, -0.5, 21, -0.5);
  skirt(ctx, -21, 6, -7, 6);
  skirt(ctx, -7, 6, 7, 6);
  skirt(ctx, 7, 6, 21, 6);

  /* ---------------- doors ---------------- */
  const mkDoor = (
    id: string,
    door: ReturnType<typeof P.hingedDoor> | ReturnType<typeof P.blastDoor>,
    autoRange: number,
  ) => {
    const d: Door = {
      id,
      setOpen: door.setOpen,
      isOpen: door.isOpen,
      locked: false,
      autoRange,
    };
    doors.set(id, d);
    return d;
  };

  const liftDoor = P.blastDoor(ctx, -21, 0, 13.5, 3.0, 2.7, { ry: Math.PI / 2, color: 0x5a5d55 });
  mkDoor("lift", liftDoor, 2.2).locked = true;

  const airlockDoor = P.hingedDoor(ctx, -16, 6, 0, 1.6, 2.25, { ry: 0, color: 0x7d7f74, window: true });
  mkDoor("airlock", airlockDoor, 2.6);

  const utilityDoor = P.hingedDoor(ctx, 14, 6, 0, 1.6, 2.25, { ry: 0, color: 0x6f6a55 });
  mkDoor("utility", utilityDoor, 2.6);

  const wetLabDoor = P.hingedDoor(ctx, -16, -4, 0, 1.6, 2.25, { ry: Math.PI, color: 0x8a8b80, window: true });
  mkDoor("wetlab", wetLabDoor, 2.6);

  const controlDoor = P.hingedDoor(ctx, 14, -4, 0, 1.6, 2.25, { ry: Math.PI, color: 0x8a8b80, window: true });
  mkDoor("control", controlDoor, 2.6);

  const serverDoor = P.hingedDoor(ctx, 0, 6, 0, 1.6, 2.25, { ry: 0, color: 0x5f6b5a, window: false });
  mkDoor("server", serverDoor, 2.6).locked = true;

  const containmentDoor = P.blastDoor(ctx, 0, 0, -4, 2.6, 2.7, { ry: 0, color: 0x63665d });
  mkDoor("containment", containmentDoor, 3.0).locked = true;

  // door frames
  const frameMat = tex.paintedMetal(0x4a4c45);
  const frame = (x: number, z: number, ry: number, w: number, h: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    for (const sx of [-1, 1]) {
      addBox(ctx, frameMat, 0.1, h, 0.36, { x: sx * (w / 2 + 0.05), y: h / 2, parent: g, uvScale: 0.6 });
    }
    addBox(ctx, frameMat, w + 0.24, 0.12, 0.36, { y: h + 0.06, parent: g, uvScale: 0.6 });
  };
  frame(-16, 6, 0, 1.6, 2.25);
  frame(14, 6, 0, 1.6, 2.25);
  frame(-16, -4, 0, 1.6, 2.25);
  frame(14, -4, 0, 1.6, 2.25);
  frame(0, 6, 0, 1.6, 2.25);
  frame(0, -4, 0, 2.6, 2.7);


  /* ================= doorway signage ================= */
  {
    // above each door, on the face the player actually approaches from
    P.wallSign(ctx, { key: "d-airlock", title: "Airlock", symbol: "arrowR", bg: "#c8c2b2" }, -16, 2.57, F.partHubZ, RY["-z"], 0.96, 0.44);
    P.wallSign(ctx, { key: "d-records", title: "Records", symbol: "arrowR", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, 0, 2.57, F.partHubZ, RY["-z"], 0.96, 0.44);
    P.wallSign(ctx, { key: "d-utility", title: "Utility", symbol: "arrowR", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, 14, 2.57, F.partHubZ, RY["-z"], 0.96, 0.44);
    P.wallSign(ctx, { key: "d-wetlab", title: "Wet lab", symbol: "arrowL", bg: "#c8c2b2" }, -16, 2.57, F.partNorthZ, RY["+z"], 0.96, 0.44);
    // The cable tray crosses directly above the containment aperture. Keep this plaque
    // on solid wall to the left so it remains readable from the corridor.
    P.wallSign(ctx, { key: "d-contain", title: "Containment", symbol: "arrowR", bg: "#a8382c", fg: "#f0e8d8", accent: "#f0e8d8" }, -2.25, 2.36, F.partNorthZ, RY["+z"], 1.28, 0.5);
    P.wallSign(ctx, { key: "d-control", title: "Control", symbol: "arrowR", bg: "#c8c2b2" }, 14, 2.57, F.partNorthZ, RY["+z"], 0.96, 0.44);
    // archway lintels between the corridor and the hub
    P.wallSign(ctx, { key: "d-hub-l", title: "Main corridor", symbol: "arrowL", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, -6, 3.08, F.partCorrZ, RY["+z"], 1.4, 0.4);
    P.wallSign(ctx, { key: "d-hub-r", title: "Main corridor", symbol: "arrowR", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, 6, 3.08, F.partCorrZ, RY["+z"], 1.4, 0.4);
  }

  /* ================= AIRLOCK ================= */
  {
    // decon stalls along the west wall
    for (let i = 0; i < 3; i++) {
      P.deconStall(ctx, -20.2, 7.4 + i * 1.25, -Math.PI / 2);
    }
    P.lockerBank(ctx, -10.5, 16.6, Math.PI, 4, 1);
    P.foldingChair(ctx, -12.6, 12.4, 0.6, true);
    P.mopBucket(ctx, -18.6, 11.2);
    P.crate(ctx, -9.2, 8.6, 0.9, 0.8, 0.7, -0.2, "SUITS");
    P.crate(ctx, -8.3, 9.6, 0.7, 0.6, 0.6, 0.4, "MED");
    P.puddle(ctx, -19.0, 12.0, 0.9);
    P.floorStain(ctx, -14, 10.5, 3.0, 0x10160f, 0.5);
    P.fallenCeilingTile(ctx, -13, 8.4, 4, 23);
    P.scatteredPapers(ctx, -15.5, 14.5, 7, 1.2, 31);
    P.scatteredPapers(ctx, -10, 15.6, 5, 1.0, 37);

    // hazard markings on the floor
    const haz = new THREE.Mesh(planeGeo(3.0, 1.1, 1), tex.hazard());
    haz.rotation.x = -Math.PI / 2;
    haz.position.set(-16, 0.011, 9.6);
    scene.add(haz);

    P.wallSign(ctx, { key: "s1", title: "Decontamination", lines: ["Stage 1 · Suit required"], symbol: "bio", bg: "#c9a21c", fg: "#1b1a18", accent: "#1b1a18" }, F.westX, 2.15, 8.4, RY["+x"], 1.35, 0.68);
    // The lift occupies the wall opening at z=13.5; mounting a sign there embeds it
    // in the blast door. Put the warning on clear wall beside the opening instead.
    P.wallSign(ctx, { key: "s3", title: "Lift shaft sealed", lines: ["Emergency bulkhead · no access"], symbol: "bolt", bg: "#a8382c", fg: "#f0e8d8", accent: "#f0e8d8" }, F.westX, 2.18, 11.15, RY["+x"], 1.22, 0.58);
    P.roomStencil(ctx, "3-A", -14.85, 2.3, F.partHubZ, RY["-z"]);
    P.scratchMarks(ctx, -20.85, 1.5, 10.4, Math.PI / 2, 2.0, 1.2);

    // emergency lighting
    const em = P.emergencyLight(ctx, -14, 2.75, 9.0, 0xffaa33);
    const em2 = P.emergencyLight(ctx, -19, 2.75, 15.4, 0xffaa33);
    flickerLights.push({ light: em.light, base: 20, rate: 5.5, seed: 1.2 });
    flickerLights.push({ light: em2.light, base: 14, rate: 3.1, seed: 4.4 });
    P.emergencyLight(ctx, -20.2, 2.78, 9.0, 0xffaa33);
    const dead = P.fluorescentFixture(ctx, -12.5, 12.0, 2.78, 2.4, true);
    dead.tube.material = emissive(0x1a2028, 0.05);
    const emLight = new THREE.PointLight(0x2a3a52, 3.0, 10, 2);
    emLight.position.set(-12.5, 2.5, 12.0);
    scene.add(emLight);
    P.dustMotes(ctx, -14, 1.6, 11.5, 12, 2.4, 9, 180);
  }

  /* ================= HUB ================= */
  {
    // facility plan on a floor-standing post, facing east down the hub
    addBox(ctx, tex.paintedMetal(0x3a3d38), 0.09, 2.1, 0.09, { x: -18.75, y: 1.05, z: 2.7, collider: true, castShadow: true, uvScale: 0.5 });
    addBox(ctx, tex.paintedMetal(0x33363a), 0.95, 0.06, 0.07, { x: -18.29, y: 2.02, z: 2.7, collider: true, castShadow: true });
    P.mountedBoard(ctx, tex.facilityMap(), -17.78, 2.02, 2.7, RY["+x"], 1.12, 1.12, { frameColor: 0x2f322e });

    P.trolleyCart(ctx, -13.5, 3.4, 0.3);
    P.crate(ctx, 17.5, 3.6, 0.8, 0.7, 0.7, -0.15, "GLASSWARE");
    P.fallenCeilingTile(ctx, 0.5, 2.7, 10, 53);
    P.scatteredPapers(ctx, -4, 1.2, 8, 1.4, 41);
    P.scatteredPapers(ctx, 6, 3.0, 7, 1.2, 43);

    // collapsed ceiling: exposed beams, rebar, hanging cables
    for (let i = 0; i < 4; i++) {
      const beam = addBox(ctx, ctx.tex.rust(), 14, 0.16, 0.16, { x: 0.5, y: 2.95, z: 1.0 + i * 0.6, rx: 0.06, castShadow: true });
      beam.castShadow = true;
    }
    for (let i = 0; i < 7; i++) {
      const rebar = addMesh(ctx, cylinderGeo(0.014, 0.014, 1.1 + (i % 3) * 0.4, 6), ctx.tex.rust(), {
        x: -5 + i * 1.8,
        y: 3.05,
        z: 1.4 + (i % 2) * 2.2,
        rz: (i % 2 ? 1 : -1) * 0.25,
        castShadow: true,
      });
      rebar.castShadow = true;
    }
    P.cableRun(ctx, 0.5, 3.1, 3.4, 12, 0, 5);
    P.cableRun(ctx, 0.5, 2.4, 4.2, 3.5, Math.PI / 2, 3);
    P.pipeRun(ctx, -19.5, 3.05, 2.7, 5.0, 0, 0.06);
    P.pipeRun(ctx, 19.5, 3.05, 2.7, 5.0, Math.PI, 0.06);

    // Entire plaque sits on solid partition instead of bleeding into the arch opening.
    P.wallSign(ctx, { key: "s4", title: "Sector C · Containment", lines: ["Authorised personnel only"], symbol: "bio", bg: "#c8c2b2", accent: "#8d1f1f" }, 10.6, 2.2, F.partCorrZ, RY["+z"], 1.25, 0.62);
    P.roomStencil(ctx, "3-B", -18.4, 2.3, F.partHubZ, RY["-z"]);

    // lighting
    P.fluorescentFixture(ctx, -14, 2.7, 2.75, 2.4);
    const fx2 = P.fluorescentFixture(ctx, 0.5, 2.7, 2.75, 2.4);
    P.fluorescentFixture(ctx, 15, 2.7, 2.75, 2.4);
    flickerLights.push({ light: fx2.light, base: 30, rate: 7.0, seed: 0.4 });
    const beacon = P.emergencyLight(ctx, 10.5, 2.9, 5.6, 0xff3322);
    beacons.push({ light: beacon.light, base: 14, phase: 0 });
    P.dustMotes(ctx, 0.5, 1.7, 2.7, 24, 2.6, 5.5, 320);
    P.lightShaft(ctx, -6.5, 2.7, 3.35, 0.0, 2.4, 0x9fb8e0, 0.35);
    P.lightShaft(ctx, 7.0, 2.7, 3.35, 0.0, 2.4, 0x9fb8e0, 0.3);
  }

  /* ================= CORRIDOR ================= */
  {
    // fixtures
    const xs = [-18, -12.5, -7, -1.5, 4, 9.5, 15, 19.5];
    xs.forEach((x, i) => {
      const dead = i === 3 || i === 6;
      const f = P.fluorescentFixture(ctx, x, -2.25, 3.15, 2.4, dead);
      if (dead) {
        f.tube.material = emissive(0x1a2028, 0.04);
      } else if (i === 5) {
        flickerLights.push({ light: f.light, base: 29, rate: 9.0, seed: 2.1 });
      }
    });
    // cable tray + pipes along the north wall
    P.cableRun(ctx, 0, 3.0, -3.65, 40, 0, 6);
    P.pipeRun(ctx, 0, 2.85, -3.75, 40, 0, 0.08);
    P.pipeRun(ctx, 0, 2.7, -3.85, 40, 0, 0.05);
    // wall gauges and a horn
    const horn = addBox(ctx, tex.paintedMetal(0x8d1f1f), 0.22, 0.16, 0.16, { x: -9.5, y: 2.6, z: -3.8, castShadow: true });
    horn.castShadow = true;
    P.wallSign(ctx, { key: "s8", title: "Sector B", lines: ["Sub-level 3"], symbol: "none", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, F.westX, 2.35, -2.25, RY["+x"], 1.0, 0.5);
    // Dedicated doorway plaques above already identify Wet Lab and Control.
    P.roomStencil(ctx, "3-B", -18.4, 2.3, F.partNorthZ, RY["+z"]);

    // fallen tiles + debris
    P.fallenCeilingTile(ctx, -8.5, -2.2, 5, 61);
    P.fallenCeilingTile(ctx, 7.5, -2.2, 5, 67);
    P.floorStain(ctx, -10.5, -1.4, 2.4, 0x1a1c18, 0.6);
    P.floorStain(ctx, 11.0, -3.2, 2.0, 0x1a1c18, 0.5);
    P.scatteredPapers(ctx, -12, -3.2, 4, 1.0, 71);
    P.fireExtinguisher(ctx, 18.4, 1.0, -3.6);

    const red1 = P.emergencyLight(ctx, -3.5, 2.95, -3.6, 0xff3322);
    const red2 = P.emergencyLight(ctx, 12.5, 2.95, -3.6, 0xff3322);
    beacons.push({ light: red1.light, base: 11, phase: 1.1 });
    beacons.push({ light: red2.light, base: 11, phase: 2.7 });
    P.dustMotes(ctx, 0, 1.8, -2.25, 40, 2.6, 3.2, 300);
  }

  /* ================= WET LAB ================= */
  {
    P.labBench(ctx, -14.5, -14.8, 5.4, 0.8, 0);
    P.labBench(ctx, -14.5, -12.2, 5.4, 0.8, 0);
    P.fumeHood(ctx, -19.2, -15.0, Math.PI / 2);
    P.shelfRack(ctx, -19.0, -10.5, 3.0, Math.PI / 2, 4);
    P.reagentBottles(ctx, -19.0, 2.25, -10.5, 8, 13);
    P.reagentBottles(ctx, -14.5, 0.94, -14.8, 7, 19);
    P.labBench(ctx, -9.5, -14.5, 3.0, 0.8, Math.PI / 2);
    P.stool(ctx, -12.4, -14.6, 0.4, true);
    P.stool(ctx, -16.6, -12.4, -0.3);
    P.filingCabinet(ctx, -19.0, -6.4, Math.PI / 2, true);
    P.trolleyCart(ctx, -9.0, -8.0, -0.4);
    P.glassShards(ctx, -12.5, -12.6, 1.5, 60, 83);
    P.floorStain(ctx, -12.8, -13.0, 2.6, 0x14301f, 0.55);
    P.floorStain(ctx, -18.6, -12.0, 1.8, 0x2a1a30, 0.4);
    P.scatteredPapers(ctx, -11.0, -15.5, 6, 1.4, 83);
    P.crate(ctx, -8.2, -6.0, 0.8, 0.7, 0.7, 0.2, "CULTURE");

    // sink with a dripping tap
    const sink = addBox(ctx, tex.stainless(), 0.7, 0.16, 0.5, { x: -19.0, y: 0.86, z: -12.4, castShadow: true, uvScale: 0.6 });
    sink.receiveShadow = true;
    addBox(ctx, tex.paintedMetal(0x6f7168), 0.03, 0.3, 0.03, { x: -19.0, y: 1.05, z: -12.2 });
    const tap = addMesh(ctx, cylinderGeo(0.016, 0.016, 0.18, 8), tex.stainless(), { x: -19.0, y: 1.1, z: -12.2, rx: Math.PI / 2 });
    tap.rotation.z = 0;
    drips.push({ x: -19.0, y: 1.0, z: -12.15 });

    // whiteboard (with the door code) on the north wall
    P.mountedBoard(ctx, tex.whiteboard(), -11.0, 1.7, F.northZ, RY["+z"], 1.55, 0.97);

    // safety shower
    addMesh(ctx, cylinderGeo(0.16, 0.16, 0.05, 14), tex.stainless(), { x: -9.2, y: 2.2, z: -16.6, rx: Math.PI / 2 });
    addMesh(ctx, cylinderGeo(0.02, 0.02, 0.3, 8), tex.stainless(), { x: -9.2, y: 2.05, z: -16.6 });
    addBox(ctx, tex.paintedMetal(0x8d1f1f), 0.06, 0.2, 0.06, { x: -9.05, y: 2.15, z: -16.6 });

    // microscope on a bench, slide left out
    const scopeBase = addMesh(ctx, cylinderGeo(0.06, 0.09, 0.04, 14), tex.paintedMetal(0x2a2d31), { x: -13.2, y: 0.94, z: -14.6, castShadow: true });
    scopeBase.receiveShadow = true;
    addBox(ctx, tex.paintedMetal(0x2a2d31), 0.05, 0.3, 0.1, { x: -13.2, y: 1.1, z: -14.5 });
    const tube = addMesh(ctx, cylinderGeo(0.025, 0.025, 0.24, 10), tex.paintedMetal(0x2a2d31), { x: -13.2, y: 1.18, z: -14.6, rx: 0.15 });
    tube.castShadow = true;
    const slide = addBox(ctx, tex.glass(0xd8e8f0, 0.3), 0.06, 0.004, 0.03, { x: -12.9, y: 0.95, z: -14.4 });
    slide.castShadow = false;

    // centrifuge
    const cent = addBox(ctx, tex.paintedMetal(0x3a3d38), 0.36, 0.24, 0.34, { x: -11.6, y: 1.06, z: -14.4, castShadow: true });
    cent.receiveShadow = true;
    addMesh(ctx, cylinderGeo(0.1, 0.1, 0.02, 14), tex.paintedMetal(0x22252a), { x: -11.6, y: 1.19, z: -14.4 });
    P.reagentBottles(ctx, -11.6, 1.2, -14.4, 2, 29);

    P.wallSign(ctx, { key: "s11", title: "Biohazard level 3", lines: ["Protective clothing beyond this point"], symbol: "bio", bg: "#c8c2b2", accent: "#8d1f1f" }, -14.0, 2.25, F.northZ, RY["+z"], 1.35, 0.68);
    P.wallSign(ctx, { key: "s12", title: "Specimen prep", symbol: "none", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, F.partWestX, 2.2, -14.5, RY["-x"], 0.95, 0.48);
    P.roomStencil(ctx, "3-C1", -14.85, 2.3, F.partNorthZ, RY["+z"]);
    P.scratchMarks(ctx, -19.85, 1.4, -8.6, Math.PI / 2, 1.6, 1.0);

    P.fluorescentFixture(ctx, -13.5, -12.5, 3.15, 2.4);
    const f2 = P.fluorescentFixture(ctx, -17.5, -8.0, 3.15, 2.4);
    flickerLights.push({ light: f2.light, base: 27, rate: 11.0, seed: 3.3 });
    const bench = new THREE.PointLight(0xbfd8ff, 13, 9, 2);
    bench.position.set(-14.5, 2.4, -14.8);
    scene.add(bench);
    bootLights.push({ light: bench, target: 13, delay: 0.9, kind: "dim", base: 2.5 });
    P.dustMotes(ctx, -14, 1.8, -11, 12, 2.6, 10, 240);
    P.lightShaft(ctx, -13.5, -12.5, 3.2, 0.0, 2.2, 0xbcd0ff, 0.22);
  }

  /* ================= CONTAINMENT ================= */
  {
    // raised platform
    const plat = addBox(ctx, concreteFloor, 8.0, 0.22, 7.0, { x: 0, y: 0.11, z: -11.5, receiveShadow: true, uvScale: 0.5 });
    plat.receiveShadow = true;
    addBox(ctx, tex.paintedMetal(0x4a4c45), 8.0, 0.06, 0.1, { x: 0, y: 0.25, z: -8.05 });
    addBox(ctx, tex.paintedMetal(0x4a4c45), 8.0, 0.06, 0.1, { x: 0, y: 0.25, z: -14.95 });

    // the specimen tank
    const tank = new THREE.Group();
    tank.position.set(0, 0.22, -11.5);
    scene.add(tank);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = addBox(ctx, tex.paintedMetal(0x3f423c), 0.16, 0.5, 0.16, { x: Math.cos(a) * 1.25, z: Math.sin(a) * 1.25, y: 0.25, parent: tank, castShadow: true });
      leg.castShadow = true;
    }
    const shell = addMesh(ctx, cylinderGeo(1.55, 1.6, 3.5, 28, 0.5), tex.glass(0xa8ccd8, 0.17), { y: 1.9, parent: tank });
    shell.castShadow = false;
    // the tank itself is solid - approximated with a box so the player cannot walk into it
    addBox(ctx, concreteFloor, 3.1, 3.6, 3.1, {
      x: 0,
      y: 0.22 + 1.85,
      z: -11.5,
      collider: true,
      castShadow: false,
      receiveShadow: false,
      uvScale: 0.2,
    });
    const liquid = addMesh(ctx, cylinderGeo(1.5, 1.5, 2.9, 28, 0.5), new THREE.MeshStandardMaterial({
      color: 0x1c4a4e, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.88,
      emissive: 0x0a2a2c, emissiveIntensity: 0.5,
    }), { y: 1.6, parent: tank });
    liquid.receiveShadow = true;
    for (const y of [0.35, 1.9, 3.45]) {
      addMesh(ctx, new THREE.TorusGeometry(1.62, 0.05, 8, 28), tex.paintedMetal(0x55584f), { y, rx: Math.PI / 2, parent: tank, castShadow: true });
    }
    addMesh(ctx, cylinderGeo(1.62, 1.62, 0.14, 28, 0.5), tex.paintedMetal(0x55584f), { y: 3.68, parent: tank, castShadow: true });
    addMesh(ctx, cylinderGeo(1.58, 1.58, 0.12, 28, 0.5), tex.paintedMetal(0x3f423c), { y: 0.32, parent: tank });

    // the specimen inside
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x8a4a3e, emissive: 0x6a2010, emissiveIntensity: 1.3, roughness: 0.4, metalness: 0.0,
    });
    const core = addMesh(ctx, new THREE.IcosahedronGeometry(0.62, 2), coreMat, { y: 1.55, parent: tank, castShadow: true });
    core.scale.set(1.3, 0.85, 1.1);
    const tendrils = P.organismTendrils(ctx, 0, -11.5, 1.1, 9, 91);
    tendrils.position.y = 0.22;

    const tankLight = new THREE.PointLight(0xff6a3c, 0.0, 9, 2);
    tankLight.position.set(0, 1.8, -11.5);
    scene.add(tankLight);
    tankPulse.push({ light: tankLight, mat: coreMat });

    // cracks in the glass
    P.scratchMarks(ctx, 1.45, 2.3, -11.5, -Math.PI / 2, 1.4, 1.4);
    P.scratchMarks(ctx, -1.5, 1.4, -11.5, Math.PI / 2, 1.2, 1.2);
    // shards on the platform
    P.glassShards(ctx, 1.9, -10.4, 1.1, 30, 101);

    // Reinforced observation opening between Control and Containment. The structural
    // frame survives; most of the glass does not. This gives the chamber a deliberate
    // architectural focal point instead of reading like a random hole in the wall.
    const obsFrameMat = tex.paintedMetal(0x34383a);
    for (const z of [-12.6, -9.5, -6.4]) {
      addBox(ctx, obsFrameMat, 0.2, 1.52, 0.12, { x: 7.0, y: 1.85, z, castShadow: true, uvScale: 0.45 });
    }
    addBox(ctx, obsFrameMat, 0.2, 0.12, 6.2, { x: 7.0, y: 1.15, z: -9.5, castShadow: true, uvScale: 0.45 });
    addBox(ctx, obsFrameMat, 0.2, 0.12, 6.2, { x: 7.0, y: 2.55, z: -9.5, castShadow: true, uvScale: 0.45 });

    // A few pieces remain in the failed pane; the rest is on the floor.
    for (let i = 0; i < 5; i++) {
      const shard = new THREE.Mesh(planeGeo(0.5 + i * 0.12, 0.4 + (i % 2) * 0.2, 1), tex.glass(0xa8ccd8, 0.1));
      shard.position.set(7.0, 1.75 + (i % 2) * 0.15, -12.4 + i * 0.35);
      shard.rotation.y = -Math.PI / 2;
      shard.rotation.x = (i % 3) * 0.12 - 0.1;
      scene.add(shard);
    }
    P.glassShards(ctx, 5.6, -9.4, 1.6, 45, 103);

    // restraint harness on the floor
    const harness = new THREE.Group();
    harness.position.set(-2.6, 0.02, -8.6);
    scene.add(harness);
    addBox(ctx, tex.paintedMetal(0x2a2d31), 0.9, 0.04, 0.06, { parent: harness, castShadow: true });
    addBox(ctx, tex.paintedMetal(0x2a2d31), 0.9, 0.04, 0.06, { z: 0.5, parent: harness, castShadow: true });
    for (const z of [0, 0.5]) {
      for (const x of [-0.45, 0.45]) {
        addBox(ctx, tex.paintedMetal(0x2a2d31), 0.05, 0.05, 0.05, { x, z, parent: harness });
      }
    }

    // cables from the wall to the tank
    for (let i = 0; i < 3; i++) {
      const cable = addMesh(ctx, new THREE.TorusGeometry(1.4 + i * 0.3, 0.03, 6, 30, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.9 }), {
        x: 6.2, y: 0.6 + i * 0.5, z: -9.5 + i * 0.4, rz: 0.4 + i * 0.2,
      });
      cable.castShadow = true;
    }

    // control pedestal + terminal
    const ped = addBox(ctx, tex.paintedMetal(0x3f423c), 0.7, 0.95, 0.5, { x: -3.4, y: 0.475, z: -8.6, castShadow: true, collider: true });
    ped.receiveShadow = true;
    addBox(ctx, tex.paintedMetal(0x22252a), 0.74, 0.05, 0.54, { x: -3.4, y: 0.98, z: -8.6 });
    const term = addBox(ctx, tex.paintedMetal(0x14171a), 0.44, 0.3, 0.06, { x: -3.4, y: 1.2, z: -8.42, rx: -0.25, castShadow: true });
    term.receiveShadow = true;
    termScreen = new THREE.Mesh(planeGeo(0.38, 0.24, 1), tex.crtOffMaterial());
    termScreen.position.set(-3.4, 1.23, -8.38);
    termScreen.rotation.x = -0.25;
    scene.add(termScreen);
    termLight = new THREE.PointLight(0xffb257, 0.0, 3.0, 2);
    termLight.position.set(-3.4, 1.35, -8.2);
    scene.add(termLight);

    P.wallSign(ctx, { key: "s13", title: "Containment · Level 4", lines: ["No entry · seal breach protocol"], symbol: "bio", bg: "#a8382c", fg: "#f0e8d8", accent: "#f0e8d8" }, 0, 2.65, F.northZ, RY["+z"], 1.55, 0.78);
    P.wallSign(ctx, { key: "s14", title: "44-B", lines: ["Do not disturb"], symbol: "none", bg: "#c8c2b2" }, F.partWestEastX, 2.45, -9.5, RY["+x"], 0.8, 0.4);
    P.roomStencil(ctx, "3-C", -1.05, 2.4, F.partNorthZ, RY["+z"]);
    P.scratchMarks(ctx, 0, 1.6, -16.85, 0, 4.0, 1.4);
    P.scratchMarks(ctx, -6.85, 1.3, -13.0, Math.PI / 2, 1.6, 1.2);

    // beacons
    const b1 = P.emergencyLight(ctx, -6.2, 3.5, -5.0, 0xff3322);
    const b2 = P.emergencyLight(ctx, 6.2, 3.5, -5.0, 0xff3322);
    const b3 = P.emergencyLight(ctx, 0, 3.5, -16.0, 0xff3322, Math.PI);
    beacons.push({ light: b1.light, base: 18, phase: 0 });
    beacons.push({ light: b2.light, base: 18, phase: 1.6 });
    beacons.push({ light: b3.light, base: 13, phase: 3.1 });

    // work light that comes on with power
    const work = new THREE.SpotLight(0xdfe8ff, 0.0, 14, 0.9, 0.45, 1.6);
    work.position.set(0, 3.8, -11.5);
    work.target.position.set(0, 0.6, -11.5);
    scene.add(work);
    scene.add(work.target);
    work.castShadow = true;
    work.userData.wantsShadow = true;
    work.shadow.mapSize.set(1024, 1024);
    work.shadow.bias = -0.0015;
    bootLights.push({ light: work, target: 72, delay: 1.4, kind: "on", base: 10 });

    // cold permanent fill: the chamber is visible from the doorway, then the work
    // light slams on when the buses come up
    const chamberFill = new THREE.PointLight(0x7f96c8, 9, 24, 2);
    chamberFill.position.set(0, 3.3, -10.5);
    scene.add(chamberFill);
    // two dim corner fills so the shell of the room is legible from the doorway
    const cornerA = new THREE.PointLight(0x6f86b8, 4, 16, 2);
    cornerA.position.set(-5.6, 3.1, -6.0);
    scene.add(cornerA);
    const cornerB = new THREE.PointLight(0x6f86b8, 4, 16, 2);
    cornerB.position.set(5.6, 3.1, -6.0);
    scene.add(cornerB);
    // a soft key light raking across the tank so the glass gets a specular edge
    const tankKey = new THREE.SpotLight(0xbcd2f0, 12, 12, 0.75, 0.7, 1.4);
    tankKey.position.set(2.4, 2.9, -7.6);
    tankKey.target.position.set(0, 1.9, -11.5);
    scene.add(tankKey);
    scene.add(tankKey.target);

    P.dustMotes(ctx, 0, 2.0, -11.5, 12, 3.2, 10, 320);
    P.lightShaft(ctx, 0, -11.5, 3.9, 0.22, 1.8, 0xffb0a0, 0.35);
  }

  /* ================= CONTROL ROOM ================= */
  {
    // console desk facing the observation window
    const desk = addBox(ctx, tex.paintedMetal(0x33363a), 7.0, 0.75, 0.85, { x: 11.5, y: 0.375, z: -10.6, castShadow: true, collider: true });
    desk.receiveShadow = true;
    const deskTop = addBox(ctx, tex.paintedMetal(0x22252a), 7.2, 0.06, 0.95, { x: 11.5, y: 0.78, z: -10.6, receiveShadow: true });
    deskTop.receiveShadow = true;
    addBox(ctx, tex.paintedMetal(0x22252a), 7.0, 0.5, 0.06, { x: 11.5, y: 0.45, z: -10.2 });

    // monitors on the desk
    const mon1 = P.crtMonitor(ctx, 9.4, 0.86, -10.55, Math.PI, "off", { scale: 1.1 });
    const mon2 = P.crtMonitor(ctx, 10.8, 0.86, -10.55, Math.PI, "off", { scale: 1.1 });
    const mon3 = P.crtMonitor(ctx, 12.2, 0.86, -10.55, Math.PI, "off", { scale: 1.1 });
    const mon4 = P.crtMonitor(ctx, 13.6, 0.86, -10.55, Math.PI, "off", { scale: 1.1 });

    // status light strip on the wall
    const stripY = 2.5;
    for (let i = 0; i < 12; i++) {
      const led = addBox(ctx, emissive(0x2a1a10, 0.2), 0.07, 0.05, 0.03, { x: 9.5 + i * 0.34, y: stripY, z: -16.6 });
      led.castShadow = false;
      led.userData.powerLit = false;
      statusLeds.push(led);
    }

    P.officeChair(ctx, 10.6, -9.3, Math.PI);
    P.officeChair(ctx, 12.4, -9.3, Math.PI + 0.3, true);
    P.filingCabinet(ctx, 19.4, -15.4, -Math.PI / 2, false);
    P.filingCabinet(ctx, 19.4, -13.6, -Math.PI / 2, true);
    P.filingCabinet(ctx, 8.2, -15.6, 0, false);
    P.crate(ctx, 17.6, -15.8, 0.8, 0.7, 0.7, 0.3, "TAPES");
    P.rotaryPhone(ctx, 15.6, 0.86, -10.6, Math.PI);
    P.wallClock(ctx, 15.0, 2.3, -16.68, 0);
    P.scatteredPapers(ctx, 13.0, -10.0, 6, 0.9, 103);
    P.floorStain(ctx, 12.0, -14.5, 2.2, 0x14181c, 0.4);
    P.fallenCeilingTile(ctx, 16.0, -12.0, 4, 107);

    // whiteboard with the door code, on the observation wall
    P.mountedBoard(ctx, tex.whiteboard(), F.partEastEastX, 1.75, -15.3, RY["+x"], 1.5, 0.94);
    // cork board on the east wall
    P.mountedBoard(ctx, tex.cork(), F.eastX, 1.95, -15.6, RY["-x"], 1.15, 1.15, { frameColor: 0x4a4436 });

    P.wallSign(ctx, { key: "s15", title: "Observation · Sector C", lines: ["Chamber interlock active"], symbol: "none", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, F.eastX, 2.2, -12.0, RY["-x"], 1.15, 0.58);
    P.wallSign(ctx, { key: "s16", title: "Control", symbol: "none", bg: "#c8c2b2" }, F.eastX, 2.2, -5.5, RY["-x"], 0.8, 0.4);
    P.roomStencil(ctx, "3-C2", 15.15, 2.3, F.partNorthZ, RY["+z"]);

    const dim = new THREE.PointLight(0x2a3448, 2.2, 12, 2);
    dim.position.set(14, 2.4, -12);
    scene.add(dim);
    const over = P.fluorescentFixture(ctx, 14, -12.0, 3.15, 2.4, true);
    over.tube.material = emissive(0x1a2028, 0.04);
    const roomGlow = new THREE.PointLight(0x4a6a92, 3.2, 12, 2);
    roomGlow.position.set(14, 2.6, -11.0);
    scene.add(roomGlow);
    const bootLight = new THREE.PointLight(0xcfe0ff, 0.0, 10, 2);
    bootLight.position.set(14, 2.7, -12.0);
    scene.add(bootLight);
    bootLights.push({ light: bootLight, target: 14, delay: 0.2, kind: "on", base: 1.5 });
    P.dustMotes(ctx, 14, 1.8, -12, 12, 2.6, 10, 200);

    // register monitor interactables
    const mons: { unit: MonitorUnit; id: string; kind: ScreenKind }[] = [
      { unit: mon1, id: "mon1", kind: "waveform" },
      { unit: mon2, id: "mon2", kind: "specimen" },
      { unit: mon3, id: "mon3", kind: "status" },
      { unit: mon4, id: "mon4", kind: "map" },
    ];
    mons.forEach((m, i) => {
      makeInteractable(ctx, {
        id: m.id,
        kind: "monitor",
        label: "Monitor",
        object: m.unit.group,
        range: 2.4,
        onUse: () => {
          const on = monitorState.get(m.id) ?? false;
          monitorState.set(m.id, !on);
          m.unit.setContent(!on ? m.kind : "off");
          sound(!on ? "beepUp" : "beepDown");
        },
      });
      if (m.unit.screenLight) {
        bootLights.push({ light: m.unit.screenLight, target: 5.0, delay: 1.7 + i * 0.45, kind: "on", base: 0 });
      }
      monitorBoot.push({ unit: m.unit, kind: m.kind });
    });
  }

  /* ================= SERVER / RECORDS ================= */
  {
    for (let i = 0; i < 4; i++) {
      P.serverRack(ctx, -5.0, 8.2 + i * 1.5, 0, 2.2, 12);
    }
    for (let i = 0; i < 3; i++) {
      P.serverRack(ctx, 5.0, 9.0 + i * 1.5, Math.PI, 2.2, 10);
    }
    P.cableRun(ctx, 0, 2.35, 11.0, 12, 0, 8);
    P.cableRun(ctx, 0, 2.15, 15.5, 12, 0, 6);
    P.crate(ctx, -5.2, 15.0, 0.8, 0.7, 0.7, -0.3, "PRINTOUT");
    P.crate(ctx, -4.2, 15.6, 0.7, 0.6, 0.6, 0.5, "TAPES");
    P.filingCabinet(ctx, 5.6, 15.4, Math.PI, false);
    P.fireExtinguisher(ctx, 6.4, 1.0, 7.0);

    // terminal desk with the incident log
    const d = addBox(ctx, tex.paintedMetal(0x33363a), 1.6, 0.72, 0.7, { x: 0.5, y: 0.36, z: 15.6, ry: 0, castShadow: true, collider: true });
    d.receiveShadow = true;
    const dt = addBox(ctx, tex.paintedMetal(0x22252a), 1.7, 0.05, 0.8, { x: 0.5, y: 0.76, z: 15.6 });
    dt.receiveShadow = true;
    const t1 = P.crtMonitor(ctx, 0.2, 0.85, 15.5, Math.PI, "off", { scale: 0.9, withLight: true });
    const t2 = P.crtMonitor(ctx, 0.95, 0.85, 15.5, Math.PI, "off", { scale: 0.9, withLight: true });
    P.officeChair(ctx, 0.6, 16.4, Math.PI);
    P.scatteredPapers(ctx, 0.5, 14.6, 6, 1.0, 113);

    P.wallSign(ctx, { key: "s17", title: "Records", lines: ["Restricted · audit required"], symbol: "none", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, 0, 2.25, F.southZ, RY["-z"], 1.05, 0.52);
    P.roomStencil(ctx, "3-B2", 1.15, 2.3, F.partSouthZ, RY["+z"]);

    const dim = new THREE.PointLight(0x3a2a2a, 2.0, 11, 2);
    dim.position.set(0, 2.2, 12);
    scene.add(dim);
    P.dustMotes(ctx, 0, 1.5, 11.5, 12, 2.2, 9, 180);

    const terminals: { unit: MonitorUnit; id: string; kind: ScreenKind }[] = [
      { unit: t1, id: "term1", kind: "specimen" },
      { unit: t2, id: "term2", kind: "static" },
    ];
    terminals.forEach((tt) => {
      makeInteractable(ctx, {
        id: tt.id,
        kind: "terminal",
        label: "Terminal",
        object: tt.unit.group,
        range: 2.2,
        onUse: () => {
          const on = terminalState.get(tt.id) ?? false;
          terminalState.set(tt.id, !on);
          tt.unit.setContent(!on ? tt.kind : "off");
          if (!on) hooks.log?.(tt.id);
          sound("beepUp");
        },
      });
    });
  }

  /* ================= UTILITY ================= */
  {
    // breaker panels
    const panelA = P.breakerPanel(ctx, 8.3, 1.35, 12.0, Math.PI / 2, [
      { id: "auxA", label: "AUX BUS A", state: false },
      { id: "grid", label: "MAIN GRID", state: false },
    ]);
    const panelB = P.breakerPanel(ctx, 8.3, 1.35, 15.0, Math.PI / 2, [
      { id: "auxB", label: "AUX BUS B", state: false },
      { id: "chiller", label: "CHILLER LOOP", state: false },
    ]);

    const tr = P.transformer(ctx, 18.5, 15.0, -Math.PI / 4);
    P.pumpUnit(ctx, 18.0, 11.5, 0.2);
    P.pumpUnit(ctx, 18.0, 13.0, -0.1);
    P.workbench(ctx, 13.0, 15.6, 2.4, 0);
    P.toolWall(ctx, 13.0, 1.9, 15.2, 0);
    P.barrel(ctx, 10.5, 9.4, 0.2);
    P.barrel(ctx, 11.4, 9.4, -0.3);
    P.crate(ctx, 16.0, 8.6, 0.9, 0.8, 0.7, 0.1, "SPARES");
    P.weldingScreen(ctx, 15.0, 10.5, Math.PI / 2);
    P.ladderAndHatch(ctx, 19.6, 16.6);
    P.puddle(ctx, 12.0, 12.5, 0.7);
    P.floorStain(ctx, 15.5, 13.0, 2.6, 0x101418, 0.7);
    P.scatteredPapers(ctx, 12.6, 15.2, 5, 0.8, 127);

    P.pipeRun(ctx, 15, 2.8, 7.2, 10, 0, 0.09);
    P.pipeRun(ctx, 15, 2.6, 7.4, 10, 0, 0.06);
    P.cableRun(ctx, 15, 2.9, 16.6, 10, 0, 5);

    P.wallSign(ctx, { key: "s18", title: "High voltage", lines: ["Authorised electricians only"], symbol: "bolt", bg: "#c8c2b2", accent: "#8d1f1f" }, F.eastX, 2.1, 13.5, RY["-x"], 1.15, 0.58);
    P.wallSign(ctx, { key: "s19", title: "Utility", symbol: "none", bg: "#4a5248", fg: "#e8e4d8", accent: "#e8e4d8" }, F.eastX, 2.1, 8.0, RY["-x"], 0.8, 0.4);
    P.roomStencil(ctx, "3-B3", 15.15, 2.3, F.partSouthZ, RY["+z"]);

    const work = new THREE.SpotLight(0xfff0d8, 48, 15, 0.85, 0.5, 1.4);
    work.position.set(15, 2.95, 12);
    work.target.position.set(15, 0.4, 12);
    scene.add(work);
    scene.add(work.target);
    work.castShadow = true;
    work.userData.wantsShadow = true;
    work.shadow.mapSize.set(1024, 1024);
    work.shadow.bias = -0.0015;

    bootLights.push({ light: tr.hum, target: 15, delay: 2.0, kind: "on", base: 4 });

    const breakerIds: [string, string, THREE.Mesh[], number][] = [
      ["auxA", "AUX BUS A", panelA.levers, 0],
      ["auxB", "AUX BUS B", panelB.levers, 0],
    ];
    breakerIds.forEach(([id, label, levers, idx]) => {
      makeInteractable(ctx, {
        id,
        kind: "breaker",
        label,
        object: levers[idx],
        range: 2.2,
        onUse: () => {
          const on = breakerState.get(id) ?? false;
          breakerState.set(id, !on);
          levers[idx].position.y += on ? -0.06 : 0.06;
          sound("breaker");
          if (breakerState.get("auxA") && breakerState.get("auxB") && !power) {
            setPower(true);
            hooks.power?.();
          }
        },
      });
    });
    // the dead main-grid breaker sparks when touched
    makeInteractable(ctx, {
      id: "grid",
      kind: "flavor",
      label: "Main grid",
      object: panelA.levers[1],
      range: 2.2,
      onUse: () => {
        sound("spark");
        hooks.flavor?.("The main grid breaker is dead. Somebody cut the feed by hand.");
      },
    });
    makeInteractable(ctx, {
      id: "chiller",
      kind: "flavor",
      label: "Chiller loop",
      object: panelB.levers[1],
      range: 2.2,
      onUse: () => {
        sound("breaker");
        hooks.flavor?.("The chiller loop reports a fault. The chamber never got cold again.");
      },
    });
  }

  /* ---------------- doors & keypads ---------------- */
  const doorLabels: Record<string, string> = {
    lift: "Lift bulkhead",
    airlock: "Airlock door",
    utility: "Utility door",
    wetlab: "Wet lab door",
    control: "Control room door",
    server: "Records door",
    containment: "Containment bulkhead",
  };
  const doorAnchors: Record<string, [number, number, number]> = {
    lift: [-21, 1.4, 13.5],
    airlock: [-16, 1.4, 6],
    utility: [14, 1.4, 6],
    wetlab: [-16, 1.4, -4],
    control: [14, 1.4, -4],
    server: [0, 1.4, 6],
    containment: [0, 1.4, -4],
  };

  function doorLockedMessage(id: string): string {
    switch (id) {
      case "lift":
        return "The lift bulkhead is dogged shut from the inside. Nobody is going back up.";
      case "server":
        return "Locked. A keypad waits beside the frame.";
      case "containment":
        return power
          ? "The seal has released. The bulkhead is free."
          : "The bulkhead is held by an electromagnetic seal. There is no power on this level.";
      default:
        return "Locked.";
    }
  }

  doors.forEach((door, id) => {
    const anchor = new THREE.Object3D();
    anchor.position.set(...(doorAnchors[id] ?? [0, 1, 0]));
    scene.add(anchor);
    makeInteractable(ctx, {
      id: `door:${id}`,
      kind: id === "server" ? "keypad" : "door",
      label: doorLabels[id] ?? "Door",
      object: anchor,
      range: 2.9,
      onUse: () => {
        if (door.locked) {
          if (id === "server") {
            hooks.keypad?.(id);
          } else {
            hooks.flavor?.(doorLockedMessage(id));
            sound("locked");
          }
          return;
        }
        door.setOpen(!door.isOpen());
        sound(door.isOpen() ? "doorOpen" : "doorClose");
      },
    });
  });

  // keypad beside the records door
  {
    const pad = addBox(ctx, tex.paintedMetal(0x2f322e), 0.16, 0.22, 0.05, { x: 1.05, y: 1.25, z: 5.78, castShadow: true });
    pad.castShadow = true;
    const padScreen = new THREE.Mesh(planeGeo(0.11, 0.07, 1), tex.crtOffMaterial());
    padScreen.position.set(1.05, 1.27, 5.75);
    padScreen.rotation.y = Math.PI;
    scene.add(padScreen);
    makeInteractable(ctx, {
      id: "keypad",
      kind: "keypad",
      label: "Keypad",
      object: padScreen,
      range: 2.0,
      onUse: () => hooks.keypad?.("server"),
    });
  }

  // The containment terminal is deliberately a two-step interaction:
  // first read the final record, then explicitly acknowledge/log the chamber seal.
  let tankLogRead = false;
  let chamberSealLogged = false;
  const tankTerminal = makeInteractable(ctx, {
    id: "tank",
    kind: "tank",
    label: "Specimen log",
    object: termScreen,
    range: 2.2,
    onUse: () => {
      if (!tankLogRead) {
        tankLogRead = true;
        terminalState.set("tank", true);
        termScreen.material = tex.crt("specimen");
        termLight.intensity = 5.5;
        tankTerminal.label = "Log chamber seal";
        hooks.log?.("tank");
        sound("beepUp");
        return;
      }

      if (chamberSealLogged) return;
      chamberSealLogged = true;
      tankTerminal.label = "Seal logged";
      tankTerminal.enabled = false;
      termScreen.material = tex.crt("status");
      termLight.color.setHex(0x86d7aa);
      termLight.intensity = 4.2;
      sound("beepUp");
      hooks.flavor?.("Seal 44-B logged. The chamber interlock acknowledges the record.");
      hooks.seal?.();
    },
  });

  // the sealed lift, as a flavour interaction
  makeInteractable(ctx, {
    id: "lift",
    kind: "flavor",
    label: "Lift bulkhead",
    object: ctx.scene,
    range: 0.1,
    enabled: false,
  });

  /* ---------------- power ---------------- */
  function setPower(on: boolean) {
    if (power === on) return;
    power = on;
    bootT = 0;
    if (on) {
      monitorBoot.forEach((m, i) => {
        window.setTimeout(() => m.unit.setContent(m.kind), 900 + i * 420);
      });
      const it = ctx.interactables.find((i) => i.id === "door:containment");
      if (it) it.label = "Containment bulkhead";
      doors.get("containment")!.locked = false;
    }
  }

  /* ---------------- update ---------------- */
  function update(t: number, dt: number) {
    for (const a of ctx.anims) a(t, dt);

    // staggered power boot. Each light keeps a small permanent base level so the
    // room is never pitch black, then ramps to full once the aux buses are live.
    bootT += dt;
    for (const b of bootLights) {
      const local = bootT - b.delay;
      let v = b.base;
      if (local > 0) {
        const k = Math.min(1, local / (b.kind === "on" ? 1.1 : 2.0));
        // fluorescent strike: fast flicker then settle
        const flick = k < 0.35 ? (Math.sin(local * 90) > 0 ? 1 : 0.15) : 1;
        v = b.base + b.target * flick * k;
      }
      (b.light as THREE.PointLight).intensity = v;
    }

    // flickering tubes
    for (const f of flickerLights) {
      const n =
        Math.sin(t * f.rate + f.seed) * 0.5 +
        Math.sin(t * f.rate * 2.7 + f.seed * 3.1) * 0.3 +
        Math.sin(t * f.rate * 5.3 + f.seed * 7.7) * 0.2;
      const dip = Math.max(0, Math.sin(t * 0.7 + f.seed * 11)) > 0.93 ? 0.15 : 1;
      f.light.intensity = f.base * (0.55 + 0.45 * n) * dip;
    }

    // emergency beacons
    for (const b of beacons) {
      b.light.intensity = b.base * (0.35 + 0.65 * Math.max(0, Math.sin(t * 1.6 + b.phase)));
    }

    // Control-room annunciators wake one by one after the buses return.
    statusLeds.forEach((led, i) => {
      const shouldGlow = power && bootT > 0.65 + i * 0.08;
      if (shouldGlow === led.userData.powerLit) return;
      led.userData.powerLit = shouldGlow;
      const color = i === 7 ? 0xc85143 : i % 4 === 0 ? 0xd2a64a : 0x5fb985;
      led.material = shouldGlow ? emissive(color, 1.8) : emissive(0x2a1a10, 0.2);
    });

    // specimen pulse
    for (const p of tankPulse) {
      const s = 0.55 + 0.45 * Math.sin(t * 0.9);
      p.light.intensity = power ? 20 * s : 4.5 * s;
      p.mat.emissiveIntensity = power ? 1.0 + 0.45 * s : 0.4;
    }
  }

  function zoneAt(x: number, z: number): string {
    for (const z0 of ZONES) {
      if (x >= z0.x1 && x <= z0.x2 && z >= z0.z1 && z <= z0.z2) return z0.name;
    }
    return "SUB-LEVEL 3";
  }

  return {
    ctx,
    update,
    doors,
    setPower,
    get power() {
      return power;
    },
    hooks,
    playerStart: { x: -14, z: 13.5, yaw: 0 },
    zoneAt,
    spawnDrip: (x, y, z) => drips.push({ x, y, z }),
    dispose: () => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    },
  };
}
