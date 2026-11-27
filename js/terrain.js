// Terrain: one heightfield for the whole range. Flat launch site, low dunes and scrub around it,
// hills rising to mountains in the west, a sandy coastline and open ocean to the east.
// Pure height function (no three.js) so placement code and tests can share it.
import * as THREE from 'three';
import { GLOBE_FADE, GLOBE_EDGE } from './earth.js';

export let SEA = -0.9;             // sea level (site ground is 0); set from the DEM when one loads
export const SITE = { x0: -200, x1: 175, z0: -250, z1: 95, blend: 150 };

// ---------- noise ----------
function hash(ix, iz) { let h = ix * 374761393 + iz * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 5) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
function ridge(x, z, oct = 5) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)) ** 2; n += a; a *= 0.5; f *= 2.1; } return s / n; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// signed distance to the flat site rectangle (negative inside)
export function siteDist(x, z) {
  const cx = (SITE.x0 + SITE.x1) / 2, cz = (SITE.z0 + SITE.z1) / 2, hx = (SITE.x1 - SITE.x0) / 2, hz = (SITE.z1 - SITE.z0) / 2;
  const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}
export const coastX = z => 760 + 220 * (fbm(z / 1400 + 7.3, 3.1, 3) - 0.5) * 2 + z * 0.08;

export function natural(x, z) {
  // dunes and low rolls
  let h = 1.2 + (fbm(x / 260, z / 260, 4) - 0.3) * 7 + (fbm(x / 60 + 11, z / 60, 2) - 0.5) * 1.2;
  // inland hills and mountains (west and north-west)
  const inland = sstep(500, 7000, -x * 0.85 + z * 0.35);
  h += inland * (ridge(x / 3200, z / 3200, 5) ** 1.4) * 1100 + inland * fbm(x / 700, z / 700, 4) * 60;
  // far south / north ranges so the horizon is never empty
  const farRing = sstep(9000, 16000, Math.hypot(x * 0.8, z));
  h += farRing * ridge(x / 4000 + 3, z / 4000, 4) * 1500 * sstep(0, 1, 1 - sstep(-2000, 4000, x - coastX(z)));
  // coast: beach slope then sea floor
  const d = x - coastX(z);
  const shore = sstep(-260, 20, d);
  h = h * (1 - shore) + shore * Math.max(-8, 1.2 - d * 0.02);
  h -= sstep(0, 900, d) * 26;
  return h;
}

// ---------- real-world elevation (DEM) ----------
// assets/terrain/<name>.bin: Int16 little-endian, decimetres, row-major (z rows, x columns),
// described by <name>.json { w, h, spacing, x0, z0 } in world metres. Falls back to the procedural range.
let DEM = null, DEMLO = null, COAST = null;
async function grid(base) {
  const meta = await (await fetch(base + '.json')).json();
  const buf = await (await fetch(base + '.bin')).arrayBuffer();
  return { ...meta, data: new Int16Array(buf) };
}
// Nested real elevation: a 4 km / 3.9 m tile around the site inside a 24 km / 47 m regional grid.
export async function loadDEM(base) {
  const [hi, lo, coast] = await Promise.all([grid(base + '_hi'), grid(base + '_lo'), fetch(base.replace(/[^/]+$/, 'coast_line.json')).then(r => r.json())]);
  DEM = hi; DEMLO = lo; COAST = coast; SEA = hi.sea + 0.25;
  return DEM;
}
export const hasDEM = () => !!DEM;
function sample(D, x, z) {
  const fx = Math.min(D.w - 1.001, Math.max(0, (x - D.x0) / D.spacing)), fz = Math.min(D.h - 1.001, Math.max(0, (z - D.z0) / D.spacing));
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, w = D.w, d = D.data, k = iz * w + ix;
  const u = tx * tx * (3 - 2 * tx), v = tz * tz * (3 - 2 * tz);
  const a = d[k], b = d[k + 1], c = d[k + w], e = d[k + w + 1];
  return (a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v) * 0.1;
}
const edgeDist = (D, x, z) => Math.min(x - D.x0, D.x0 + (D.w - 1) * D.spacing - x, z - D.z0, D.z0 + (D.h - 1) * D.spacing - z);
function demNatural(x, z) {
  // regional grid, fading to the procedural far range only past its own edge
  let h = sample(DEMLO, x, z);
  const wl = sstep(0, 2500, edgeDist(DEMLO, x, z));
  if (wl < 1) h = h * wl + (natural(x, z) + SEA) * (1 - wl);
  // high-res tile wins inside, blended over its last 300 m
  const wh = sstep(0, 300, edgeDist(DEM, x, z));
  if (wh > 0) h = h * (1 - wh) + sample(DEM, x, z) * wh;
  // metre-scale relief the DEM cannot resolve, on land only
  const above = h - SEA;
  if (above > 1) h += (fbm(x / 38 + 5, z / 38, 3) - 0.5) * 0.9 * Math.min(1, above / 4);
  return h;
}
// shoreline x for a given z (east of the site); procedural fallback without a DEM
export function shoreX(z) {
  if (!COAST) return coastX(z);
  let lo = 0, hi = COAST.length - 1; if (z <= COAST[0][0]) return COAST[0][1]; if (z >= COAST[hi][0]) return COAST[hi][1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (COAST[m][0] < z) lo = m; else hi = m; }
  const t = (z - COAST[lo][0]) / (COAST[hi][0] - COAST[lo][0]); return COAST[lo][1] + (COAST[hi][1] - COAST[lo][1]) * t;
}

