// Procedural meshes for every part. Original designs: stout stainless tanks with weld rings,
// dark machined mounts, bell nozzles. No real-vehicle shapes or marks.
import * as THREE from 'three';
import { PARTS, layout } from './rocket.js';

let M = null; // shared materials
const texCache = new Map();

function canvasTex(w, h, draw, srgb = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// deterministic noise
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function steelRough(base) {
  // brushed streaks around the tank + a weld bead ring at the top of each tile
  return canvasTex(256, 512, (g, w, h) => {
    seed = 11;
    g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const y = rnd() * h, a = rnd() * (base < 50 ? 0.05 : 0.1);
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(0, y, w, 1 + rnd() * 1.5);
    }
    // weld seam
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, 7);
    g.fillStyle = 'rgb(210,210,210)'; g.fillRect(0, 2, w, 3);
    // a small rectangular access panel outline on one side
    g.strokeStyle = 'rgba(200,200,200,0.9)'; g.lineWidth = 3; g.strokeRect(w * 0.62, h * 0.4, w * 0.1, h * 0.14);
  });
}
function steelBump() {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, 9); gr.addColorStop(0, '#808080'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#808080');
    g.fillStyle = gr; g.fillRect(0, 0, w, 9);
    g.strokeStyle = '#5a5a5a'; g.lineWidth = 3; g.strokeRect(w * 0.62, h * 0.4, w * 0.1, h * 0.14);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 16; i++) { g.beginPath(); g.arc((i + 0.5) * w / 16, 18, 2.2, 0, 7); g.fill(); }
  });
}

export function initMaterials() {
  if (M) return M;
  const roughM = steelRough(28), roughB = steelRough(85), bump = steelBump();
  M = {
    mirror: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, metalness: 1, roughness: 0.9, roughnessMap: roughM, bumpMap: bump, bumpScale: 1.2, clearcoat: 0.4, clearcoatRoughness: 0.05 }),
    brushed: new THREE.MeshPhysicalMaterial({ color: 0xd9dde2, metalness: 1, roughness: 1, roughnessMap: roughB, bumpMap: bump, bumpScale: 1.0, anisotropy: 0.7 }),
    chromeTrim: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.85, roughness: 0.38 }),
    darkMatte: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.5, roughness: 0.62 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.6, roughness: 0.5 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x0d0f12, metalness: 0.3, roughness: 0.5 }),
    ghost: new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.38, depthWrite: false }),
    ghostBad: new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.38, depthWrite: false }),
  };
  return M;
}
export function finishMat(f, len = 2) {
  const base = f === 'brushed' ? M.brushed : f === 'dark' ? M.dark : M.mirror;
  if (f === 'dark') return base;
  const key = f + len;
  if (texCache.has(key)) return texCache.get(key);
  const m = base.clone();
  for (const k of ['roughnessMap', 'bumpMap']) { m[k] = base[k].clone(); m[k].repeat.set(1, Math.max(1, Math.round(len / 1.5))); m[k].needsUpdate = true; }
  texCache.set(key, m);
  return m;
}

const mesh = (geo, mat, cast = true) => { const o = new THREE.Mesh(geo, mat); o.castShadow = cast; o.receiveShadow = true; return o; };

