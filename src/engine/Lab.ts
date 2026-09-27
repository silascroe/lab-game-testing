import * as THREE from "three";
import { Ambience } from "./audio";
import { Player, type InputState } from "./player";
import { createPostFx, type PostFx } from "./postfx";
import { TextureLibrary } from "./textures";
import { buildWorld, type WorldHandle } from "./world";

export type LabCallbacks = {
  onProgress?: (progress: number, label: string) => void;
  onReady?: () => void;
  onZone?: (name: string) => void;
  onPrompt?: (prompt: { label: string; kind: string } | null) => void;
  onLog?: (id: string) => void;
  onFlavor?: (message: string) => void;
  onObjective?: (text: string) => void;
  onPointerLock?: (locked: boolean) => void;
  onError?: (message: string) => void;
  onFinished?: () => void;
};

export const LOGS: Record<string, { title: string; lines: string[] }> = {
  term1: {
    title: "TERMINAL 1 · SHIFT RECORD",
    lines: [
      "> 04:12  chiller loop 2 fault, temp rising",
      "> 06:40  44-B agitated. acoustic spike 19Hz",
      "> 09:03  Vance authorised aux buses only",
      "> 11:55  OBSERVATION WINDOW FAILED",
      "> 12:00  ...",
      "> 12:00  it is on the glass",
    ],
  },
  term2: {
    title: "TERMINAL 2 · ARCHIVE",
    lines: ["> drive not ready", "> tape library: 0 volumes mounted", "> no readable media"],
  },
  tank: {
    title: "SPECIMEN 44-B · FINAL ENTRY",
    lines: [
      "Recovered from the borehole at 2,100m.",
      "It was dormant for eleven years.",
      "",
      "We warmed it to study the regeneration.",
      "It warmed us to study the regeneration.",
      "",
      "The grid is cut. The buses are on a timer.",
      "When the last light goes, the chamber",
      "will be cold again - but not cold enough.",
      "",
      "If you are reading this: do not open the tank.",
      "Log the seal and leave.",
      "",
      "- R. Vance, Site Director",
    ],
  },
};

const OBJECTIVES = [
  "Find the utility room and restore auxiliary power",
  "Auxiliary power is live. The containment seal has released",
  "Enter the containment chamber and inspect specimen 44-B",
  "Log chamber seal 44-B at the specimen terminal",
  "Seal logged. Get clear of the chamber",
];

const KEYPAD_CODE = "7419";

/** One-line orientation notes shown the first time the player enters a space. */
const ZONE_HINTS: Record<string, string> = {
  "CENTRAL HUB · SECTOR B":
    "A junction. Utility east, records west, airlock south, the main corridor north.",
  "UTILITY · POWER":
    "Two auxiliary bus breakers on the west wall. The grid is dead - both buses have to be thrown.",
  "CONTAINMENT CHAMBER · SECTOR C":
    "The chamber. A log terminal sits on the pedestal beside the tank.",
  "RECORDS · SERVER": "Terminals on the desk at the far end. One of them still answers.",
  "CONTROL ROOM · SECTOR C": "The observation window looks straight into the chamber.",
  "WET LAB · SPECIMEN PREP": "Frozen mid-experiment. Nothing here still works.",
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function detectSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return false;
    const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
    return /swiftshader|software|llvmpipe|basic render/i.test(name);
  } catch {
    return false;
  }
}

function webglSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

export class Lab {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private postfx!: PostFx;
  private tex!: TextureLibrary;
  private world!: WorldHandle;
  private player!: Player;
  private ambience = new Ambience();

  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private disposed = false;
  private timeouts = new Set<number>();
  private ready = false;
  private uiBlocked = false;

