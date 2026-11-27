// Worker robots: original, realistic humanoid service robots (about 1.75 m) built procedurally.
// White clear-coated (or satin-silver) shell panels with thin seams, brushed-metal joints (procedural anisotropic),
// a graphite under-suit, plain dark rubber soles and fingertips, a glossy black glass faceplate and visible linear
// actuators at the elbows and knees. Every robot shares one rigidly-skinned geometry set (6 draw calls per robot),
// with its own skeleton. Legs use planted-foot IK (no foot sliding); upper body is code-animated and smoothed.
// Jobs: patrol, inspect (reach toward the rocket), console (hands on a panel). Click one: it stops, turns, looks at
// you and waves with a soft servo whir. Pad crews walk clear at countdown and are gone by liftoff.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { SPOTS } from './env.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = t => t * t * (3 - 2 * t);

// ---------------- skeleton definition (bind pose: standing straight, arms down, facing +z) ----------------
const L_THIGH = 0.43, L_SHIN = 0.42, ANKLE_H = 0.075, HIP_Y = 0.985, HIP_OFF = [0.095, -0.06];
const BONES = [];   // [name, parent, [x,y,z]]
const B = (n, p, pos) => BONES.push([n, p, pos]);
B('root', null, [0, 0, 0]);
B('pelvis', 'root', [0, HIP_Y, 0]);
B('spine', 'pelvis', [0, 0.10, 0]);
B('chest', 'spine', [0, 0.16, 0]);
B('neck', 'chest', [0, 0.30, 0]);
B('head', 'neck', [0, 0.075, 0]);
for (const [S, s] of [['L', 1], ['R', -1]]) {
  B('sh' + S, 'chest', [0.19 * s, 0.245, 0]);
  B('el' + S, 'sh' + S, [0, -0.30, 0]);
  B('wr' + S, 'el' + S, [0, -0.265, 0]);
  [0.031, 0.011, -0.009, -0.029].forEach((z, i) => { B(`f${i}a` + S, 'wr' + S, [0.002 * s, -0.098, z]); B(`f${i}b` + S, `f${i}a` + S, [0, -0.044 + i * 0.002 * (i === 3 ? 1 : 0), 0]); });
  B('thA' + S, 'wr' + S, [-0.014 * s, -0.035, 0.036]); B('thB' + S, 'thA' + S, [0, -0.042, 0]);
  B('hip' + S, 'pelvis', [HIP_OFF[0] * s, HIP_OFF[1], 0]);
  B('kn' + S, 'hip' + S, [0, -L_THIGH, 0]);
  B('an' + S, 'kn' + S, [0, -L_SHIN, 0]);
  B('toe' + S, 'an' + S, [0, -0.055, 0.105]);
  // linear actuators: body rides the parent segment, rod rides it too but is re-aimed every frame
  B('eaB' + S, 'sh' + S, [0, -0.11, 0.058]); B('eaR' + S, 'sh' + S, [0, -0.3, 0.05]);
  B('kaB' + S, 'hip' + S, [0, -0.14, 0.098]); B('kaR' + S, 'hip' + S, [0, -0.5, 0.06]);
}
// actuator anchor on the child segment (in the child bone's frame)
const ACT = [
  { body: 'eaB', rod: 'eaR', child: 'el', anchor: V3(0, -0.075, 0.048) },
  { body: 'kaB', rod: 'kaR', child: 'kn', anchor: V3(0, -0.09, 0.072) },
];
const _q = new THREE.Quaternion(), _v = V3(), _w = V3(), _m = new THREE.Matrix4();
function aimActuators(bones, S) {
  for (const a of ACT) {
    const body = bones[a.body + S], rod = bones[a.rod + S], ch = bones[a.child + S];
    const Bp = _w.copy(a.anchor).applyQuaternion(ch.quaternion).add(ch.position);   // rod anchor in the parent frame
    const d = _v.copy(Bp).sub(body.position).normalize();
    body.quaternion.setFromUnitVectors(UP, d);
    rod.position.copy(Bp); rod.quaternion.setFromUnitVectors(UP, d.negate());
  }
}
function makeBones() {
  const map = {}, list = [];
  for (const [n, p, pos] of BONES) { const b = new THREE.Bone(); b.name = n; b.position.set(...pos); if (p) map[p].add(b); map[n] = b; list.push(b); }
  for (const S of ['L', 'R']) { map['sh' + S].rotation.order = 'XZY'; map['hip' + S].rotation.order = 'ZXY'; }
  return { map, list };
}

// ---------------- geometry ----------------
function lathe(profile, seg = 24, sx = 1, sz = 1) {   // profile: [[r, y], ...] bottom to top
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg);
  g.scale(sx, 1, sz); return g;
}
const rAt = (profile, y) => { for (let i = 1; i < profile.length; i++) { const [r0, y0] = profile[i - 1], [r1, y1] = profile[i]; if (y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0 || 1); } return profile[profile.length - 1][0]; };
// thin dark seam band hugging a lathe shell at height y
const seam = (profile, y, sx, sz, h = 0.0035) => { const r = rAt(profile, y) * 1.012 + 0.0006; const g = new THREE.CylinderGeometry(r, r, h, 28, 1, true); g.scale(sx, 1, sz); g.translate(0, y, 0); return g; };
const sph = (rx, ry, rz, x, y, z, w = 24, h = 16) => { const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); g.translate(x, y, z); return g; };
const cylX = (r, len, x, y, z, seg = 20) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; };
const cyl = (r0, r1, h, x, y, z, seg = 16) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(x, y + h / 2, z); return g; };   // from y up
const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
const caps = (r, len, x, y, z) => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(x, y - len / 2, z); return g; };   // hangs down from y

