// Hangar helper robots: a pair of original, realistic humanoid service robots (about 1.75 m) built procedurally,
// one satin silver and one dark gunmetal. Clear-coated shell panels with thin seams, brushed-metal joints (procedural anisotropic), a graphite
// under-suit, plain dark rubber soles and fingertips, a black glass faceplate with a soft emissive eye display and
// visible linear actuators at the elbows and knees. One shared rigidly-skinned geometry set (6 draw calls each).
// Walk: a phase-locked gait (the cycle advances with distance walked, so planted feet never slide) with a full
// stride, heel strike and toe-off, arm swing, hip turn and a soft torso bob; upper body is code-animated and smoothed.
// Jobs: rounds (inspect the rocket, work the console, walk the floor), inspect, console, check the stand, follow you.
// Click one: he turns, looks at you and waves, and a small job bar shows. Click him twice quickly: he follows you.
// Hooks: game.robots.list / .byId, robot.state, .jobKey, .enabled, .setJob({ type: 'custom', tick }), robots.send(r, key).
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { C, R_ROBOT, R_PLAYER, detour, resolve, hangarFrame, playerFrame } from './collide.js';

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
  // face display: two soft eye bars just under the glass, tilted to follow its curve
  for (const s of [1, -1]) { const g = new THREE.SphereGeometry(1, 20, 10); g.scale(0.0165, 0.0062, 0.0032); g.rotateY(s * 0.41); g.translate(s * 0.034, 0.1, 0.0975); add('head', 'glow', g); }
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
  // two shell finishes so the pair reads apart at a glance: satin silver, and dark gunmetal under a clear coat.
  // Both get a soft, readable highlight from the hangar probe, never a mirror.
  const silver = new Phys({ color: 0xc8ccd0, roughness: 0.28, metalness: 0.85, envMapIntensity: 1.0, ...(lite ? {} : { clearcoat: 0.35, clearcoatRoughness: 0.18 }) });
  const gunmetal = new Phys({ color: 0x3a3e44, roughness: 0.36, metalness: 0.6, envMapIntensity: 1.0, ...(lite ? {} : { clearcoat: 0.6, clearcoatRoughness: 0.14, specularIntensity: 0.7 }) });
  // brushed metal in code: fine streak texture drives roughness/colour grain; anisotropic highlights on desktop
  const brush = brushedTex();
  const metal = new Phys({ color: 0xd6d9dc, metalness: 1, roughness: 0.4, map: brush, roughnessMap: brush, envMapIntensity: 1.0, ...(lite ? {} : { anisotropy: 0.6, anisotropyRotation: Math.PI / 2 }) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.35, roughness: 0.48 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1e1f21, metalness: 0, roughness: 0.82 });   // plain dark rubber
  // black glass faceplate: a dielectric (no metal tint) so it only reflects the real hangar at a glancing angle,
  // with a sharp clear-coat glint on top; the face itself is the soft emissive eye display (glow material)
  const visor = new Phys({ color: 0x050607, roughness: 0.1, metalness: 0.0, envMapIntensity: 0.9, ...(lite ? {} : { clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 0.8 }) });
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x6fdcff, emissiveIntensity: 1.6, roughness: 0.4 });
  return { silver, gunmetal, metal, dark, rubber, visor, glow };
}

// ---------------- the robot ----------------
const JOINTS = ['spineX', 'spineY', 'chestX', 'chestZ', 'neckX', 'neckY', 'headX', 'headZ',
  'shLx', 'shLy', 'shLz', 'elL', 'wrLx', 'wrLz', 'curlL', 'shRx', 'shRy', 'shRz', 'elR', 'wrRx', 'wrRz', 'curlR'];
const REST = { spineX: 0, spineY: 0, chestX: 0, chestZ: 0, neckX: 0, neckY: 0, headX: 0, headZ: 0, shLx: 0.04, shLy: 0, shLz: 0.07, elL: -0.22, wrLx: 0, wrLz: 0, curlL: 0.45, shRx: 0.04, shRy: 0, shRz: -0.07, elR: -0.22, wrRx: 0, wrRz: 0, curlR: 0.45 };
// gait: one cycle = two steps. Each foot swings for SWING of the cycle and is planted (world-locked) the rest.
const SWING = 0.4, WALK = 1.1, RATE_MIN = 0.9;
// stride (two steps) grows with speed like a person's: ~1.1 m at 1.1 m/s, ~1.3 m at a brisk 1.45 m/s
const strideFor = v => clamp(0.5 + 0.56 * v, 0.7, 1.32);

