import {
  CustomBlending, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, RedFormat, RepeatWrapping,
  ShaderMaterial, UnsignedByteType, Vector3, Vector4, type IUniform,
} from 'three';
import type { Rgb } from './colors';
import { BRAIN_FRAGMENT, BRAIN_VERTEX } from './shaders';

/**
 * The brain at the mind map's core (UI-DESIGN "Living graph" → The brain): its shape and folds are drawn by
 * `shaders.ts` `BRAIN_FRAGMENT`; this layer places it on the core every frame and drives its life — waves of activity
 * and sparks while it thinks, bolts from its heart toward what it reaches for and back, a flash when an answer
 * comes home. The engine says when (`send` / `receive` / `think`); the layer keeps the timing.
 */

const IMPULSES = 6;
const WAVES = 4;
/** Seconds a bolt takes between the brain's heart and its edge. */
export const BRAIN_EXIT = 0.3;
/** The heart of the brain in its own space (`BRAIN_FRAGMENT` brain space b), where bolts start and end. */
const HEART: [number, number] = [-0.05, 0.05];

/**
 * The cortex's folds: a tileable labyrinth of ridges (1) and grooves (0), grown once as a Turing pattern — random
 * values sharpened again and again by the difference of a narrow and a wide blur — so the stripes meander with an
 * even width like a brain's gyri instead of nesting like noise contours.
 */