// parts per bone: { mat: [geometries] }
function buildParts() {
  const P = [];   // [bone, mat, geo]
  const add = (bone, mat, geo) => P.push([bone, mat, geo]);
  // pelvis
  const pel = [[0.085, -0.10], [0.135, -0.06], [0.158, -0.01], [0.152, 0.04], [0.118, 0.07], [0.09, 0.075]];
  add('pelvis', 'shell', lathe(pel, 28, 1, 0.66));
  add('pelvis', 'dark', seam(pel, 0.02, 1, 0.66, 0.004));
  add('pelvis', 'dark', sph(0.06, 0.05, 0.05, 0, -0.105, 0.0));   // crotch housing
  // abdomen: metal core + flexible ribbed graphite bellows
  add('spine', 'metal', cyl(0.06, 0.06, 0.17, 0, -0.01, 0, 18));
  for (let i = 0; i < 4; i++) { const g = new THREE.TorusGeometry(0.086 - (i === 3 ? 0.006 : 0), 0.013, 8, 28); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.66); g.translate(0, 0.02 + i * 0.038, 0); add('spine', 'dark', g); }
  // chest shell with a sternum seam and a back power pack
  const ch = [[0.115, -0.01], [0.148, 0.05], [0.172, 0.13], [0.182, 0.2], [0.17, 0.255], [0.13, 0.295], [0.07, 0.318]];
  add('chest', 'shell', lathe(ch, 32, 1, 0.6));
  add('chest', 'dark', seam(ch, 0.115, 1, 0.6)); add('chest', 'dark', seam(ch, 0.235, 1, 0.6));
  add('chest', 'dark', box(0.0035, 0.1, 0.012, 0, 0.17, rAt(ch, 0.17) * 0.6 + 0.001));   // vertical sternum seam
  add('chest', 'dark', box(0.2, 0.2, 0.05, 0, 0.14, -0.1));   // back pack
  add('chest', 'metal', box(0.17, 0.012, 0.055, 0, 0.255, -0.098)); add('chest', 'metal', box(0.17, 0.012, 0.055, 0, 0.035, -0.098));
  for (let i = 0; i < 5; i++) add('chest', 'dark', box(0.15, 0.006, 0.006, 0, 0.08 + i * 0.03, -0.127));   // vents
  // collar yoke over the shoulders
  { const g = new THREE.CylinderGeometry(0.085, 0.13, 0.05, 28); g.scale(1.55, 1, 0.62); g.translate(0, 0.29, 0); add('chest', 'shell', g); }
  // neck
  add('neck', 'metal', cyl(0.034, 0.03, 0.1, 0, -0.03, 0, 16));
  for (let i = 0; i < 3; i++) { const g = new THREE.TorusGeometry(0.036, 0.007, 6, 18); g.rotateX(Math.PI / 2); g.translate(0, 0.0 + i * 0.022, 0); add('neck', 'dark', g); }
  // head: tapered shell, glossy faceplate wrapping the front, ear pods with a soft status ring
  add('head', 'shell', sph(0.093, 0.118, 0.108, 0, 0.088, -0.006, 32, 24));
  { const g = new THREE.SphereGeometry(1, 40, 28, Math.PI / 2 - 0.98, 1.96, 0.5, 1.72); g.scale(0.0962, 0.1205, 0.1105); g.translate(0, 0.088, -0.004); add('head', 'visor', g); }
  add('head', 'dark', sph(0.072, 0.03, 0.07, 0, 0.0, -0.005));   // jaw/neck housing
  for (const s of [1, -1]) {
    add('head', 'metal', cylX(0.03, 0.022, s * 0.093, 0.085, -0.01, 24));
    const ring = new THREE.TorusGeometry(0.022, 0.0025, 6, 24); ring.rotateY(Math.PI / 2); ring.translate(s * 0.1045, 0.085, -0.01); add('head', 'glow', ring);
  }
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? 1 : -1;
    // shoulder: brushed joint ball under a white deltoid cap
    add('sh' + S, 'metal', sph(0.06, 0.06, 0.06, 0, 0, 0, 20, 14));
    const delt = [[0.052, -0.13], [0.07, -0.07], [0.078, -0.02], [0.07, 0.03], [0.045, 0.06], [0.01, 0.07]];
    { const g = lathe(delt, 24, 1, 0.92); g.translate(s * 0.008, 0, 0); add('sh' + S, 'shell', g); }
    add('sh' + S, 'dark', cyl(0.036, 0.036, 0.2, 0, -0.28, 0, 14));   // inner arm core
    const ua = [[0.043, -0.262], [0.05, -0.225], [0.055, -0.17], [0.056, -0.135], [0.05, -0.105]];
    add('sh' + S, 'shell', lathe(ua, 24, 0.95, 1));
    add('sh' + S, 'dark', seam(delt, -0.125, 1, 0.92));
    // elbow hinge + forearm
    add('el' + S, 'metal', cylX(0.04, 0.088, 0, 0, 0, 22));
    add('el' + S, 'dark', cylX(0.044, 0.012, 0.047 * s, 0, 0, 22)); add('el' + S, 'dark', cylX(0.044, 0.012, -0.047 * s, 0, 0, 22));
    const fa = [[0.033, -0.25], [0.038, -0.2], [0.048, -0.1], [0.05, -0.065], [0.042, -0.035], [0.02, -0.025]];
    add('el' + S, 'shell', lathe(fa, 24, 0.92, 1));
    add('el' + S, 'dark', seam(fa, -0.13, 0.92, 1));
    // wrist + hand: palm pad, white back plate, two-segment graphite fingers with brushed knuckles, thumb
    add('wr' + S, 'metal', sph(0.028, 0.026, 0.03, 0, -0.008, 0, 16, 12));
    add('wr' + S, 'dark', sph(0.02, 0.052, 0.045, -0.004 * s, -0.055, 0.0));
    add('wr' + S, 'shell', sph(0.016, 0.05, 0.044, 0.01 * s, -0.054, 0.0));
    for (let i = 0; i < 4; i++) {
      const la = i === 3 ? 0.032 : 0.04, lb = i === 3 ? 0.028 : i === 1 ? 0.036 : 0.034;
      add(`f${i}a` + S, 'metal', sph(0.0095, 0.0095, 0.0095, 0, 0, 0, 10, 8));
      add(`f${i}a` + S, 'dark', caps(0.0082, la - 0.012, 0, -0.006, 0));
      add(`f${i}b` + S, 'rubber', caps(0.0076, lb - 0.012, 0, -0.004, 0));
    }
    add('thA' + S, 'metal', sph(0.011, 0.011, 0.011, 0, 0, 0, 10, 8)); add('thA' + S, 'dark', caps(0.0095, 0.03, 0, -0.006, 0)); add('thB' + S, 'rubber', caps(0.0085, 0.022, 0, -0.004, 0));
    // hip ball, thigh shell
    add('hip' + S, 'metal', sph(0.058, 0.058, 0.058, 0, 0, 0, 20, 14));
    add('hip' + S, 'dark', cyl(0.045, 0.05, 0.36, 0, -0.42, 0, 14));
    const th = [[0.052, -0.38], [0.062, -0.33], [0.076, -0.17], [0.08, -0.09], [0.074, -0.04], [0.055, -0.01]];
    add('hip' + S, 'shell', lathe(th, 28, 0.9, 1.02));
    add('hip' + S, 'dark', seam(th, -0.21, 0.9, 1.02));
    // knee hinge + kneecap + shin with calf
    add('kn' + S, 'metal', cylX(0.05, 0.1, 0, 0, 0, 24));
    add('kn' + S, 'dark', cylX(0.054, 0.012, 0.054, 0, 0, 24)); add('kn' + S, 'dark', cylX(0.054, 0.012, -0.054, 0, 0, 24));
    add('kn' + S, 'shell', sph(0.042, 0.052, 0.026, 0, -0.005, 0.052));
    add('kn' + S, 'dark', cyl(0.034, 0.04, 0.33, 0, -0.39, 0, 14));
    const sh = [[0.036, -0.375], [0.042, -0.32], [0.058, -0.2], [0.062, -0.14], [0.054, -0.08], [0.03, -0.06]];
    add('kn' + S, 'shell', lathe(sh, 28, 0.92, 1.06));
    add('kn' + S, 'dark', seam(sh, -0.25, 0.92, 1.06));
    // ankle + foot (heel on the ankle bone, toe cap on the toe bone), rubber soles
    add('an' + S, 'metal', sph(0.037, 0.035, 0.037, 0, 0, 0, 18, 12));
    add('an' + S, 'shell', sph(0.052, 0.035, 0.1, 0, -0.035, 0.03));
    add('an' + S, 'rubber', box(0.098, 0.02, 0.19, 0, -0.065, 0.006));
    add('toe' + S, 'shell', sph(0.049, 0.026, 0.05, 0, -0.003, 0.028));
    add('toe' + S, 'rubber', box(0.096, 0.02, 0.07, 0, -0.01, 0.034));
    // actuators (along +y from each anchor)
    add('eaB' + S, 'metal', cyl(0.0105, 0.0105, 0.12, 0, 0, 0, 12)); add('eaB' + S, 'dark', cyl(0.012, 0.012, 0.012, 0, 0.105, 0, 12)); add('eaB' + S, 'metal', cyl(0.016, 0.016, 0.018, 0, 0, 0, 12));
    add('eaR' + S, 'metal', cyl(0.0055, 0.0055, 0.15, 0, 0, 0, 10)); add('eaR' + S, 'metal', sph(0.011, 0.011, 0.011, 0, 0, 0, 10, 8));
    add('kaB' + S, 'metal', cyl(0.014, 0.014, 0.2, 0, 0, 0, 12)); add('kaB' + S, 'dark', cyl(0.017, 0.017, 0.022, 0, 0, 0, 12)); add('kaB' + S, 'dark', cyl(0.016, 0.016, 0.014, 0, 0.19, 0, 12));
    add('kaR' + S, 'metal', cyl(0.0075, 0.0075, 0.22, 0, 0, 0, 10)); add('kaR' + S, 'metal', sph(0.014, 0.014, 0.014, 0, 0, 0, 10, 8));
  }
  return P;
}

