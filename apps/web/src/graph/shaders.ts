/**
 * GLSL for the living graph (WebGL2 through three.js ShaderMaterial). Colours arrive in linear space; the
 * OutputPass converts to sRGB. Node and pulse layers write premultiplied colour: alpha covers the body only, so
 * glow, rings and pulses add light without hiding what is behind them.
 */

/** Shape ids shared with `engine.ts` (`SHAPE`). */
export const NODE_VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute float iSize;
attribute float iShape;
attribute vec4 iState;   // x: brightness 0..1 · y: emphasis 0..1 · z: ring flags · w: birth time (-1 = none)
attribute vec3 iMisc;    // x: closed (hollow) · y: phase 0..1 · z: progress 0..1 (-1 = none)
attribute float iTouch;  // when the brain's signal reaches the node (engine seconds; -1 = none)
uniform float uTime;
uniform float uProjScale;
uniform float uMinPx;
varying vec2 vUv;
varying vec3 vColor;
varying float vShape;
varying vec4 vState;
varying vec3 vMisc;
varying float vBirth;
varying float vPx;
varying float vTouch;
const float HALO = 3.4;
float elasticOut(float t) {
  if (t >= 1.0) return 1.0;
  return sin(-13.0 * 1.5707963 * (t + 1.0)) * pow(2.0, -10.0 * t) + 1.0;
}
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float depth = max(1.0, -mv.z);
  float bt = iState.w < 0.0 ? 1.0 : clamp((uTime - iState.w) / 1.15, 0.0, 1.0);
  float grow = elasticOut(bt);
  float r = iSize * max(grow, 0.0) * (1.0 + 0.22 * iState.y);
  float px = r * uProjScale / depth;
  float scale = px < uMinPx ? uMinPx / max(px, 0.0001) : 1.0;
  float h = r * scale * HALO;
  mv.xy += position.xy * h;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * HALO;
  vColor = iColor;
  vShape = iShape;
  vState = iState;
  vMisc = iMisc;
  vBirth = bt;
  vPx = px * scale;
  vTouch = iTouch;
}
`;

export const NODE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
varying vec3 vColor;
varying float vShape;
varying vec4 vState;
varying vec3 vMisc;
varying float vBirth;
varying float vPx;
varying float vTouch;

float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdStar(vec2 p, float r, float n, float m) {
  float an = 3.141593 / n;
  float en = 3.141593 / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}
float sdPentagon(vec2 p, float r) {
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  p.x = abs(p.x);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}
float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float shape(float s, vec2 p) {
  if (s < 0.5) return length(p) - 1.0;                          // note
  if (s < 1.5) return sdHex(p.yx, 0.94);                        // project
  if (s < 2.5) return sdBox(p, vec2(0.86), 0.34);               // task
  if (s < 3.5) return sdStar(p, 1.25, 4.0, 2.7);                // idea
  if (s < 4.5) return abs(length(p) - 0.7) - 0.32;              // person
  if (s < 5.5) return sdBox(p, vec2(0.74, 0.96), 0.22);         // resource
  if (s < 6.5) return (abs(p.x) + abs(p.y) - 1.18) * 0.7071;   // journal
  if (s < 7.5) return length(p) - 1.0;                          // area (hub)
  if (s < 8.5) return length(p) - 0.95;                         // inbox
  if (s < 9.5) return abs(length(p) - 0.82) - 0.13;             // ghost
  if (s < 10.5) return sdBox(p, vec2(0.72), 0.16);              // tag
  if (s < 11.5) return min(abs(length(p) - 0.8) - 0.17, length(p) - 0.3);   // goal: a target
  if (s < 12.5) return sdPentagon(vec2(p.x, -p.y), 0.84);       // habit
  if (s < 13.5) return sdTriangle(vec2(p.x, p.y + 0.12), 0.82) - 0.16;        // event: a soft triangle
  return length(p) - 1.0;                                       // a map's centre (15): a hub like an area
}
float ringAt(float rr, float radius, float width, float aa) { return 1.0 - smoothstep(0.0, aa * 1.6, abs(rr - radius) - width); }

void main() {
  if (vShape > 13.5 && vShape < 14.5) discard;                   // the core (14): the brain layer draws it
  vec2 p = vUv;
  float rr = length(p);
  float d = shape(vShape, p);
  float aa = max(fwidth(d), 0.015);
  float body = 1.0 - smoothstep(-aa, aa, d);
  float bright = vState.x;
  float emph = vState.y;
  float flags = vState.z;
  if (vMisc.x > 0.5) {                                           // closed: hollow outline
    float edge = abs(d + 0.16) - 0.11;
    body = (1.0 - smoothstep(-aa, aa, edge)) * 0.85;
  }
  float depthIn = clamp(-d, 0.0, 1.0);
  float hl = exp(-dot(p - vec2(-0.32, 0.38), p - vec2(-0.32, 0.38)) * 3.2);
  float edgeDark = smoothstep(-0.45, 0.0, d);
  float rim = 1.0 - smoothstep(0.0, 0.07, abs(d + 0.035));
  // Progress shows in the shape itself (UI-DESIGN "Shapes"): a goal's ring closes clockwise from the top as it
  // advances; a project's hexagon fills from the bottom with the share of its tasks done. The rest stays as a track.
  float fillK = 1.0;
  if (vMisc.z >= 0.0) {
    if (vShape > 10.5 && vShape < 11.5) {
      float t = atan(p.x, p.y) / 6.2831853;
      t = t < 0.0 ? t + 1.0 : t;
      float inRing = step(abs(rr - 0.8) - 0.17, 0.0);
      fillK = mix(1.0, 0.26, inRing * step(vMisc.z, t));
    } else if (vShape > 0.5 && vShape < 1.5) {
      float level = -0.95 + 1.9 * vMisc.z;
      fillK = mix(1.0, 0.36, smoothstep(level - aa * 2.0, level + aa * 2.0, p.y));
    }
  }
  vec3 core = (vColor * (0.62 + 0.38 * smoothstep(0.0, 0.6, depthIn)) * (1.0 - 0.28 * edgeDark)
            + mix(vColor, vec3(1.0), 0.45) * hl * 0.3) * fillK
            + vColor * rim * 0.55;
  float outside = max(d, 0.0);
  // Tiny (far) nodes get little halo, so a zoomed-out region does not melt into one white blob.
  float near = smoothstep(2.0, 10.0, vPx);
  float glow = exp(-outside * (2.6 - 1.2 * emph)) * (0.06 + 0.1 * near + 0.5 * emph) * uGlow * (1.0 - body);
  float breathe = 0.5 + 0.5 * sin(uTime * 1.25 + vMisc.y * 6.2831);
  bool hubLike = (vShape > 6.5 && vShape < 7.5) || vShape > 13.5;
  if ((vShape > 6.5 && vShape < 8.5) || vShape > 13.5) glow *= 0.7 + 0.7 * breathe;
  vec3 light = vColor * glow;
  if (hubLike) {                                                 // hub: slowly turning orbit with three gaps
    float a = atan(p.y, p.x) + uTime * 0.32 + vMisc.y * 6.2831;
    float seg = step(0.26, fract(a * 3.0 / 6.2831));
    light += vColor * ringAt(rr, 1.62, 0.03, aa) * seg * 0.85;
    light += vColor * ringAt(rr, 2.25, 0.012, aa) * 0.35 * (0.6 + 0.4 * breathe);
  }
  if (vShape > 13.5) {                                           // a map's centre: a second, counter-turning orbit
    float a2 = atan(p.y, p.x) - uTime * 0.21 + vMisc.y * 3.1;
    float seg2 = step(0.4, fract(a2 * 2.0 / 6.2831));
    light += vColor * ringAt(rr, 1.95, 0.022, aa) * seg2 * 0.6;
  }
  if (vTouch >= 0.0) {                                           // the brain's signal arrives: a flash and a ring of light
    float ta = uTime - vTouch;
    if (ta >= 0.0 && ta < 1.7) {
      vec3 spark = mix(vColor, vec3(0.78, 0.96, 1.0), 0.65);
      light += spark * ringAt(rr, 1.25 + ta * 1.9, 0.045, aa) * (1.0 - ta / 1.7) * 1.7;
      light += spark * exp(-ta * 4.5) * exp(-rr * 1.15) * 1.6;
    }
  }
  if (vShape > 7.5 && vShape < 8.5) {                            // inbox: dashed waiting ring
    float a = atan(p.y, p.x) - uTime * 0.6;
    light += vColor * ringAt(rr, 1.45, 0.03, aa) * step(0.5, fract(a * 8.0 / 6.2831)) * 0.8;
  }
  if (vShape > 8.5 && vShape < 9.5) {                            // ghost: dashed
    float a = atan(p.y, p.x);
    body *= step(0.45, fract(a * 10.0 / 6.2831));
  }
  if (mod(flags, 2.0) >= 1.0) light += vec3(1.0) * ringAt(rr, 1.42, 0.05, aa) * 0.95;                 // selected
  if (mod(floor(flags / 2.0), 2.0) >= 1.0) {                                                           // created by the brain
    float t = fract(uTime * 0.6);
    light += vec3(0.35, 1.0, 0.6) * ringAt(rr, 1.35 + t * 1.3, 0.05, aa) * (1.0 - t) * 1.4;
  }
  if (mod(floor(flags / 4.0), 2.0) >= 1.0) {                                                           // updated by the brain
    float t = fract(uTime * 0.6 + 0.5);
    light += vec3(0.45, 0.65, 1.0) * ringAt(rr, 1.35 + t * 1.3, 0.05, aa) * (1.0 - t) * 1.2;
  }
  if (mod(floor(flags / 8.0), 2.0) >= 1.0) light += vColor * ringAt(rr, 1.9, 0.03, aa) * 0.9;          // focus
  if (vBirth < 1.0) light += vColor * (1.0 - vBirth) * 2.5 * exp(-rr * 0.9);                            // birth flash
  vec3 rgb = core * body + light;
  float alpha = body;
  rgb *= bright;
  alpha *= mix(0.2, 1.0, bright);
  if (alpha < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) discard;
  gl_FragColor = vec4(rgb, alpha);
}
`;

