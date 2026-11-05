import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial, Vector2, Vector3, type IUniform } from 'three';
import type { Rgb } from './colors';
import { ARC_FRAGMENT, ARC_VERTEX } from './shaders';

/**
 * The current on the links while the brain reaches for an item (UI-DESIGN "Living graph" → The brain at work): one
 * ribbon per hop of the path from the core, drawn by `shaders.ts` `ARC_FRAGMENT` as a crackling bolt whose head runs
 * out along the link, stays charged while the item is read or written, and carries the answer back as a packet.
 * Arcs name their ends by node id, so a data refresh that reorders the nodes does not break one in flight.
 */

const MAX_ARCS = 48;

export interface ReachLeg { t0: number; dur: number; u0: number; back0: number; backDur: number }
export interface ReachPlan {
  legs: ReachLeg[];
  /** When the head reaches the item. */
  arrive: number;
  /** When the answer crosses the brain's edge on its way home. */
  edgeHome: number;
  /** When the arcs start to fade. */
  end: number;
}

/**
 * The timing of one reach (UI-DESIGN "Living graph" → The brain at work): after the bolt inside the brain (`exit`
 * seconds) the head runs the hops of the path one after another — the first from the brain's edge, `brainR` world
 * units from the core — waits at the item a moment (longer for a write), and the answer runs back hop by hop.
 * `lengths` are the hops' world lengths from the core outward.
 */
export function planReach(lengths: number[], brainR: number, start: number, exit: number, write: boolean): ReachPlan {
  let t = start + exit;
  const legs = lengths.map((len, k) => {
    const u0 = k === 0 ? Math.min(0.7, (brainR * 0.9) / Math.max(1, len)) : 0;
    const dur = Math.min(0.8, Math.max(0.16, len / 340)) * (1 - u0);
    const leg: ReachLeg = { t0: t, dur, u0, back0: 0, backDur: Math.max(0.12, dur * 0.75) };
    t += dur;
    return leg;
  });
  const arrive = t;
  let back = arrive + (write ? 0.7 : 0.45);
  for (let k = legs.length - 1; k >= 0; k--) { legs[k]!.back0 = back; back += legs[k]!.backDur; }
  const first = legs[0];
  return { legs, arrive, edgeHome: first ? first.back0 + first.backDur * (1 - first.u0) : back, end: back + 0.05 };
}

export interface ArcSpec {
  from: string;
  to: string;
  /** When the head leaves `from` (engine seconds) and how long it takes to reach `to`. */
  t0: number;
  dur: number;
  /** Where along the link the head starts (past the brain's edge on the first hop). */
  u0: number;
  /** When the answer's packet leaves `to` on its way back, and how long it takes. */
  back0: number;
  backDur: number;
  /** When the arc starts to fade. */
  end: number;
  /** The packet's colour, linear. */
  color: Rgb;
  /** 1 for a read, more for a write (brighter, wider). */
  power: number;
}

export class ArcLayer {
  readonly mesh: Mesh;
  private readonly geom = new BufferGeometry();
  readonly mat: ShaderMaterial;
  private readonly from = new Float32Array(MAX_ARCS * 4 * 3);
  private readonly to = new Float32Array(MAX_ARCS * 4 * 3);
  private readonly state = new Float32Array(MAX_ARCS * 4 * 4);
  private readonly color = new Float32Array(MAX_ARCS * 4 * 3);
  private readonly power = new Float32Array(MAX_ARCS * 4);
  private arcs: Array<ArcSpec & { seed: number }> = [];