export function height(x, z) {
  const sd = siteDist(x, z);
  if (sd < 0) return 0;
  const n = DEM ? demNatural(x, z) : natural(x, z), f = sstep(0, SITE.blend, sd);
  return n * f;
}
export function slopeAt(x, z, e = 2) {
  const hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

// Grid that is dense near the site and coarse at the horizon: x(s) = R s^3 + L s.
export function terrainGeometry(N = 200, R = 26000, L = 700) {
  const cx = (SITE.x0 + SITE.x1) / 2, cz = (SITE.z0 + SITE.z1) / 2;
  const map = s => R * s * s * s + L * s;
  const pos = new Float32Array((N + 1) * (N + 1) * 3), idx = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = cx + map(i / N * 2 - 1), z = cz + map(j / N * 2 - 1), k = (j * (N + 1) + i) * 3;
    pos[k] = x; pos[k + 1] = height(x, z) - 0.12; pos[k + 2] = z;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- LOD terrain ----------
// Centre: 500 m tiles, each a THREE.LOD with 3 resolutions and skirts to hide cracks between levels.
// Beyond: one coarse non-uniform ring mesh out to the horizon, sunk under the tiled area.
const OFF = -0.12; // the mesh sits 12 cm under the apron slab
function normalAt(x, z, e) { const hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e); const l = Math.hypot(hx, 2 * e, hz); return [-hx / l, 2 * e / l, -hz / l]; }
// One height sample per vertex (plus a 1-cell border); normals from the same grid so tiles match.
function tileGeometry(x0, z0, T, seg, cx, cz) {
  const n = seg + 1, step = T / seg, m = n + 2, H = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) H[j * m + i] = height(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const pos = [], nor = [], idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (j + 1) * m + i + 1, hx = H[k + 1] - H[k - 1], hz = H[k + m] - H[k - m], l = Math.hypot(hx, 2 * step, hz);
    pos.push(x0 + i * step - cx, H[k] + OFF, z0 + j * step - cz); nor.push(-hx / l, 2 * step / l, -hz / l);
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  const edge = list => {
    const base = pos.length / 3;
    for (const k of list) { pos.push(pos[k * 3], pos[k * 3 + 1] - 6, pos[k * 3 + 2]); nor.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]); }
    for (let t = 0; t < list.length - 1; t++) { const a = list[t], b = list[t + 1], c = base + t, d = base + t + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
  };
  const row = j => Array.from({ length: n }, (_, i) => j * n + i), col = i => Array.from({ length: n }, (_, j) => j * n + i);
  edge(row(0)); edge(row(seg)); edge(col(0)); edge(col(seg));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Tiled terrain with distance-based levels built lazily (a couple per frame) and freed when far,
// so iPhone only ever holds fine geometry for the few tiles around the camera.
export class TerrainLOD extends THREE.Group {
  constructor(mat, lite) {
    super(); this.name = 'terrain'; this.mat = mat; this.lite = lite;
    const cx = Math.round((SITE.x0 + SITE.x1) / 2), cz = Math.round((SITE.z0 + SITE.z1) / 2);
    const T = this.T = 500, NT = lite ? 10 : 14, half = this.half = NT * T / 2;
    this.levels = lite ? [[40, 650], [16, 1500], [6, 1e9]] : [[64, 800], [24, 2000], [8, 1e9]];
    this.tiles = [];
    for (let tj = 0; tj < NT; tj++) for (let ti = 0; ti < NT; ti++) {
      const x0 = cx - half + ti * T, z0 = cz - half + tj * T, tile = { x0, z0, cx: x0 + T / 2, cz: z0 + T / 2, geos: [], lvl: -1 };
      tile.mesh = new THREE.Mesh(undefined, mat); tile.mesh.position.set(tile.cx, 0, tile.cz); tile.mesh.receiveShadow = true;
      this.setLevel(tile, this.levels.length - 1); this.add(tile.mesh); this.tiles.push(tile);
    }
    // horizon ring: non-uniform grid, vertices inside the tiled square pushed down out of sight
    const N = lite ? 120 : 170, R = 30000, L = 1200, map = s => R * s * s * s + L * s;
    const pos = new Float32Array((N + 1) * (N + 1) * 3), nor = new Float32Array(pos.length), idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = cx + map(i / N * 2 - 1), z = cz + map(j / N * 2 - 1), k = (j * (N + 1) + i) * 3, inside = Math.abs(x - cx) < half - 1 && Math.abs(z - cz) < half - 1;
      pos[k] = x; pos[k + 1] = height(x, z) + OFF - (inside ? 40 : 0); pos[k + 2] = z;
      const nn = normalAt(x, z, 40); nor[k] = nn[0]; nor[k + 1] = nn[1]; nor[k + 2] = nn[2];
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
    const ring = new THREE.Mesh(g, mat); ring.receiveShadow = true; this.add(ring);
  }
  setLevel(tile, l) {
    if (tile.lvl === l) return;
    if (!tile.geos[l]) tile.geos[l] = tileGeometry(tile.x0, tile.z0, this.T, this.levels[l][0], tile.cx, tile.cz);
    tile.mesh.geometry = tile.geos[l]; tile.lvl = l;
    // free fine levels we have stepped away from (keep the coarsest forever)
    for (let k = 0; k < l; k++) if (tile.geos[k]) { tile.geos[k].dispose(); tile.geos[k] = null; }
  }
  wanted(tile, p) {
    const dx = Math.max(0, Math.abs(p.x - tile.cx) - this.T / 2), dz = Math.max(0, Math.abs(p.z - tile.cz) - this.T / 2), d = Math.hypot(dx, dz, Math.max(0, p.y) * 0.8);
    for (let l = 0; l < this.levels.length; l++) if (d < this.levels[l][1] * (l < tile.lvl ? 0.92 : 1.0)) return l;
    return this.levels.length - 1;
  }
  // budget = how many new geometries may be built this call (Infinity to settle at once)
  refine(p, budget = 2) {
    const todo = [];
    for (const t of this.tiles) { const l = this.wanted(t, p); if (l !== t.lvl) todo.push([l < t.lvl ? Math.hypot(p.x - t.cx, p.z - t.cz) : -1, t, l]); }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, t, l] of todo) { const needs = !t.geos[l]; this.setLevel(t, l); if (needs && --budget <= 0) break; }
  }
}
export function buildTerrainLOD(mat, lite) { return new TerrainLOD(mat, lite); }