export const NEBULA_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Glows on the light theme (UI-DESIGN "Light theme"): an additive light on a dark sky becomes, on paper, a tint that
 * takes away the colours the glow lacks (drawn with reverse-subtract blending). `v` is what the glow would add.
 */
export const GLOW_OUT = /* glsl */ `
uniform float uLight;
vec4 glowOut(vec3 v) {
  if (uLight < 0.5) return vec4(v, 1.0);
  float m = max(v.r, max(v.g, v.b));
  return vec4((vec3(m) - v) * 1.5 + vec3(m * 0.2), 1.0);
}
`;

/** Nebula clouds sample a pre-baked tileable fbm texture (three fetches per pixel instead of fifteen noise calls). */
export const NEBULA_FRAGMENT = /* glsl */ `
${GLOW_OUT}
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float fall = exp(-r * r * 3.1) * (1.0 - smoothstep(0.72, 0.98, r));
  if (fall < 0.004) discard;
  vec2 q = vUv * 0.42 + vec2(uSeed * 0.37, uSeed * 0.21);
  float warp = texture2D(uNoise, q * 0.8 - vec2(uTime * 0.0026, uTime * 0.0017)).r;
  float n = texture2D(uNoise, q + 0.32 * warp + vec2(uTime * 0.0042, -uTime * 0.003)).r;
  float w = texture2D(uNoise, q * 2.2 + warp * 0.5).r;
  float cloud = smoothstep(0.42, 0.95, n) * fall;
  float wisps = smoothstep(0.6, 1.0, w) * fall * 0.55;
  vec3 col = uColor * (cloud * 0.95 + wisps * 0.6 + fall * 0.16);
  gl_FragColor = glowOut(col * uIntensity);
}
`;