// ---------------- shared template (geometry + bind inverses) ----------------
const MATS = ['shell', 'metal', 'dark', 'rubber', 'visor', 'glow'];
let TEMPLATE = null;
function template() {
  if (TEMPLATE) return TEMPLATE;
  const { map, list } = makeBones();
  aimActuators(map, 'L'); aimActuators(map, 'R');
  map.root.updateMatrixWorld(true);
  const idx = new Map(list.map((b, i) => [b.name, i]));
  const by = {};
  for (const [bone, mat, g0] of buildParts()) {
    let g = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(map[bone].matrixWorld);
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), bi = idx.get(bone);
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    (by[mat] ||= []).push(g);
  }
  const geos = {};
  for (const m of MATS) if (by[m]) { geos[m] = mergeGeometries(by[m], false); geos[m].computeBoundingSphere(); }
  const inverses = list.map(b => b.matrixWorld.clone().invert());
  TEMPLATE = { geos, inverses };
  return TEMPLATE;
}

function brushedTex() {   // grey streaks along u (lathe/cylinder circumference) for a brushed grain
  const W = 512, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, W, H);
  let s0 = 7; const r = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2200; i++) { const v = 150 + r() * 105 | 0, y = r() * H; g.fillStyle = `rgba(${v},${v},${v},${0.08 + r() * 0.18})`; g.fillRect(r() * W, y, 40 + r() * 260, 0.6 + r() * 0.8); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 6); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeMaterials(lite) {
  const Phys = lite ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
  const shellW = new Phys({ color: 0xeeeff0, roughness: 0.3, metalness: 0.0, ...(lite ? {} : { clearcoat: 0.7, clearcoatRoughness: 0.12, specularIntensity: 0.6 }) });
  const shellS = new Phys({ color: 0xc4c8cc, roughness: 0.27, metalness: 0.88, ...(lite ? {} : { clearcoat: 0.35, clearcoatRoughness: 0.2 }) });
  // brushed metal in code: fine streak texture drives roughness/colour grain; anisotropic highlights on desktop
  const brush = brushedTex();
  const metal = new Phys({ color: 0xd6d9dc, metalness: 1, roughness: 0.42, map: brush, roughnessMap: brush, ...(lite ? {} : { anisotropy: 0.75, anisotropyRotation: Math.PI / 2 }) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.35, roughness: 0.48 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1e1f21, metalness: 0, roughness: 0.82 });   // plain dark rubber
  const visor = new Phys({ color: 0x030405, roughness: 0.06, metalness: 0.3, ...(lite ? {} : { clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1 }) });
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x6fdcff, emissiveIntensity: 1.6, roughness: 0.4 });
  return { shellW, shellS, metal, dark, rubber, visor, glow };
}