function tankMesh(d) {
  const g = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(d.radius, d.radius, d.length, 64, 1, true), finishMat(d.finish, d.length));
  body.position.y = d.length / 2; g.add(body);
  // flush end rings in chrome trim
  for (const y of [0.04, d.length - 0.04]) {
    const ring = mesh(new THREE.TorusGeometry(d.radius + 0.005, 0.035, 8, 64), M.chromeTrim, false);
    ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring);
  }
  // a dark band near the top (original livery), plus a thin conduit
  const band = mesh(new THREE.CylinderGeometry(d.radius + 0.004, d.radius + 0.004, 0.22, 64, 1, true), M.stripe, false);
  band.position.y = d.length - 0.45; g.add(band);
  const conduit = mesh(new THREE.BoxGeometry(0.12, d.length - 0.2, 0.1), M.brushed);
  conduit.position.set(0, d.length / 2, d.radius + 0.04); g.add(conduit);
  // caps so it never looks hollow
  for (const y of [0, d.length]) { const cap = mesh(new THREE.CircleGeometry(d.radius, 48), M.dark, false); cap.rotation.x = y ? -Math.PI / 2 : Math.PI / 2; cap.position.y = y; g.add(cap); }
  return g;
}
function noseMesh(d) {
  const g = new THREE.Group(), pts = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // tangent-ogive-ish, slightly blunted tip
    const r = d.radius * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.06 * t);
    pts.push(new THREE.Vector2(Math.max(0.05, r), t * d.length));
  }
  pts.push(new THREE.Vector2(0, d.length + 0.02));
  const nose = mesh(new THREE.LatheGeometry(pts, 64), finishMat(d.finish, d.length));
  g.add(nose);
  const tip = mesh(new THREE.SphereGeometry(0.08, 16, 8), M.dark); tip.position.y = d.length; g.add(tip);
  const ring = mesh(new THREE.TorusGeometry(d.radius + 0.005, 0.035, 8, 64), M.chromeTrim, false); ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  return g;
}
function mountMesh(d) {
  const g = new THREE.Group();
  const shell = mesh(new THREE.CylinderGeometry(d.radius, d.radius * 0.94, d.length, 48), M.dark); shell.position.y = d.length / 2; g.add(shell);
  // bolt heads around the top
  const bolt = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, b = mesh(bolt, M.chromeTrim, false);
    b.position.set(Math.cos(a) * d.radius, d.length - 0.12, Math.sin(a) * d.radius); b.rotation.z = Math.PI / 2; b.rotation.y = -a; g.add(b);
  }
  const plate = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 32), M.darkMatte); plate.position.y = 0.02; g.add(plate);
  return g;
}
export function engineMesh(d) {
  const g = new THREE.Group();
  const L = d.length, R = d.radius, throat = R * 0.32;
  const prof = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push(new THREE.Vector2(throat + (R - throat) * Math.pow(t, 0.6), (1 - t) * L * 0.72)); }
  const nozMat = M.dark.clone(); nozMat.side = THREE.DoubleSide; nozMat.emissive = new THREE.Color(0xff5a1a); nozMat.emissiveIntensity = 0; nozMat.userData.own = true;
  const bell = mesh(new THREE.LatheGeometry(prof.reverse(), 48), nozMat); g.add(bell);
  const lip = mesh(new THREE.TorusGeometry(R, 0.025, 6, 48), M.copper, false); lip.rotation.x = Math.PI / 2; lip.position.y = 0.01; g.add(lip);
  const chamber = mesh(new THREE.CylinderGeometry(throat * 1.5, throat * 1.1, L * 0.28, 24), M.copper); chamber.position.y = L * 0.72 + L * 0.14; g.add(chamber);
  const pump = mesh(new THREE.BoxGeometry(R * 0.5, L * 0.22, R * 0.4), M.dark); pump.position.set(R * 0.45, L * 0.86, 0); g.add(pump);
  const pipe = mesh(new THREE.TorusGeometry(R * 0.35, 0.03, 6, 16, Math.PI), M.brushed); pipe.position.set(0, L * 0.8, 0); g.add(pipe);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0x000000 }); innerMat.userData.own = true;
  const inner = mesh(new THREE.CircleGeometry(throat * 1.1, 24), innerMat); inner.rotation.x = Math.PI / 2; inner.position.y = L * 0.7; g.add(inner);
  g.userData.nozMat = nozMat; g.userData.innerMat = inner.material;
  return g;
}
function finGeo(d) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0, d.root); s.lineTo(d.span, d.root - (d.root - d.tip) * 0.35 - 0.2); s.lineTo(d.span, d.root - (d.root - d.tip) * 0.35 - 0.2 - d.tip); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  geo.translate(0, 0, -0.03);
  return geo;
}
let FINGEO = null;
// free a rocket's GPU memory (shared materials/geometry are kept)
export function disposeTree(o) {
  o.traverse(c => {
    if (c.geometry && !c.geometry.userData.keep) c.geometry.dispose();
    if (c.material && c.material.userData.own) c.material.dispose();
  });
}
export function finPair(pairIndex, radius = 0.9) {
  const d = PARTS.fins; if (!FINGEO) { FINGEO = finGeo(d); FINGEO.userData.keep = true; }
  const g = new THREE.Group();
  for (const s of [0, 1]) {
    const f = mesh(FINGEO, finishMat('brushed', 2));
    const a = (pairIndex ? Math.PI / 2 : 0) + s * Math.PI + Math.PI / 4;
    f.position.set(Math.cos(a) * (radius - 0.02), -0.35, Math.sin(a) * (radius - 0.02));
    f.rotation.y = -a;
    g.add(f);
  }
  return g;
}
export function legSet(dropTo, radius = 0.9) {
  // dropTo = distance from attach point down to the feet
  const d = PARTS.legs, g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    const top = new THREE.Vector3(c * radius, 0.9, s * radius), foot = new THREE.Vector3(c * d.footRadius, -dropTo, s * d.footRadius);
    const mid = top.clone().add(foot).multiplyScalar(0.5), dir = foot.clone().sub(top), L = dir.length();
    const strut = mesh(new THREE.CylinderGeometry(0.07, 0.09, L, 10), M.dark); strut.position.copy(mid);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); g.add(strut);
    const brace = mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), M.chromeTrim);
    const b0 = new THREE.Vector3(c * radius, -0.1, s * radius), b1 = top.clone().lerp(foot, 0.55), bd = b1.clone().sub(b0);
    brace.scale.y = bd.length(); brace.position.copy(b0.clone().add(b1).multiplyScalar(0.5)); brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bd.normalize()); g.add(brace);
    const pad = mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 16), M.dark); pad.position.copy(foot).add(new THREE.Vector3(0, 0.04, 0)); g.add(pad);
  }
  return g;
}