/**
 * A map's island (UI-DESIGN "Maps"): a mellow haze in the map's colour under its regions — a wide gaussian field whose
 * reach wobbles with low-frequency noise so it is never a circle, broken up by the same cloud texture the nebulae use,
 * with no edge and no ring. The engine scales the quad so the haze fades out around the island's radius.
 */
export const ZONE_FRAGMENT = /* glsl */ `
${GLOW_OUT}
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  // An uneven reach that drifts over minutes (the texture repeats along the angle), so the haze has no circular rim.
  float wob = texture2D(uNoise, vec2(a / 6.2831 + uSeed, uTime * 0.002 + uSeed * 0.37)).r;
  float reach = 0.66 + 0.3 * (wob - 0.5);
  float field = exp(-pow(r / reach, 2.0) * 1.8);
  if (field < 0.012) discard;
  vec2 q = vUv * 0.5 + vec2(uSeed * 0.29, uSeed * 0.17);
  float cloud = texture2D(uNoise, q + vec2(uTime * 0.0018, -uTime * 0.0012)).r;
  float wisps = texture2D(uNoise, q * 2.3 + cloud * 0.4).r;
  float body = field * (0.42 + 0.62 * smoothstep(0.3, 0.95, cloud) + 0.28 * smoothstep(0.6, 1.0, wisps));
  vec3 col = uColor * body * 0.36;
  if (max(col.r, max(col.g, col.b)) < 0.002) discard;
  gl_FragColor = glowOut(col * uIntensity);
}
`;