  private input: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
  };

  private currentZone = "";
  private currentPrompt: { label: string; kind: string } | null = null;
  private stage = 0;
  private doorAnchors: Record<string, THREE.Vector3> = {};
  /** unit normal (in XZ) pointing from each doorway into the facility */
  private doorNormals: Record<string, [number, number]> = {
    lift: [1, 0],
    airlock: [0, -1],
    utility: [0, -1],
    wetlab: [0, 1],
    control: [0, 1],
    server: [0, -1],
    containment: [0, 1],
  };
  private skipNextMouseMove = false;
  private keypadBuffer = "";
  private finished = false;
  private software = false;
  private quality: "low" | "high" = "high";
  private dprOverride = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: LabCallbacks = {},
  ) {}

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */

  async boot(): Promise<void> {
    if (!webglSupported()) {
      this.cb.onError?.("WebGL is not available in this browser. The facility cannot be rendered.");
      return;
    }
    try {
      const report = (p: number, label: string) => this.cb.onProgress?.(Math.min(1, p), label);

      report(0.04, "Calibrating optics");
      await nextFrame();
      if (this.disposed) return;

      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: "high-performance",
        stencil: false,
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      const gl = this.renderer.getContext();
      this.software = detectSoftwareRenderer(gl);
      const forced = new URLSearchParams(window.location.search).get("quality");
      this.quality = forced === "low" ? "low" : forced === "high" ? "high" : this.software ? "low" : "high";
      this.dprOverride = Number(new URLSearchParams(window.location.search).get("dpr")) || 0;
      this.applyQuality();
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);
      this.scene.fog = new THREE.FogExp2(0x101826, 0.0072);
      this.scene.background = new THREE.Color(0x0a0f18);

      report(0.1, "Generating materials");
      await nextFrame();
      if (this.disposed) return;

      this.tex = new TextureLibrary();
      // warm the heavy procedural surfaces so the progress bar is honest
      const warm: [number, string, () => void][] = [
        [0.16, "Casting concrete", () => this.tex.concreteWall()],
        [0.24, "Pouring floors", () => this.tex.concreteFloor()],
        [0.31, "Laying tile", () => this.tex.tileFloor()],
        [0.38, "Rolling steel", () => this.tex.paintedMetal()],
        [0.45, "Weathering surfaces", () => this.tex.rust()],
        [0.5, "Polishing stainless", () => this.tex.stainless()],
        [0.56, "Printing signage", () => this.tex.hazard()],
        [0.62, "Warming CRTs", () => this.tex.crt("boot")],
        [0.68, "Filing records", () => this.tex.paper()],
        [0.73, "Drafting plans", () => this.tex.facilityMap()],
        [0.78, "Seeding particulates", () => this.tex.dustSprite()],
      ];
      for (const [p, label, fn] of warm) {
        report(p, label);
        await nextFrame();
        if (this.disposed) return;
        fn();
      }

      report(0.82, "Constructing sub-level 3");
      await nextFrame();
      if (this.disposed) return;
      this.world = buildWorld(this.scene, this.tex);

      report(0.9, "Wiring the grid");
      await nextFrame();
      if (this.disposed) return;
      this.wireWorld();

      this.player = new Player(this.camera, [
        ...this.world.ctx.colliders,
        ...this.world.ctx.doorColliders,
      ]);
      this.player.position.set(this.world.playerStart.x, 0, this.world.playerStart.z);
      this.player.yaw = this.world.playerStart.yaw;
      this.player.pitch = -0.02;
      this.player.onFootstep = () => this.ambience.play("footstep");

      // base ambience
      // Base ambience. Hemisphere lights tint upward faces with `sky` and downward
      // faces with `ground`, so both the floor AND the ceiling need a real value or
      // the architecture reads as a black void. Two of them cross-fill the room.
      const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x76808f, 1.05);
      this.scene.add(hemi);
      const bounce = new THREE.HemisphereLight(0x5f7098, 0x5e6874, 0.26);
      bounce.position.set(0, -1, 0);
      this.scene.add(bounce);
      const fill = new THREE.DirectionalLight(0xa8bedd, 0.34);
      fill.position.set(0.35, 1, 0.2);
      this.scene.add(fill);

      this.postfx = createPostFx(this.renderer, this.scene, this.camera);
      this.applyQuality();

      report(0.96, "Compiling shaders");
      await nextFrame();
      if (this.disposed) return;
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
      await nextFrame();
      if (this.disposed) return;

      this.bindEvents();
      this.cb.onObjective?.(OBJECTIVES[0]);
      this.cb.onZone?.(this.world.zoneAt(this.player.position.x, this.player.position.z));
      this.currentZone = this.world.zoneAt(this.player.position.x, this.player.position.z);

      report(1, "Ready");
      this.ready = true;
      this.cb.onReady?.();
      this.start();
    } catch (err) {
      if (this.disposed) return;
      console.error(err);
      this.cb.onError?.(
        "The facility failed to initialise: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private applyQuality(): void {
    const low = this.quality === "low";
    this.renderer.shadowMap.enabled = !low;
    const base = this.dprOverride || (low ? 0.7 : Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.setPixelRatio(base);
    this.postfx?.setQuality(low);
    this.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && "castShadow" in l) {
        (l as THREE.SpotLight).castShadow = !low && l.userData.wantsShadow === true;
      }
    });
  }

  private wireWorld(): void {
    const w = this.world;
    w.hooks.sound = (name, arg) => {
      this.ambience.play(name);
      if (arg !== undefined) this.ambience.play("beepUp");
    };
    w.hooks.power = () => {
      this.ambience.play("powerSurge");
      this.ambience.setPower(true);
      this.setStage(1);
    };
    w.hooks.log = (id) => {
      this.cb.onLog?.(id);
      if (id === "tank") this.setStage(3);
    };
    w.hooks.seal = () => this.setStage(4);
    w.hooks.flavor = (msg) => this.cb.onFlavor?.(msg);
    w.hooks.keypad = () => this.openKeypad();

    w.doors.forEach((_door, id) => {
      const pos: Record<string, [number, number, number]> = {
        lift: [-21, 1.4, 13.5],
        airlock: [-16, 1.4, 6],
        utility: [14, 1.4, 6],
        wetlab: [-16, 1.4, -4],
        control: [14, 1.4, -4],
        server: [0, 1.4, 6],
        containment: [0, 1.4, -4],
      };
      this.doorAnchors[id] = new THREE.Vector3(...(pos[id] ?? [0, 1, 0]));
    });
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const timeout of this.timeouts) window.clearTimeout(timeout);
    this.timeouts.clear();
    this.unbindEvents();
    this.ambience.stop();
    this.world?.dispose();
    this.tex?.dispose();
    this.postfx?.dispose();
    this.renderer?.dispose();
  }

  private schedule(callback: () => void, delay: number): void {
    const timeout = window.setTimeout(() => {
      this.timeouts.delete(timeout);
      if (!this.disposed) callback();
    }, delay);
    this.timeouts.add(timeout);
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                              */
  /* ------------------------------------------------------------------ */

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    if (this.ready) {
      this.player.update(dt, this.input);
      this.world.update(t, dt);
      this.updateZone();
      this.updateInteraction();
      this.updateDoors();
      this.postfx.update(t);
      this.postfx.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private firstVisit = new Set<string>();

  private updateZone(): void {
    const z = this.world.zoneAt(this.player.position.x, this.player.position.z);
    if (z !== this.currentZone) {
      this.currentZone = z;
      this.cb.onZone?.(z);
      this.ambience.setZone(this.zoneKey(z));
      if (!this.firstVisit.has(z)) {
        this.firstVisit.add(z);
        const hint = ZONE_HINTS[z];
        if (hint) this.schedule(() => this.cb.onFlavor?.(hint), 1400);
      }
    }
  }

  private zoneKey(name: string): Parameters<Ambience["setZone"]>[0] {
    if (name.startsWith("AIRLOCK")) return "airlock";
    if (name.startsWith("CENTRAL")) return "hub";
    if (name.startsWith("MAIN CORRIDOR")) return "corridor";
    if (name.startsWith("WET LAB")) return "wetlab";
    if (name.startsWith("CONTROL")) return "control";
    if (name.startsWith("CONTAINMENT")) return "containment";
    if (name.startsWith("RECORDS")) return "server";
    return "utility";
  }

  /**
   * Picks the interactable the player is actually aiming at: it must be inside the
   * interaction cone AND near the centre of the crosshair, so small targets such as
   * individual breaker levers stay selectable.
   */
  private findTarget(): (typeof this.world.ctx.interactables)[number] | null {
    const cam = this.camera;
    const origin = cam.position;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const p = new THREE.Vector3();
    let best: (typeof this.world.ctx.interactables)[number] | null = null;
    let bestScore = Infinity;
    for (const it of this.world.ctx.interactables) {
      if (it.enabled === false || !it.onUse) continue;
      p.setFromMatrixPosition(it.object.matrixWorld);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const dz = p.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      const range = it.range ?? 2.4;
      if (dist > range) continue;
      const along = dx * forward.x + dy * forward.y + dz * forward.z;
      if (along <= 0.08) continue;
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      if (perp > 0.5) continue;
      const score = perp * 3 + along * 0.12;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  private updateInteraction(): void {
    if (this.uiBlocked) {
      if (this.currentPrompt) {
        this.currentPrompt = null;
        this.cb.onPrompt?.(null);
      }
      return;
    }
    const target = this.findTarget();
    const prompt = target ? { label: target.label, kind: target.kind } : null;
    const changed =
      (prompt === null) !== (this.currentPrompt === null) ||
      (prompt && this.currentPrompt && prompt.label !== this.currentPrompt.label);
    if (changed) {
      this.currentPrompt = prompt;
      this.cb.onPrompt?.(prompt);
    }
  }

  private updateDoors(): void {
    const p = this.player.position;
    this.world.doors.forEach((door, id) => {
      if (door.autoRange <= 0) return;
      const anchor = this.doorAnchors[id];
      if (!anchor) return;
      const dx = p.x - anchor.x;
      const dz = p.z - anchor.z;
      const d = Math.hypot(dx, dz);
      if (!door.locked && d < door.autoRange && !door.isOpen()) {
        door.setOpen(true);
        this.ambience.play("doorOpen");
        if (id === "containment" && this.stage === 1) this.setStage(2);
      } else if (door.isOpen() && d > door.autoRange + 1.6) {
        door.setOpen(false);
        this.ambience.play("doorClose");
      }
    });
  }

  private setStage(n: number): void {
    if (n <= this.stage) return;
    this.stage = n;
    const obj = OBJECTIVES[Math.min(n, OBJECTIVES.length - 1)];
    this.cb.onObjective?.(obj);
    if (n >= 4 && !this.finished) {
      this.finished = true;
      this.schedule(() => this.cb.onFinished?.(), 2200);
    }
  }

  /* ------------------------------------------------------------------ */
  /* input                                                              */
  /* ------------------------------------------------------------------ */

  private bindEvents(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onCanvasClick);
  }

  private unbindEvents(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onCanvasClick);
  }

  private onCanvasClick = () => {
    if (this.uiBlocked) return;
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  };

  private onPointerLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    this.cb.onPointerLock?.(locked);
    // browsers deliver one synthetic mousemove when the cursor is warped into place;
    // swallowing it stops the view from snapping on entry
    this.skipNextMouseMove = locked;
    if (!locked) {
      this.input.forward = this.input.back = this.input.left = this.input.right = false;
      this.input.sprint = this.input.crouch = false;
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    if (this.skipNextMouseMove) {
      this.skipNextMouseMove = false;
      return;
    }
    // clamp a single event so a stray warp can never spin the camera
    const mx = Math.max(-220, Math.min(220, e.movementX));
    const my = Math.max(-160, Math.min(160, e.movementY));
    this.player.look(mx, my);
  };

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.postfx.setSize(w, h);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") return;
    // Pointer lock is the game's focus boundary. Without this guard, WASD can
    // move the player behind menus or after the user deliberately releases the mouse.
    if (document.pointerLockElement !== this.canvas) return;
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.input.forward = true;
        break;
      case "KeyS":
      case "ArrowDown":
        this.input.back = true;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.input.left = true;
        break;
      case "KeyD":
      case "ArrowRight":
        this.input.right = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.input.sprint = true;
        break;
      case "ControlLeft":
      case "KeyC":
        this.input.crouch = true;
        break;
      case "KeyE":
      case "Enter":
        if (!this.uiBlocked) this.interact();
        break;
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.input.forward = false;
        break;
      case "KeyS":
      case "ArrowDown":
        this.input.back = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.input.left = false;
        break;
      case "KeyD":
      case "ArrowRight":
        this.input.right = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.input.sprint = false;
        break;
      case "ControlLeft":
      case "KeyC":
        this.input.crouch = false;
        break;
    }
  };

  /* ------------------------------------------------------------------ */
  /* public actions                                                     */
  /* ------------------------------------------------------------------ */

  setUiBlocked(v: boolean): void {
    this.uiBlocked = v;
    if (v && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  interact(): void {
    if (!this.ready || this.uiBlocked) return;
    this.findTarget()?.onUse?.();
  }

  openKeypad(): void {
    this.setUiBlocked(true);
    this.keypadBuffer = "";
    this.cb.onLog?.("__keypad__");
  }

  submitKeypad(digit: string): boolean {
    if (!/^\d$/.test(digit) || this.keypadBuffer.length >= 4) return false;
    this.keypadBuffer += digit;
    if (this.keypadBuffer === KEYPAD_CODE) {
      const door = this.world.doors.get("server");
      if (door) door.locked = false;
      const pad = this.world.ctx.interactables.find((i) => i.id === "keypad");
      if (pad) pad.enabled = false;
      this.setUiBlocked(false);
      this.cb.onFlavor?.("The bolt withdraws. Forty years of records, still waiting.");
      return true;
    }
    if (this.keypadBuffer.length === KEYPAD_CODE.length) this.keypadBuffer = "";
    return false;
  }

  clearKeypad(): void {
    this.keypadBuffer = "";
  }

  closeKeypad(): void {
    this.clearKeypad();
    this.setUiBlocked(false);
  }

  /**
   * Geometry audit: for every intended doorway, cast rays across the opening at several
   * heights and lateral offsets and report whether the wall geometry actually has a gap.
   */
  auditOpenings(): { id: string; blocked: string[] }[] {
    const out: { id: string; blocked: string[] }[] = [];
    const colliders = this.world.ctx.colliders;
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    for (const [id, anchor] of Object.entries(this.doorAnchors)) {
      const [nx, nz] = this.doorNormals[id] ?? [0, 1];
      const blocked: string[] = [];
      for (const y of [1.0, 1.35, 1.65]) {
        for (const lat of [-0.45, 0, 0.45]) {
          // lateral offset is perpendicular to the doorway normal
          const px = anchor.x + nx * 1.4 + -nz * lat;
          const pz = anchor.z + nz * 1.4 + nx * lat;
          const qx = anchor.x - nx * 1.4 + -nz * lat;
          const qz = anchor.z - nz * 1.4 + nx * lat;
          const dir = new THREE.Vector3(qx - px, 0, qz - pz);
          const dist = dir.length();
          dir.normalize();
          ray.set(new THREE.Vector3(px, y, pz), dir);
          let blockedBy: THREE.Box3 | null = null;
          for (const c of colliders) {
            if (c.isEmpty()) continue;
            const entry = ray.intersectBox(c, hit);
            if (entry && entry.distanceTo(ray.origin) < dist - 0.05) {
              blockedBy = c;
              break;
            }
          }
          if (blockedBy) blocked.push(`y=${y} lat=${lat}`);
        }
      }
      out.push({ id, blocked });
    }
    return out;
  }

  /** True when the spawn point is clear of every collider. */
  spawnClear(): boolean {
    const box = new THREE.Box3(
      new THREE.Vector3(this.player.position.x - 0.3, this.player.position.y + 0.18, this.player.position.z - 0.3),
      new THREE.Vector3(this.player.position.x + 0.3, this.player.position.y + 1.78, this.player.position.z + 0.3),
    );
    for (const c of this.world.ctx.colliders) {
      if (!c.isEmpty() && box.intersectsBox(c)) return false;
    }
    return true;
  }

  colliderCount(): number {
    return this.world.ctx.colliders.length + this.world.ctx.doorColliders.length;
  }

  /** Diagnostic dump of the current crosshair targeting (read-only). */
  debugTarget() {
    const cam = this.camera;
    const origin = cam.position.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const p = new THREE.Vector3();
    return this.world.ctx.interactables
      .filter((i) => i.enabled !== false && i.onUse)
      .map((i) => {
        p.setFromMatrixPosition(i.object.matrixWorld);
        const dx = p.x - origin.x;
        const dy = p.y - origin.y;
        const dz = p.z - origin.z;
        const dist = Math.hypot(dx, dy, dz);
        const along = dx * forward.x + dy * forward.y + dz * forward.z;
        const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
        return {
          id: i.id,
          label: i.label,
          dist: +dist.toFixed(3),
          along: +along.toFixed(3),
          perp: +perp.toFixed(3),
          inRange: dist <= (i.range ?? 2.4),
        };
      })
      .sort((a, b) => a.dist - b.dist);
  }

  /**
   * Visual signage audit used by the browser test harness. It checks the actual rendered
   * scene from the current camera: a sign must be inside the frustum and be the first
   * mesh hit by a ray from the player's eye. This catches plaques hidden behind doors,
   * beams, pipes, or wall geometry even when the texture itself is perfectly valid.
   */
  auditSigns() {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);

    const signs: THREE.Mesh[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.kind === "sign") signs.push(m);
    });

    const raycaster = new THREE.Raycaster();
    const world = new THREE.Vector3();
    const ndc = new THREE.Vector3();
    const dir = new THREE.Vector3();

    return signs.map((sign) => {
      sign.getWorldPosition(world);
      ndc.copy(world).project(this.camera);
      const inViewport =
        ndc.x >= -1.02 &&
        ndc.x <= 1.02 &&
        ndc.y >= -1.02 &&
        ndc.y <= 1.02 &&
        ndc.z >= -1 &&
        ndc.z <= 1;

      dir.copy(world).sub(this.camera.position);
      const distance = dir.length();
      dir.normalize();
      raycaster.set(this.camera.position, dir);
      raycaster.near = 0.02;
      raycaster.far = distance + 0.08;

      const hit = raycaster
        .intersectObjects(this.scene.children, true)
        .find((h) => (h.object as THREE.Mesh).isMesh);
      const key = String(sign.userData.signKey ?? "");
      const visible = !!hit && hit.object.userData.signKey === key;

      return {
        key,
        x: +world.x.toFixed(3),
        y: +world.y.toFixed(3),
        z: +world.z.toFixed(3),
        distance: +distance.toFixed(3),
        screenX: +ndc.x.toFixed(3),
        screenY: +ndc.y.toFixed(3),
        inViewport,
        visible,
        firstHit: hit
          ? String(hit.object.userData.signKey ?? hit.object.userData.kind ?? hit.object.type)
          : null,
      };
    });
  }

  /** World positions of every interactable (read-only, used by the automated playthrough). */
  interactables() {
    const v = new THREE.Vector3();
    return this.world.ctx.interactables
      .filter((i) => i.enabled !== false)
      .map((i) => {
        v.setFromMatrixPosition(i.object.matrixWorld);
        return { id: i.id, label: i.label, kind: i.kind, x: v.x, y: v.y, z: v.z, range: i.range ?? 2.4 };
      });
  }

  /** Read-only snapshot of player + progression state (used by the automated playthrough). */
  getState() {
    return {
      x: this.player.position.x,
      z: this.player.position.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      zone: this.currentZone,
      prompt: this.currentPrompt,
      stage: this.stage,
      power: this.world.power,
      locked: document.pointerLockElement === this.canvas,
      finished: this.finished,
      audioRunning: this.ambience.isRunning,
      crouching: this.player.crouching,
      sprinting: this.player.sprinting,
      speed: this.player.speed,
    };
  }

  /** Test/debug helper: force the auxiliary power state (mirrors the breaker sequence). */
  forcePower(): void {
    if (this.world.power) return;
    this.world.setPower(true);
    this.ambience.play("powerSurge");
    this.ambience.setPower(true);
    this.setStage(1);
  }

  requestLock(): void {
    void this.ambience.start().catch(() => undefined);
    this.canvas.requestPointerLock?.();
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Test / screenshot helper: drop the camera at a viewpoint. */
  teleport(x: number, z: number, yaw: number, pitch = 0): void {
    this.player.position.set(x, 0, z);
    this.player.velocity.set(0, 0, 0);
    this.player.yaw = yaw;
    this.player.pitch = pitch;
    this.player.update(0.016, this.input);
    this.camera.updateMatrixWorld(true);
  }

  renderNow(): void {
    this.postfx.composer.render(0.016);
  }
}
