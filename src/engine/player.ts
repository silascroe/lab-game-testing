import * as THREE from "three";

const EPS = 0.001;
// the player capsule clears anything under this height (floor trim, fallen tiles, glass)
const STEP_UP = 0.18;
const RADIUS = 0.33;
const STAND_EYE = 1.68;
const CROUCH_EYE = 0.98;
const STAND_H = 1.78;
const CROUCH_H = 1.16;

const WALK = 2.45;
const SPRINT = 4.3;
const CROUCH_SPEED = 1.15;
const ACCEL = 14;
const FRICTION = 11;

export type InputState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
};

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouching = false;
  sprinting = false;
  eye = STAND_EYE;
  bobY = 0;
  bobX = 0;
  private stepPhase = 0;
  private travelled = 0;
  private smoothedSpeed = 0;
  onFootstep: (() => void) | null = null;

  private grid = new Map<string, THREE.Box3[]>();
  private cell = 4;
  private bounds = new THREE.Box3(
    new THREE.Vector3(-20.9, -1, -16.9),
    new THREE.Vector3(20.9, 4.2, 16.9),
  );

  constructor(private camera: THREE.PerspectiveCamera, colliders: THREE.Box3[]) {
    this.index(colliders);
  }

  private index(colliders: THREE.Box3[]): void {
    for (const c of colliders) {
      const x0 = Math.floor(c.min.x / this.cell);
      const x1 = Math.floor(c.max.x / this.cell);
      const z0 = Math.floor(c.min.z / this.cell);
      const z1 = Math.floor(c.max.z / this.cell);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`;
          let list = this.grid.get(key);
          if (!list) {
            list = [];
            this.grid.set(key, list);
          }
          list.push(c);
        }
      }
    }
  }

  private nearby(box: THREE.Box3): THREE.Box3[] {
    const out: THREE.Box3[] = [];
    const seen = new Set<THREE.Box3>();
    const x0 = Math.floor(box.min.x / this.cell);
    const x1 = Math.floor(box.max.x / this.cell);
    const z0 = Math.floor(box.min.z / this.cell);
    const z1 = Math.floor(box.max.z / this.cell);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.grid.get(`${x},${z}`);
        if (!list) continue;
        for (const c of list) {
          if (!seen.has(c)) {
            seen.add(c);
            out.push(c);
          }
        }
      }
    }
    return out;
  }

  private aabb(out: THREE.Box3): THREE.Box3 {
    const h = this.crouching ? CROUCH_H : STAND_H;
    return out.set(
      new THREE.Vector3(this.position.x - RADIUS, this.position.y + STEP_UP, this.position.z - RADIUS),
      new THREE.Vector3(this.position.x + RADIUS, this.position.y + h, this.position.z + RADIUS),
    );
  }

  look(dx: number, dy: number, sensitivity = 0.0022): void {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.06;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  update(dt: number, input: InputState): void {
    // --- desired horizontal direction in world space -------------------
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let ix = 0;
    let iz = 0;
    if (input.forward) iz -= 1;
    if (input.back) iz += 1;
    if (input.left) ix -= 1;
    if (input.right) ix += 1;
    const len = Math.hypot(ix, iz);
    if (len > 0) {
      ix /= len;
      iz /= len;
    }
    // Camera basis for rotation order YXZ:
    //   forward = (-sin(yaw), 0, -cos(yaw))   (the camera looks down -Z when yaw = 0)
    //   right   = ( cos(yaw), 0, -sin(yaw))
    // `iz` is -1 when moving forward, `ix` is +1 when strafing right.
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;

    this.crouching = input.crouch;
    this.sprinting = input.sprint && !input.crouch && iz < 0;
    const maxSpeed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;

    const targetX = wx * maxSpeed;
    const targetZ = wz * maxSpeed;
    const accel = len > 0 ? ACCEL : FRICTION;
    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (targetX - this.velocity.x) * k;
    this.velocity.z += (targetZ - this.velocity.z) * k;

    const box = new THREE.Box3();
    this.moveAxis("x", this.velocity.x * dt, box);
    this.moveAxis("z", this.velocity.z * dt, box);

    // --- vertical: eye height + head bob -------------------------------
    const targetEye = this.crouching ? CROUCH_EYE : STAND_EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * dt));

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.smoothedSpeed += (speed - this.smoothedSpeed) * (1 - Math.exp(-8 * dt));
    if (this.smoothedSpeed > 0.25) {
      this.travelled += this.smoothedSpeed * dt;
      const stepLen = this.crouching ? 1.15 : this.sprinting ? 2.15 : 1.65;
      const phase = (this.travelled / stepLen) * Math.PI * 2;
      this.bobY = Math.sin(phase) * (this.crouching ? 0.014 : this.sprinting ? 0.032 : 0.024);
      this.bobX = Math.cos(phase) * (this.sprinting ? 0.02 : 0.014);
      if (this.stepPhase + Math.PI * 2 < phase) {
        this.stepPhase = phase;
        this.onFootstep?.();
      } else if (phase < this.stepPhase) {
        this.stepPhase = phase;
      }
    } else {
      this.bobY *= 1 - Math.exp(-8 * dt);
      this.bobX *= 1 - Math.exp(-8 * dt);
    }

    // --- apply to the camera -------------------------------------------
    this.camera.position.set(this.position.x + this.bobX, this.position.y + this.eye + this.bobY, this.position.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private moveAxis(axis: "x" | "z", delta: number, box: THREE.Box3): void {
    if (delta === 0) return;
    this.position[axis] += delta;
    this.aabb(box);
    for (const c of this.nearby(box)) {
      if (!box.intersectsBox(c)) continue;
      if (axis === "x") {
        this.position.x = delta > 0 ? c.min.x - RADIUS - EPS : c.max.x + RADIUS + EPS;
        this.velocity.x = 0;
      } else {
        this.position.z = delta > 0 ? c.min.z - RADIUS - EPS : c.max.z + RADIUS + EPS;
        this.velocity.z = 0;
      }
      this.aabb(box);
    }
    // hard clamp so the player can never escape the shell
    this.position.x = Math.min(this.bounds.max.x, Math.max(this.bounds.min.x, this.position.x));
    this.position.z = Math.min(this.bounds.max.z, Math.max(this.bounds.min.z, this.position.z));
  }

  get speed(): number {
    return this.smoothedSpeed;
  }
}