export const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aPhase * 1.7) + aPhase * 40.0);
  vTwinkle = tw;
  vColor = aColor;
  gl_PointSize = aSize * uPixelRatio * (0.8 + 0.4 * tw);
}
`;

export const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = exp(-d * 4.5) * vTwinkle;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export const PULSE_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
uniform float uPixelRatio;
uniform float uSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = aAlpha;
  gl_PointSize = uSize * uPixelRatio * (0.6 + 0.4 * aAlpha);
}
`;

export const PULSE_FRAGMENT = /* glsl */ `
${GLOW_OUT}
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  float core = exp(-d * 9.0);
  float halo = exp(-d * 2.5) * 0.45;
  gl_FragColor = glowOut((vColor * (core * 2.2 + halo) + vec3(core * 0.6)) * vAlpha);
}
`;

/**
 * The brain at the mind map's core (UI-DESIGN "Living graph" → The brain): one camera-facing quad drawn as a side view
 * of a brain, front to the left — the cerebrum's lobes, the cerebellum and the stem as smoothly joined signed
 * distances, the major sulci as grooves, the gyri from a baked labyrinth (`brain.ts` `bakeFolds`) — glassy and lit
 * from within. Its life comes through uniforms: `uWork` (a run is live: aura waves, sparks firing faster), waves of
 * light running across the folds from where a thought starts (`uWave`), bolts between its heart and its edge toward
 * what it reads (`uImpA` direction · start · kind, `uImpB` origin · length · seed), and a flash when an answer comes
 * home (`uFlash`). Premultiplied like the nodes: the body hides the links behind it.
 */
export const BRAIN_VERTEX = /* glsl */ `
uniform vec3 uCenter;
uniform float uRadius;
uniform float uProjScale;
uniform float uMinPx;
uniform float uGrow;
varying vec2 vUv;
varying float vPx;
const float EXTENT = 1.6;
void main() {
  vec4 mv = modelViewMatrix * vec4(uCenter, 1.0);
  float depth = max(1.0, -mv.z);
  float px = uRadius * uProjScale / depth;
  float scale = px < uMinPx ? uMinPx / max(px, 0.0001) : 1.0;
  mv.xy += position.xy * uRadius * scale * EXTENT * max(uGrow, 0.0);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * EXTENT;
  vPx = px * scale;
}
`;

