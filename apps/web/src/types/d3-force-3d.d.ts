// Minimal typings for the parts of d3-force-3d the graph layout uses (the package ships none).
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number; y?: number; z?: number;
    vx?: number; vy?: number; vz?: number;
    fx?: number | null; fy?: number | null; fz?: number | null;
  }
  export interface SimLink<N extends SimNode> {
    source: string | N;
    target: string | N;
    index?: number;
  }
  export interface Force<N extends SimNode> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }
  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(): number;
    alphaMin(a: number): this;
    alphaDecay(): number;
    alphaDecay(a: number): this;
    alphaTarget(): number;
    alphaTarget(a: number): this;
    velocityDecay(): number;
    velocityDecay(a: number): this;
    numDimensions(): number;
    numDimensions(n: 1 | 2 | 3): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    stop(): this;
    restart(): this;
  }
  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;

  export interface LinkForce<N extends SimNode, L extends SimLink<N>> extends Force<N> {
    links(links: L[]): this;
    id(fn: (n: N) => string): this;
    distance(d: number | ((l: L) => number)): this;
    strength(s: number | ((l: L) => number)): this;
    iterations(n: number): this;
  }
  export function forceLink<N extends SimNode, L extends SimLink<N>>(links?: L[]): LinkForce<N, L>;

  export interface ManyBodyForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
    distanceMax(d: number): this;
    distanceMin(d: number): this;
    theta(t: number): this;
  }
  export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;

  export interface CollideForce<N extends SimNode> extends Force<N> {
    radius(r: number | ((n: N) => number)): this;
    strength(s: number): this;
    iterations(n: number): this;
  }
  export function forceCollide<N extends SimNode>(radius?: number | ((n: N) => number)): CollideForce<N>;
}