export function partMesh(id) {
  const d = PARTS[id];
  if (d.kind === 'tank') return tankMesh(d);
  if (d.kind === 'nose') return noseMesh(d);
  if (d.kind === 'mount') return mountMesh(d);
  if (d.kind === 'engine') return engineMesh(d);
  if (d.kind === 'fins') { const g = new THREE.Group(); const p = finPair(0); p.position.y = 0.35; g.add(p); return g; }
  if (d.kind === 'legs') return legSet(1.6);
}

// Whole rocket, local origin at the nozzle exit. Each pickable piece is tagged with its target.
export function rocketMesh(r) {
  const L = layout(r), g = new THREE.Group(), picks = [];
  const tag = (o, t) => { o.traverse(c => { if (c.isMesh) c.userData.target = t; }); picks.push({ obj: o, t }); };
  if (r.engine && L.engLen) {
    // engine hangs from a gimbal pivot at its top so the bell visibly swivels
    const pivot = new THREE.Group(); pivot.position.y = L.engLen; g.add(pivot);
    const e = engineMesh(PARTS[r.engine]); e.position.y = -L.engLen; pivot.add(e);
    tag(e, { type: 'engine', index: 0 }); g.userData.engine = e; g.userData.gimbal = pivot;
  }
  for (const it of L.items) {
    const m = partMesh(it.s.p); m.position.y = it.y0; g.add(m); tag(m, { type: 'stack', index: it.i });
    for (let k = 0; k < (it.s.fins || 0); k++) { const f = finPair(k); f.position.y = it.y0 + 0.35; g.add(f); tag(f, { type: 'fins', index: it.i }); }
    if (it.s.legs) { const l = legSet(it.y0 + PARTS.legs.drop); l.position.y = it.y0; g.add(l); tag(l, { type: 'legs', index: it.i }); }
  }
  g.userData.picks = picks; g.userData.layout = L;
  return g;
}

export function ghostify(obj, bad) {
  obj.traverse(c => { if (c.isMesh) { c.material = bad ? M.ghostBad : M.ghost; c.castShadow = false; c.raycast = () => {}; } });
  return obj;
}