// ---------------- one robot ----------------
const JOINTS = ['spineX', 'spineY', 'chestX', 'chestZ', 'neckX', 'neckY', 'headX', 'headZ',
  'shLx', 'shLy', 'shLz', 'elL', 'wrLx', 'wrLz', 'curlL', 'shRx', 'shRy', 'shRz', 'elR', 'wrRx', 'wrRz', 'curlR'];
const REST = { spineX: 0, spineY: 0, chestX: 0, chestZ: 0, neckX: 0, neckY: 0, headX: 0, headZ: 0, shLx: 0.04, shLy: 0, shLz: 0.07, elL: -0.22, wrLx: 0, wrLz: 0, curlL: 0.45, shRx: 0.04, shRy: 0, shRz: -0.07, elR: -0.22, wrRx: 0, wrRz: 0, curlR: 0.45 };

class Robot {
  constructor(sys, opts) {
    const T = template(), M = sys.M;
    this.sys = sys; this.opts = opts;
    this.group = new THREE.Group(); this.group.name = 'robot';
    const { map, list } = makeBones(); this.b = map;
    this.group.add(map.root);
    const sk = new THREE.Skeleton(list, T.inverses);
    for (const m of MATS) {
      if (!T.geos[m]) continue;
      const mat = m === 'shell' ? (opts.silver ? M.shellS : M.shellW) : M[m];
      const mesh = new THREE.SkinnedMesh(T.geos[m], mat);
      mesh.bind(sk, new THREE.Matrix4());
      mesh.frustumCulled = false; mesh.castShadow = !sys.lite && m !== 'glow'; mesh.receiveShadow = m === 'shell' || m === 'metal';
      this.group.add(mesh);
    }
    this.ground = opts.ground || 0;
    this.pos = V3(opts.pos[0], this.ground, opts.pos[1]); this.yaw = opts.yaw ?? 0; this.v = 0; this.yawRate = 0;
    this.pose = { ...REST }; this.t = Math.random() * 10; this.phase = Math.random() * 10;
    this.feet = ['L', 'R'].map(S => { const s = S === 'L' ? 1 : -1; return { S, s, pos: this.footIdeal(s, this.pos, this.yaw), yaw: this.yaw, sw: null }; });
    this.lastStep = 1; this.sway = 0; this.bob = 0; this.restT = 0;
    this.job = opts.job; this.wp = 0; this.wait = 1 + Math.random() * 2;
    this.glanceT = 2; this.glance = { yaw: 0, pitch: 0 };
    this.greet = null; this.look = null; this.workT = Math.random() * 6;
    this.group.position.copy(this.pos);
  }
  footIdeal(s, p, yaw) { return V3(p.x + Math.cos(yaw) * 0.105 * s, this.ground, p.z - Math.sin(yaw) * 0.105 * s); }
  fwd(yaw = this.yaw) { return V3(Math.sin(yaw), 0, Math.cos(yaw)); }