class Robot {
  constructor(sys, opts) {
    const T = template(), M = sys.M;
    this.sys = sys; this.id = opts.id; this.finish = opts.finish; this.where = 'hangar';
    this.enabled = true;   // false = frozen in place (no steering, no animation); for hooks such as a breakdown
    this.group = new THREE.Group(); this.group.name = 'robot';
    const { map, list } = makeBones(); this.b = map;
    this.group.add(map.root);
    const sk = new THREE.Skeleton(list, T.inverses);
    for (const m of MATS) {
      if (!T.geos[m]) continue;
      const mesh = new THREE.SkinnedMesh(T.geos[m], m === 'shell' ? M[opts.finish] : M[m]);
      mesh.bind(sk, new THREE.Matrix4());
      mesh.frustumCulled = false; mesh.castShadow = !sys.lite && m !== 'glow'; mesh.receiveShadow = m === 'shell' || m === 'metal';
      this.group.add(mesh);
    }
    this.ground = 0;
    this.pos = V3(opts.pos[0], 0, opts.pos[1]); this.yaw = opts.yaw ?? 0; this.v = 0; this.yawRate = 0;
    this.pose = { ...REST }; this.t = Math.random() * 10; this.phase = Math.random() * 10;
    this.ph = 0.42;   // gait phase, parked where both feet are planted
    this.feet = ['L', 'R'].map((S, i) => { const s = S === 'L' ? 1 : -1; return { S, s, off: i * 0.5, pos: this.footIdeal(s, this.pos, this.yaw), yaw: this.yaw, swinging: false, from: null, fy: 0, lift: 0, pitch: 0 }; });
    this.walkK = 0; this.py = HIP_Y;
    this.setJob(opts.job);
    this.glanceT = 2; this.glance = { yaw: 0, pitch: 0 };
    this.greet = null; this.workT = Math.random() * 6;
    this.group.position.copy(this.pos);
  }
  // job: { type: 'patrol' | 'inspect' | 'console' | 'follow' | 'custom', ... }. A 'custom' job's
  // tick(robot, dt, ctx) returns { goal, speed, look, gesture } each frame, so other systems can drive him.
  setJob(job, key = job.type) { this.job = job; this.jobKey = key; this.wp = 0; this.wait = job.type === 'patrol' ? 1 : 0; this.workT = 0; }
  // what he is doing right now, for UI and hooks: 'greeting' | 'walking' | 'working' | 'following' | 'idle'
  get state() { return this.greet ? 'greeting' : this.jobKey === 'follow' ? 'following' : this.gesture ? 'working' : this.v > 0.05 ? 'walking' : 'idle'; }
  footIdeal(s, p, yaw) { return V3(p.x + Math.cos(yaw) * 0.105 * s, this.ground, p.z - Math.sin(yaw) * 0.105 * s); }
  fwd(yaw = this.yaw) { return V3(Math.sin(yaw), 0, Math.cos(yaw)); }
  at(x, z, face, tol = 0.15) { return Math.hypot(x - this.pos.x, z - this.pos.z) < tol && (face == null || Math.abs(wrapA(face - this.yaw)) < 0.2); }

  // ---- locomotion: steer toward a goal; gentle curves while walking, turn in place when the heading is far off ----
  steer(dt, goal, speed, obs) {
    let wantV = 0, wantYaw = this.yaw, aim = goal;
    if (goal && obs?.length) {
      const wp = detour(this.pos.x, this.pos.z, goal.x, goal.z, R_ROBOT, obs);
      if (wp) aim = wp;
    }
    if (aim) {
      const dx = aim.x - this.pos.x, dz = aim.z - this.pos.z, d = Math.hypot(dx, dz);
      const stopAt = goal.stop ?? 0.04;
      if (d > stopAt) {
        wantYaw = Math.atan2(dx, dz); const err = Math.abs(wrapA(wantYaw - this.yaw));
        const brake = aim === goal ? clamp((d - stopAt) / 0.9, 0.2, 1) : 1;   // ease into the stop over the last metre
        wantV = speed * brake * clamp(1 - err / 1.1, 0, 1);
      } else if (goal.face != null && aim === goal) wantYaw = goal.face;
    }
    this.v = wantV > this.v ? Math.min(wantV, this.v + 1.1 * dt) : Math.max(wantV, this.v - 2.0 * dt);
    const err = wrapA(wantYaw - this.yaw), maxR = this.v > 0.3 ? 1.3 : 1.8;
    this.yawRate = damp(this.yawRate, clamp(err * 3, -maxR, maxR), 6, dt);
    this.yaw += this.yawRate * dt;
    this.pos.addScaledVector(this.fwd(), this.v * dt);
    if (obs?.length) { const p = resolve(this.pos.x, this.pos.z, R_ROBOT, obs); this.pos.x = p.x; this.pos.z = p.z; }
  }

