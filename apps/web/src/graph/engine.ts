import {
  AddEquation, AdditiveBlending, BufferAttribute, DataTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType, BufferGeometry, CustomBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, NoToneMapping, OneFactor, ZeroFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Points, ReverseSubtractEquation, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
  type Material,
  type InterleavedBufferAttribute,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { ArcLayer, planReach } from './arcs';
import { BRAIN_EXIT, BrainLayer } from './brain';
import { CameraRig } from './camera';
import { forLight, type Rgb } from './colors';
import { LabelLayer, TOGGLE_SIZE, type GlyphMark, type LabelCandidate, type RegionLabel, type ToggleMark } from './labels';
import { ARCHIVE_GROUP, CORE_GROUP, hash01, INBOX_GROUP, JOURNAL_GROUP, Layout, MAP_GROUP, MIND_ZONE, UNSORTED_GROUP, type Dims, type LayoutSnapshot, type ZoneLayout } from './layout';
import { NEBULA_FRAGMENT, NEBULA_VERTEX, NODE_FRAGMENT, NODE_VERTEX, PULSE_FRAGMENT, PULSE_VERTEX, STAR_FRAGMENT, STAR_VERTEX, ZONE_FRAGMENT } from './shaders';

/**
 * The living graph: a WebGL scene of category regions (spec: docs/UI-DESIGN.md "Living graph"), with the regions of
 * each map ringed as an island (UI-DESIGN "Maps"). It owns the layout, camera, layers, labels and pointer input;
 * React feeds it data and view state and listens to callbacks.
 */

export const SHAPE: Record<string, number> = { note: 0, project: 1, task: 2, idea: 3, person: 4, resource: 5, journal: 6, area: 7, inbox: 8, ghost: 9, tag: 10, goal: 11, habit: 12, event: 13, core: 14, map: 15 };

export interface GNode {
  id: string;
  title: string;
  group: string;
  hub: boolean;
  /** World radius. */
  r: number;
  /** sRGB 0..1. */
  color: Rgb;
  shape: number;
  closed: boolean;
  /** 0..1 drawn into the shape (a goal's ring, a project's fill); -1 when the kind has none. */
  progress: number;
  /** Label order when space is short: higher first. */
  rank: number;
  tier: 'hub' | 'major' | 'minor';
}

/** Where the camera is headed, with a mark of the user's own moves so a later flight back can yield to them. */
export interface CamPose { x: number; y: number; z: number; dist: number; mark: number }
export interface GLink { source: string; target: string; kind: string }
/** Which names the map shows: every name, only regions' and islands' (`places`), or none (UI-DESIGN "Map-style labels"). */
export type MapNames = 'all' | 'places' | 'none';
/** The brush tools (UI-DESIGN "Mind map" → Spreading): open a crowded spot up, or pull items closer together. */
export type SpreadMode = 'spread' | 'gather';
export interface GGroup {
  id: string;
  title: string;
  /** Signature colour (labels, chips). */
  color: Rgb;
  /** Deeper, saturated colour of the region's nebula. */
  glow: Rgb;
  kind: 'category' | 'inbox' | 'journal' | 'unsorted' | 'archive' | 'map' | 'core';
  /** Second line under the region's name (how many items it holds). */
  sub: string;
  /** The map (zone) this region belongs to; null on the mind map. */
  map: string | null;
}

/** A map drawn as an island of regions with its own outline and name (UI-DESIGN "Maps"). */
export interface GZone {
  id: string;
  title: string;
  /** Colour of its name and outline. */
  color: Rgb;
  glow: Rgb;
  /** Second line under its name (how many items it holds). */
  sub: string;
  role: 'character' | null;
  /** The mark at the island's centre (`graph/zoneGlyphs.ts`). */
  symbol: string;
  /** Zones it is connected to: map ids and `mind`; a link across unconnected zones is not drawn. */
  connects: string[];
  /** Text of the switch on its label when it is connected to the mind map, and when it is cut off. */
  switchOn: string;
  switchOff: string;
}

export interface GView {
  selectedId: string | null;
  focusId: string | null;
  /** Nodes that stay bright; everything else dims (local focus). */
  focusIds: ReadonlySet<string> | null;
  /** Search hits; everything else dims. */
  matchIds: ReadonlySet<string> | null;
  created: ReadonlySet<string>;
  updated: ReadonlySet<string>;
  /** A category picked in the legend: its region stays lit, the others fade. */
  isolateGroup: string | null;
}

export interface GCallbacks {
  onHover?: (id: string | null) => void;
  onClick?: (id: string, ev: PointerEvent) => void;
  onDoubleClick?: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  onBackgroundClick?: () => void;
  /** A category was clicked: its name, its centre (hub) or, zoomed out, anywhere inside its region. */
  onGroupClick?: (group: string) => void;
  /** A map's name over its island was clicked. */
  onZoneClick?: (map: string) => void;
  /** The switch on a map's label was pressed: connect it to the mind map, or cut it off. */
  onZoneToggle?: (map: string) => void;
  /** The mind map's core node was clicked. */
  onCoreClick?: () => void;
  /** The layout changed in a way worth saving (settled, a region or a node was dragged). */
  onLayoutChange?: () => void;
  /** Fires after each rendered frame (the hover card follows its node with it). */
  onFrame?: () => void;
}

export interface GOptions { reducedMotion: boolean; coarse: boolean }

const MAX_PULSES = 384;
/** On-screen gap (CSS px) between neighbouring nodes at which major / minor item names show; region names fade out over REGION_FADE. */
const MAJOR_GAP = 38;
const MINOR_GAP = 64;
const REGION_FADE: [number, number] = [26, 42];
const STAR_COUNT = 1600;
const BG = 0x03050b;
const BG_LIGHT = 0xf3f5fa;
/** The brain at the core is never drawn narrower than this on screen (half-width, CSS px), so it reads as a brain from afar. */
const BRAIN_MIN_PX = 24;
/** The electric colour of the brain's signals (UI-DESIGN "Living graph"), sRGB. */
const SPARK: Rgb = [0.56, 0.9, 1];
/** The spread tool's brush radius on screen (CSS px), larger on touch screens (UI-DESIGN "Mind map" → Spreading). */
const SPREAD_R = 110;
const SPREAD_R_TOUCH = 140;

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linRgb = (c: Rgb): Rgb => [lin(c[0]), lin(c[1]), lin(c[2])];
const css = (c: Rgb, a = 1): string => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
const lighten = (c: Rgb, k: number): Rgb => [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k];
/** The nodes' growth curve (`NODE_VERTEX` `elasticOut`), for the brain's own ignition. */
const elasticOut = (t: number): number => (t >= 1 ? 1 : Math.sin(-13 * (Math.PI / 2) * (t + 1)) * 2 ** (-10 * t) + 1);

interface Link { s: number; t: number; cross: boolean; /** Between two connected maps: drawn as a bridge. */ bridge: boolean; kind: string }
/** The region-wide ignition played when the map comes on screen (UI-DESIGN "Living graph" → Ignition); the queue is keyed by id so a data refresh mid-way does not break the wave. */
interface Intro { t0: number; until: number; queue: Array<{ at: number; id: string }> }
const ZONE_LABEL = 'zone:';
/** Screen pixels between an island's outermost node and its toggle. */
const TOGGLE_GAP = 14;

/** Tileable value-noise fbm baked once into a single-channel texture (the nebula shader samples it). */
function bakeNoise(size: number): DataTexture {
  const lattice = (period: number, seed: number): Float32Array => {
    const a = new Float32Array(period * period);
    for (let i = 0; i < a.length; i++) a[i] = hash01(`n${seed}:${i}`, seed);
    return a;
  };
  const octaves = [4, 8, 16, 32, 64].map((p, k) => ({ p, a: 0.5 ** (k + 1), g: lattice(p, k + 3) }));
  const data = new Uint8Array(size * size);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const o of octaves) {
      const fx = (x / size) * o.p; const fy = (y / size) * o.p;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy);
      const tx = smooth(fx - x0); const ty = smooth(fy - y0);
      const at = (i: number, j: number): number => o.g[((j % o.p) + o.p) % o.p * o.p + (((i % o.p) + o.p) % o.p)]!;
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      v += o.a * (top + (bot - top) * ty);
    }
    data[y * size + x] = Math.round(Math.min(1, v / 0.97) * 255);
  }
  const tex = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
interface Pulse { link: number; t0: number; dur: number; rev: boolean; color: Rgb }
interface Nebula { group: string; mesh: Mesh; mat: ShaderMaterial; cx: number; cy: number; cz: number; r: number; ready: boolean; target: number }
interface ZoneRing { zone: string; mesh: Mesh; mat: ShaderMaterial; cx: number; cy: number; cz: number; r: number; ready: boolean; target: number }
interface Down { id: string | null; region: string | null; x: number; y: number; moved: boolean; button: number; pointerType: string; consumed: boolean; shift: boolean }

export class LivingGraph {
  private readonly container: HTMLElement;
  private readonly cb: GCallbacks;
  private readonly opts: GOptions;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig = new CameraRig(40);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly labels: LabelLayer;
  private readonly layout = new Layout(2);
  private readonly uniforms = { uTime: { value: 0 }, uProjScale: { value: 1 }, uMinPx: { value: 2.6 }, uGlow: { value: 1 }, uPixelRatio: { value: 1 }, uSize: { value: 7 }, uWork: { value: 0 }, uLight: { value: 0 } };
  /** The light theme (UI-DESIGN "Light theme"): paper instead of the night sky; see `setTheme`. */
  private light = false;
  /** What the model sent, before the light theme's colours: a theme switch recolours from it without a rebuild. */
  private raw: { nodes: GNode[]; groups: GGroup[]; zones: GZone[] } = { nodes: [], groups: [], zones: [] };

  private nodes: GNode[] = [];
  private index = new Map<string, number>();
  private links: Link[] = [];
  private incident: number[][] = [];
  private groups: GGroup[] = [];
  private groupOrder: string[] = [];
  private zones: GZone[] = [];
  /** Zone (map) id of every node's group, `mind` on the mind map. */
  private zoneOfNode: string[] = [];
  private zoneRings: ZoneRing[] = [];
  private intro: Intro | null = null;
  private labelOrder: number[] = [];
  private view: GView = { selectedId: null, focusId: null, focusIds: null, matchIds: null, created: new Set(), updated: new Set(), isolateGroup: null };
  private hoverId: string | null = null;
  private bright = new Float32Array(0);
  private birth = new Map<string, number>();

  private nodeGeom: InstancedBufferGeometry | null = null;
  private nodeMesh: Mesh | null = null;
  private readonly nodeMat: ShaderMaterial;
  private linkGeom = new LineSegmentsGeometry();
  private readonly linkMat: LineMaterial;
  private readonly linkMesh: LineSegments2;
  private linkPos = new Float32Array(6);
  private linkCol = new Float32Array(6);
  private linkBase = new Float32Array(6);
  private nebulae: Nebula[] = [];
  private readonly nebulaGeom = new PlaneGeometry(1, 1);
  private readonly noiseTex = bakeNoise(256);
  private stars: Points | null = null;
  private readonly pulseGeom = new BufferGeometry();
  private readonly pulseMat: ShaderMaterial;
  private readonly pulsePos = new Float32Array(MAX_PULSES * 3);
  private readonly pulseCol = new Float32Array(MAX_PULSES * 3);
  private readonly pulseAlpha = new Float32Array(MAX_PULSES);
  private pulses: Pulse[] = [];
  /** The brain at the core and the current it sends along the links (UI-DESIGN "Living graph" → The brain at work). */
  private readonly brain: BrainLayer;
  private readonly arcs: ArcLayer;
  /** The brain touched these nodes: id → engine time its signal arrives (they glow for a moment after). */
  private touched = new Map<string, number>();
  /** Nodes a signal passed through on its way (a category on the path): id → when; they flicker. */
  private relayed = new Map<string, number>();
  /** A brain run is live: the brain at the core thinks (`uWork`). */
  private working = false;
  /** Items' names on the map (the toolbar's names switch); region and island names always show. */
  private names: MapNames = 'all';
  /** The spread tool is on: a click gives the items under the brush more room instead of opening anything. */
  private spreadMode: SpreadMode | null = null;
  private get spreadOn(): boolean { return this.spreadMode !== null; }
  /** The brush that follows the pointer while the spread tool is on. */
  private readonly ring: HTMLDivElement;
  /** Index of the mind map's core node (`CORE_GROUP`), or -1. */
  private coreIndex = -1;
  private pulseClock = 0;
  private hoverPulseClock = 0;