  // ---- locomotion: steer toward a goal, turn in place when the heading is far off ----
  steer(dt, goal, speed) {
    let wantV = 0, wantYaw = this.yaw;
    if (goal) {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z, d = Math.hypot(dx, dz);
      if (goal.face != null && d < 0.06) wantYaw = goal.face;
      else if (d > 0.04) { wantYaw = Math.atan2(dx, dz); const err = Math.abs(wrapA(wantYaw - this.yaw)); wantV = err < 0.5 ? speed * clamp(d / 0.6, 0.25, 1) * (1 - err) : 0; }
      else if (goal.face != null) wantYaw = goal.face;
    }
    // speed ramps gently, and the body never outruns a planted foot (keeps every stance leg within reach)
    this.v = wantV > this.v ? Math.min(wantV, this.v + 0.9 * dt) : Math.max(wantV, this.v - 1.8 * dt);
    const fw0 = this.fwd(); let lag = 0;
    for (const f of this.feet) if (!f.sw) lag = Math.min(lag, (f.pos.x - this.pos.x) * fw0.x + (f.pos.z - this.pos.z) * fw0.z);
    if (lag < -0.24) this.v = Math.max(0, this.v - 4 * dt);
    const err = wrapA(wantYaw - this.yaw), maxR = 1.6;
    const rate = clamp(err * 3, -maxR, maxR);
    this.yawRate = damp(this.yawRate, rate, 6, dt);
    this.yaw += this.yawRate * dt;
    const f = this.fwd(); this.pos.addScaledVector(f, this.v * dt);
    return Math.hypot((goal?.x ?? this.pos.x) - this.pos.x, (goal?.z ?? this.pos.z) - this.pos.z);
  }

  // ---- planted-foot gait: a foot only moves while it is swinging, so stance feet never slide ----
  gait(dt) {
    const swinging = this.feet.find(f => f.sw);
    if (swinging) {
      const sw = swinging.sw; sw.t = Math.min(1, sw.t + dt / sw.dur);
      const k = smooth(sw.t); swinging.pos.lerpVectors(sw.from, sw.to, k); swinging.yaw = sw.fy + wrapA(sw.ty - sw.fy) * k;
      swinging.lift = Math.sin(Math.PI * sw.t) * sw.h; swinging.pitch = Math.sin(Math.PI * sw.t) * 0.35 * (sw.t < 0.5 ? 1 : -0.6) * sw.h / 0.08;
      if (sw.t >= 1) { swinging.sw = null; swinging.lift = 0; swinging.pitch = 0; this.restT = 0; }
      return;
    }
    this.restT += dt;
    const moving = this.v > 0.06 || Math.abs(this.yawRate) > 0.25;
    const dur = clamp(0.5 - this.v * 0.08, 0.36, 0.5);
    const pY = this.yaw + this.yawRate * dur * 0.9;
    const pPos = this.pos.clone().addScaledVector(this.fwd(), this.v * dur * 1.5);
    let best = null, bestE = 0;
    for (const f of this.feet) {
      const ideal = this.footIdeal(f.s, pPos, pY);
      const e = f.pos.distanceTo(this.footIdeal(f.s, this.pos, this.yaw)) + Math.abs(wrapA(f.yaw - this.yaw)) * 0.25;
      const score = (moving ? (f.S === this.lastFoot ? -1 : 1) : 0) + e;
      if (!best || score > bestE) { best = f; bestE = score; best._ideal = ideal; best._e = e; }
    }
    const need = moving ? this.restT > 0.02 : (best._e > 0.035 && this.restT > 0.12);
    if (!need) return;
    const dist = best.pos.distanceTo(best._ideal);
    if (dist < 0.01 && !moving) return;
    best.sw = { from: best.pos.clone(), to: best._ideal, fy: best.yaw, ty: pY, t: 0, dur: moving ? dur : 0.34, h: clamp(0.03 + dist * 0.14, 0.03, 0.085) };
    this.lastFoot = best.S;
  }

  // ---- two-bone leg IK in the pelvis frame ----
  legIK(f) {
    const b = this.b, S = f.S, hip = b['hip' + S], kn = b['kn' + S], an = b['an' + S], toe = b['toe' + S];
    const tgt = _v.set(f.pos.x, f.pos.y + ANKLE_H + (f.lift || 0), f.pos.z);
    b.pelvis.worldToLocal(tgt); tgt.sub(hip.position);
    const roll = Math.atan2(tgt.x, -tgt.y);
    const y2 = -Math.hypot(tgt.x, tgt.y), z = tgt.z;
    const r = clamp(Math.hypot(y2, z), 0.2, (L_THIGH + L_SHIN) * 0.9995);
    const beta = Math.atan2(z, -y2);
    const knee = Math.PI - Math.acos(clamp((L_THIGH ** 2 + L_SHIN ** 2 - r * r) / (2 * L_THIGH * L_SHIN), -1, 1));
    const a1 = Math.acos(clamp((L_THIGH ** 2 + r * r - L_SHIN ** 2) / (2 * L_THIGH * r), -1, 1));
    const phi = beta + a1;
    hip.rotation.set(-phi, clamp(wrapA(f.yaw - this.yaw), -0.7, 0.7), roll);
    kn.rotation.set(knee, 0, 0);
    const pelvisPitch = b.pelvis.rotation.x;
    an.rotation.set(phi - knee - pelvisPitch - (f.pitch || 0) * 0.6, 0, -roll);
    toe.rotation.set(Math.max(0, f.pitch || 0) * 0.9, 0, 0);
  }

  // ---- head/torso look at a world point ----
  lookAngles(p) {
    const ch = this.b.chest; ch.updateWorldMatrix(true, false);
    const l = ch.worldToLocal(_w.copy(p)); l.y -= 0.42;
    return { yaw: Math.atan2(l.x, l.z), pitch: -Math.atan2(l.y, Math.hypot(l.x, l.z)) };
  }