// Splat-blended material: sand / dirt / grass / rock by height, slope and noise, with two-scale
// sampling so tiling never shows. Built on MeshStandardMaterial so lights, fog and shadows still work.
// Rect (x0, z0, size) in world metres covered by a DEM grid, for the matching aerial image.
export const demRect = (lo = false) => { const g = lo ? DEMLO : DEM; return g ? new THREE.Vector3(g.x0, g.z0, (g.w - 1) * g.spacing) : null; };

export function terrainMaterial(tex, nor = null, macro = null) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  m.defines = {}; if (nor) m.defines.DETAIL_NORMALS = ''; if (macro) m.defines.MACRO = '';
  const U = {
    tSand: { value: tex.sand }, tDirt: { value: tex.dirt }, tGrass: { value: tex.grass }, tRock: { value: tex.rock },
    nSand: { value: nor?.sand }, nDirt: { value: nor?.dirt }, nGrass: { value: nor?.grass }, nRock: { value: nor?.rock },
    tMacHi: { value: macro?.hi }, tMacLo: { value: macro?.lo }, uHiR: { value: macro?.hiR || new THREE.Vector3() }, uLoR: { value: macro?.loR || new THREE.Vector3() },
    uGF: GLOBE_FADE, uGE: GLOBE_EDGE, uSea: { value: SEA }, uCoast: { value: shoreX(-80) }, uSite: { value: new THREE.Vector4(SITE.x0, SITE.x1, SITE.z0, SITE.z1) },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP; varying vec3 vWN;
uniform sampler2D tSand, tDirt, tGrass, tRock; uniform float uSea, uCoast, uGF, uGE; uniform vec4 uSite;
#ifdef DETAIL_NORMALS
uniform sampler2D nSand, nDirt, nGrass, nRock;
#endif
#ifdef MACRO
uniform sampler2D tMacHi, tMacLo; uniform vec3 uHiR, uLoR;
float edgeIn(vec2 u, float k){ return smoothstep(0.0, k, min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y))); }
#endif
vec4 gTW; vec2 gTP; float gFar;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fb(vec2 p){ return vn(p)*0.5 + vn(p*2.03)*0.25 + vn(p*4.1)*0.125 + vn(p*8.3)*0.0625; }
vec3 two(sampler2D t, vec2 p, float far){ vec3 a = texture2D(t, p / 5.0).rgb, b = texture2D(t, p / 41.0 + 0.37).rgb, c = texture2D(t, p / 290.0).rgb;
  return mix(mix(a, b, 0.35), mix(b, c, 0.5), far); }`)
      .replace('#include <map_fragment>', `