  constructor(shared: { uTime: IUniform<number>; uLight: IUniform<number> }, bolt: Rgb) {
    const corner = new Float32Array(MAX_ARCS * 4 * 2);
    const index = new Uint16Array(MAX_ARCS * 6);
    for (let k = 0; k < MAX_ARCS; k++) {
      corner.set([0, -1, 0, 1, 1, -1, 1, 1], k * 8);
      index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4 + 3], k * 6);
    }
    this.geom.setIndex(new BufferAttribute(index, 1));
    this.geom.setAttribute('position', new BufferAttribute(new Float32Array(MAX_ARCS * 4 * 3), 3));
    this.geom.setAttribute('aCorner', new BufferAttribute(corner, 2));
    this.geom.setAttribute('aFrom', new BufferAttribute(this.from, 3).setUsage(DynamicDrawUsage));
    this.geom.setAttribute('aTo', new BufferAttribute(this.to, 3).setUsage(DynamicDrawUsage));
    this.geom.setAttribute('aState', new BufferAttribute(this.state, 4).setUsage(DynamicDrawUsage));
    this.geom.setAttribute('aColor', new BufferAttribute(this.color, 3).setUsage(DynamicDrawUsage));
    this.geom.setAttribute('aPower', new BufferAttribute(this.power, 1).setUsage(DynamicDrawUsage));
    this.geom.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({
      uniforms: { uTime: shared.uTime, uLight: shared.uLight, uViewport: { value: new Vector2(1, 1) }, uWidth: { value: 16 }, uPixel: { value: 1 }, uBolt: { value: new Vector3(bolt[0], bolt[1], bolt[2]) } },
      vertexShader: ARC_VERTEX, fragmentShader: ARC_FRAGMENT,
      // A ribbon's winding depends on which way its link runs on screen, so neither face may be culled.
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.mesh = new Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0.5;
  }

  add(a: ArcSpec): void {
    this.arcs.push({ ...a, seed: Math.random() * 100 });
    if (this.arcs.length > MAX_ARCS) this.arcs.splice(0, this.arcs.length - MAX_ARCS);
  }

  clear(): void { this.arcs = []; this.geom.setDrawRange(0, 0); }

  get active(): number { return this.arcs.length; }

  /** Writes every live arc's ends and state for this frame; `posOf` gives a node's world position (null when it is gone). */
  update(time: number, posOf: (id: string) => [number, number, number] | null, viewport: [number, number], pixelRatio: number): void {
    this.arcs = this.arcs.filter((a) => time < a.end + 0.5);
    const u = this.mat.uniforms;
    (u['uViewport']!.value as Vector2).set(viewport[0], viewport[1]);
    u['uWidth']!.value = 15 * pixelRatio;
    u['uPixel']!.value = pixelRatio;
    let n = 0;
    for (const a of this.arcs) {
      if (time < a.t0) continue;
      const pa = posOf(a.from); const pb = posOf(a.to);
      if (!pa || !pb) continue;
      const head = a.u0 + (1 - a.u0) * Math.min(1, (time - a.t0) / Math.max(0.01, a.dur));
      // Full strength while the head runs; once it has arrived the link stays charged at a lower hum, so the moving
      // head and the answer's packet are what catches the eye.
      const arrived = a.t0 + a.dur;
      const charge = time < arrived ? 1 : 0.5 + 0.5 * Math.exp(-(time - arrived) * 2.4);
      const alpha = (time < a.end ? Math.min(1, (time - a.t0) / 0.08 + 0.4) : Math.max(0, 1 - (time - a.end) / 0.5)) * charge;
      const back = time >= a.back0 && time <= a.back0 + a.backDur ? (time - a.back0) / a.backDur : -1;
      for (let v = 0; v < 4; v++) {
        const i = n * 4 + v;
        this.from.set(pa, i * 3);
        this.to.set(pb, i * 3);
        // The packet keeps its own strength: the alpha's hum must not dim the answer coming home.
        this.state.set([head, back >= 0 ? Math.max(alpha, 0.85) : alpha, a.seed, back], i * 4);
        this.color.set(a.color, i * 3);
        this.power[i] = a.power;
      }
      n++;
    }
    this.geom.setDrawRange(0, n * 6);
    for (const name of ['aFrom', 'aTo', 'aState', 'aColor', 'aPower']) (this.geom.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.geom.dispose(); this.mat.dispose(); }
}