  update(dt, ctx) {
    this.t += dt;
    const P = { ...REST }, t = this.t, job = this.job;
    let goal = null, speed = 0.85, look = null, gesture = null;

    if (this.greet) {
      const g = this.greet; g.t += dt;
      const toCam = Math.atan2(ctx.cam.x - this.pos.x, ctx.cam.z - this.pos.z);
      const off = wrapA(toCam - this.yaw);
      if (!g.face || Math.abs(wrapA(toCam - g.face)) > 0.6) g.face = Math.abs(off) > 0.45 ? toCam : g.face ?? this.yaw;
      goal = { x: this.pos.x, z: this.pos.z, face: g.face };
      look = ctx.cam; if (g.t > 0.35) gesture = 'wave';
      if (!g.whir2 && g.t > 0.4) { g.whir2 = true; this.sys.whir(0.5, 1.3); }
      if (g.t > 3.4) this.greet = null;
    } else if (job.type === 'patrol' || job.type === 'leave') {
      const pts = job.path, w = pts[this.wp % pts.length];
      if (this.wait > 0 && job.type === 'patrol') { this.wait -= dt; goal = { x: this.pos.x, z: this.pos.z, face: w.face ?? null }; if (w.look) look = w.look; }
      else {
        goal = w; speed = job.speed || 0.85;
        const d = Math.hypot(w.x - this.pos.x, w.z - this.pos.z);
        if (d < 0.2) { if (job.type === 'leave') { if (this.wp < pts.length - 1) this.wp++; else goal = { x: w.x, z: w.z }; } else { this.wp = (this.wp + 1) % pts.length; this.wait = w.pause ?? (1.5 + Math.random() * 2.5); } }
      }
    } else if (job.type === 'inspect' || job.type === 'console') {
      goal = { x: job.at[0], z: job.at[1], face: job.face };
      if (Math.hypot(job.at[0] - this.pos.x, job.at[1] - this.pos.z) < 0.15 && Math.abs(wrapA(job.face - this.yaw)) < 0.2) gesture = job.type;
      if (job.type === 'inspect') look = job.target;
    }

    this.steer(dt, goal, speed);
    this.gait(dt);

    // idle breathing + sway, occasional glances
    const br = Math.sin(t * 1.25 + this.phase);
    P.chestX = br * 0.012; P.spineX = 0.01; P.shLz += br * 0.01; P.shRz -= br * 0.01;
    P.chestZ = Math.sin(t * 0.37 + this.phase) * 0.012;
    this.glanceT -= dt;
    if (this.glanceT < 0) { this.glanceT = 2.5 + Math.random() * 4; this.glance = Math.random() < 0.4 ? { yaw: 0, pitch: 0 } : { yaw: (Math.random() - 0.5) * 1.2, pitch: (Math.random() - 0.5) * 0.3 }; }

    // walking arm swing, opposite to the legs, from where the feet are relative to the body
    if (this.v > 0.05 || this.feet.some(f => f.sw)) {
      const fw = this.fwd(), off = f => (f.pos.x - this.pos.x) * fw.x + (f.pos.z - this.pos.z) * fw.z;
      const fl = off(this.feet[0]), fr = off(this.feet[1]), k = clamp(this.v / 0.85, 0, 1);
      P.shLx = 0.04 - fr * 1.5 * k; P.shRx = 0.04 - fl * 1.5 * k;
      P.elL = -0.25 - Math.max(0, -P.shLx) * 0.6; P.elR = -0.25 - Math.max(0, -P.shRx) * 0.6;
      P.spineY = (fl - fr) * 0.25 * k; P.chestX = 0.035 * k;
    }

    if (gesture === 'wave') {
      const w = Math.sin(this.greet.t * 7.5);
      P.shRx = -0.12; P.shRy = -Math.PI / 2; P.shRz = -1.35; P.elR = -1.55 + w * 0.32; P.wrRx = 0; P.wrRz = w * 0.15; P.curlR = 0.12;
      P.shLz = 0.1; P.chestZ = -0.04;
    } else if (gesture === 'inspect') {
      // reach toward the rocket for a few seconds, then step back into a thinking pose
      this.workT += dt; const c = (this.workT % 9) / 9, reach = smooth(clamp((c < 0.5 ? c / 0.15 : (0.75 - c) / 0.15), 0, 1));
      P.spineX = 0.06 * reach; P.chestX = 0.08 * reach;
      P.shRx = -0.15 - 1.15 * reach; P.shRz = -0.12; P.elR = -0.3 - 0.25 * (1 - reach) - Math.sin(this.workT * 2.1) * 0.05 * reach; P.wrRx = -0.25 * reach; P.curlR = 0.45 - 0.3 * reach;
      P.shLx = -0.35 * (1 - reach) + 0.04 * reach; P.elL = -0.22 - 1.2 * (1 - reach); P.shLz = 0.12; P.curlL = 0.7;
    } else if (gesture === 'console') {
      this.workT += dt;
      const tap = s => Math.max(0, Math.sin(this.workT * 5.3 + s)) * 0.08;
      P.spineX = 0.05; P.chestX = 0.06; P.neckX = 0.28;
      P.shLx = -0.62; P.shLz = 0.16; P.elL = -0.95 + tap(0); P.wrLx = 0.2; P.wrLz = 0.1; P.curlL = 0.25;
      P.shRx = -0.6; P.shRz = -0.16; P.elR = -0.98 + tap(2.1); P.wrRx = 0.2; P.wrRz = -0.1; P.curlR = 0.25;
      if (!look && Math.sin(this.workT * 0.4) > 0.85) this.glance = { yaw: 0.5, pitch: -0.15 };
    }

    // head + torso aim
    let ly = this.glance.yaw, lp = this.glance.pitch + (gesture === 'console' ? 0.25 : 0);
    if (look) { const a = this.lookAngles(look); ly = clamp(a.yaw, -1.4, 1.4); lp = clamp(a.pitch, -0.6, 0.7); }
    P.spineY += ly * 0.15; P.neckY = ly * 0.45; P.headX = lp * 0.65; P.neckX += lp * 0.35;
    P.headZ = Math.sin(t * 0.5 + this.phase) * 0.02;

    // smooth every joint toward its target
    const k = this.greet ? 7 : 4.5;
    for (const j of JOINTS) this.pose[j] = damp(this.pose[j], P[j], j === 'neckY' || j === 'headX' ? 5 : k, dt);
    const q = this.pose, b = this.b;

    // pelvis: height bob and lateral sway toward the stance foot
    const sw = this.feet.find(f => f.sw);
    const bobT = sw ? Math.sin(Math.PI * sw.sw.t) : 0;
    this.bob = damp(this.bob, (sw ? 0.008 * bobT : 0) - clamp(this.v / 0.85, 0, 1) * 0.03, 10, dt);
    this.sway = damp(this.sway, sw ? -sw.s * 0.018 * bobT : 0, 8, dt);
    const crouch = gesture === 'inspect' ? 0.01 : 0;
    // drop the hips when a foot is far out so every leg stays within reach (long strides, stopping mid-step)
    let py = HIP_Y - 0.022 + this.bob - crouch + br * 0.002;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), reach = (L_THIGH + L_SHIN) * 0.995;
    for (const f of this.feet) {
      const hx = this.pos.x + cy * (HIP_OFF[0] * f.s + this.sway), hz = this.pos.z - sy * (HIP_OFF[0] * f.s + this.sway);
      const h = Math.min(reach - 0.01, Math.hypot(f.pos.x - hx, f.pos.z - hz));
      py = Math.min(py, Math.sqrt(reach * reach - h * h) - HIP_OFF[1] + ANKLE_H + (f.lift || 0) + f.pos.y - this.ground);
    }
    b.pelvis.position.set(this.sway, py, 0);
    b.pelvis.rotation.set(0.02, sw ? sw.s * 0.05 * bobT : 0, -this.sway * 0.8);