export function bakeFolds(size = 256, seed = 20261101): DataTexture {
  const n = size * size;
  let s = seed >>> 0 || 1;
  const rnd = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rnd();
  const tmp = new Float32Array(n);
  // A running-sum box blur that wraps at the edges (the texture tiles); plain index arithmetic, no modulo per sample.
  const box = (src: Float32Array, dst: Float32Array, r: number): void => {
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < size; y++) {
      const row = y * size;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + (k + size) % size]!;
      let add = r + 1; let sub = size - r;
      for (let x = 0; x < size; x++) {
        tmp[row + x] = acc * inv;
        acc += src[row + add]! - src[row + sub]!;
        if (++add === size) add = 0;
        if (++sub === size) sub = 0;
      }
    }
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[((k + size) % size) * size + x]!;
      let add = r + 1; let sub = size - r;
      for (let y = 0; y < size; y++) {
        dst[y * size + x] = acc * inv;
        acc += tmp[add * size + x]! - tmp[sub * size + x]!;
        if (++add === size) add = 0;
        if (++sub === size) sub = 0;
      }
    }
  };
  // Two box passes make a tent: round enough that the stripes do not line up with the texture's axes.
  const blur = (src: Float32Array, dst: Float32Array, r: number, scratch: Float32Array): void => { box(src, scratch, r); box(scratch, dst, r); };
  const near = new Float32Array(n); const far = new Float32Array(n); const scratch = new Float32Array(n);
  for (let it = 0; it < 16; it++) {
    blur(a, near, 2, scratch);
    blur(a, far, 5, scratch);
    for (let i = 0; i < n; i++) { const v = 0.5 + (near[i]! - far[i]!) * 10; a[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
  blur(a, near, 1, scratch);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round(near[i]! * 255);
  const tex = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

interface Impulse { toward: string | null; t0: number; kind: 1 | -1 | 2; ox: number; oy: number; dx: number; dy: number; len: number; seed: number }
/** A wave across the cortex; one that starts where a bolt leaves takes its place from that bolt's node when it starts. */
interface Wave { x: number; y: number; t0: number; s: number; toward?: string }

export interface BrainFrame {
  time: number;
  dt: number;
  /** World position of the core, or null when there is none. */
  center: [number, number, number] | null;
  /** World half-width of the brain (the core node's radius). */
  radius: number;
  /** Smallest half-width on screen, in device pixels. */
  minPx: number;
  /** Growth while the map ignites (elastic, 1 = full size). */
  grow: number;
  bright: number;
  /** 0..1: a run is live (eased). */
  work: number;
  hovered: boolean;
  still: boolean;
  /** The core's colour, linear. */
  color: Rgb;
  /** Unit direction on screen (y up) from the core toward a node, or null when it is not drawn. */
  dirTo: (id: string) => [number, number] | null;
}

/** A one-texel stand-in for the folds until they are baked: every groove distance reads as far, so no folds show. */
function blankFolds(): DataTexture {
  const tex = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat, UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

export class BrainLayer {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private folds: DataTexture;
  private disposed = false;
  private readonly impA = Array.from({ length: IMPULSES }, () => new Vector4());
  private readonly impB = Array.from({ length: IMPULSES }, () => new Vector4());
  private readonly waveU = Array.from({ length: WAVES }, () => new Vector4());
  private impulses: Impulse[] = [];
  private waves: Wave[] = [];
  private flashes: number[] = [];
  private flash = 0;
  private hover = 0;
  private nextThought = 0;

  /** `folds` for a caller that has them baked already; otherwise they are baked once the browser is idle (~40 ms of work kept off the start). */
  constructor(shared: { uTime: IUniform<number>; uProjScale: IUniform<number> }, spark: Rgb, folds?: DataTexture) {
    this.folds = folds ?? blankFolds();
    if (!folds) {
      const bake = (): void => {
        if (this.disposed) return;
        const baked = bakeFolds();
        this.mat.uniforms['uFolds']!.value = baked;
        this.folds.dispose();
        this.folds = baked;
      };
      const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(bake, { timeout: 900 }); else setTimeout(bake, 150);
    }
    this.mat = new ShaderMaterial({
      uniforms: {
        uTime: shared.uTime, uProjScale: shared.uProjScale,
        uCenter: { value: new Vector3() }, uRadius: { value: 20 }, uMinPx: { value: 20 }, uGrow: { value: 1 },
        uWork: { value: 0 }, uFlash: { value: 0 }, uBright: { value: 1 }, uHover: { value: 0 }, uStill: { value: 0 },
        uColor: { value: new Vector3(0.3, 0.32, 1) }, uSpark: { value: new Vector3(spark[0], spark[1], spark[2]) },
        uFolds: { value: this.folds }, uImpA: { value: this.impA }, uImpB: { value: this.impB }, uWave: { value: this.waveU },
      },
      vertexShader: BRAIN_VERTEX, fragmentShader: BRAIN_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1.5;
    this.mesh.visible = false;
  }

  /** A signal leaves for `toward`: a bolt from the heart to the edge facing it, and the cortex lights up where it leaves. */
  send(toward: string, t0: number): void {
    this.push({ toward, t0, kind: 1, ox: HEART[0], oy: HEART[1], dx: 1, dy: 0, len: 1.05, seed: Math.random() * 50 });
    this.waves.push({ x: HEART[0], y: HEART[1], t0: t0 + BRAIN_EXIT * 0.4, s: 0.55, toward });
  }

  /** An answer comes home from `from`: a bolt from the edge facing it to the heart, then a flash. */
  receive(from: string, t0: number): void {
    this.push({ toward: from, t0, kind: -1, ox: HEART[0], oy: HEART[1], dx: 1, dy: 0, len: 1.05, seed: Math.random() * 50 });
    this.flashes.push(t0 + BRAIN_EXIT);
  }

  /** A thought inside the brain (or a read of its own memory, the index): a discharge between two regions and a wave. */
  think(t0: number, strength = 1): void {
    const x = -0.6 + Math.random() * 1.2; const y = -0.12 + Math.random() * 0.62;
    const a = Math.random() * Math.PI * 2;
    if (strength >= 0.5) this.push({ toward: null, t0, kind: 2, ox: x, oy: y, dx: Math.cos(a), dy: Math.sin(a), len: 0.28 + Math.random() * 0.3, seed: Math.random() * 50 });
    this.waves.push({ x, y, t0, s: 0.45 + 0.5 * strength });
  }

  /** A flash at `t` (an index read, a write landing). */
  flashAt(t: number): void { this.flashes.push(t); }

  clear(): void { this.impulses = []; this.waves = []; this.flashes = []; this.flash = 0; }

  private push(i: Impulse): void {
    this.impulses.push(i);
    if (this.impulses.length > 24) this.impulses.splice(0, this.impulses.length - 24);
  }

  update(f: BrainFrame): void {
    this.mesh.visible = f.center !== null && f.grow > 0.001;
    if (!f.center) return;
    const u = this.mat.uniforms;
    (u['uCenter']!.value as Vector3).set(f.center[0], f.center[1], f.center[2]);
    u['uRadius']!.value = f.radius;
    u['uMinPx']!.value = f.minPx;
    u['uGrow']!.value = f.grow;
    u['uBright']!.value = f.bright;
    u['uWork']!.value = f.work;
    u['uStill']!.value = f.still ? 1 : 0;
    (u['uColor']!.value as Vector3).set(f.color[0], f.color[1], f.color[2]);
    this.hover += ((f.hovered ? 1 : 0) - this.hover) * Math.min(1, f.dt * 8);
    u['uHover']!.value = this.hover;

    // Thinking: while a run is live the brain keeps firing on its own, between the signals it sends; idle, now and then.
    if (!f.still && f.time >= this.nextThought) {
      const busy = f.work > 0.5;
      if (this.nextThought > 0) this.think(f.time, busy ? 0.75 + Math.random() * 0.25 : 0.3);
      this.nextThought = f.time + (busy ? 0.32 + Math.random() * 0.45 : 3 + Math.random() * 3.5);
    }

    // Flashes land when their time comes and fade quickly.
    for (let i = this.flashes.length - 1; i >= 0; i--) if (this.flashes[i]! <= f.time) { this.flash = Math.min(1.4, this.flash + 0.85); this.flashes.splice(i, 1); }
    this.flash *= Math.exp(-f.dt * 3.2);
    u['uFlash']!.value = this.flash;

    // Bolts toward a node aim at where that node is on screen right now.
    this.impulses = this.impulses.filter((i) => f.time - i.t0 < 0.95);
    const live = this.impulses.filter((i) => i.t0 <= f.time + 0.02).slice(-IMPULSES);
    for (let k = 0; k < IMPULSES; k++) {
      const i = live[k];
      if (!i) { this.impA[k]!.set(0, 0, 0, 0); continue; }
      if (i.toward) { const d = f.dirTo(i.toward); if (d) { i.dx = d[0]; i.dy = d[1]; } }
      this.impA[k]!.set(i.dx, i.dy, i.t0, i.kind);
      this.impB[k]!.set(i.ox, i.oy, i.len, i.seed);
    }
    // Waves start where a bolt leaves (toward its node) or where a thought began.
    this.waves = this.waves.filter((w) => f.time - w.t0 < 2.4);
    const shown = this.waves.filter((w) => w.t0 <= f.time + 0.02).slice(-WAVES);
    for (let k = 0; k < WAVES; k++) {
      const w = shown[k];
      if (!w) { this.waveU[k]!.set(0, 0, 0, 0); continue; }
      if (w.toward) { const d = f.dirTo(w.toward); if (d) { w.x = HEART[0] + d[0] * 0.62; w.y = HEART[1] + d[1] * 0.5; } delete w.toward; }
      this.waveU[k]!.set(w.x, w.y, w.t0, w.s);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.folds.dispose();
  }
}