export const BRAIN_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uWork;
uniform float uFlash;
uniform float uBright;
uniform float uHover;
uniform float uStill;
uniform vec3 uColor;
uniform vec3 uSpark;
uniform sampler2D uFolds;
uniform vec4 uImpA[6];
uniform vec4 uImpB[6];
uniform vec4 uWave[4];
varying vec2 vUv;
varying float vPx;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdEll(vec2 p, vec2 c, vec2 r) { vec2 q = p - c; float k0 = length(q / r); float k1 = length(q / (r * r)); return k0 * (k0 - 1.0) / max(k1, 0.0001); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float h11(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), f) * 2.0 - 1.0; }

// Brain space b: the quad's space moved so the silhouette's box is centred.
float cerebrum(vec2 b) {
  float d = sdEll(b, vec2(0.02, 0.15), vec2(0.9, 0.58));
  d = smin(d, sdEll(b, vec2(-0.5, 0.1), vec2(0.46, 0.43)), 0.16);
  d = smin(d, sdEll(b, vec2(0.58, 0.06), vec2(0.38, 0.44)), 0.14);
  return smin(d, sdEll(b, vec2(-0.08, -0.3), vec2(0.58, 0.25)), 0.09);
}
float cerebellum(vec2 b) { return sdEll(b, vec2(0.5, -0.43), vec2(0.31, 0.18)); }
float brainStem(vec2 b) { return sdSeg(b, vec2(0.2, -0.34), vec2(0.25, -0.74)) - mix(0.085, 0.068, clamp((-0.34 - b.y) / 0.4, 0.0, 1.0)); }
// The major sulci, wavy like the folds around them: the lateral fissure above the temporal lobe and the central
// sulcus from the crown down toward it.
float sulci(vec2 b) {
  b += vec2(0.018 * sin(b.y * 21.0 + 1.3), 0.022 * sin(b.x * 17.0 + 0.4));
  float d = sdSeg(b, vec2(-0.6, -0.16), vec2(-0.3, -0.1));
  d = min(d, sdSeg(b, vec2(-0.3, -0.1), vec2(-0.02, -0.07)));
  d = min(d, sdSeg(b, vec2(-0.02, -0.07), vec2(0.2, -0.01)));
  d = min(d, sdSeg(b, vec2(0.2, -0.01), vec2(0.36, 0.08)));
  d = min(d, sdSeg(b, vec2(0.12, 0.73), vec2(0.05, 0.5)));
  d = min(d, sdSeg(b, vec2(0.05, 0.5), vec2(0.02, 0.3)));
  d = min(d, sdSeg(b, vec2(0.02, 0.3), vec2(-0.06, 0.12)));
  return min(d, sdSeg(b, vec2(-0.06, 0.12), vec2(-0.1, -0.04)));
}