    b.spine.rotation.set(q.spineX, q.spineY, 0);
    b.chest.rotation.set(q.chestX, q.spineY * 0.6, q.chestZ);
    b.neck.rotation.set(q.neckX, q.neckY, 0);
    b.head.rotation.set(q.headX, q.neckY * 0.5, q.headZ);
    for (const S of ['L', 'R']) {
      b['sh' + S].rotation.set(q['sh' + S + 'x'], q['sh' + S + 'y'], q['sh' + S + 'z']);
      b['el' + S].rotation.set(q['el' + S], 0, 0);
      b['wr' + S].rotation.set(q['wr' + S + 'x'], 0, q['wr' + S + 'z']);
      const s = S === 'L' ? 1 : -1, c = q['curl' + S];
      for (let i = 0; i < 4; i++) { b[`f${i}a` + S].rotation.set(0, 0, -s * c * (0.8 + i * 0.1)); b[`f${i}b` + S].rotation.set(0, 0, -s * c * 1.1); }
      b['thA' + S].rotation.set(-0.35 - c * 0.4, 0, s * 0.3); b['thB' + S].rotation.set(-c * 0.5, 0, 0);
    }

    this.group.position.set(this.pos.x, this.ground, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.group.updateMatrixWorld(true);
    for (const f of this.feet) this.legIK(f);
    aimActuators(b, 'L'); aimActuators(b, 'R');
  }
}

