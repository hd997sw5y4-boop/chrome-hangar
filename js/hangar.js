// Hangar interior architecture: insulated wall panels on steel columns, a deep Pratt-truss roof with purlins,
// high-bay lamp fixtures, overhead cable runs, a mobile scaffold tower and a sealed, worn concrete floor.
// Everything static is merged into a handful of draw calls. Floor lighting is even scene lights, not pool decals.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { applyPBR } from './tex.js';

const _o = new THREE.Object3D(), UP = new THREE.Vector3(0, 1, 0);
const xf = (p, r = [0, 0, 0], s = [1, 1, 1]) => { _o.position.set(...p); _o.rotation.set(...r); _o.scale.set(...s); _o.updateMatrix(); return _o.matrix.clone(); };
class Kit {
  constructor() { this.by = new Map(); }
  add(geo, mat, m4) { let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m4) g.applyMatrix4(m4); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!this.by.has(mat)) this.by.set(mat, []); this.by.get(mat).push(g); return this; }
  box(w, h, d, mat, p, r) { return this.add(new THREE.BoxGeometry(w, h, d), mat, xf(p, r)); }
  rod(a, b, r, mat, seg = 6) { const d = b.clone().sub(a), L = d.length(); return this.add(new THREE.CylinderGeometry(r, r, L, seg), mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1))); }
  build(group, { cast = true, receive = true } = {}) { for (const [mat, list] of this.by) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = cast; m.receiveShadow = receive; m.matrixAutoUpdate = false; group.add(m); } this.by.clear(); return group; }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildInterior(w, g, H, M, lite) {
  const k = new Kit(), shell = new THREE.Group(); shell.name = 'shell'; g.add(shell);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.55, roughness: 0.42 });           // white-painted structure
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.7, roughness: 0.38 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a816, metalness: 0.3, roughness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.75 });

  // ---- walls: insulated white panels above a concrete dado, steel columns between bays ----
  const panel = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.15, roughness: 0.44 });   // painted steel: a gentle sheen
  const dado = new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.85 });
  const walls = [[H.x * 2, 0, H.z, Math.PI], [H.z * 2, -H.x, 0, Math.PI / 2], [H.z * 2, H.x, 0, -Math.PI / 2]];
  const side = H.x - H.door;
  walls.push([side, -H.door - side / 2, -H.z, 0, true], [side, H.door + side / 2, -H.z, 0, true]);
  const pm = [];
  for (const [len, x, z, ry] of walls) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, H.h - 3), panel); p.position.set(x, 3 + (H.h - 3) / 2, z); p.rotation.y = ry; p.receiveShadow = true; shell.add(p); pm.push([p, len]);
    k.add(new THREE.PlaneGeometry(len, 3), dado, xf([x, 1.5, z], [0, ry, 0]));
    const nx = Math.round(len / 6.2);   // columns
    for (let i = 0; i <= nx; i++) {
      const t = -len / 2 + len * i / nx, dx = Math.cos(ry) * t, dz = -Math.sin(ry) * t, inx = Math.sin(ry) * 0.25, inz = Math.cos(ry) * 0.25;
      k.box(0.04, H.h, 0.22, steel, [x + dx + inx, H.h / 2, z + dz + inz], [0, ry, 0]);             // web
      for (const f of [-0.22, 0.22]) k.box(0.5, H.h, 0.04, steel, [x + dx + inx * (1 + f * 2), H.h / 2, z + dz + inz * (1 + f * 2)], [0, ry, 0]);
    }
    for (const y of [3, 9.5, 16, 22.5]) k.box(len, 0.16, 0.12, steel, [x + Math.sin(ry) * 0.08, y, z + Math.cos(ry) * 0.08], [0, ry, 0]);   // girts
    k.box(len, 0.25, 0.04, yellow, [x + Math.sin(ry) * 0.03, 0.12, z + Math.cos(ry) * 0.03], [0, ry, 0]);   // kick strip
  }
  // panel texture: vertical insulated panel joints, a little grime toward the floor
  pm.forEach(([p, len]) => { const t = p.material = panel.clone(); applyPBR(t, 'corrugated_iron_02', [len / 1.2, (H.h - 3) / 6], { metal: false, normalScale: 0.35 }).then(m => { m.map = null; m.color.set(0x9ca2a9); m.aoMap = null; }).catch(() => {}); });
  // upper door header
  k.add(new THREE.PlaneGeometry(H.door * 2, H.h - H.doorH), panel, xf([0, H.doorH + (H.h - H.doorH) / 2, -H.z]));

  // ---- roof: Pratt trusses across the span + purlins + metal deck ----
  const nT = 7, depth = 3.2, yB = H.h - depth - 0.6, yT = H.h - 0.4;
  for (let i = 0; i < nT; i++) {
    const z = -H.z + (i + 0.5) * (H.z * 2 / nT);
    k.box(H.x * 2, 0.3, 0.3, steel, [0, yT, z]); k.box(H.x * 2, 0.3, 0.3, steel, [0, yB, z]);
    const n = 16, dx = H.x * 2 / n;
    for (let j = 0; j <= n; j++) {
      const x = -H.x + j * dx; k.box(0.16, depth, 0.16, steel, [x, (yB + yT) / 2, z]);
      if (j < n) { const a = j < n / 2 ? V(x, yT, z) : V(x + dx, yT, z), b = j < n / 2 ? V(x + dx, yB, z) : V(x, yB, z); k.rod(a, b, 0.07, steel, 4); }
    }
  }
  for (let x = -H.x + 1.4; x < H.x; x += 2.75) k.box(0.14, 0.22, H.z * 2, steel, [x, yT + 0.22, 0]);   // purlins
  for (let x = -H.x + 1.4; x < H.x; x += 5.5) k.rod(V(x, yB, -H.z + 0.3), V(x + 2.75, yB, H.z - 0.3), 0.025, steelDark, 4);   // bracing
  const deck = new THREE.MeshStandardMaterial({ color: 0x6a7078, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide });
  k.add(new THREE.PlaneGeometry(H.x * 2, H.z * 2), deck, xf([0, H.h, 0], [Math.PI / 2, 0, 0]));
  // skylight strips in the deck (cool daylight, they bloom slightly)
  const sky = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.75, 2.0) });
  for (const x of [-11, 11]) k.add(new THREE.PlaneGeometry(2.2, H.z * 2 - 4), sky, xf([x, H.h - 0.02, 0], [Math.PI / 2, 0, 0]));

  // ---- high-bay lamps: shades + glowing lenses (even lighting comes from scene lights, not floor cookies) ----
  const lamps = [];
  for (let i = 0; i < nT; i += 1) { if (i === 3) continue; const z = -H.z + (i + 0.5) * (H.z * 2 / nT); for (const x of [-14, -5, 5, 14]) lamps.push([x, z]); }
  const shade = new THREE.LatheGeometry([V(0.08, 0.95, 0), V(0.2, 0.8, 0), V(0.32, 0.55, 0), V(0.62, 0.05, 0), V(0.66, 0, 0)].map(v => new THREE.Vector2(v.x, v.y)), 24);
  const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12.5, 10) });
  const lampY = yB - 2.2;
  for (const [x, z] of lamps) {
    k.add(shade, steelDark, xf([x, lampY, z])); k.add(new THREE.CircleGeometry(0.6, 24), lens, xf([x, lampY + 0.02, z], [Math.PI / 2, 0, 0]));
    k.rod(V(x, lampY + 0.95, z), V(x, yB, z), 0.015, steelDark, 4);
  }
  k.build(shell, { cast: false });

  // ---- cables: overhead catenaries to the stand, floor runs, umbilical tray ----
  const cab = new Kit();
  const catenary = (a, b, sag, r) => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); } cab.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, r, 6), rubber); };
  catenary(V(-H.x + 0.4, 12, -6), V(-6, yB, -2), 2.2, 0.05); catenary(V(-H.x + 0.4, 11.5, -5.4), V(-6, yB, -1.4), 2.6, 0.035);
  catenary(V(H.x - 0.4, 12, 4), V(7, yB, 3), 2.4, 0.05);
  for (const [a, b] of [[V(-H.x + 0.3, 0.05, -6), V(-3.2, 0.05, -1.5)], [V(H.x - 0.3, 0.05, 3.6), V(3.3, 0.05, 1.2)]]) {
    const m = a.clone().lerp(b, 0.5); m.z += 1.2; cab.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, m, b]), 24, 0.06, 6), rubber);
    cab.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a.clone().add(V(0, 0, 0.18)), m.clone().add(V(0, 0, 0.18)), b.clone().add(V(0, 0, 0.18))]), 24, 0.04, 6), yellow);
  }
  // ---- mobile scaffold tower beside the stand (tubes, toe boards, platforms) ----
  const sx = -7.6, sz = 5.2, sw = 2.5, sd = 1.6, lv = [0, 2, 4, 6, 8];
  for (const [dx, dz] of [[0, 0], [sw, 0], [0, sd], [sw, sd]]) { cab.rod(V(sx + dx, 0.2, sz + dz), V(sx + dx, 9.1, sz + dz), 0.03, yellow, 6); cab.add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), rubber, xf([sx + dx, 0.09, sz + dz], [Math.PI / 2, 0, 0])); }
  for (const y of lv) {
    cab.rod(V(sx, y + 0.3, sz), V(sx + sw, y + 0.3, sz), 0.024, yellow); cab.rod(V(sx, y + 0.3, sz + sd), V(sx + sw, y + 0.3, sz + sd), 0.024, yellow);
    cab.rod(V(sx, y + 0.3, sz), V(sx, y + 0.3, sz + sd), 0.024, yellow); cab.rod(V(sx + sw, y + 0.3, sz), V(sx + sw, y + 0.3, sz + sd), 0.024, yellow);
    if (y) { cab.rod(V(sx, y - 1.7, sz), V(sx + sw, y + 0.3, sz), 0.02, yellow); cab.box(sw, 0.05, sd, steelDark, [sx + sw / 2, y + 0.32, sz + sd / 2]); cab.rod(V(sx, y + 1.3, sz), V(sx + sw, y + 1.3, sz), 0.022, yellow); }
  }
  cab.build(shell, { cast: true });
  return {};
}