void main() {
  vec2 p = vUv;
  vec2 b = p - vec2(0.0, 0.08);
  float cer = cerebrum(b);
  float cbl = cerebellum(b);
  float body = smin(smin(cer, cbl, 0.04), brainStem(b), 0.07);
  float aa = max(fwidth(body), 0.0005);
  float mask = 1.0 - smoothstep(-aa, aa, body);
  float px1 = 1.0 / max(vPx, 1.0);                       // one pixel in brain units
  float motion = 1.0 - uStill;
  vec3 rgb = vec3(0.0);
  vec3 elec = uSpark;

  if (body < 0.06) {
    // How much the size on screen can carry: the folds come in from ~30 px, the cerebellum's folia from ~60 px.
    float detail = smoothstep(24.0, 56.0, vPx);
    float fine = smoothstep(50.0, 100.0, vPx);
    float inCbl = (1.0 - smoothstep(-0.012, 0.012, cbl - cer)) * step(cbl, 0.02);
    float inStem = (1.0 - smoothstep(-0.02, 0.02, brainStem(b) - min(cer, cbl)));
    // Sulci: the contour lines of the baked labyrinth, thin grooves meandering between broad rounded gyri.
    vec2 fuv = b * 0.3 + vec2(0.5, 0.5);
    fuv += 0.012 * vec2(sin(b.y * 7.0 + b.x * 3.0), cos(b.x * 6.0 - b.y * 2.0));
    float g = texture2D(uFolds, fuv).r;
    float e = abs(g - 0.5);
    float wpx = max(0.9, 0.011 * vPx);
    float fold = (1.0 - smoothstep(0.0, wpx, e / max(fwidth(g), 0.0001))) * detail;
    float tube = sin(min(e / 0.42, 1.0) * 1.5708);
    // The cerebellum's folia: close parallel arcs.
    float fr = length(b - vec2(0.47, -0.06)) * 15.3;
    float fe = 0.5 - abs(fract(fr) - 0.5);
    float folia = (1.0 - smoothstep(0.0, wpx * 0.8, fe / max(fwidth(fr), 0.0001))) * fine;
    fold = mix(fold, folia, inCbl) * (1.0 - inStem);
    tube = mix(tube, smoothstep(0.0, 0.3, fe), inCbl);
    // The major sulci and the seam between cerebrum and cerebellum show at every size.
    float wMaj = max(0.8, 0.013 * vPx);
    float major = (1.0 - smoothstep(wMaj * 0.5, wMaj * 1.3, sulci(b) * vPx)) * step(cer, -0.004) * (1.0 - inCbl);
    float seam = (1.0 - smoothstep(0.0, max(1.0, 0.018 * vPx), abs(cbl - cer) * vPx)) * (1.0 - smoothstep(0.0, 0.16, max(cbl, cer)));
    float groove = max(max(fold, major), seam);
    float ridge = mix(0.78, tube, detail * (1.0 - inStem)) * (1.0 - groove);
    // Lighting: a dome over the whole silhouette and the gyri's own relief, from the upper front.
    float dome = smoothstep(0.0, 0.28, -body);
    float hgt = dome * 0.6 + ridge * 0.4;
    vec2 grad = vec2(dFdx(hgt), dFdy(hgt)) * vPx;
    vec3 n = normalize(vec3(-grad * 0.05, 1.0));
    vec3 L = normalize(vec3(-0.55, 0.65, 0.55));
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float spec = pow(clamp(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 28.0);
    float side = smoothstep(-1.0, 1.0, -b.x * 0.45 + b.y * 0.9);
    vec3 tint = mix(vec3(0.86, 0.95, 1.12), vec3(1.1, 0.92, 1.0), smoothstep(-0.8, 0.8, b.x));
    // Dark glass: the gyri are rounded forms that catch a little light; the light lives in the grooves.
    vec3 glass = uColor * vec3(0.72, 0.68, 1.18) * tint;
    vec3 col = glass * mix(0.03, 0.17, ridge) * (0.5 + 0.85 * diff) * (0.55 + 0.75 * side);
    col += mix(uColor, vec3(1.0), 0.6) * spec * 0.16 * ridge;
    col += uColor * 0.05 * exp(-length(b - vec2(-0.25, 0.32)) * 2.6);   // light held inside the glass, upper front
    // The outline catches light like the hubs' glass rim; the grooves glow from inside, brighter while it thinks.
    float rim = 1.0 - smoothstep(0.0, max(0.035, 2.0 * px1), -body);
    col += mix(uColor, elec, 0.3) * rim * 0.42;
    float hum = 0.75 + 0.25 * sin(uTime * 2.3 * motion + b.x * 5.0 + b.y * 3.0);
    col += mix(uColor, elec, 0.35 + 0.3 * uWork) * groove * (0.2 + 0.3 * uWork) * hum;

    // Waves of activity running through the folds from where a thought starts: the grooves light up as they pass.
    float wave = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 w = uWave[i];
      if (w.w <= 0.0) continue;
      float age = uTime - w.z;
      if (age < 0.0 || age > 2.4) continue;
      float front = length(b - w.xy) - age * 1.1;
      wave += w.w * exp(-front * front * 150.0) * exp(-age * 1.4);
    }
    col += mix(elec, vec3(1.0), 0.25) * wave * (0.08 + 1.5 * groove + 0.18 * ridge) * motion;

    // Sparks: neurons firing here and there, many more while the brain works.
    vec2 cell = floor(b * 8.0);
    vec2 f = fract(b * 8.0);
    float r0 = h21(cell);
    float rate = mix(0.22, 1.7, uWork) * (0.6 + r0);
    float cyc = uTime * rate + r0 * 17.0;
    float fire = step(0.62 - 0.32 * uWork, h21(cell + floor(cyc) * 1.37));
    vec2 sp = vec2(h21(cell + 3.1), h21(cell + 7.7)) * 0.6 + 0.2;
    float sd = length(f - sp) / 8.0;
    float sw = max(0.006, 1.2 * px1);
    float spark = fire * exp(-fract(cyc) * 9.0) * (exp(-sd * sd / (sw * sw)) + 0.22 * exp(-sd * 55.0));
    col += mix(elec, vec3(1.0), 0.5) * spark * 1.3 * motion * (0.4 + 0.6 * detail);

    col *= 1.0 + 0.6 * uFlash + 0.15 * uHover;
    col += mix(uColor, elec, 0.5) * uFlash * 0.18 * (0.5 + groove);
    rgb += col * mask;
  }

  // Bolts: from the brain's heart out to its edge toward what it reaches for, from the edge home, or between two of
  // its own regions while it thinks. Each is a hot jagged filament with a bright head.
  float boltL = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 ia = uImpA[i];
    if (ia.w == 0.0) continue;
    float age = uTime - ia.z;
    if (age < 0.0 || age > 0.95) continue;
    vec4 ib = uImpB[i];
    vec2 dir = ia.xy;
    vec2 q = b - ib.xy;
    float s = dot(q, dir);
    float l = dot(q, vec2(-dir.y, dir.x));
    float len = ib.z;
    float go = clamp(age / 0.3, 0.0, 1.0);
    float headS = ia.w < 0.0 ? (1.0 - go) * len : go * len;
    float lo = ia.w < 0.0 ? headS : 0.0;
    float hi = ia.w < 0.0 ? len : headS;
    float tq = floor(uTime * 22.0) * motion;
    float bend = smoothstep(0.0, 0.12, s) * smoothstep(0.0, 0.12, len - s + 0.12);
    float off = (vn(s * 8.0 + ib.w + tq * 0.37) * 0.06 + vn(s * 21.0 + ib.w * 3.0 - tq) * 0.018) * bend;
    float dl = abs(l - off);
    float w = max(0.006, 1.1 * px1);
    float on = step(lo, s) * step(s, hi);
    float fade = 1.0 - smoothstep(0.3, 0.95, age);
    float trail = ia.w < 0.0 ? 1.0 : 0.45 + 0.55 * exp(-(headS - s) * 4.0);
    float hd = length(q - dir * headS);
    float head = exp(-hd * hd / (w * w * 18.0)) * (1.0 - smoothstep(0.26, 0.42, age));
    boltL += (exp(-dl * dl / (w * w)) * 1.4 + exp(-dl / (w * 3.5)) * 0.35) * on * fade * trail + head * 1.8;
  }
  // A bolt is drawn over the body and a little past its edge, where the current on the link takes over.
  rgb += mix(elec, vec3(1.0), 0.45) * boltL * (1.0 - smoothstep(-0.01, 0.16, body));

  // Outside: a soft halo in the brain's colour, and while it works aura waves that leave its outline and widen.
  float outside = max(body, 0.0);
  float halo = exp(-outside * 8.0) * (0.08 + 0.12 * uWork + 0.4 * uFlash + 0.08 * uHover) * (1.0 - mask);
  rgb += mix(uColor, elec, 0.25 + 0.3 * uWork) * halo;
  float aura = 0.0;
  for (int k = 0; k < 2; k++) {
    float ph = fract(uTime * 0.62 + float(k) * 0.5);
    float rr = 0.02 + ph * 0.5;
    aura += exp(-pow((outside - rr) / max(0.012, 1.2 * px1), 2.0)) * (1.0 - ph) * (1.0 - ph);
  }
  rgb += mix(uColor, elec, 0.5) * aura * uWork * 0.4 * motion * (1.0 - mask);

  rgb *= uBright;
  float alpha = mask * 0.94 * mix(0.25, 1.0, uBright);
  if (alpha < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) discard;
  gl_FragColor = vec4(rgb, alpha);
}
`;

/**
 * The current on a link while the brain reaches along it (UI-DESIGN "Living graph" → The brain at work): a ribbon in
 * screen space per hop, drawn as a jagged bolt that crackles (its kinks re-roll many times a second) with charge
 * running outward, a bright head while it travels, and the answer coming back as a packet in the item's colour.
 * Additive; `aState` is head (0..1) · alpha · seed · the packet's progress (-1 = none).
 */
export const ARC_VERTEX = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec2 aCorner;
attribute vec4 aState;
attribute vec3 aColor;
attribute float aPower;
uniform vec2 uViewport;
uniform float uWidth;
varying float vU;
varying float vV;
varying float vLen;
varying vec4 vState;
varying vec3 vColor;
varying float vPower;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(aFrom, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aTo, 1.0);
  vec2 sa = a.xy / a.w * 0.5 * uViewport;
  vec2 sb = b.xy / b.w * 0.5 * uViewport;
  vec2 d = sb - sa;
  float len = max(length(d), 0.001);
  vec2 n = vec2(-d.y, d.x) / len;
  float w = uWidth * (0.85 + 0.3 * aPower);
  vec4 c = aCorner.x < 0.5 ? a : b;
  c.xy += n * aCorner.y * w / (0.5 * uViewport) * c.w;
  gl_Position = c;
  vU = aCorner.x;
  vV = aCorner.y * w;
  vLen = len;
  vState = aState;
  vColor = aColor;
  vPower = aPower;
}
`;