  private pos = new Float32Array(0);
  private screen = new Float32Array(0);
  private phase = new Float32Array(0);
  private width = 1;
  private height = 1;
  private time = 0;
  private last = 0;
  private raf = 0;
  private paused = false;
  private disposed = false;
  private slowFrames = 0;
  private stateDirty = true;
  private labelsDirty = true;
  /** Median gap between neighbouring nodes (world units); label levels are measured against it. */
  private spacing = 30;
  private wasMoving = false;
  /** Region whose name (or, zoomed out, whose area) is under the pointer. */
  private hotRegion: string | null = null;
  /** How much of the overview (region names only) is showing: 1 far away, 0 close in. */
  private overview = 1;
  private groupDrag: { group: string; x: number; y: number; z: number } | null = null;
  /** Dragging an island by its name carries every region of the map along. */
  private zoneDrag: { zone: string; x: number; y: number } | null = null;
  /** The first framing was made before the layout settled (a slow machine cuts the warm-up short): re-frame once it
   * settles, unless the user has moved the camera by then. */
  private autoFit = false;
  /** Counts the user's own pans and zooms (wheel, pinch, drag, buttons); app flights do not count. */
  private userMoves = 0;

  private pointers = new Map<number, { x: number; y: number }>();
  private down: Down | null = null;
  private dragging: string | null = null;
  private pinch: { dist: number; x: number; y: number } | null = null;
  private velocity = { x: 0, y: 0, t: 0 };
  private hoverAt: { x: number; y: number } | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, cb: GCallbacks, opts: GOptions) {
    this.container = container;
    this.cb = cb;
    this.opts = opts;
    this.rig.reducedMotion = opts.reducedMotion;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    // The glow hides the difference above 1.5x, and the GPU work grows with the square of it.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(BG, 1);
    this.renderer.toneMapping = NoToneMapping;
    const canvas = this.renderer.domElement;
    canvas.className = 'graph-canvas';
    container.appendChild(canvas);
    this.labels = new LabelLayer(container, { onZoneToggle: (map) => this.cb.onZoneToggle?.(map) });
    this.ring = document.createElement('div');
    this.ring.className = 'spread-ring';
    container.appendChild(this.ring);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.7, 0.5, 0.32);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.nodeMat = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: NODE_VERTEX, fragmentShader: NODE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.linkMat = new LineMaterial({ vertexColors: true, linewidth: 1.25, transparent: true, depthWrite: false, worldUnits: false });
    this.linkMat.blending = AdditiveBlending;
    this.linkMat.depthTest = false;
    this.linkGeom.setPositions(this.linkPos);
    this.linkGeom.setColors(this.linkCol);
    this.linkMesh = new LineSegments2(this.linkGeom, this.linkMat);
    this.linkMesh.frustumCulled = false;
    this.linkMesh.renderOrder = -1;
    this.scene.add(this.linkMesh);

    this.pulseGeom.setAttribute('position', new BufferAttribute(this.pulsePos, 3).setUsage(DynamicDrawUsage));
    this.pulseGeom.setAttribute('aColor', new BufferAttribute(this.pulseCol, 3).setUsage(DynamicDrawUsage));
    this.pulseGeom.setAttribute('aAlpha', new BufferAttribute(this.pulseAlpha, 1).setUsage(DynamicDrawUsage));
    this.pulseGeom.setDrawRange(0, 0);
    this.pulseMat = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: PULSE_VERTEX, fragmentShader: PULSE_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
    const pulses = new Points(this.pulseGeom, this.pulseMat);
    pulses.frustumCulled = false;
    pulses.renderOrder = 2;
    this.scene.add(pulses);
    const spark = linRgb(SPARK);
    this.arcs = new ArcLayer(this.uniforms, spark);
    this.scene.add(this.arcs.mesh);
    this.brain = new BrainLayer(this.uniforms, spark);
    this.scene.add(this.brain.mesh);
    this.buildStars();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.setPaused(true); });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- data

  setData(rawNodes: GNode[], links: GLink[], rawGroups: GGroup[], rawZones: GZone[] = []): void {
    this.raw = { nodes: rawNodes, groups: rawGroups, zones: rawZones };
    const { nodes, groups, zones } = this.themed(rawNodes, rawGroups, rawZones);
    // Draw order: minor nodes first, hubs last (on top).
    const tierOrder = { minor: 0, major: 1, hub: 2 } as const;
    this.nodes = [...nodes].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);
    this.index = new Map(this.nodes.map((n, i) => [n.id, i]));
    this.groups = groups;
    this.zones = zones;
    const cats = groups.filter((g) => g.kind === 'category').map((g) => g.id);
    const centres = groups.filter((g) => g.kind === 'map').map((g) => g.id);
    this.groupOrder = [CORE_GROUP, ...cats, ...centres, JOURNAL_GROUP, UNSORTED_GROUP, INBOX_GROUP, ARCHIVE_GROUP];
    const zoneOfGroup = new Map<string, string>();
    for (const g of groups) if (g.map) zoneOfGroup.set(g.id, g.map);
    this.zoneOfNode = this.nodes.map((n) => zoneOfGroup.get(n.group) ?? MIND_ZONE);
    const connected = (a: string, b: string): boolean => a === b || Boolean(zones.find((z) => z.id === a)?.connects.includes(b)) || Boolean(zones.find((z) => z.id === b)?.connects.includes(a));
    // A link between two maps that are not connected is not drawn, pulsed or simulated: the islands stay apart.
    this.links = [];
    for (const l of links) {
      const s = this.index.get(l.source);
      const t = this.index.get(l.target);
      if (s === undefined || t === undefined || s === t) continue;
      const bridge = this.zoneOfNode[s] !== this.zoneOfNode[t];
      if (bridge && !connected(this.zoneOfNode[s]!, this.zoneOfNode[t]!)) continue;
      this.links.push({ s, t, cross: this.nodes[s]!.group !== this.nodes[t]!.group, bridge, kind: l.kind });
    }
    this.incident = this.nodes.map(() => []);
    this.links.forEach((l, i) => { this.incident[l.s]!.push(i); this.incident[l.t]!.push(i); });
    this.labelOrder = this.nodes.map((_, i) => i).sort((a, b) => this.nodes[b]!.rank - this.nodes[a]!.rank);
    this.coreIndex = this.nodes.findIndex((n) => n.group === CORE_GROUP);

    const zoneLayout: ZoneLayout | undefined = zones.length
      ? { of: zoneOfGroup, list: zones.map((z) => ({ id: z.id, near: connected(z.id, MIND_ZONE) })), connected }
      : undefined;
    const born = this.layout.setData(
      this.nodes.map((n) => ({ id: n.id, group: n.group, hub: n.hub, r: n.r })),
      this.links.map((l) => ({ source: this.nodes[l.s]!.id, target: this.nodes[l.t]!.id })),
      this.groupOrder,
      zoneLayout,
    );
    if (!this.opts.reducedMotion) for (const id of born) this.birth.set(id, this.time + 0.15);
    for (const id of born) this.burstFrom(id);
    this.spacing = this.layout.spacing();
    // A map laid out from scratch may have settled inside `setData`, where no settle reports it: save it now.
    if (this.layout.takeFresh()) this.cb.onLayoutChange?.();

    const n = this.nodes.length;
    this.pos = new Float32Array(n * 3);
    this.screen = new Float32Array(n * 4);
    this.bright = new Float32Array(n).fill(1);
    this.phase = new Float32Array(n * 3);
    this.nodes.forEach((nd, i) => { this.phase[i * 3] = hash01(nd.id, 11); this.phase[i * 3 + 1] = hash01(nd.id, 12); this.phase[i * 3 + 2] = hash01(nd.id, 13); });
    this.pulses = this.pulses.filter((p) => p.link < this.links.length);
    this.buildNodes();
    this.buildLinks();
    this.buildNebulae();
    this.buildZones();
    this.stateDirty = true;
    this.labelsDirty = true;
  }

  /**
   * The ignition played whenever the map comes on screen (first load, back from another page): every item grows in
   * again in a wave from its region's centre outward, signals run along the links ahead of the wave, the islands
   * light up after the mind map and their bridges last; with `camera`, the view settles in from slightly farther away.
   */
  playIntro(opts: { camera?: boolean } = {}): void {
    if (this.opts.reducedMotion || !this.nodes.length) return;
    const t0 = this.time + 0.05;
    const hops = this.hopsFromHubs();
    const queue: Intro['queue'] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i]!;
      const island = this.zoneOfNode[i] !== MIND_ZONE ? 0.55 : 0;
      const at = t0 + island + Math.min(1.1, 0.09 * hops[i]!) + hash01(nd.id, 41) * 0.22;
      this.birth.set(nd.id, at);
      queue.push({ at, id: nd.id });
    }
    queue.sort((a, b) => a.at - b.at);
    this.intro = { t0, until: t0 + 3.2, queue };
    this.pulses = [];
    this.arcs.clear();
    this.brain.clear();
    for (const nb of this.nebulae) nb.mat.uniforms['uIntensity']!.value = 0;
    for (const z of this.zoneRings) z.mat.uniforms['uIntensity']!.value = 0;
    this.stateDirty = true;
    if (opts.camera) {
      const g = this.rig.goalPose;
      this.rig.flyTo(g.tx, g.ty, g.tz, g.dist * 1.18, 0);
      this.rig.flyTo(g.tx, g.ty, g.tz, g.dist, 1.5);
    }
  }

  /** Link hops from the nearest region centre (hub) for every node; nodes no hub reaches count as far. */
  private hopsFromHubs(): number[] {
    const hops = this.nodes.map(() => -1);
    let frontier: number[] = [];
    this.nodes.forEach((n, i) => { if (n.hub) { hops[i] = 0; frontier.push(i); } });
    for (let d = 1; frontier.length && d < 12; d++) {
      const next: number[] = [];
      for (const i of frontier) for (const li of this.incident[i] ?? []) {
        const l = this.links[li]!;
        const j = l.s === i ? l.t : l.s;
        if (hops[j]! < 0) { hops[j] = d; next.push(j); }
      }
      frontier = next;
    }
    return hops.map((h, i) => (h < 0 ? 3 + hash01(this.nodes[i]!.id, 42) * 3 : h));
  }

  setView(v: Partial<GView>): void {
    this.view = { ...this.view, ...v };
    this.stateDirty = true;
    this.labelsDirty = true;
  }

  // ---------------------------------------------------------------- camera API

  /**
   * Glides to a node. `zoom: true` comes close; `'reveal'` comes just close enough for item names to show (never
   * moving away); `false` only pans.
   */
  flyToNode(id: string, zoom: boolean | 'reveal' = true): void {
    this.autoFit = false;
    const i = this.index.get(id);
    const n = i === undefined ? undefined : this.layout.node(id);
    if (!n) return;
    const reveal = this.revealDistance();
    const dist = zoom === 'reveal' ? Math.min(this.rig.goalDistance, reveal) : zoom ? Math.min(Math.max(this.rig.goalDistance * 0.55, 170), Math.max(420, reveal * 0.8)) : this.rig.goalDistance;
    this.rig.flyTo(n.x, n.y, n.z, dist, 1.15);
  }

  /** Zooms into a category's region, like a map opening a city: the region fills the free view and its names appear. */
  flyToGroup(group: string): void {
    this.autoFit = false;
    const neb = this.nebulae.find((x) => x.group === group);
    if (!neb) return;
    const fit = this.rig.distanceToFit(neb.r * 0.82, 0.12);
    this.rig.flyTo(neb.cx, neb.cy, neb.cz, Math.min(fit, this.revealDistance() * 1.15), 1.2);
  }

  /** The camera's current goal, marked with the user's move count (see `movedSince`). */
  cameraPose(): CamPose {
    const g = this.rig.goalPose;
    return { x: g.tx, y: g.ty, z: g.tz, dist: g.dist, mark: this.userMoves };
  }

  /** True when the user panned or zoomed by hand after `pose` was taken: a flight back would fight them. */
  movedSince(pose: CamPose): boolean { return this.userMoves !== pose.mark; }

  /** Glides back to a pose taken earlier (stepping back out of an item or a category). */
  flyToPose(pose: CamPose, seconds = 1.05): void {
    this.autoFit = false;
    this.rig.flyTo(pose.x, pose.y, pose.z, pose.dist, seconds);
  }

  /** Camera distance at which most item names have room (spec: UI-DESIGN "Map-style labels"). */
  private revealDistance(): number {
    const projScale = this.height / (2 * Math.tan((this.rig.camera.fov * Math.PI) / 360));
    return Math.max(120, (projScale * this.spacing) / MINOR_GAP);
  }

  /** Where the user left the map; call before the first `setData`. */
  restoreLayout(saved: Partial<LayoutSnapshot>): void { this.layout.restore(saved); }

  /**
   * Takes the layout another open copy of the app saved (docs/ARCHITECTURE.md "Layout"). Refused (false) while the
   * user drags: their own save follows and is merged with it then.
   */
  adoptLayout(saved: Partial<LayoutSnapshot>, reheat = false): boolean {
    if (this.dragging || this.groupDrag || this.zoneDrag) return false;
    this.layout.adopt(saved, reheat);
    this.spacing = this.layout.spacing();
    this.labelsDirty = true;
    this.stateDirty = true;
    return true;
  }

  /** The layout worth saving (flat view only: 3D positions are not the user's map). */
  layoutSnapshot(): LayoutSnapshot | null { return this.layout.dims === 2 ? this.layout.snapshot() : null; }

  /** Lays the whole map out again from scratch (forgets dragged regions and pins). */
  rearrange(): void {
    this.layout.rearrange();
    this.spacing = this.layout.spacing();
    this.labelsDirty = true;
    setTimeout(() => this.frameAll(1.1), 60);
  }

  /** The user asks to see everything (or the given ids): counts as their own camera move. */
  fit(seconds = 1.1, ids?: ReadonlySet<string>): void {
    this.userMoves++;
    this.frameAll(seconds, ids);
  }

  /** An app flight to the given ids (a map's island, the mind map, new items): not the user's move, so a step back still returns the camera. */
  frameNodes(seconds = 1.1, ids?: ReadonlySet<string>): void { this.frameAll(seconds, ids); }

  /** A brain run is live: the brain at the core thinks — waves, sparks, aura — until it is over (UI-DESIGN "Living graph" → The brain at work). */
  setWorking(on: boolean): void { this.working = on; }

  /** Which names show (UI-DESIGN "Map-style labels"): all, only regions' and islands', or none; the hover card still names what is under the pointer. */
  setNames(names: MapNames): void {
    if (names === this.names) return;
    this.names = names;
    this.labelsDirty = true;
  }

  /**
   * New colours for the same items, regions and islands (a colour being picked, or its save coming back): the buffers'
   * colours and the clouds' are rewritten in place, nothing is rebuilt and nothing moves. Anything else goes to `setData`.
   */
  setColors(rawNodes: GNode[], rawGroups: GGroup[], rawZones: GZone[]): void {
    this.raw = { nodes: rawNodes, groups: rawGroups, zones: rawZones };
    const { nodes, groups, zones } = this.themed(rawNodes, rawGroups, rawZones);
    const attr = this.nodeGeom?.getAttribute('iColor') as InstancedBufferAttribute | undefined;
    for (const nd of nodes) {
      const i = this.index.get(nd.id);
      if (i === undefined) continue;
      this.nodes[i] = nd;
      if (attr) { const c = linRgb(nd.color); attr.setXYZ(i, c[0], c[1], c[2]); }
    }
    if (attr) attr.needsUpdate = true;
    this.fillLinkColors();
    this.groups = groups;
    this.zones = zones;
    for (const nb of this.nebulae) {
      const g = groups.find((x) => x.id === nb.group);
      if (g) { const c = linRgb(g.glow); (nb.mat.uniforms['uColor']!.value as Vector3).set(c[0], c[1], c[2]); }
    }
    for (const z of this.zoneRings) {
      const zone = zones.find((x) => x.id === z.zone);
      if (zone) { const c = linRgb(zone.glow); (z.mat.uniforms['uColor']!.value as Vector3).set(c[0], c[1], c[2]); }
    }
    this.stateDirty = true;
    this.labelsDirty = true;
  }

  /**
   * The brush tools (UI-DESIGN "Mind map" → Spreading): while one is on the cursor is its mark (arrows outward to
   * spread, inward to gather) with a brush ring around it, hover stays quiet, a drag still pans, and a click opens up
   * or closes in the spot under the brush; Shift or Alt does the other tool's work while held. Every click is reported
   * at once (`onLayoutChange`), so the change is saved before the map has even finished moving.
   */
  setSpread(mode: SpreadMode | null): void {
    if (mode === this.spreadMode) return;
    const was = this.spreadMode;
    this.spreadMode = mode;
    this.renderer.domElement.classList.toggle('is-spreading', mode !== null);
    this.ring.classList.remove('is-on');
    this.setGathering(false);
    if (mode && !was) {
      this.setHover(null);
      if (this.hotRegion) { this.hotRegion = null; this.labelsDirty = true; }
      window.addEventListener('keydown', this.onSpreadKey);
      window.addEventListener('keyup', this.onSpreadKey);
    } else if (!mode && was) {
      window.removeEventListener('keydown', this.onSpreadKey);
      window.removeEventListener('keyup', this.onSpreadKey);
    }
    this.setCursor('grab');
  }

  private onSpreadKey = (e: KeyboardEvent): void => this.setGathering(e.shiftKey || e.altKey);

  /** Whether a click now gathers: the gather tool, or the spread tool with Shift or Alt held (and the other way round). */
  private gathersWith(flip: boolean): boolean { return (this.spreadMode === 'gather') !== flip; }

  private setGathering(flip: boolean): void {
    const on = this.spreadOn && this.gathersWith(flip);
    this.renderer.domElement.classList.toggle('is-gathering', on);
    this.ring.classList.toggle('is-gathering', on);
  }

  /** The cursor for the moment, unless the spread tool's own cursor (set by CSS) is showing. */
  private setCursor(c: string): void {
    this.renderer.domElement.style.cursor = this.spreadOn && c !== 'grabbing' ? '' : c;
  }

  private moveRing(x: number, y: number): void {
    const r = this.opts.coarse ? SPREAD_R_TOUCH : SPREAD_R;
    this.ring.style.width = `${r * 2}px`;
    this.ring.style.height = `${r * 2}px`;
    this.ring.style.transform = `translate3d(${Math.round(x - r)}px, ${Math.round(y - r)}px, 0)`;
    this.ring.classList.add('is-on');
  }

  /** Opens up (or gathers) the spot under the brush at a screen point: more room for every item there, and a push. */
  private spreadAt(x: number, y: number, gather: boolean): void {
    const R = this.opts.coarse ? SPREAD_R_TOUCH : SPREAD_R;
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    const right: [number, number, number] = [m[0]!, m[1]!, m[2]!];
    const up: [number, number, number] = [m[4]!, m[5]!, m[6]!];
    const hits: Array<{ id: string; f: number; dir: [number, number, number] }> = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.screen[i * 4 + 3]! <= 0 || i === this.coreIndex) continue;
      const dx = this.screen[i * 4]! - x; const dy = this.screen[i * 4 + 1]! - y;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const id = this.nodes[i]!.id;
      // On screen away from the click (y down), turned into the world through the camera's own axes.
      let ux = dx / Math.max(d, 0.001); let uy = dy / Math.max(d, 0.001);
      if (d < 0.5) { const a = hash01(id, 7) * Math.PI * 2; ux = Math.cos(a); uy = Math.sin(a); }
      hits.push({ id, f: 1 - (d / R) ** 2, dir: [right[0] * ux - up[0] * uy, right[1] * ux - up[1] * uy, right[2] * ux - up[2] * uy] });
    }
    const projScale = this.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const worldPerPx = Math.max(1, this.rig.distance) / projScale;
    if (hits.length) {
      this.layout.spread(hits, gather, R * worldPerPx * 0.06);
      // Saved now, not only once the map has settled: a refresh a moment later keeps the change.
      this.cb.onLayoutChange?.();
    }
    this.pulse(x, y, R, gather);
    this.labelsDirty = true;
  }

  /** The brush's answer to a click: a ring that widens (spread) or closes in (gather) and fades. */
  private pulse(x: number, y: number, r: number, gather: boolean): void {
    if (this.opts.reducedMotion) return;
    const el = document.createElement('div');
    el.className = `spread-pulse${gather ? ' is-gathering' : ''}`;
    el.style.width = `${r * 2}px`;
    el.style.height = `${r * 2}px`;
    el.style.left = `${Math.round(x - r)}px`;
    el.style.top = `${Math.round(y - r)}px`;
    this.container.appendChild(el);
    const frames = gather ? [{ transform: 'scale(1.1)', opacity: 0.9 }, { transform: 'scale(0.25)', opacity: 0 }] : [{ transform: 'scale(0.25)', opacity: 0.9 }, { transform: 'scale(1.15)', opacity: 0 }];
    const anim = el.animate(frames, { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' });
    anim.onfinish = () => el.remove();
  }

  /**
   * The brain touched these nodes (read or wrote them): for each one a bolt leaves the brain's heart, a current runs
   * out along the drawn links to the node, which lights up, and the answer travels back home and flashes in the
   * brain. Its own index and memory (the core itself) make it think instead; a node no link joins to the core only
   * glows.
   */
  signal(ids: string[], kind: 'read' | 'write'): void {
    if (this.opts.reducedMotion || this.coreIndex < 0) return;
    const write = kind === 'write';
    let start = this.time + 0.03;
    for (const id of ids) {
      const target = this.index.get(id);
      if (target === undefined) continue;
      if (target === this.coreIndex) { this.brain.think(start, 1); this.brain.flashAt(start + 0.2); start += 0.12; continue; }
      const hops = this.pathFrom(this.coreIndex, target);
      if (!hops) { this.touched.set(id, start); continue; }
      this.reach(hops, target, start, write);
      start += write ? 0.18 : 0.12;
    }
    this.stateDirty = true;
  }

  /** One reach of the brain: out of its heart, hop by hop to the node, a moment there, and the answer back home. */
  private reach(hops: Array<{ link: number; rev: boolean }>, target: number, start: number, write: boolean): void {
    const ends = hops.map((h) => { const l = this.links[h.link]!; return h.rev ? [l.t, l.s] as const : [l.s, l.t] as const; });
    const lengths = ends.map(([a, b]) => Math.hypot(this.pos[a * 3]! - this.pos[b * 3]!, this.pos[a * 3 + 1]! - this.pos[b * 3 + 1]!, this.pos[a * 3 + 2]! - this.pos[b * 3 + 2]!));
    // The first hop starts at the brain's edge: the bolt inside it has carried the signal that far.
    const plan = planReach(lengths, this.nodes[ends[0]![0]]!.r, start, BRAIN_EXIT, write);
    const first = this.nodes[ends[0]![1]]!.id;
    this.brain.send(first, start);
    this.brain.receive(first, plan.edgeHome);
    this.touched.set(this.nodes[target]!.id, plan.arrive);
    const packet = linRgb(lighten(this.nodes[target]!.color, 0.4));
    plan.legs.forEach((leg, k) => {
      const [a, b] = ends[k]!;
      if (k < ends.length - 1) this.relayed.set(this.nodes[b]!.id, leg.t0 + leg.dur);
      this.arcs.add({ from: this.nodes[a]!.id, to: this.nodes[b]!.id, ...leg, end: plan.end, color: packet, power: write ? 1.35 : 1 });
    });
  }

  /**
   * Link hops from node `from` to node `to` (breadth-first over the drawn links), or null when nothing joins them. Of
   * equally short ways the one through `to`'s own region wins, so a signal reaches an item through its category.
   */
  private pathFrom(from: number, to: number): Array<{ link: number; rev: boolean }> | null {
    const prev = new Map<number, { node: number; link: number }>();
    const home = this.nodes[to]!.group;
    let frontier = [from];
    prev.set(from, { node: -1, link: -1 });
    for (let d = 0; frontier.length && d < 8 && !prev.has(to); d++) {
      const next: number[] = [];
      frontier.sort((a, b) => Number(this.nodes[b]!.group === home) - Number(this.nodes[a]!.group === home));
      for (const i of frontier) for (const li of this.incident[i] ?? []) {
        const l = this.links[li]!;
        const j = l.s === i ? l.t : l.s;
        if (prev.has(j)) continue;
        prev.set(j, { node: i, link: li });
        next.push(j);
      }
      frontier = next;
    }
    if (!prev.has(to)) return null;
    const hops: Array<{ link: number; rev: boolean }> = [];
    for (let n = to; n !== from;) {
      const p = prev.get(n)!;
      hops.push({ link: p.link, rev: this.links[p.link]!.t !== n });
      n = p.node;
    }
    return hops.reverse();
  }

  /** Frames every node (or the given ids), ignoring nothing: the layout keeps orphans inside their regions. */
  private frameAll(seconds = 1.1, ids?: ReadonlySet<string>): void {
    this.autoFit = false;
    const f = this.framing(ids);
    if (f) this.rig.flyTo(f.x, f.y, f.z, f.dist, seconds);
  }

  panBy(dx: number, dy: number): void { this.autoFit = false; this.userMoves++; this.rig.pan(dx, dy); }

  /** Width covered by panels on the left and right edges (CSS px). */
  setViewInsets(left: number, right: number): void { this.rig.setInsets(left, right); this.labelsDirty = true; }

  /** First frame: frame everything from far away, then glide in. */
  introFit(seconds = 2): void {
    const f = this.framing();
    if (!f) return;
    this.autoFit = !this.layout.settled;
    this.rig.flyTo(f.x, f.y, f.z, f.dist * 2.6, 0);
    this.rig.flyTo(f.x, f.y, f.z, f.dist, seconds);
  }

  private framing(ids?: ReadonlySet<string>): { x: number; y: number; z: number; dist: number } | null {
    const pts: Vector3[] = [];
    for (const n of this.layout.nodes) if (!ids || ids.has(n.id)) pts.push(new Vector3(n.x, n.y, n.z));
    if (!pts.length) return null;
    const c = pts.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / pts.length);
    let r = 40;
    for (const p of pts) r = Math.max(r, p.distanceTo(c) + 18);
    // Extra room so region names above the outer regions stay on screen.
    return { x: c.x, y: c.y, z: c.z, dist: this.rig.distanceToFit(r, ids ? 0.12 : 0.24) };
  }
  zoomBy(factor: number): void { this.autoFit = false; this.userMoves++; this.rig.zoomAt(factor, this.width / 2, this.height / 2); }

  setDims(dims: Dims): void {
    this.layout.setDims(dims, this.groupOrder);
    this.rig.setMode(dims === 3 ? '3d' : 'flat');
    this.nodeMat.depthTest = false;
    setTimeout(() => this.frameAll(1.2), 650);
  }

  get dims(): Dims { return this.layout.dims; }

  setPaused(p: boolean): void {
    if (p === this.paused || this.disposed) return;
    this.paused = p;
    if (p) cancelAnimationFrame(this.raf);
    else { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
  }

  /** Screen position (CSS px) and on-screen radius of a node, or null when it is off-screen. */
  screenOf(id: string): { x: number; y: number; r: number } | null {
    const i = this.index.get(id);
    if (i === undefined || this.screen[i * 4 + 3]! <= 0) return null;
    return { x: this.screen[i * 4]!, y: this.screen[i * 4 + 1]!, r: this.screen[i * 4 + 2]! };
  }

  unpin(id: string): void { this.layout.unpin(id); }
  isPinned(id: string): boolean { return this.layout.isPinned(id); }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.nodeGeom?.dispose();
    this.nodeMat.dispose();
    this.linkGeom.dispose();
    this.linkMat.dispose();
    for (const nb of this.nebulae) nb.mat.dispose();
    for (const z of this.zoneRings) z.mat.dispose();
    this.nebulaGeom.dispose();
    this.noiseTex.dispose();
    this.pulseGeom.dispose();
    this.pulseMat.dispose();
    this.brain.dispose();
    this.arcs.dispose();
    if (this.stars) { this.stars.geometry.dispose(); (this.stars.material as ShaderMaterial).dispose(); }
    this.composer.dispose();
    this.renderer.dispose();
    this.labels.dispose();
    window.removeEventListener('keydown', this.onSpreadKey);
    window.removeEventListener('keyup', this.onSpreadKey);
    this.ring.remove();
    canvas.remove();
  }

  // ---------------------------------------------------------------- building layers

  private buildStars(): void {
    const g = new BufferGeometry();
    const p = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const ph = new Float32Array(STAR_COUNT);
    const col = new Float32Array(STAR_COUNT * 3);
    const tints: Rgb[] = [[0.75, 0.82, 1], [1, 0.95, 0.88], [0.85, 0.78, 1], [0.7, 0.95, 1]];
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = hash01(`s${i}`, 1) * 2 - 1;
      const th = hash01(`s${i}`, 2) * Math.PI * 2;
      const rad = 3800 + hash01(`s${i}`, 3) * 6500;
      const s = Math.sqrt(1 - u * u);
      p[i * 3] = Math.cos(th) * s * rad; p[i * 3 + 1] = u * rad; p[i * 3 + 2] = Math.sin(th) * s * rad - 1200;
      size[i] = 0.8 + hash01(`s${i}`, 4) ** 3 * 2.6;
      ph[i] = hash01(`s${i}`, 5);
      const t = linRgb(tints[i % tints.length]!);
      const k = 0.35 + hash01(`s${i}`, 6) * 0.65;
      col[i * 3] = t[0] * k; col[i * 3 + 1] = t[1] * k; col[i * 3 + 2] = t[2] * k;
    }
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aPhase', new BufferAttribute(ph, 1));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    const m = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
    this.stars = new Points(g, m);
    this.stars.visible = !this.light;
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -3;
    this.scene.add(this.stars);
  }

  private buildNodes(): void {
    const n = this.nodes.length;
    if (this.nodeMesh) { this.scene.remove(this.nodeMesh); this.nodeGeom?.dispose(); }
    const base = new PlaneGeometry(2, 2);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    const iPos = new InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3).setUsage(DynamicDrawUsage);
    const iColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
    const iSize = new InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
    const iShape = new InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
    const iState = new InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4).setUsage(DynamicDrawUsage);
    const iMisc = new InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
    // When the brain's signal reaches the node (engine seconds; -1 = none): its ring of arrival.
    const iTouch = new InstancedBufferAttribute(new Float32Array(Math.max(1, n)).fill(-1), 1).setUsage(DynamicDrawUsage);
    this.nodes.forEach((nd, i) => {
      const c = linRgb(nd.color);
      iColor.setXYZ(i, c[0], c[1], c[2]);
      iSize.setX(i, nd.r);
      iShape.setX(i, nd.shape);
      iMisc.setXYZ(i, nd.closed ? 1 : 0, hash01(nd.id, 21), nd.progress);
    });
    g.setAttribute('iPos', iPos);
    g.setAttribute('iColor', iColor);
    g.setAttribute('iSize', iSize);
    g.setAttribute('iShape', iShape);
    g.setAttribute('iState', iState);
    g.setAttribute('iMisc', iMisc);
    g.setAttribute('iTouch', iTouch);
    g.instanceCount = n;
    this.nodeGeom = g;
    this.nodeMesh = new Mesh(g, this.nodeMat);
    this.nodeMesh.frustumCulled = false;
    this.nodeMesh.renderOrder = 1;
    this.scene.add(this.nodeMesh);
  }

  /** Segment index of each link half: links are drawn as two halves so a bridge between regions can fade in the middle. */
  private buildLinks(): void {
    const m = Math.max(1, this.links.length * 2);
    this.linkPos = new Float32Array(m * 6);
    this.linkCol = new Float32Array(m * 6);
    this.linkBase = new Float32Array(m * 6);
    this.fillLinkColors();
    this.linkGeom.dispose();
    this.linkGeom = new LineSegmentsGeometry();
    this.linkGeom.setPositions(this.linkPos);
    this.linkGeom.setColors(this.linkCol);
    this.linkMesh.geometry = this.linkGeom;
  }

  /** The colours as the theme draws them: on paper every node, region and island takes its darker shade. */
  private themed(nodes: GNode[], groups: GGroup[], zones: GZone[]): { nodes: GNode[]; groups: GGroup[]; zones: GZone[] } {
    if (!this.light) return { nodes, groups, zones };
    return {
      nodes: nodes.map((n) => ({ ...n, color: forLight(n.color) })),
      groups: groups.map((g) => ({ ...g, color: forLight(g.color) })),
      zones: zones.map((z) => ({ ...z, color: forLight(z.color) })),
    };
  }

  /** A name's or a mark's colour: lifted toward white on the night sky, kept deep on paper. */
  private ink(c: Rgb, k: number): Rgb {
    return this.light ? [c[0] * (1 - k * 0.4), c[1] * (1 - k * 0.4), c[2] * (1 - k * 0.4)] : lighten(c, k);
  }

  /** How glows mix in: added to the dark sky, taken away from the paper (with `GLOW_OUT` in the shaders). */
  private glowBlend(m: Material): void {
    // The alpha channel is left as it is: subtracting it too would leave a transparent hole the output pass shows white.
    if (this.light) {
      m.blending = CustomBlending; m.blendEquation = ReverseSubtractEquation; m.blendSrc = OneFactor; m.blendDst = OneFactor;
      m.blendEquationAlpha = AddEquation; m.blendSrcAlpha = ZeroFactor; m.blendDstAlpha = OneFactor;
    } else { m.blending = AdditiveBlending; m.blendEquation = AddEquation; m.blendEquationAlpha = null; m.blendSrcAlpha = null; m.blendDstAlpha = null; }
    m.needsUpdate = true;
  }

  /**
   * Dark or light: the clear colour, the bloom and the stars, how glows mix, and every colour (from what the model
   * sent). Nothing is rebuilt and nothing moves.
   */
  setTheme(theme: 'dark' | 'light'): void {
    const light = theme === 'light';
    if (light === this.light) return;
    this.light = light;
    this.uniforms.uLight.value = light ? 1 : 0;
    this.renderer.setClearColor(light ? BG_LIGHT : BG, 1);
    this.bloom.enabled = !light;
    if (this.stars) this.stars.visible = !light;
    for (const m of [this.linkMat, this.pulseMat, this.arcs.mat, ...this.nebulae.map((n) => n.mat), ...this.zoneRings.map((z) => z.mat)]) this.glowBlend(m);
    if (this.raw.nodes.length) this.setColors(this.raw.nodes, this.raw.groups, this.raw.zones);
    this.labelsDirty = true;
    this.stateDirty = true;
  }

  /** Each link's base colours from its ends' colours; the frame scales them by what is lit. */
  private fillLinkColors(): void {
    this.links.forEach((l, i) => {
      const a = linRgb(this.nodes[l.s]!.color);
      const b = linRgb(this.nodes[l.t]!.color);
      const gs = this.nodes[l.s]!.group; const gt = this.nodes[l.t]!.group;
      const side = gs === JOURNAL_GROUP || gt === JOURNAL_GROUP || gs === INBOX_GROUP || gt === INBOX_GROUP;
      // A bridge between two connected maps stays visible along its whole length, a little lifted toward white.
      const k = (l.bridge ? 0.42 : l.cross ? 0.3 : 0.5) * (side ? 0.6 : 1) * (l.kind === 'mentions' ? 0.7 : 1);
      const mid = l.bridge ? 0.6 : l.cross ? (side ? 0.06 : 0.16) : 1;
      const lift = l.bridge ? 0.22 : 0;
      const mc: Rgb = [(a[0] + b[0]) / 2 + lift, (a[1] + b[1]) / 2 + lift, (a[2] + b[2]) / 2 + lift];
      this.linkBase.set([a[0] * k, a[1] * k, a[2] * k, mc[0] * k * mid, mc[1] * k * mid, mc[2] * k * mid], i * 12);
      this.linkBase.set([mc[0] * k * mid, mc[1] * k * mid, mc[2] * k * mid, b[0] * k, b[1] * k, b[2] * k], i * 12 + 6);
    });
    // On paper a link is a tint taken away from the background (reverse-subtract), as the glows are.
    if (this.light) {
      for (let v = 0; v < this.linkBase.length; v += 3) {
        const r = this.linkBase[v]!; const g = this.linkBase[v + 1]!; const b = this.linkBase[v + 2]!;
        const m = Math.max(r, g, b) * 1.6;
        this.linkBase[v] = m - r + m * 0.3; this.linkBase[v + 1] = m - g + m * 0.3; this.linkBase[v + 2] = m - b + m * 0.3;
      }
    }
  }

  private buildNebulae(): void {
    const keep = new Map(this.nebulae.map((n) => [n.group, n]));
    const next: Nebula[] = [];
    const present = new Set(this.nodes.map((n) => n.group));
    for (const g of this.groups) {
      // A map's centre and the mind map's core are single nodes: the island haze and the regions' clouds suffice.
      if (!present.has(g.id) || g.kind === 'map' || g.kind === 'core') continue;
      const prev = keep.get(g.id);
      const c = linRgb(g.glow);
      if (prev) { prev.mat.uniforms['uColor']!.value = new Vector3(c[0], c[1], c[2]); next.push(prev); keep.delete(g.id); continue; }
      const mat = new ShaderMaterial({
        uniforms: { uColor: { value: new Vector3(c[0], c[1], c[2]) }, uTime: this.uniforms.uTime, uLight: this.uniforms.uLight, uSeed: { value: hash01(g.id, 31) * 10 }, uIntensity: { value: 0 }, uNoise: { value: this.noiseTex } },
        vertexShader: NEBULA_VERTEX, fragmentShader: NEBULA_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      });
      this.glowBlend(mat);
      const mesh = new Mesh(this.nebulaGeom, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -2;
      this.scene.add(mesh);
      next.push({ group: g.id, mesh, mat, cx: 0, cy: 0, cz: 0, r: 60, ready: false, target: 0.55 });
    }
    for (const old of keep.values()) { this.scene.remove(old.mesh); old.mat.dispose(); }
    this.nebulae = next;
  }

  /** One outline quad per map on the canvas, kept across data changes like the nebulae. */
  private buildZones(): void {
    const keep = new Map(this.zoneRings.map((z) => [z.zone, z]));
    const next: ZoneRing[] = [];
    for (const z of this.zones) {
      const c = linRgb(z.glow);
      const prev = keep.get(z.id);
      if (prev) { prev.mat.uniforms['uColor']!.value = new Vector3(c[0], c[1], c[2]); next.push(prev); keep.delete(z.id); continue; }
      const mat = new ShaderMaterial({
        uniforms: { uColor: { value: new Vector3(c[0], c[1], c[2]) }, uTime: this.uniforms.uTime, uLight: this.uniforms.uLight, uSeed: { value: hash01(z.id, 33) * 6.283 }, uIntensity: { value: 0 }, uNoise: { value: this.noiseTex } },
        vertexShader: NEBULA_VERTEX, fragmentShader: ZONE_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      });
      this.glowBlend(mat);
      const mesh = new Mesh(this.nebulaGeom, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -2;
      this.scene.add(mesh);
      next.push({ zone: z.id, mesh, mat, cx: 0, cy: 0, cz: 0, r: 100, ready: false, target: 0.55 });
    }
    for (const old of keep.values()) { this.scene.remove(old.mesh); old.mat.dispose(); }
    this.zoneRings = next;
  }

  // ---------------------------------------------------------------- per-frame

  private frame = (now: number): void => {
    if (this.disposed || this.paused) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    // The brain thinks while a run is live; a touched node glows for a moment after its signal arrives.
    const uw = this.uniforms.uWork;
    uw.value += ((this.working ? 1 : 0) - uw.value) * Math.min(1, dt * 3);
    if (this.touched.size || this.relayed.size) {
      for (const [id, at] of this.touched) if (this.time > at + 3) this.touched.delete(id);
      for (const [id, at] of this.relayed) if (this.time > at + 2) this.relayed.delete(id);
      this.stateDirty = true;
    }
    if (dt > 0.026) this.slowFrames++; else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 120 && this.bloom.enabled) { this.bloom.enabled = false; this.slowFrames = 0; }

    const moving = this.layout.tick();
    if (moving && this.layout.alpha > 0.2) this.layout.tick();
    if (this.wasMoving && !moving && !this.dragging && !this.groupDrag && !this.zoneDrag) {
      this.spacing = this.layout.spacing();
      this.labelsDirty = true;
      this.cb.onLayoutChange?.();
      if (this.autoFit) { this.autoFit = false; this.frameAll(1); }
    }
    this.wasMoving = moving;
    const cam = this.rig.update(dt);
    const closeness = Math.min(1, Math.max(0, (1500 - this.rig.distance) / 1100));
    // The ignition swells the glow for a moment and the births it set are forgotten once it has played out.
    let swell = 0;
    if (this.intro) {
      const u = (this.time - this.intro.t0) / (this.intro.until - this.intro.t0);
      if (u >= 1) { this.intro = null; this.birth.clear(); this.stateDirty = true; }
      else swell = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * 0.35;
    }
    this.bloom.strength = 0.3 + 0.3 * closeness + swell;
    this.updatePositions();
    if (this.stateDirty) this.refreshState();
    this.updateLinks();
    this.updatePulses(dt);
    this.updateNebulae(dt);
    this.updateZones(dt);
    this.project();
    this.updateBrain(dt);
    if (this.hoverAt && !this.down && !this.pinch) this.hoverTest(this.hoverAt.x, this.hoverAt.y);
    if (this.labelsDirty || moving || cam || !this.opts.reducedMotion) this.updateLabels();
    this.labelsDirty = false;
    this.composer.render(dt);
    this.cb.onFrame?.();
  };

  /** Puts the brain on the core and feeds it this frame's state; moves the current on the links with the nodes. */
  private updateBrain(dt: number): void {
    const ci = this.coreIndex;
    const core = ci >= 0 ? this.nodes[ci] : undefined;
    const pr = this.renderer.getPixelRatio();
    const born = core ? this.birth.get(core.id) : undefined;
    const sx = ci >= 0 ? this.screen[ci * 4]! : 0; const sy = ci >= 0 ? this.screen[ci * 4 + 1]! : 0;
    this.brain.update({
      time: this.time, dt,
      center: core && this.screen[ci * 4 + 3]! > 0 ? [this.pos[ci * 3]!, this.pos[ci * 3 + 1]!, this.pos[ci * 3 + 2]!] : null,
      radius: core?.r ?? 20,
      minPx: BRAIN_MIN_PX * pr,
      grow: born === undefined ? 1 : elasticOut(Math.min(1, Math.max(0, (this.time - born) / 1.15))),
      bright: ci >= 0 ? this.bright[ci]! : 1,
      work: this.uniforms.uWork.value,
      hovered: Boolean(core && this.hoverId === core.id),
      still: this.opts.reducedMotion,
      color: linRgb(core?.color ?? [0.62, 0.66, 1]),
      dirTo: (id) => {
        const j = this.index.get(id);
        if (j === undefined || this.screen[j * 4 + 3]! <= 0) return null;
        const dx = this.screen[j * 4]! - sx; const dy = sy - this.screen[j * 4 + 1]!;
        const l = Math.hypot(dx, dy);
        return l > 0.5 ? [dx / l, dy / l] : null;
      },
    });
    this.arcs.update(this.time, (id) => {
      const j = this.index.get(id);
      return j === undefined ? null : [this.pos[j * 3]!, this.pos[j * 3 + 1]!, this.pos[j * 3 + 2]!];
    }, [this.width * pr, this.height * pr], pr);
  }

  private updatePositions(): void {
    const t = this.time;
    const still = this.opts.reducedMotion;
    const list = this.layout.nodes;
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i]!;
      const ln = list[i] && list[i]!.id === nd.id ? list[i]! : this.layout.node(nd.id);
      if (!ln) continue;
      let dx = 0; let dy = 0; let dz = 0;
      if (!still && this.dragging !== nd.id) {
        const a = (nd.hub ? 0.6 : 1.4) + nd.r * 0.08;
        const p0 = this.phase[i * 3]! * 6.283; const p1 = this.phase[i * 3 + 1]! * 6.283; const p2 = this.phase[i * 3 + 2]! * 6.283;
        dx = a * Math.sin(t * 0.33 + p0) + 0.45 * a * Math.sin(t * 0.71 + p1);
        dy = a * Math.cos(t * 0.29 + p1) + 0.45 * a * Math.sin(t * 0.63 + p2);
        if (this.layout.dims === 3) dz = a * Math.sin(t * 0.31 + p2);
      }
      this.pos[i * 3] = ln.x + dx;
      this.pos[i * 3 + 1] = ln.y + dy;
      this.pos[i * 3 + 2] = ln.z + dz;
    }
    if (this.nodeGeom) {
      const a = this.nodeGeom.getAttribute('iPos') as InstancedBufferAttribute;
      (a.array as Float32Array).set(this.pos.subarray(0, Math.min(this.pos.length, a.array.length)));
      a.needsUpdate = true;
    }
  }

  private refreshState(): void {
    this.stateDirty = false;
    const v = this.view;
    const hover = this.hoverId;
    const hoverSet = new Set<string>();
    if (hover) {
      hoverSet.add(hover);
      const hi = this.index.get(hover);
      if (hi !== undefined) for (const li of this.incident[hi] ?? []) { const l = this.links[li]!; hoverSet.add(this.nodes[l.s]!.id); hoverSet.add(this.nodes[l.t]!.id); }
    }
    const keep = (id: string, group: string): boolean => {
      if (hover) return hoverSet.has(id);
      if (v.matchIds) return v.matchIds.has(id);
      if (v.focusIds) return v.focusIds.has(id);
      if (v.isolateGroup) return group === v.isolateGroup;
      return true;
    };
    const st = this.nodeGeom?.getAttribute('iState') as InstancedBufferAttribute | undefined;
    const tc = this.nodeGeom?.getAttribute('iTouch') as InstancedBufferAttribute | undefined;
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i]!;
      const lit = keep(nd.id, nd.group);
      const b = lit ? 1 : hover ? 0.24 : 0.14;
      this.bright[i] = b;
      let emph = nd.id === hover ? 1 : hover && hoverSet.has(nd.id) ? 0.45 : nd.id === v.selectedId ? 0.7 : (v.matchIds?.has(nd.id) ? 0.5 : 0);
      const at = this.touched.get(nd.id);
      if (at !== undefined && this.time >= at) emph = Math.max(emph, 0.9 * Math.exp(-(this.time - at) / 1.2));
      const via = this.relayed.get(nd.id);
      if (via !== undefined && this.time >= via) emph = Math.max(emph, 0.55 * Math.exp(-(this.time - via) / 0.6));
      tc?.setX(i, at ?? -1);
      let flags = 0;
      if (nd.id === v.selectedId) flags += 1;
      if (v.created.has(nd.id)) flags += 2;
      else if (v.updated.has(nd.id)) flags += 4;
      if (nd.id === v.focusId) flags += 8;
      const bt = this.birth.get(nd.id);
      st?.setXYZW(i, b, emph, flags, bt === undefined ? -1 : bt);
    }
    if (st) st.needsUpdate = true;
    if (tc) tc.needsUpdate = true;
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i]!;
      const s = this.nodes[l.s]!; const t = this.nodes[l.t]!;
      let k: number;
      if (hover) k = s.id === hover || t.id === hover ? 2.3 : 0.1;
      else {
        const lit = this.bright[l.s]! >= 1 && this.bright[l.t]! >= 1;
        k = lit ? (s.id === v.selectedId || t.id === v.selectedId ? 1.9 : 1) : 0.08;
      }
      for (let j = 0; j < 12; j++) this.linkCol[i * 12 + j] = this.linkBase[i * 12 + j]! * k;
    }
    const colAttr = this.linkGeom.getAttribute('instanceColorStart') as InterleavedBufferAttribute | undefined;
    if (colAttr) colAttr.data.needsUpdate = true;
    for (const nb of this.nebulae) {
      const g = nb.group;
      const hoverGroup = hover ? this.nodes[this.index.get(hover) ?? -1]?.group : undefined;
      const selGroup = v.selectedId ? this.nodes[this.index.get(v.selectedId) ?? -1]?.group : undefined;
      const special = g === INBOX_GROUP || g === JOURNAL_GROUP || g === UNSORTED_GROUP;
      let target = special ? 0.2 : 0.5;
      if (v.isolateGroup) target = g === v.isolateGroup ? 0.95 : 0.1;
      else if (v.matchIds || v.focusIds) target *= 0.45;
      else if (hoverGroup) target = g === hoverGroup ? target * 1.35 : target * 0.6;
      else if (selGroup) target = g === selGroup ? target * 1.2 : target * 0.8;
      nb.target = target;
    }
    const zoneOfGroup = (g: string | undefined): string | undefined => (g ? this.groups.find((x) => x.id === g)?.map ?? MIND_ZONE : undefined);
    for (const z of this.zoneRings) {
      let target = 0.55;
      if (v.isolateGroup) target = zoneOfGroup(v.isolateGroup) === z.zone ? 0.8 : 0.15;
      else if (v.matchIds || v.focusIds) target = 0.3;
      else if (hover) target = zoneOfGroup(this.nodes[this.index.get(hover) ?? -1]?.group) === z.zone ? 0.75 : 0.4;
      z.target = target;
    }
  }

  private updateLinks(): void {
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i]!;
      const o = i * 12;
      const ax = this.pos[l.s * 3]!; const ay = this.pos[l.s * 3 + 1]!; const az = this.pos[l.s * 3 + 2]!;
      const bx = this.pos[l.t * 3]!; const by = this.pos[l.t * 3 + 1]!; const bz = this.pos[l.t * 3 + 2]!;
      const mx = (ax + bx) / 2; const my = (ay + by) / 2; const mz = (az + bz) / 2;
      this.linkPos[o] = ax; this.linkPos[o + 1] = ay; this.linkPos[o + 2] = az;
      this.linkPos[o + 3] = mx; this.linkPos[o + 4] = my; this.linkPos[o + 5] = mz;
      this.linkPos[o + 6] = mx; this.linkPos[o + 7] = my; this.linkPos[o + 8] = mz;
      this.linkPos[o + 9] = bx; this.linkPos[o + 10] = by; this.linkPos[o + 11] = bz;
    }
    const a = this.linkGeom.getAttribute('instanceStart') as InterleavedBufferAttribute | undefined;
    if (a) a.data.needsUpdate = true;
  }

  private emit(link: number, rev: boolean, boost = 1): void {
    const l = this.links[link];
    if (!l) return;
    const sx = this.pos[l.s * 3]! - this.pos[l.t * 3]!; const sy = this.pos[l.s * 3 + 1]! - this.pos[l.t * 3 + 1]!; const sz = this.pos[l.s * 3 + 2]! - this.pos[l.t * 3 + 2]!;
    const len = Math.hypot(sx, sy, sz);
    const from = this.nodes[rev ? l.t : l.s]!;
    const c = lighten(from.color, 0.35);
    this.pulses.push({ link, t0: this.time, dur: Math.min(2.4, Math.max(0.55, len / 95)) / boost, rev, color: c });
    if (this.pulses.length > MAX_PULSES) this.pulses.splice(0, this.pulses.length - MAX_PULSES);
  }

  private burstFrom(id: string): void {
    const i = this.index.get(id);
    if (i === undefined || this.opts.reducedMotion) return;
    setTimeout(() => { for (const li of this.incident[i] ?? []) this.emit(li, this.links[li]!.t === i, 1.3); }, 500);
  }

  private updatePulses(dt: number): void {
    if (!this.opts.reducedMotion && this.links.length) {
      this.pulseClock += dt;
      // During the ignition the random traffic runs several times denser.
      const interval = Math.max(0.12, 2.4 / Math.sqrt(this.links.length + 4)) / (this.intro ? 5 : 1);
      while (this.pulseClock > interval) {
        this.pulseClock -= interval;
        const li = Math.floor(Math.random() * this.links.length);
        const l = this.links[li]!;
        if (this.bright[l.s]! >= 1 && this.bright[l.t]! >= 1) this.emit(li, Math.random() < 0.5);
      }
      // The wave: as each item ignites it sends a signal down every link to an item that ignites after it.
      const intro = this.intro;
      if (intro) {
        let budget = 40;
        while (intro.queue.length && intro.queue[0]!.at <= this.time && budget-- > 0) {
          const { id } = intro.queue.shift()!;
          const i = this.index.get(id);
          if (i === undefined) continue;
          const mine = this.birth.get(id) ?? 0;
          for (const li of this.incident[i] ?? []) {
            const l = this.links[li]!;
            const j = l.s === i ? l.t : l.s;
            if ((this.birth.get(this.nodes[j]!.id) ?? 0) >= mine) this.emit(li, l.t === i, l.bridge ? 0.8 : 1.25);
          }
        }
      }
      if (this.hoverId) {
        this.hoverPulseClock += dt;
        const hi = this.index.get(this.hoverId);
        const inc = hi === undefined ? [] : this.incident[hi] ?? [];
        while (inc.length && this.hoverPulseClock > 0.16) {
          this.hoverPulseClock -= 0.16;
          const li = inc[Math.floor(Math.random() * inc.length)]!;
          this.emit(li, this.links[li]!.t === hi, 1.4);
        }
      }
    }
    let n = 0;
    const live: Pulse[] = [];
    for (const p of this.pulses) {
      const u = (this.time - p.t0) / p.dur;
      if (u >= 1) continue;
      live.push(p);
      if (u < 0) continue;
      const l = this.links[p.link];
      if (!l) continue;
      const a = p.rev ? l.t : l.s; const b = p.rev ? l.s : l.t;
      const e = u * u * (3 - 2 * u);
      this.pulsePos[n * 3] = this.pos[a * 3]! + (this.pos[b * 3]! - this.pos[a * 3]!) * e;
      this.pulsePos[n * 3 + 1] = this.pos[a * 3 + 1]! + (this.pos[b * 3 + 1]! - this.pos[a * 3 + 1]!) * e;
      this.pulsePos[n * 3 + 2] = this.pos[a * 3 + 2]! + (this.pos[b * 3 + 2]! - this.pos[a * 3 + 2]!) * e;
      const c = linRgb(p.color);
      this.pulseCol[n * 3] = c[0]; this.pulseCol[n * 3 + 1] = c[1]; this.pulseCol[n * 3 + 2] = c[2];
      this.pulseAlpha[n] = Math.sin(Math.PI * u) * Math.min(this.bright[a]!, this.bright[b]!);
      n++;
    }
    this.pulses = live;
    this.pulseGeom.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aAlpha']) (this.pulseGeom.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  private updateNebulae(dt: number): void {
    if (!this.nebulae.length) return;
    const acc = new Map<string, { x: number; y: number; z: number; n: number }>();
    for (let i = 0; i < this.nodes.length; i++) {
      const g = this.nodes[i]!.group;
      const a = acc.get(g) ?? { x: 0, y: 0, z: 0, n: 0 };
      a.x += this.pos[i * 3]!; a.y += this.pos[i * 3 + 1]!; a.z += this.pos[i * 3 + 2]!; a.n++;
      acc.set(g, a);
    }
    const spread = new Map<string, number>();
    for (let i = 0; i < this.nodes.length; i++) {
      const g = this.nodes[i]!.group;
      const a = acc.get(g)!;
      const d2 = (this.pos[i * 3]! - a.x / a.n) ** 2 + (this.pos[i * 3 + 1]! - a.y / a.n) ** 2 + (this.pos[i * 3 + 2]! - a.z / a.n) ** 2;
      spread.set(g, (spread.get(g) ?? 0) + d2);
    }
    const k = 1 - Math.exp(-dt * 4);
    const flat = this.layout.dims === 2;
    for (const nb of this.nebulae) {
      const a = acc.get(nb.group);
      if (!a) continue;
      const cx = a.x / a.n; const cy = a.y / a.n; const cz = a.z / a.n;
      const r = Math.sqrt((spread.get(nb.group) ?? 0) / a.n) * 1.7 + 34;
      if (!nb.ready) { nb.cx = cx; nb.cy = cy; nb.cz = cz; nb.r = r; nb.ready = true; }
      else { nb.cx += (cx - nb.cx) * k; nb.cy += (cy - nb.cy) * k; nb.cz += (cz - nb.cz) * k; nb.r += (r - nb.r) * k; }
      nb.mesh.position.set(nb.cx, nb.cy, nb.cz - (flat ? 30 : 0));
      nb.mesh.scale.setScalar(nb.r * 2.5);
      if (flat) nb.mesh.quaternion.identity(); else nb.mesh.quaternion.copy(this.rig.camera.quaternion);
      const rPx = (nb.r * this.height) / (2 * Math.tan((this.rig.camera.fov * Math.PI) / 360) * Math.max(1, this.rig.distance));
      const size = Math.min(1, Math.max(0.12, 1.25 - rPx / (this.height * 0.55)));
      const u = nb.mat.uniforms['uIntensity']!;
      u.value += (nb.target * size - (u.value as number)) * (1 - Math.exp(-dt * 3));
    }
  }

  /** Each map's outline follows the smoothed centre and extent of its nodes, and fades as the camera enters it. */
  private updateZones(dt: number): void {
    if (!this.zoneRings.length) return;
    const acc = new Map<string, { x: number; y: number; z: number; n: number }>();
    for (let i = 0; i < this.nodes.length; i++) {
      const zid = this.zoneOfNode[i]!;
      if (zid === MIND_ZONE) continue;
      const a = acc.get(zid) ?? { x: 0, y: 0, z: 0, n: 0 };
      a.x += this.pos[i * 3]!; a.y += this.pos[i * 3 + 1]!; a.z += this.pos[i * 3 + 2]!; a.n++;
      acc.set(zid, a);
    }
    const reach = new Map<string, number>();
    for (let i = 0; i < this.nodes.length; i++) {
      const zid = this.zoneOfNode[i]!;
      const a = acc.get(zid);
      if (!a) continue;
      const d = Math.hypot(this.pos[i * 3]! - a.x / a.n, this.pos[i * 3 + 1]! - a.y / a.n, this.pos[i * 3 + 2]! - a.z / a.n);
      reach.set(zid, Math.max(reach.get(zid) ?? 0, d + this.nodes[i]!.r));
    }
    const k = 1 - Math.exp(-dt * 4);
    const flat = this.layout.dims === 2;
    for (const z of this.zoneRings) {
      const a = acc.get(z.zone);
      if (!a) continue;
      const cx = a.x / a.n; const cy = a.y / a.n; const cz = a.z / a.n;
      // The island covers its regions' clouds, not just their dots.
      let r = (reach.get(z.zone) ?? 60) + 30;
      for (const nb of this.nebulae) {
        if (!nb.ready || (this.groups.find((g) => g.id === nb.group)?.map ?? MIND_ZONE) !== z.zone) continue;
        r = Math.max(r, Math.hypot(nb.cx - cx, nb.cy - cy, nb.cz - cz) + nb.r * 0.85 + 24);
      }
      if (!z.ready) { z.cx = cx; z.cy = cy; z.cz = cz; z.r = r; z.ready = true; }
      else { z.cx += (cx - z.cx) * k; z.cy += (cy - z.cy) * k; z.cz += (cz - z.cz) * k; z.r += (r - z.r) * k; }
      z.mesh.position.set(z.cx, z.cy, z.cz - (flat ? 32 : 0));
      // The coast sits at about 0.8 of the quad's half-size (shaders.ts ZONE_FRAGMENT).
      z.mesh.scale.setScalar((z.r / 0.8) * 2);
      if (flat) z.mesh.quaternion.identity(); else z.mesh.quaternion.copy(this.rig.camera.quaternion);
      const rPx = (z.r * this.height) / (2 * Math.tan((this.rig.camera.fov * Math.PI) / 360) * Math.max(1, this.rig.distance));
      const size = Math.min(1, Math.max(0, 1.3 - rPx / (this.height * 0.7)));
      const u = z.mat.uniforms['uIntensity']!;
      u.value += (z.target * size - (u.value as number)) * (1 - Math.exp(-dt * 3));
    }
  }

  private project(): void {
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorldInverse.elements;
    const p = cam.projectionMatrix.elements;
    const projScale = this.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.uniforms.uProjScale.value = projScale * this.renderer.getPixelRatio();
    for (let i = 0; i < this.nodes.length; i++) {
      const x = this.pos[i * 3]!; const y = this.pos[i * 3 + 1]!; const z = this.pos[i * 3 + 2]!;
      const vx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      const vy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      const vz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      const depth = -vz;
      if (depth <= 1) { this.screen[i * 4 + 3] = 0; continue; }
      const cx = p[0]! * vx + p[8]! * vz;
      const cy = p[5]! * vy + p[9]! * vz;
      const sx = ((cx / depth) * 0.5 + 0.5) * this.width;
      const sy = (0.5 - (cy / depth) * 0.5) * this.height;
      // The core is the brain: never smaller on screen than BRAIN_MIN_PX, a little narrower than its quad's full width.
      const r = i === this.coreIndex ? Math.max(BRAIN_MIN_PX, (this.nodes[i]!.r * projScale) / depth) * 0.95 : Math.max(2.6, (this.nodes[i]!.r * projScale) / depth);
      this.screen[i * 4] = sx; this.screen[i * 4 + 1] = sy; this.screen[i * 4 + 2] = r; this.screen[i * 4 + 3] = depth;
    }
  }

  private updateLabels(): void {
    const v = this.view;
    const cam = this.rig.camera;
    const projScale = this.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const dist = Math.max(1, this.rig.distance);
    const gap = (projScale / dist) * this.spacing;
    const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    this.overview = 1 - smooth(REGION_FADE[0], REGION_FADE[1], gap);
    const majorOn = gap >= MAJOR_GAP;
    const minorOn = gap >= MINOR_GAP;

    const regions: RegionLabel[] = [];
    // A map's name and count hang under its centre node at every zoom (its symbol is drawn on the node); its switch
    // is a small toggle set permanently beside the island, on the side that faces away from the rest of the map.
    const glyphs: GlyphMark[] = [];
    const toggles: ToggleMark[] = [];
    // From afar an island says only its name; its regions' names come in as it opens on screen (UI-DESIGN "Maps").
    const islandOpen = new Map<string, number>();
    const view = Math.min(this.width, this.height);
    let ox = 0; let oy = 0; let on = 0;
    for (let i = 0; i < this.nodes.length; i++) if (this.screen[i * 4 + 3]! > 0) { ox += this.screen[i * 4]!; oy += this.screen[i * 4 + 1]!; on++; }
    for (const zone of this.zones) {
      const hi = this.index.get(zone.id);
      if (hi === undefined || this.screen[hi * 4 + 3]! <= 0) continue;
      const x = this.screen[hi * 4]!; const y = this.screen[hi * 4 + 1]!; const r = this.screen[hi * 4 + 2]!;
      const dimZone = v.isolateGroup && (this.groups.find((g) => g.id === v.isolateGroup)?.map ?? MIND_ZONE) !== zone.id ? 0.3 : 1;
      const hot = this.hotRegion === ZONE_LABEL + zone.id || this.hoverId === zone.id;
      const lit = this.bright[hi]! >= 1;
      glyphs.push({ id: zone.id, x, y, r, symbol: zone.symbol, color: css(this.ink(zone.color, 0.55)), opacity: lit ? 1 : 0.35 });
      // The name and count stay with the centre at every zoom (the centre carries no item label of its own).
      const size = Math.min(22, Math.max(13, r * 1.1)) * (hot ? 1.05 : 1);
      if (this.names !== 'none') regions.push({ id: ZONE_LABEL + zone.id, text: zone.title, sub: zone.sub, x, y: y + r + 10, color: css(this.ink(zone.color, hot ? 0.4 : 0.2), 0.96), opacity: dimZone * (lit ? 1 : 0.4), size, hot, zone: true });
      // The island's extent on screen (its nodes and the name under the centre), and the side of it that faces away
      // from everything else on screen: the toggle sits just past the outermost node on that side.
      let x0 = x - r; let x1 = x + r; let y0 = y - r; let y1 = y + r + 10 + size * 1.6; let zx = 0; let zy = 0; let zn = 0;
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.zoneOfNode[i] !== zone.id || this.screen[i * 4 + 3]! <= 0) continue;
        const sx = this.screen[i * 4]!; const sy = this.screen[i * 4 + 1]!; const sr = this.screen[i * 4 + 2]!;
        x0 = Math.min(x0, sx - sr); x1 = Math.max(x1, sx + sr); y0 = Math.min(y0, sy - sr); y1 = Math.max(y1, sy + sr);
        zx += sx; zy += sy; zn++;
      }
      islandOpen.set(zone.id, smooth(view * 0.28, view * 0.45, Math.max(x1 - x0, y1 - y0)));
      const rest = on - zn;
      const dx = rest > 0 ? x - (ox - zx) / rest : 1; const dy = rest > 0 ? y - (oy - zy) / rest : 0;
      // A side, not a corner: left or right unless the island sits clearly above or below everything else.
      const side = Math.abs(dx) * 1.5 >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
      const away = TOGGLE_GAP + TOGGLE_SIZE.w / 2;
      const linked = zone.connects.includes(MIND_ZONE);
      toggles.push({
        id: zone.id, vertical: side === 'left' || side === 'right', on: linked,
        x: side === 'right' ? x1 + away : side === 'left' ? x0 - away : x,
        y: side === 'bottom' ? y1 + away : side === 'top' ? y0 - away - (this.overview > 0.02 ? 24 : 0) : y, // room for a region's name above its cluster
        color: css(this.ink(zone.color, 0.25)), title: linked ? zone.switchOn : zone.switchOff, opacity: dimZone,
      });
    }
    this.labels.updateGlyphs(glyphs);
    this.labels.updateToggles(toggles);
    if (this.overview > 0.02 && this.names !== 'none') {
      // Each region's name sits just above its own cluster of dots, like a map's place name; below it when "above"
      // would cover another region.
      const bounds = new Map<string, { x: number; n: number; top: number; bottom: number }>();
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.screen[i * 4 + 3]! <= 0) continue;
        const g = this.nodes[i]!.group;
        const b = bounds.get(g) ?? { x: 0, n: 0, top: Infinity, bottom: -Infinity };
        const y = this.screen[i * 4 + 1]!; const r = this.screen[i * 4 + 2]!;
        b.x += this.screen[i * 4]!; b.n++; b.top = Math.min(b.top, y - r); b.bottom = Math.max(b.bottom, y + r);
        bounds.set(g, b);
      }
      // A node covers a label's box when its disc reaches into it (the brain at the core is wide).
      const covers = (group: string, x0: number, y0: number, x1: number, y1: number): boolean => {
        for (let i = 0; i < this.nodes.length; i++) {
          if (this.nodes[i]!.group === group || this.screen[i * 4 + 3]! <= 0) continue;
          const x = this.screen[i * 4]!; const y = this.screen[i * 4 + 1]!; const r = this.screen[i * 4 + 2]!;
          if (x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1) return true;
        }
        return false;
      };
      for (const nb of this.nebulae) {
        const g = this.groups.find((x) => x.id === nb.group);
        const b = bounds.get(nb.group);
        if (!g || !nb.ready || !b) continue;
        const rPx = (nb.r * projScale) / dist;
        const dim = v.isolateGroup && v.isolateGroup !== g.id ? 0.3 : 1;
        const fit = Math.min(1, Math.max(0.45, (rPx - 14) / 26));
        const hot = this.hotRegion === g.id;
        const size = Math.min(28, Math.max(15, rPx * 0.19)) * (hot ? 1.06 : 1);
        const x = b.x / b.n;
        const half = (g.title.length * size * 0.56 + 24) / 2;
        const above = b.top - 8 - size * 1.1;
        const below = b.bottom + 8 + size * 0.95;
        const y = covers(g.id, x - half, above - size, x + half, above + size * 1.2) && !covers(g.id, x - half, below - size, x + half, below + size * 1.2) ? below : above;
        const open = g.map ? islandOpen.get(g.map) ?? 1 : 1;
        regions.push({ id: g.id, text: g.title, sub: g.sub, x, y, color: css(this.ink(g.color, hot ? 0.45 : 0.28), 0.96), opacity: this.overview * dim * fit * open, size, hot });
      }
    }
    const forced = new Set<string>();
    if (this.hoverId) forced.add(this.hoverId);
    if (v.selectedId) forced.add(v.selectedId);
    if (v.focusId) forced.add(v.focusId);
    if (v.matchIds && v.matchIds.size <= 40) for (const id of v.matchIds) forced.add(id);
    const items: LabelCandidate[] = [];
    const push = (i: number, isForced: boolean): void => {
      const nd = this.nodes[i]!;
      if (this.screen[i * 4 + 3]! <= 0 || nd.shape === SHAPE['map']) return;
      const r = this.screen[i * 4 + 2]!;
      const dim = this.bright[i]! < 1;
      if (!isForced) {
        if (dim) return;
        // Like a map: region names first, then the big places, then the small ones.
        if (nd.hub ? this.overview > 0.45 : nd.tier === 'major' ? !majorOn : !minorOn) return;
      }
      const ring = nd.id === v.selectedId ? 1.5 : nd.id === this.hoverId ? 1.2 : 1;
      items.push({ id: nd.id, text: nd.title, x: this.screen[i * 4]!, y: this.screen[i * 4 + 1]!, r: r * ring, tier: nd.tier, color: css(this.ink(nd.color, 0.15)), forced: isForced, dim });
    };
    // Only with every name on is an item named; the hover card still says what is under the pointer.
    if (this.names === 'all') {
      for (const id of forced) { const i = this.index.get(id); if (i !== undefined) push(i, true); }
      for (const i of this.labelOrder) if (!forced.has(this.nodes[i]!.id)) push(i, false);
    }
    this.labels.update(items, regions, this.width, this.height);
  }

  /** At overview, the region under a screen point (inside its cloud), for clicks on a category's area. */
  private pickRegionArea(x: number, y: number): string | null {
    if (this.overview < 0.5) return null;
    const cam = this.rig.camera;
    const projScale = this.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    let best: string | null = null;
    let bestK = 1;
    for (const nb of this.nebulae) {
      if (!nb.ready) continue;
      const v3 = new Vector3(nb.cx, nb.cy, nb.cz).project(cam);
      if (v3.z > 1) continue;
      const sx = (v3.x * 0.5 + 0.5) * this.width;
      const sy = (0.5 - v3.y * 0.5) * this.height;
      const rPx = (nb.r * projScale) / Math.max(1, this.rig.distance);
      const k = Math.hypot(x - sx, y - sy) / Math.max(1, rPx * 0.85);
      if (k < bestK) { bestK = k; best = nb.group; }
    }
    return best;
  }

  // ---------------------------------------------------------------- picking and input

  private pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    const slack = this.opts.coarse ? 14 : 7;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.screen[i * 4 + 3]! <= 0) continue;
      const dx = this.screen[i * 4]! - x; const dy = this.screen[i * 4 + 1]! - y;
      const d = Math.hypot(dx, dy);
      const reach = this.screen[i * 4 + 2]! + slack;
      if (d > reach) continue;
      const score = d - (this.bright[i]! >= 1 ? 0 : 6);
      if (score < bestD) { bestD = score; best = this.nodes[i]!.id; }
    }
    return best;
  }

  /** What the pointer is over: a region's name wins, then a node, then (zoomed out) a region's area. */
  private hoverTest(x: number, y: number): void {
    // The spread tool keeps hover quiet: no lit neighbourhoods, no hover card, its own cursor.
    if (this.spreadOn) return;
    const name = this.labels.hitRegion(x, y);
    const node = name ? null : this.pick(x, y);
    this.setHover(node);
    const hot = name ?? (node ? null : this.pickRegionArea(x, y));
    if (hot !== this.hotRegion) { this.hotRegion = hot; this.labelsDirty = true; }
    this.setCursor(node || hot ? 'pointer' : 'grab');
  }

  private setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.hoverPulseClock = 0.2;
    this.stateDirty = true;
    this.labelsDirty = true;
    this.setCursor(id ? 'pointer' : this.down ? 'grabbing' : 'grab');
    this.cb.onHover?.(id);
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.autoFit = false;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.renderer.domElement.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.down = null; this.dragging = null; this.groupDrag = null; this.zoneDrag = null;
      if (this.longPress) clearTimeout(this.longPress);
      return;
    }
    // With the spread tool on, nothing under the pointer is picked: a click spreads and a drag pans.
    const region = this.spreadOn ? null : this.labels.hitRegion(p.x, p.y);
    const id = this.spreadOn || region ? null : this.pick(p.x, p.y);
    this.down = { id, region, x: p.x, y: p.y, moved: false, button: e.button, pointerType: e.pointerType, consumed: false, shift: e.shiftKey };
    if (this.spreadOn) { this.moveRing(p.x, p.y); this.setGathering(e.shiftKey || e.altKey); }
    this.velocity = { x: 0, y: 0, t: performance.now() };
    if (id && e.pointerType !== 'mouse') {
      this.longPress = setTimeout(() => {
        if (this.down && !this.down.moved && this.down.id === id) { this.down.consumed = true; this.cb.onContextMenu?.(id, p.x, p.y); }
      }, 520);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (prev) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      if (dist > 0 && this.pinch.dist > 0) this.rig.zoomAt(this.pinch.dist / dist, mx, my);
      this.rig.pan(mx - this.pinch.x, my - this.pinch.y);
      this.pinch = { dist, x: mx, y: my };
      this.userMoves++;
      return;
    }
    if (this.spreadOn) { this.moveRing(p.x, p.y); this.setGathering(e.shiftKey || e.altKey); }
    if (!this.down) {
      if (e.pointerType === 'mouse') {
        this.hoverAt = p;
        this.rig.setTilt((p.x / this.width - 0.5) * 2, (p.y / this.height - 0.5) * 2);
      }
      return;
    }
    if (!prev) return;
    const dx = p.x - prev.x; const dy = p.y - prev.y;
    if (!this.down.moved && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 4) {
      this.down.moved = true;
      if (this.longPress) clearTimeout(this.longPress);
      if (this.down.id && this.down.button === 0 && !this.down.consumed) {
        const nd = this.nodes[this.index.get(this.down.id) ?? -1];
        if (nd?.hub && this.layout.dims === 2) {
          // Dragging a category's centre carries its whole region along; a map's centre carries its whole island,
          // the core the whole mind map.
          const w = this.rig.worldAt(p.x, p.y);
          if (nd.group.startsWith(MAP_GROUP)) this.zoneDrag = { zone: nd.id, x: w.x, y: w.y };
          else if (nd.group === CORE_GROUP) this.zoneDrag = { zone: MIND_ZONE, x: w.x, y: w.y };
          else this.groupDrag = { group: nd.group, x: w.x, y: w.y, z: w.z };
        } else this.dragging = this.down.id;
      } else if (this.down.region?.startsWith(ZONE_LABEL) && this.down.button === 0 && this.layout.dims === 2) {
        // Dragging an island's name carries the whole map along (UI-DESIGN "Maps").
        const w = this.rig.worldAt(p.x, p.y);
        this.zoneDrag = { zone: this.down.region.slice(ZONE_LABEL.length), x: w.x, y: w.y };
      }
      if (!this.groupDrag && !this.dragging && !this.zoneDrag) this.userMoves++;
      this.setCursor('grabbing');
    }
    if (!this.down.moved) return;
    if (this.zoneDrag) {
      const w = this.rig.worldAt(p.x, p.y);
      const dx = w.x - this.zoneDrag.x; const dy = w.y - this.zoneDrag.y;
      for (const g of this.groups) if ((g.map ?? MIND_ZONE) === this.zoneDrag.zone) this.layout.moveGroup(g.id, dx, dy, 0);
      this.zoneDrag.x = w.x; this.zoneDrag.y = w.y;
      this.labelsDirty = true;
      return;
    }
    if (this.groupDrag) {
      const w = this.rig.worldAt(p.x, p.y);
      this.layout.moveGroup(this.groupDrag.group, w.x - this.groupDrag.x, w.y - this.groupDrag.y, 0);
      this.groupDrag.x = w.x; this.groupDrag.y = w.y;
      this.labelsDirty = true;
      return;
    }
    if (this.dragging) {
      const w = this.rig.worldAt(p.x, p.y);
      this.layout.pin(this.dragging, w.x, w.y, w.z);
      return;
    }
    const now = performance.now();
    const dtv = Math.max(1, now - this.velocity.t) / 1000;
    this.velocity = { x: dx / dtv, y: dy / dtv, t: now };
    if (this.rig.mode === '3d' && this.down.button === 0 && !this.down.shift) this.rig.rotate(dx, dy);
    else this.rig.pan(dx, dy);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.longPress) { clearTimeout(this.longPress); this.longPress = null; }
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.down = null; return; }
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (this.groupDrag) { this.groupDrag = null; this.cb.onLayoutChange?.(); }
    else if (this.zoneDrag) { this.zoneDrag = null; this.cb.onLayoutChange?.(); }
    else if (this.dragging) { this.dragging = null; this.cb.onLayoutChange?.(); }
    else if (this.spreadOn && !d.moved && e.type === 'pointerup' && d.button === 0) {
      this.spreadAt(d.x, d.y, this.gathersWith(e.shiftKey || e.altKey));
      if (e.pointerType !== 'mouse') this.ring.classList.remove('is-on'); // a finger lifted leaves no brush behind
    }
    else if (!d.moved && !d.consumed && e.type === 'pointerup' && d.button === 0) {
      const nd = d.id ? this.nodes[this.index.get(d.id) ?? -1] : undefined;
      if (d.region?.startsWith(ZONE_LABEL)) this.cb.onZoneClick?.(d.region.slice(ZONE_LABEL.length));
      else if (d.region) this.cb.onGroupClick?.(d.region);
      else if (nd?.hub && nd.group.startsWith(MAP_GROUP)) this.cb.onZoneClick?.(nd.id);
      else if (nd?.hub && nd.group === CORE_GROUP) this.cb.onCoreClick?.();
      else if (nd?.hub) this.cb.onGroupClick?.(nd.group);
      else if (d.id) this.cb.onClick?.(d.id, e);
      else {
        const area = this.pickRegionArea(d.x, d.y);
        if (area) this.cb.onGroupClick?.(area); else this.cb.onBackgroundClick?.();
      }
    } else if (d.moved && !(this.rig.mode === '3d' && d.button === 0 && !d.shift) && performance.now() - this.velocity.t < 80) {
      this.rig.fling(this.velocity.x, this.velocity.y);
    }
    this.setCursor(this.hoverId ? 'pointer' : 'grab');
  };

  private onPointerLeave = (): void => {
    this.ring.classList.remove('is-on');
    if (this.down) return;
    this.hoverAt = null;
    this.setHover(null);
    if (this.hotRegion) { this.hotRegion = null; this.labelsDirty = true; }
    this.rig.setTilt(0, 0);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.autoFit = false;
    this.userMoves++;
    const p = this.local(e);
    const k = e.ctrlKey ? 0.012 : 0.0016;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.rig.zoomAt(Math.exp(delta * k), p.x, p.y);
  };

  private onDoubleClick = (e: MouseEvent): void => {
    // Two quick clicks of the spread tool are two spreads, not a zoom.
    if (this.spreadOn) return;
    const p = this.local(e);
    const id = this.pick(p.x, p.y);
    if (id) this.cb.onDoubleClick?.(id);
    else { this.userMoves++; this.rig.zoomAt(0.55, p.x, p.y); }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.spreadOn) return;
    const p = this.local(e);
    const id = this.pick(p.x, p.y);
    if (id) this.cb.onContextMenu?.(id, p.x, p.y);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w; this.height = h;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr, h * pr);
    this.linkMat.resolution.set(w, h);
    this.rig.setSize(w, h);
    this.uniforms.uPixelRatio.value = pr;
    this.uniforms.uMinPx.value = 2.6 * pr;
    this.labelsDirty = true;
  }
}