  // ---- phase-locked gait: the cycle advances with distance walked, so planted feet never slide ----
  gait(dt) {
    const v = this.v, kv = clamp(v / 0.3, 0, 1);
    const stride = strideFor(v);
    let need = false;   // a foot is far from where it should rest (stopping, turning in place)
    for (const f of this.feet) if (!f.swinging && (f.pos.distanceTo(this.footIdeal(f.s, this.pos, this.yaw)) > 0.06 || Math.abs(wrapA(f.yaw - this.yaw)) > 0.22)) need = true;
    const midSwing = this.feet.some(f => f.swinging);
    const moving = v > 0.05 || Math.abs(this.yawRate) > 0.35 || need || midSwing;
    const rate = moving ? Math.max(v / stride, RATE_MIN) : 0;   // cycles per second
    this.ph = (this.ph + rate * dt) % 1;
    this.rate = rate; this.walkK = damp(this.walkK, kv, 5, dt);
    const stepLen = rate > 0 ? v / rate : 0;   // the stride we actually cover at this cadence
    for (const f of this.feet) {
      const u = (this.ph + f.off) % 1;
      if (u < SWING && moving) {
        if (!f.swinging) { f.swinging = true; f.from = f.pos.clone(); f.fy = f.yaw; }
        const s = u / SWING, tLeft = (SWING - u) / Math.max(rate, 1e-3);
        // land under where the body will be, ahead of the hip by half the stance travel
        const pyaw = this.yaw + this.yawRate * tLeft;
        const pp = this.pos.clone().addScaledVector(this.fwd(), v * tLeft);
        const land = this.footIdeal(f.s, pp, pyaw).addScaledVector(this.fwd(pyaw), stepLen * (1 - SWING) * 0.5 * kv);
        const e = smooth(clamp(s * 1.08, 0, 1));
        f.pos.lerpVectors(f.from, land, e);
        f.yaw = f.fy + wrapA(pyaw - f.fy) * e;
        const h = clamp(0.035 + stepLen * 0.05, 0.035, 0.1) * (0.45 + 0.55 * kv);
        f.lift = h * Math.sin(Math.PI * Math.pow(s, 0.85));
        // toes stay pointed down right after push-off, heel leads into the landing
        f.pitch = (0.35 * (1 - smooth(clamp(s / 0.35, 0, 1))) - 0.22 * smooth(clamp((s - 0.55) / 0.4, 0, 1)) * (1 - smooth(clamp((s - 0.93) / 0.07, 0, 1)))) * kv;
      } else {
        f.swinging = false;
        f.lift = 0;
        // stance: heel rolls flat after strike, then the heel peels up before toe-off
        const p = moving ? (u - SWING) / (1 - SWING) : 0.5;
        const strike = -0.12 * (1 - smooth(clamp(p / 0.12, 0, 1)));
        const peel = 0.38 * smooth(clamp((p - 0.7) / 0.3, 0, 1));
        f.pitch = (strike + peel) * kv;
        f.lift = Math.sin(Math.max(0, peel * kv)) * 0.13;   // ankle rises as the foot pivots on its toes
      }
    }
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
    hip.rotation.set(-phi, clamp(wrapA(f.yaw - this.yaw) - b.pelvis.rotation.y, -0.7, 0.7), roll);
    kn.rotation.set(knee, 0, 0);
    // foot pitch: + = heel up / toes down; the toe joint bends back so the toes stay flat while the heel peels
    an.rotation.set(phi - knee - b.pelvis.rotation.x + (f.pitch || 0), 0, -roll);
    toe.rotation.set(-Math.max(0, f.pitch || 0), 0, 0);
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
    let goal = null, speed = WALK, look = null, gesture = null, waveT = 0;

    if (this.greet) {
      const g = this.greet; g.t += dt;
      const toCam = Math.atan2(ctx.cam.x - this.pos.x, ctx.cam.z - this.pos.z);
      const off = wrapA(toCam - this.yaw);
      if (!g.face || Math.abs(wrapA(toCam - g.face)) > 0.6) g.face = Math.abs(off) > 0.45 ? toCam : g.face ?? this.yaw;
      goal = { x: this.pos.x, z: this.pos.z, face: g.face };
      look = ctx.cam; waveT = g.t; if (g.t > 0.35 && g.t < 3.1) gesture = 'wave';
      if (!g.whir2 && g.t > 0.4) { g.whir2 = true; this.sys.whir(0.5, 1.3); }
      if (g.t > 3.4) this.greet = null;
    } else if (job.type === 'follow') {
      // walk to a spot just beside you, keep a polite distance, look at you while waiting
      const p = ctx.player;
      if (p) {
        const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
        const tx = p.x + dx / d * 1.6, tz = p.z + dz / d * 1.6;
        if (d > 2.4 || (this.v > 0.05 && d > 1.8)) { goal = { x: tx, z: tz, stop: 0.15 }; speed = clamp(0.8 + (d - 2) * 0.35, 0.9, 1.5); }
        else goal = { x: this.pos.x, z: this.pos.z, face: Math.atan2(p.x - this.pos.x, p.z - this.pos.z) };
        look = ctx.cam;
      }
    } else if (job.type === 'patrol') {
      const pts = job.path, w = pts[this.wp % pts.length];
      if (this.wait > 0) {
        goal = { x: w.x, z: w.z, face: w.face ?? null }; if (w.look) look = w.look;
        if (!w.act || this.at(w.x, w.z, w.face, 0.25)) this.wait -= dt;
        if (w.act && this.at(w.x, w.z, w.face, 0.25)) { gesture = w.act; if (w.act === 'inspect') look = w.target; }
        if (this.wait <= 0) this.wp = (this.wp + 1) % pts.length;
      } else {
        goal = w;
        if (Math.hypot(w.x - this.pos.x, w.z - this.pos.z) < 0.2) this.wait = w.dur ?? w.pause ?? (1.5 + Math.random() * 2.5);
      }
    } else if (job.type === 'custom') {
      const o = job.tick?.(this, dt, ctx) || {};
      goal = o.goal ?? null; speed = o.speed ?? WALK; look = o.look ?? null; gesture = o.gesture ?? null;
    } else if (job.type === 'inspect' || job.type === 'console') {
      goal = { x: job.at[0], z: job.at[1], face: job.face };
      if (this.at(job.at[0], job.at[1], job.face)) gesture = job.type;
      if (job.type === 'inspect') look = job.target;
    }

    this.gesture = gesture;
    this.steer(dt, goal, speed, ctx?.obs);
    this.gait(dt);
    const wk = this.walkK, ph = this.ph;

    // idle breathing + sway, occasional glances
    const br = Math.sin(t * 1.25 + this.phase);
    P.chestX = br * 0.012; P.spineX = 0.01; P.shLz += br * 0.01; P.shRz -= br * 0.01;
    P.chestZ = Math.sin(t * 0.37 + this.phase) * 0.012;
    this.glanceT -= dt;
    if (this.glanceT < 0) { this.glanceT = 2.5 + Math.random() * 4; this.glance = Math.random() < 0.4 ? { yaw: 0, pitch: 0 } : { yaw: (Math.random() - 0.5) * 1.2, pitch: (Math.random() - 0.5) * 0.3 }; }

    // walking: arms swing opposite the legs (left arm forward as the right heel strikes), elbows bend more going forward,
    // the chest counter-turns against the hips and leans a touch into the walk
    const hipYaw = -0.075 * wk * Math.cos(TAU * (ph - SWING));       // left hip forward at left heel strike
    if (wk > 0.01) {
      const A = 0.3 * wk * clamp(this.v / WALK, 0.5, 1.25);
      const sL = Math.cos(TAU * (ph - (0.5 + SWING)));                 // +1 when the right heel strikes
      P.shLx = 0.04 - A * sL; P.shRx = 0.04 + A * sL;
      P.elL = -0.24 - 0.32 * wk * Math.max(0, sL); P.elR = -0.24 - 0.32 * wk * Math.max(0, -sL);
      P.shLz = 0.09; P.shRz = -0.09; P.curlL = P.curlR = 0.5;
      P.spineY = -hipYaw * 1.4; P.spineX = 0.03 * wk; P.chestX += 0.025 * wk;
      P.neckX = -0.02 * wk;
    }

    if (gesture === 'wave') {
      const w = Math.sin(waveT * 7.5);
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
    let ly = this.glance.yaw * (1 - wk * 0.6), lp = this.glance.pitch + (gesture === 'console' ? 0.25 : 0);
    if (look) { const a = this.lookAngles(look); ly = clamp(a.yaw, -1.4, 1.4); lp = clamp(a.pitch, -0.6, 0.7); }
    P.spineY += ly * 0.15; P.neckY = ly * 0.45; P.headX = lp * 0.65; P.neckX += lp * 0.35;
    P.headZ = Math.sin(t * 0.5 + this.phase) * 0.02;

    // smooth every joint toward its target (arms follow the gait closely so the swing stays in time)
    const k = this.greet ? 7 : wk > 0.2 ? 10 : 4.5;
    for (const j of JOINTS) this.pose[j] = damp(this.pose[j], P[j], j === 'neckY' || j === 'headX' ? 5 : k, dt);
    const q = this.pose, b = this.b;

    // pelvis: highest over the planted foot at mid-stance, lowest in double support (a soft ~2 cm bob),
    // shifts over the stance foot, turns with the stride; then drops only as far as it must to keep both legs in reach
    const bob = 0.011 * wk * Math.cos(2 * TAU * (ph - (SWING + (1 - SWING) / 2)));
    const sway = 0.017 * wk * Math.cos(TAU * (ph - (SWING + (1 - SWING) / 2)));   // + = over the left foot
    const crouch = gesture === 'inspect' ? 0.01 : 0;
    let py = HIP_Y - 0.022 - 0.022 * wk + bob - crouch + br * 0.002;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), reach = (L_THIGH + L_SHIN) * 0.995;
    for (const f of this.feet) {
      const hx = this.pos.x + cy * (HIP_OFF[0] * f.s + sway), hz = this.pos.z - sy * (HIP_OFF[0] * f.s + sway);
      const h = Math.min(reach - 0.01, Math.hypot(f.pos.x - hx, f.pos.z - hz));
      py = Math.min(py, Math.sqrt(reach * reach - h * h) - HIP_OFF[1] + ANKLE_H + (f.lift || 0) + f.pos.y - this.ground);
    }
    this.py = py < this.py ? py : damp(this.py, py, 14, dt);   // drop at once (reach), rise smoothly
    b.pelvis.position.set(sway, this.py, 0);
    b.pelvis.rotation.set(0.02 + 0.03 * wk, hipYaw, -sway * 0.9);

    b.spine.rotation.set(q.spineX, q.spineY, 0);
    b.chest.rotation.set(q.chestX, q.spineY * 0.6, q.chestZ + sway * 0.6);
    b.neck.rotation.set(q.neckX, q.neckY - q.spineY * 0.5, 0);
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

// ---------------- the hangar helpers: two robots, clickable, each can follow you or take a job ----------------
const ROCKET = V3(0, 3.2, 0);
const CONSOLE_AT = [16.35, -4.4], CONSOLE_FACE = -Math.PI / 2;   // operator side of the launch console (console.js POS)
const JOBS = {
  rounds: () => ({ type: 'patrol', path: [
    { x: -3.75, z: -2.8, act: 'inspect', face: Math.atan2(3.75, 2.8), target: ROCKET, dur: 9 },
    { x: 8.3, z: -6 },
    { x: CONSOLE_AT[0], z: CONSOLE_AT[1], act: 'console', face: CONSOLE_FACE, dur: 10 },
    { x: 8.3, z: 6, look: ROCKET, pause: 2.5 },
    { x: -4, z: 9.6 },
    { x: -8.3, z: 3, look: ROCKET, pause: 2 },
  ] }),
  rounds2: () => ({ type: 'patrol', path: [
    { x: 8.3, z: 6, look: ROCKET, pause: 2 },
    { x: 3.0, z: 3.4, act: 'inspect', face: Math.atan2(-3.0, -3.4), target: V3(0, 0.55, 0), dur: 8 },
    { x: 8.3, z: -11.5 },
    { x: 4, z: -11.8, look: ROCKET, pause: 3 },
    { x: -8.3, z: -10 },
    { x: -8.3, z: 9, look: ROCKET, pause: 2 },
  ] }),
  inspect: () => ({ type: 'inspect', at: [-3.75, -2.8], face: Math.atan2(3.75, 2.8), target: ROCKET }),
  console: () => ({ type: 'console', at: CONSOLE_AT.slice(), face: CONSOLE_FACE }),
  stand: () => ({ type: 'inspect', at: [3.0, 3.4], face: Math.atan2(-3.0, -3.4), target: V3(0, 0.55, 0) }),
  follow: () => ({ type: 'follow' }),
};
const JOB_NAMES = { rounds: 'Back to his rounds', inspect: 'Inspecting the rocket', console: 'Heading to the console', stand: 'Checking the stand', follow: 'Following you' };

export { JOBS };
export class Robots {
  constructor(game) {
    this.g = game; const w = game.world;
    this.lite = w.quality === 'phone' || w.quality === 'low';
    this.M = makeMaterials(this.lite);
    this.hangar = new THREE.Group(); this.hangar.name = 'robots'; w.hangar.add(this.hangar);
    this.ray = new THREE.Raycaster();
    // the pair: `list` is the public roster (hooks: robot.id, .finish, .pos, .yaw, .state, .jobKey, .enabled, .group, .setJob)
    this.list = [
      { id: 'silver', finish: 'silver', pos: [-3.75, -2.8], yaw: Math.atan2(3.75, 2.8), rounds: 'rounds' },
      { id: 'gunmetal', finish: 'gunmetal', pos: [8.3, 6], yaw: Math.PI, rounds: 'rounds2' },
    ].map(o => { const r = new Robot(this, { ...o, job: JOBS[o.rounds]() }); r.jobKey = r.rounds = o.rounds; this.hangar.add(r.group); return r; });
    this.byId = Object.fromEntries(this.list.map(r => [r.id, r]));
    this.makeBar();
    // click / tap one: he stops, turns and waves (and the job bar shows); click him twice quickly: he follows you
    const c = w.renderer.domElement; let down = null;
    c.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    c.addEventListener('pointerup', e => { if (!down) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y); if (d < 8 && performance.now() - down.t < 600) this.click(e.clientX, e.clientY); down = null; });
  }
  // they are soft obstacles for you
  obstacles() { return this.hangar.visible ? this.list.filter(r => r.enabled || r.solid).map(r => C(r.pos.x, r.pos.z, R_ROBOT)) : []; }
  pick(x, y) {
    const w = this.g.world, cam = w.camera, locked = document.pointerLockElement === w.renderer.domElement;
    const ndc = locked ? new THREE.Vector2(0, 0) : new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, cam);
    let best = null, bd = 60; const a = V3(), b = V3(), onRay = V3();
    for (const r of this.list) {
      if (!r.group.visible) continue;
      a.set(r.pos.x, 0.15, r.pos.z); b.set(r.pos.x, 1.62, r.pos.z);
      const d2 = this.ray.ray.distanceSqToSegment(a, b, onRay), along = onRay.distanceTo(cam.position);
      if (d2 < 0.3 * 0.3 && along < bd) { best = r; bd = along; }
    }
    return best;
  }
  click(x, y) {
    if (!this.hangar.visible || this.g.mode !== 'build') return false;
    const r = this.pick(x, y); if (!r || !r.enabled) return false;
    const now = performance.now();
    if (this.last && this.last.r === r && now - this.last.t < 420) { this.last = null; this.send(r, r.jobKey === 'follow' ? r.rounds : 'follow'); return true; }
    this.last = { r, t: now };
    if (!r.greet) { r.greet = { t: 0 }; this.whir(0.7, 1); }
    this.showBar(r);
    return true;
  }
  // send one robot on a job by key (see JOBS); only one follows you at a time
  send(r, key) {
    if (!JOBS[key] || !r) return;
    if (key === 'follow') for (const o of this.list) if (o !== r && o.jobKey === 'follow') o.setJob(JOBS[o.rounds](), o.rounds);
    r.setJob(JOBS[key](), key); r.greet = null;
    this.whir(0.45, key === 'follow' ? 1.4 : 1.15);
    const name = r.finish === 'silver' ? 'Silver robot' : 'Dark robot';
    this.g.toast?.(`${name}: ${(key === r.rounds ? 'back to his rounds' : JOB_NAMES[key]).toLowerCase()}`, 1800);
    this.showBar(null);
  }

