import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

/**
 * Camera rig for the living graph: a perspective camera orbiting a target with critically damped motion. Flat mode
 * looks straight at the z = 0 plane with a small pointer-driven tilt (parallax depth); 3D mode orbits freely.
 * Every input writes the goal state; `update(dt)` eases the real camera toward it, so pan, zoom and fly-to all glide.
 */

export interface Pose { tx: number; ty: number; tz: number; dist: number; az: number; el: number }

const MIN_DIST = 30;
const MAX_DIST = 9000;
const MAX_TILT = 0.045;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: 'flat' | '3d' = 'flat';
  private cur: Pose = { tx: 0, ty: 0, tz: 0, dist: 900, az: 0, el: 0 };
  private goal: Pose = { ...this.cur };
  private vel = { x: 0, y: 0 };
  private tilt = { x: 0, y: 0 };
  private width = 1;
  private height = 1;
  /** Horizontal shift of the projection centre (CSS px) so the graph centres in the area the rail and dock leave free. */
  private shift = 0;
  /** Seconds of eased travel left for an explicit fly-to (keeps it smooth instead of snapping). */
  private flight: { from: Pose; to: Pose; t: number; dur: number } | null = null;
  reducedMotion = false;

  constructor(fov = 40) {
    this.camera = new PerspectiveCamera(fov, 1, 1, 30000);
    this.apply(this.cur);
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const extra = Math.abs(this.shift);
    this.camera.aspect = (this.width + 2 * extra) / this.height;
    if (extra > 0.5) this.camera.setViewOffset(this.width + 2 * extra, this.height, extra - this.shift, 0, this.width, this.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Panels covering the canvas edges (CSS px, physical left/right): the view centre moves to the free area. */
  setInsets(left: number, right: number): void {
    this.shift = (left - right) / 2;
    this.setSize(this.width, this.height);
  }

  get distance(): number { return this.cur.dist; }
  get goalDistance(): number { return this.goal.dist; }
  /** Where every input and flight is taking the camera (the end of a flight in progress). */
  get goalPose(): Readonly<Pose> { return this.goal; }
  get target(): Vector3 { return new Vector3(this.cur.tx, this.cur.ty, this.cur.tz); }

  /** World units per CSS pixel at the target distance. */
  worldPerPx(dist = this.goal.dist): number {
    return (2 * dist * Math.tan(MathUtils.degToRad(this.camera.fov) / 2)) / this.height;
  }

  setMode(mode: 'flat' | '3d'): void {
    this.mode = mode;
    if (mode === 'flat') { this.goal.az = 0; this.goal.el = 0; }
    else { this.goal.az = 0.55; this.goal.el = 0.32; }
  }

  /** Small parallax tilt following the pointer (flat mode); x, y in -1..1 from the canvas centre. */
  setTilt(x: number, y: number): void {
    if (this.reducedMotion) { this.tilt.x = 0; this.tilt.y = 0; return; }
    this.tilt.x = MathUtils.clamp(x, -1, 1) * MAX_TILT;
    this.tilt.y = MathUtils.clamp(y, -1, 1) * MAX_TILT;
  }

  pan(dxPx: number, dyPx: number): void {
    this.flight = null;
    const s = this.worldPerPx();
    const right = new Vector3(Math.cos(this.goal.az), 0, -Math.sin(this.goal.az));
    const up = this.mode === 'flat' ? new Vector3(0, 1, 0) : new Vector3(-Math.sin(this.goal.el) * Math.sin(this.goal.az), Math.cos(this.goal.el), -Math.sin(this.goal.el) * Math.cos(this.goal.az));
    this.goal.tx += (-dxPx * right.x + dyPx * up.x) * s;
    this.goal.ty += (-dxPx * right.y + dyPx * up.y) * s;
    this.goal.tz += (-dxPx * right.z + dyPx * up.z) * s;
  }

  /** Inertia after a drag, in CSS px per second. */
  fling(vxPx: number, vyPx: number): void {
    if (this.reducedMotion) return;
    this.vel.x = MathUtils.clamp(vxPx, -3000, 3000);
    this.vel.y = MathUtils.clamp(vyPx, -3000, 3000);
  }

  rotate(dxPx: number, dyPx: number): void {
    this.flight = null;
    this.goal.az -= dxPx * 0.006;
    this.goal.el = MathUtils.clamp(this.goal.el + dyPx * 0.006, -1.35, 1.35);
  }

  /** Zoom by `factor` (< 1 closer) keeping the world point under the cursor where it is. */
  zoomAt(factor: number, sx: number, sy: number): void {
    this.flight = null;
    const before = this.goal.dist;
    const after = MathUtils.clamp(before * factor, MIN_DIST, MAX_DIST);
    if (after === before) return;
    const k = 1 - after / before;
    const s = this.worldPerPx(before);
    const ox = (sx - (this.width / 2 + this.shift)) * s;
    const oy = -(sy - this.height / 2) * s;
    if (this.mode === 'flat') { this.goal.tx += ox * k; this.goal.ty += oy * k; }
    else {
      const right = new Vector3(Math.cos(this.goal.az), 0, -Math.sin(this.goal.az));
      this.goal.tx += right.x * ox * k; this.goal.tz += right.z * ox * k; this.goal.ty += oy * k;
    }
    this.goal.dist = after;
  }

  /** Eased travel to a point (and distance), used for click-to-focus and the category legend. */
  flyTo(x: number, y: number, z: number, dist?: number, seconds = 1.1): void {
    const to: Pose = { ...this.goal, tx: x, ty: y, tz: z, dist: MathUtils.clamp(dist ?? this.goal.dist, MIN_DIST, MAX_DIST) };
    if (this.reducedMotion || seconds <= 0) { this.goal = to; this.cur = { ...to }; this.flight = null; this.vel.x = this.vel.y = 0; return; }
    this.flight = { from: { ...this.cur }, to, t: 0, dur: seconds };
    this.goal = { ...to };
    this.vel.x = this.vel.y = 0;
  }

  /** Distance at which a sphere of `radius` around the target fills the view with `padding` (0..1). */
  distanceToFit(radius: number, padding = 0.12): number {
    const vFov = MathUtils.degToRad(this.camera.fov);
    const visible = Math.max(0.3, (this.width - 2 * Math.abs(this.shift)) / this.height);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * visible);
    const fov = Math.min(vFov, hFov);
    return MathUtils.clamp((radius * (1 + padding)) / Math.sin(fov / 2), MIN_DIST, MAX_DIST);
  }

  /** Advances the camera; true while it is still moving noticeably. */
  update(dt: number): boolean {
    let moving = false;
    if (this.vel.x !== 0 || this.vel.y !== 0) {
      this.pan(this.vel.x * dt, this.vel.y * dt);
      const decay = Math.exp(-dt * 5.5);
      this.vel.x *= decay; this.vel.y *= decay;
      if (Math.hypot(this.vel.x, this.vel.y) < 8) this.vel.x = this.vel.y = 0;
      moving = true;
    }
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2; // easeInOutCubic
      // A long flight rises a little in the middle, like a camera crane.
      const span = Math.hypot(f.to.tx - f.from.tx, f.to.ty - f.from.ty, f.to.tz - f.from.tz);
      const lift = Math.sin(Math.PI * e) * Math.min(span * 0.35, Math.max(f.from.dist, f.to.dist) * 0.5);
      for (const k of ['tx', 'ty', 'tz', 'az', 'el'] as const) this.cur[k] = f.from[k] + (f.to[k] - f.from[k]) * e;
      this.cur.dist = f.from.dist * (f.to.dist / f.from.dist) ** e + lift;
      if (f.t >= 1) this.flight = null;
      moving = true;
    } else {
      const a = 1 - Math.exp(-dt * 9);
      const b = 1 - Math.exp(-dt * 7);
      for (const k of ['tx', 'ty', 'tz'] as const) {
        const d = this.goal[k] - this.cur[k];
        if (Math.abs(d) > 0.01) { this.cur[k] += d * a; moving = true; } else this.cur[k] = this.goal[k];
      }
      const dd = Math.log(this.goal.dist / this.cur.dist);
      if (Math.abs(dd) > 0.0005) { this.cur.dist *= Math.exp(dd * a); moving = true; } else this.cur.dist = this.goal.dist;
      for (const k of ['az', 'el'] as const) {
        const d = this.goal[k] - this.cur[k];
        if (Math.abs(d) > 0.0002) { this.cur[k] += d * b; moving = true; } else this.cur[k] = this.goal[k];
      }
    }
    this.apply(this.cur);
    return moving;
  }

  private apply(p: Pose): void {
    const az = p.az + (this.mode === 'flat' ? this.tilt.x : 0);
    const el = p.el + (this.mode === 'flat' ? this.tilt.y : 0);
    const c = Math.cos(el);
    this.camera.position.set(p.tx + p.dist * c * Math.sin(az), p.ty + p.dist * Math.sin(el), p.tz + p.dist * c * Math.cos(az));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p.tx, p.ty, p.tz);
    this.camera.updateMatrixWorld();
  }

  /** World point under a screen position, on the plane through the target facing the camera. */
  worldAt(sx: number, sy: number): Vector3 {
    const ndc = new Vector3((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const origin = this.camera.position.clone();
    const dir = ndc.sub(origin).normalize();
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    const target = this.target;
    const denom = dir.dot(normal);
    if (Math.abs(denom) < 1e-6) return target;
    const t = target.clone().sub(origin).dot(normal) / denom;
    return origin.add(dir.multiplyScalar(t));
  }
}