float gFade = max(uGF, uGE * smoothstep(7000.0, 11000.0, max(abs(vWP.x), abs(vWP.z))));   // blend into the globe pass behind
if (gFade > 0.995) discard;     // dissolve into the globe pass at high altitude
{
  vec2 p = vWP.xz; float dist = length(vWP - cameraPosition); float far = smoothstep(80.0, 1400.0, dist);
  float n = fb(p / 90.0), n2 = fb(p / 900.0 + 3.1);
  float slope = 1.0 - clamp(vWN.y, 0.0, 1.0);
  vec2 q = max(vec2(uSite.x - p.x, p.x - uSite.y), 0.0); vec2 r = max(vec2(uSite.z - p.y, p.y - uSite.w), 0.0);
  float sd = length(vec2(max(q.x, q.y), max(r.x, r.y)));
  float coast = smoothstep(uCoast - 900.0, uCoast - 250.0, vWP.x + (n - 0.5) * 220.0);
  float sand = coast * smoothstep(75.0, 35.0, vWP.y - uSea + (n - 0.5) * 20.0) + smoothstep(0.66, 0.82, n2) * 0.7 * (1.0 - smoothstep(60.0, 300.0, vWP.y)) * (1.0 - smoothstep(60.0, 0.0, sd));
  float rock = smoothstep(0.28, 0.55, slope + (n - 0.5) * 0.2) + smoothstep(380.0, 900.0, vWP.y + n * 200.0);
  float grass = smoothstep(0.3, 0.55, n + n2 * 0.5 - 0.12) * (1.0 - smoothstep(500.0, 900.0, vWP.y)) * 1.3;
  float dirt = 0.28 + smoothstep(0.55, 0.3, n) * 0.25 + smoothstep(30.0, 0.0, sd) * 1.4;
  sand = clamp(sand, 0.0, 1.0); rock = clamp(rock, 0.0, 1.0);
#ifdef MACRO
  // real aerial imagery decides what grows where; the tiling sets only add close-up detail
  vec2 uh = (p - uHiR.xy) / uHiR.z, ul = (p - uLoR.xy) / uLoR.z;
  float fh = edgeIn(uh, 0.05), fl = edgeIn(ul, 0.06);
  vec4 mlo4 = texture2D(tMacLo, ul), mhi4 = texture2D(tMacHi, uh);
  vec3 mac = mix(mlo4.rgb, mhi4.rgb, fh * mhi4.a);
  float mk = fl * mix(mlo4.a, 1.0, fh * mhi4.a) * smoothstep(40.0, 260.0, sd + (n - 0.5) * 60.0);      // keep the graded site procedural
  float ml = dot(mac, vec3(0.3, 0.59, 0.11)), mg = mac.g - max(mac.r, mac.b);
  float sandM = smoothstep(0.16, 0.34, ml) * (1.0 - smoothstep(0.0, 0.03, mg));
  float grassM = smoothstep(-0.005, 0.03, mg + (n - 0.5) * 0.02);
  sand = mix(sand, sandM, mk); grass = mix(grass, grassM * 1.4, mk); rock = mix(rock, smoothstep(0.35, 0.6, slope), mk);
#endif
  vec4 w = vec4(sand, dirt * (1.0 - sand), grass * (1.0 - sand) * (1.0 - smoothstep(25.0, 0.0, sd)), rock * 1.6);
  w = pow(w, vec4(2.0)); w /= max(1e-3, w.x + w.y + w.z + w.w);
  vec3 col = two(tSand, p, far) * w.x + two(tDirt, p, far) * w.y + two(tGrass, p, far) * w.z + two(tRock, p * 0.6, far) * w.w;
  col *= 0.86 + 0.28 * fb(p / 23.0);                    // breakup
  col *= mix(vec3(1.04, 0.99, 0.92), vec3(0.86, 0.93, 0.8), smoothstep(0.35, 0.7, n2));   // macro tint
#ifdef MACRO
  {
    vec3 avg = texture2D(tSand, vec2(0.5), 14.0).rgb * w.x + texture2D(tDirt, vec2(0.5), 14.0).rgb * w.y + texture2D(tGrass, vec2(0.5), 14.0).rgb * w.z + texture2D(tRock, vec2(0.5), 14.0).rgb * w.w;
    vec3 detail = clamp(col / max(avg, vec3(0.03)), 0.0, 2.2);
    float near = 1.0 - smoothstep(15.0, 120.0, dist);
    vec3 real = mac * mix(detail, vec3(1.0), far * 0.7) * 1.05;
    col = mix(col, mix(real, col, near * 0.25), mk);
  }
#endif
  float wet = smoothstep(uSea + 0.9, uSea + 0.05, vWP.y); col *= 1.0 - wet * 0.45; // wet sand at the waterline
  diffuseColor.rgb *= col; diffuseColor.a *= 1.0 - gFade;
  gTW = w; gTP = p; gFar = far;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef DETAIL_NORMALS
{
  float near = 1.0 - smoothstep(40.0, 260.0, length(vWP - cameraPosition));
  if (near > 0.0) {
    vec3 dn = (texture2D(nSand, gTP / 5.0).xyz * 2.0 - 1.0) * gTW.x + (texture2D(nDirt, gTP / 5.0).xyz * 2.0 - 1.0) * gTW.y
            + (texture2D(nGrass, gTP / 5.0).xyz * 2.0 - 1.0) * gTW.z + (texture2D(nRock, gTP * 0.6 / 5.0).xyz * 2.0 - 1.0) * gTW.w;
    vec3 nW = normalize(normalize(vWN) + (vec3(1.0, 0.0, 0.0) * dn.x + vec3(0.0, 0.0, 1.0) * dn.y) * 0.9 * near);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }
}
#endif`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.97, 0.55, smoothstep(uSea + 0.6, uSea, vWP.y));');
  };
  m.customProgramCacheKey = () => 'terrain-v3' + (nor ? 'n' : '') + (macro ? 'm' : '');
  return m;
}

// Tiling wave normal map, generated once (256²).
export function waterNormals() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), img = g.createImageData(S, S);
  const H = new Float32Array(S * S), waves = [];
  for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, k = 1 + (Math.random() * 6 | 0); waves.push([Math.round(Math.cos(a) * k), Math.round(Math.sin(a) * k), Math.random() * 6.28, 1 / (k + 0.5)]); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let h = 0; for (const [kx, ky, ph, amp] of waves) h += Math.sin((kx * x + ky * y) / S * Math.PI * 2 + ph) * amp; H[y * S + x] = h; }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = H[y * S + (x + 1) % S] - H[y * S + (x + S - 1) % S], dy = H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x];
    const nx = -dx * 1.2, ny = -dy * 1.2, l = Math.hypot(nx, ny, 1), k = (y * S + x) * 4;
    img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