  // small job bar for the robot you clicked (shows after a click, hides itself)
  makeBar() {
    const st = document.createElement('style');
    st.textContent = `#robotBar{position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top));transform:translateX(-50%);z-index:20;display:flex;gap:6px;align-items:center;padding:6px 8px;background:rgba(14,18,22,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(127,231,255,.28);border-radius:14px;font:600 13px system-ui,sans-serif;color:#eef6fa}
#robotBar.hidden{display:none}#robotBar span{padding:0 6px;opacity:.75;font-weight:700;letter-spacing:.04em;white-space:nowrap}
#robotBar button{min-height:40px;padding:6px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer;white-space:nowrap}
#robotBar button:hover{background:rgba(127,231,255,.16);box-shadow:0 0 0 1px rgba(127,231,255,.55),0 0 14px rgba(127,231,255,.3)}
#robotBar button.on{background:rgba(127,231,255,.24);box-shadow:0 0 0 1px #7fe7ff}
#robotBar small{opacity:.6;font-weight:500;padding:0 4px;white-space:nowrap}body.menuopen #robotBar{display:none}
@media (max-width:760px){#robotBar{flex-wrap:wrap;justify-content:center;width:calc(100vw - 24px)}#robotBar button{min-height:36px;padding:4px 9px;font-size:12px}}`;
    document.head.appendChild(st);
    const bar = this.bar = document.createElement('div'); bar.id = 'robotBar'; bar.className = 'hidden';
    document.body.appendChild(bar);
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    bar.addEventListener('click', e => {
      const k = e.target.closest('button')?.dataset.job, r = this.barFor; if (!k || !r) return;
      this.g.audio?.tap?.(); this.send(r, k === 'follow' && r.jobKey === 'follow' ? r.rounds : k === 'rounds' ? r.rounds : k);
    });
  }
  showBar(r) {
    clearTimeout(this.barT); this.barFor = r;
    if (!r) { this.bar.classList.add('hidden'); return; }
    const f = r.jobKey === 'follow', locked = !!document.pointerLockElement;
    this.bar.innerHTML = `<span>${r.finish === 'silver' ? 'SILVER ROBOT' : 'DARK ROBOT'}</span><button data-job="follow" class="${f ? 'on' : ''}">${f ? 'Stop following' : 'Follow me'}</button>` +
      `<button data-job="inspect">Inspect rocket</button><button data-job="console">Console</button><button data-job="stand">Check stand</button>` +
      (r.jobKey !== r.rounds && !f ? '<button data-job="rounds">Free roam</button>' : '') + (locked ? '<small>Tab or the Tray button frees the cursor</small>' : '');
    this.bar.classList.remove('hidden');
    this.barT = setTimeout(() => this.bar.classList.add('hidden'), 7000);
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
    this.hangar.visible = w.indoor || Math.hypot(cam.x, cam.y, cam.z) < 90;
    if (!this.hangar.visible) return;
    const P = g.mode === 'build' ? g.build?.player : null;
    const base = hangarFrame(g), wide = this.list.some(r => r.jobKey === 'follow') ? playerFrame(g) : null;
    for (const r of this.list) {
      if (!r.enabled) continue;
      const follow = r.jobKey === 'follow';
      // a follower may step out onto the apron with you, so he uses your full collision frame
      const obs = (follow ? wide : base).slice();
      if (P) obs.push(C(P.x, P.z, R_PLAYER));
      for (const o of this.list) if (o !== r) obs.push(C(o.pos.x, o.pos.z, R_ROBOT));
      r.update(dt, { cam, obs, player: follow && P ? P : null });
    }
  }
}