export const ARC_FRAGMENT = /* glsl */ `
${GLOW_OUT}
uniform float uTime;
uniform float uPixel;
uniform vec3 uBolt;
varying float vU;
varying float vV;
varying float vLen;
varying vec4 vState;
varying vec3 vColor;
varying float vPower;
float h11(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float vn(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), f) * 2.0 - 1.0; }
void main() {
  float head = vState.x;
  float alpha = vState.y;
  float seed = vState.z;
  float back = vState.w;
  float px = vU * vLen;
  float headPx = head * vLen;
  float k = uPixel;                                           // device pixels per CSS pixel
  float env = smoothstep(0.0, 14.0 * k, px) * smoothstep(0.0, 14.0 * k, vLen - px) * min(1.0, vLen / (90.0 * k));
  float tq = floor(uTime * 16.0 + seed);
  float x = px / (24.0 * k);
  float j = vn(x + seed * 13.1 + tq * 1.37) * 0.72 + vn(x * 2.6 + seed * 3.7 - tq * 0.61) * 0.28;
  float d = abs(vV - j * 6.0 * k * env) / k;
  float j2 = vn(x * 1.4 + seed * 7.9 + tq * 2.3);
  float d2 = abs(vV - j2 * 8.5 * k * env) / k;
  float lit = (1.0 - smoothstep(headPx - 3.0 * k, headPx + 3.0 * k, px));
  float flow = 0.68 + 0.32 * sin(px / k * 0.33 - uTime * 26.0);
  float bolt = (exp(-d * d * 0.85) * 1.45 + exp(-d * 0.62) * 0.3) * flow + exp(-d2 * d2 * 1.4) * 0.22;
  float tip = head < 0.999 ? exp(-pow((px - headPx) / (8.0 * k), 2.0)) * exp(-vV * vV / (k * k) * 0.035) * 2.2 : 0.0;
  float packet = 0.0;
  if (back >= 0.0) { float bp = (1.0 - back) * vLen; packet = exp(-pow((px - bp) / (7.0 * k), 2.0)) * exp(-vV * vV / (k * k) * 0.05) * 2.1; }
  vec3 col = (uBolt * bolt * lit * vPower + mix(uBolt, vec3(1.0), 0.5) * tip + vColor * packet) * alpha;
  if (max(col.r, max(col.g, col.b)) < 0.002) discard;
  gl_FragColor = glowOut(col);
}
`;