// ---------------- robot crew ----------------
export class Robots {
  constructor(game) {
    this.g = game; const w = game.world;
    this.lite = w.quality === 'phone' || w.quality === 'low';
    this.M = makeMaterials(this.lite);
    this.hangar = new THREE.Group(); this.hangar.name = 'robots'; w.hangar.add(this.hangar);
    this.padG = new THREE.Group(); this.padG.name = 'padRobots'; w.scene.add(this.padG);
    this.list = []; this.ray = new THREE.Raycaster(); this.padState = 'idle';
    const R = (grp, o) => { const r = new Robot(this, o); r.where = grp === this.hangar ? 'hangar' : 'pad'; grp.add(r.group); this.list.push(r); return r; };
    const rocketPt = V3(0, 3.2, 0);
    // hangar crew (hangar group sits at the world origin; the stand pit is at 0,0 and the door faces -z)
    R(this.hangar, { pos: [-3.75, -2.8], yaw: Math.atan2(3.75, 2.8), job: { type: 'inspect', at: [-3.75, -2.8], face: Math.atan2(3.75, 2.8), target: rocketPt } });
    R(this.hangar, { pos: [8.3, 6], yaw: Math.PI, silver: true, job: { type: 'patrol', path: [{ x: 8.3, z: 6, look: rocketPt }, { x: 8.3, z: -11.5 }, { x: 4, z: -11.8, look: rocketPt }, { x: 8.3, z: -6 }] } });
    if (!this.lite) {
      R(this.hangar, { pos: [-8.3, -10], yaw: 0, job: { type: 'patrol', path: [{ x: -8.3, z: -10 }, { x: -8.3, z: 9, look: rocketPt }, { x: -4, z: 9.6 }, { x: -8.3, z: 3 }] } });
      R(this.hangar, { pos: [10.0, 5.0], yaw: Math.PI / 2, silver: true, job: { type: 'console', at: [10.0, 5.05], face: Math.PI / 2 } });
    }
    // pad crew, laid out in the launch complex frame (local +x along the flame trench, tower toward local -z)
    const pad = w.pad, P = SPOTS.pad;
    const toW = (x, z) => { if (pad?.frame) { pad.frame.updateMatrixWorld(true); const v = pad.frame.localToWorld(V3(x, 0, z)); return [v.x, v.z]; } return [P.x + x, P.z + z]; };
    const tower = pad?.tower ? pad.tower.getWorldPosition(V3()) : V3(P.x, 0, P.z - 10);
    const padSpecs = [
      { pos: toW(-9, 6), job: (a = toW(-9, 6), b2 = toW(9, 6), c = toW(9, 9.5)) => ({ type: 'patrol', path: [{ x: a[0], z: a[1], look: V3(P.x, 4, P.z) }, { x: b2[0], z: b2[1] }, { x: c[0], z: c[1], look: V3(P.x, 8, P.z) }] }) },
      { pos: toW(4.2, -6.4), silver: true, job: (a = toW(4.2, -6.4)) => ({ type: 'console', at: a, face: Math.atan2(tower.x - a[0], tower.z - a[1]) }) },
    ].slice(0, this.lite ? 1 : 2);
    for (const s of padSpecs) { const r = R(this.padG, { pos: s.pos, ground: 0.02, silver: s.silver, job: s.job() }); r.home = { pos: s.pos.slice(), job: s.job }; }
    // walk-clear points: off the deck on the stand side
    this.exitPts = [toW(-14, 18), toW(-4, 21)];
    this.padG.visible = false;
    // click / tap a robot: it stops, turns, looks at you and waves
    const c = w.renderer.domElement; let down = null;
    c.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    c.addEventListener('pointerup', e => { if (!down) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y); if (d < 8 && performance.now() - down.t < 600) this.click(e.clientX, e.clientY); down = null; });
  }

  click(x, y) {
    const w = this.g.world, cam = w.camera, locked = document.pointerLockElement === w.renderer.domElement;
    const ndc = locked ? new THREE.Vector2(0, 0) : new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, cam);
    let best = null, bd = 1e9; const a = V3(), b = V3(), onRay = V3();
    for (const r of this.list) {
      if (!r.group.visible || !r.group.parent.visible) continue;
      a.set(r.pos.x, r.ground + 0.15, r.pos.z); b.set(r.pos.x, r.ground + 1.62, r.pos.z);
      const d2 = this.ray.ray.distanceSqToSegment(a, b, onRay);
      const along = onRay.distanceTo(cam.position);
      if (d2 < 0.3 * 0.3 && along < bd && along < 60) { best = r; bd = along; }
    }
    if (!best) return false;
    if (!best.greet) { best.greet = { t: 0 }; this.whir(0.7, 1); }
    return true;
  }

  // soft servo whir through the game's SFX bus
  whir(dur = 0.6, pitch = 1) {
    const A = this.g.audio; if (!A?.ctx || !A.sfx) return;
    const c = A.ctx, t = c.currentTime;
    const o = c.createOscillator(), o2 = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'sine';
    o.frequency.setValueAtTime(150 * pitch, t); o.frequency.linearRampToValueAtTime(330 * pitch, t + dur * 0.35); o.frequency.linearRampToValueAtTime(240 * pitch, t + dur);
    o2.frequency.setValueAtTime(600 * pitch, t); o2.frequency.linearRampToValueAtTime(1100 * pitch, t + dur * 0.4); o2.frequency.linearRampToValueAtTime(900 * pitch, t + dur);
    bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(900 * pitch, t); bp.frequency.linearRampToValueAtTime(1600 * pitch, t + dur * 0.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + 0.06); g.gain.setValueAtTime(0.04, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(g); g.connect(A.sfx);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  update(dt) {
    const g = this.g, w = g.world, cam = w.camera.position;
    const nearHangar = w.indoor || Math.hypot(cam.x, cam.y, cam.z) < 90;
    this.hangar.visible = nearHangar;
    // pad crew: only around a rocket waiting on the pad; walk clear at countdown, gone at liftoff
    const fl = g.flight, onPad = g.mode === 'flight' && fl?.f?.phase === 'pad' && !fl.f.e?.on;
    const counting = onPad && fl.countdown != null;
    const padNear = Math.hypot(cam.x - SPOTS.pad.x, cam.z - SPOTS.pad.z) < 600 && cam.y < 400;
    if (!onPad) { if (this.padState !== 'idle') this.resetPad(); this.padState = 'idle'; this.padG.visible = false; }
    else {
      if (this.padState === 'idle') this.padState = 'work';
      if (counting && this.padState === 'work') { this.padState = 'leave'; this.list.filter(r => r.where === 'pad').forEach((r, i) => { r.greet = null; r.wp = 0; r.job = { type: 'leave', speed: 1.45, path: [{ x: this.exitPts[i % 2][0], z: this.exitPts[i % 2][1] }] }; }); }
      this.padG.visible = padNear;
    }
    const ctx = { cam };
    for (const r of this.list) {
      const vis = r.where === 'hangar' ? this.hangar.visible : this.padG.visible;
      if (!vis) continue;
      r.update(dt, ctx);
    }
  }
  resetPad() {
    for (const r of this.list) if (r.where === 'pad' && r.home) {
      r.pos.set(r.home.pos[0], r.ground, r.home.pos[1]); r.job = r.home.job(); r.wp = 0; r.greet = null; r.v = 0; r.yawRate = 0;
      for (const f of r.feet) { f.pos = r.footIdeal(f.s, r.pos, r.yaw); f.sw = null; f.yaw = r.yaw; }
    }
  }
}
