// Launch complex: concrete deck with a two-way flame trench and deflector, a steel launch mount bridging it,
// water-deluge rails, and a detailed lattice service tower (platforms, stairs, piping, elevator, crew access arm
// that swings away at ignition). Static steel is merged per material. Original design, no real-pad likeness.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { applyPBR } from './tex.js';

// trench runs across the stand's line of sight so the exhaust clouds billow out left and right
export const TRENCH = { ang: Math.atan2(0.84, 0.54), half: 34, w: 3.2, depth: 7, mount: 5.5, cx: 0, cz: -115 };
TRENCH.dir = new THREE.Vector2(Math.cos(TRENCH.ang), Math.sin(TRENCH.ang));   // (x, z)

const UP = new THREE.Vector3(0, 1, 0), V = (x, y, z) => new THREE.Vector3(x, y, z);
class Kit {
  constructor() { this.by = new Map(); }
  add(geo, mat, m4) { let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m4) g.applyMatrix4(m4); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); (this.by.get(mat) || this.by.set(mat, []).get(mat)).push(g); return this; }
  box(w, h, d, mat, x, y, z, ry = 0) { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; o.updateMatrix(); return this.add(new THREE.BoxGeometry(w, h, d), mat, o.matrix); }
  rod(a, b, r, mat, seg = 6) { const d = b.clone().sub(a), L = d.length(); if (L < 1e-3) return this; return this.add(new THREE.CylinderGeometry(r, r, L, seg), mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), V(1, 1, 1))); }
  build(parent, cast = true) { for (const [mat, list] of this.by) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); } this.by.clear(); return parent; }
}

function sootTex() {   // trench walls: concrete darkened by exhaust toward the centre and the floor
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#9a968f'; g.fillRect(0, 0, 512, 128);
  let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 4000; i++) { const v = 90 + r() * 80 | 0; g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.2)`; g.fillRect(r() * 512, r() * 128, 2, 2); }
  const gr = g.createLinearGradient(0, 0, 512, 0); gr.addColorStop(0, 'rgba(25,22,20,0.15)'); gr.addColorStop(0.5, 'rgba(18,16,14,0.92)'); gr.addColorStop(1, 'rgba(25,22,20,0.15)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
  const gv = g.createLinearGradient(0, 0, 0, 128); gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(1, 'rgba(10,9,8,0.6)'); g.fillStyle = gv; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(20,18,16,${0.1 + r() * 0.2})`; g.fillRect(r() * 512, 0, 1 + r() * 4, 20 + r() * 108); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function buildPadComplex(w, padPos, lite) {
  const g = new THREE.Group(); g.position.copy(padPos); g.name = 'padComplex'; w.scene.add(g);
  const T = TRENCH, frame = new THREE.Group(); frame.rotation.y = -T.ang; g.add(frame);   // local +x = along the trench
  const k = new Kit(), kf = new Kit();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xc9c5bd, roughness: 0.9 });
  applyPBR(concrete, 'concrete_pavement', [9, 9], { normalScale: 0.6 }).catch(() => {});
  const trenchMat = new THREE.MeshStandardMaterial({ map: sootTex(), roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5b6067, metalness: 0.75, roughness: 0.5 });
  const steelSoot = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.6, roughness: 0.7 });
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xb04a2a, metalness: 0.45, roughness: 0.55 });   // weathered red-orange
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.45 });
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 0.7, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a816, metalness: 0.3, roughness: 0.5 });
  const grate = new THREE.MeshStandardMaterial({ color: 0x3b3f44, metalness: 0.7, roughness: 0.6 });

  // ---- deck: 46 m square slab with the trench slot cut out (local frame) ----
  const S = 23, hw = T.w, L = T.half;
  const sh = new THREE.Shape(); sh.moveTo(-S, -S); sh.lineTo(S, -S); sh.lineTo(S, S); sh.lineTo(-S, S); sh.closePath();
  const hole = new THREE.Path(); hole.moveTo(-S + 0.01, -hw); hole.lineTo(-S + 0.01, hw); hole.lineTo(S - 0.01, hw); hole.lineTo(S - 0.01, -hw); hole.closePath(); sh.holes.push(hole);
  const deckGeo = new THREE.ShapeGeometry(sh, 4); deckGeo.rotateX(-Math.PI / 2);
  { const p = deckGeo.attributes.position, uv = deckGeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + S) / (2 * S), (p.getZ(i) + S) / (2 * S)); }
  const deck = new THREE.Mesh(deckGeo, concrete); deck.position.y = 0.02; deck.receiveShadow = true; frame.add(deck);
  // slab edge kerb
  for (const [x, z, ww, dd] of [[0, -S, 2 * S, 0.4], [0, S, 2 * S, 0.4]]) k.box(ww, 0.35, dd, concrete, x, 0.1, z);
  // ---- trench: walls, floor with exit ramps, central wedge deflector ----
  const floorY = -T.depth;
  const prof = x => { const a = Math.abs(x); return a < 16 ? floorY : floorY * (1 - (a - 16) / (L - 16)); };
  const fl = new THREE.PlaneGeometry(2 * L, 2 * hw, 64, 1), fp = fl.attributes.position;
  for (let i = 0; i < fp.count; i++) { const x = fp.getX(i); fp.setZ(i, 0); } fl.rotateX(-Math.PI / 2);
  for (let i = 0; i < fp.count; i++) fp.setY(i, prof(fp.getX(i))); fl.computeVertexNormals();
  k.add(fl, trenchMat);
  for (const sz of [-1, 1]) {   // side walls following the ramp
    const wg = new THREE.PlaneGeometry(2 * L, 1, 64, 1), wp = wg.attributes.position;
    for (let i = 0; i < wp.count; i++) { const x = wp.getX(i), top = wp.getY(i) > 0; wp.setXYZ(i, x, top ? 0.02 : prof(x), 0); }
    wg.computeVertexNormals(); const o = new THREE.Object3D(); o.position.z = sz * hw; o.rotation.y = sz > 0 ? Math.PI : 0; o.updateMatrix();
    if (sz < 0) { /* faces +z already */ }
    k.add(wg, trenchMat, o.matrix);
  }
  // deflector: wedge ridge under the engine splitting the flow both ways
  { const s2 = new THREE.Shape(); s2.moveTo(-7, 0); s2.quadraticCurveTo(-1.2, 0.4, 0, 5.2); s2.quadraticCurveTo(1.2, 0.4, 7, 0); s2.closePath();
    const wedge = new THREE.ExtrudeGeometry(s2, { depth: 2 * hw - 0.1, bevelEnabled: false }); wedge.translate(0, floorY, -hw + 0.05); k.add(wedge, steelSoot); }
  // ---- launch mount: steel table bridging the trench, central exhaust hole, girders, hold-downs ----
  const M2 = T.mount;
  const tsh = new THREE.Shape(); tsh.moveTo(-M2, -hw - 1.2); tsh.lineTo(M2, -hw - 1.2); tsh.lineTo(M2, hw + 1.2); tsh.lineTo(-M2, hw + 1.2); tsh.closePath();
  const th = new THREE.Path(); th.absarc(0, 0, 1.9, 0, Math.PI * 2, true); tsh.holes.push(th);
  const table = new THREE.ExtrudeGeometry(tsh, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: 32 }); table.rotateX(Math.PI / 2); table.translate(0, 0.05, 0);
  kf.add(table, grate);
  for (const x of [-M2 + 0.4, -1.9, 1.9, M2 - 0.4]) kf.box(0.5, 1.6, 2 * hw + 2.4, steel, x, -1.2, 0);           // girders across the slot
  for (const z of [-hw - 0.9, hw + 0.9]) kf.box(2 * M2, 2.4, 0.6, steel, 0, -1.5, z);                              // bearers on the trench lips
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 2.45, z = Math.sin(a) * 2.45; kf.box(0.5, 0.45, 0.5, yellow, x, 0.28, z, -a); kf.box(0.22, 0.25, 0.7, steel, x * 0.92, 0.6, z * 0.92, -a); }   // hold-down clamps
  // deluge: perforated rails along the hole and the trench lips (spray is particles in flight.js)
  const nozzles = [];
  { const ring = new THREE.TorusGeometry(2.15, 0.09, 6, 40); ring.rotateX(Math.PI / 2); ring.translate(0, 0.12, 0); kf.add(ring, pipeMat); }
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; nozzles.push(V(Math.cos(a) * 2.15, 0.15, Math.sin(a) * 2.15)); }
  for (const z of [-hw - 0.15, hw + 0.15]) { kf.rod(V(-16, 0.25, z), V(16, 0.25, z), 0.14, pipeMat, 8); for (let x = -15; x <= 15; x += 3) nozzles.push(V(x, 0.2, z)); }
  // ---- service tower: 4-leg lattice, bays with X bracing, platforms + railings, stair, elevator, piping, arm ----
  const TW = new THREE.Group(); TW.position.set(0, 0, -(hw + 8.5)); frame.add(TW);   // behind the mount (across the trench line)
  const kt = new Kit(), H = 42, a2 = 2.4;
  const legs = [[-a2, -a2], [a2, -a2], [a2, a2], [-a2, a2]];
  for (const [x, z] of legs) kt.box(0.42, H, 0.42, towerMat, x, H / 2, z);
  for (let y = 0; y < H - 0.1; y += 3) {
    for (let i = 0; i < 4; i++) { const [x0, z0] = legs[i], [x1, z1] = legs[(i + 1) % 4]; kt.rod(V(x0, y + 3, z0), V(x1, y + 3, z1), 0.11, towerMat, 4); kt.rod(V(x0, y, z0), V(x1, y + 3, z1), 0.075, towerMat, 4); kt.rod(V(x1, y, z1), V(x0, y + 3, z0), 0.075, towerMat, 4); }
    if (y % 6 === 0 && y > 0) {   // service platform with grating, toe board and railing on three sides
      kt.box(2 * a2 + 3.2, 0.12, 2 * a2 + 3.2, grate, 0, y, 0);
      const e = a2 + 1.6;
      for (const [x0, z0, x1, z1] of [[-e, -e, e, -e], [e, -e, e, e], [-e, e, e, e], [-e, -e, -e, e]]) { kt.rod(V(x0, y + 1.1, z0), V(x1, y + 1.1, z1), 0.04, yellow, 5); kt.rod(V(x0, y + 0.55, z0), V(x1, y + 0.55, z1), 0.03, yellow, 5); }
      for (const [x, z] of [[-e, -e], [e, -e], [e, e], [-e, e]]) kt.rod(V(x, y, z), V(x, y + 1.1, z), 0.04, yellow, 5);
    }
  }
  kt.box(1.8, H, 1.8, grey, -a2 - 1.4, H / 2, 0);   // elevator shaft cladding
  for (let y = 0; y < H - 3; y += 3) kt.rod(V(a2 + 0.5, y, -1.2), V(a2 + 0.5, y + 3, 1.2), 0.06, grey, 4), kt.box(1.0, 0.06, 1.0, grate, a2 + 0.5, y + 3, (y / 3) % 2 ? -1.2 : 1.2);   // stair flights
  for (const [x, r] of [[a2 - 0.6, 0.22], [a2 - 1.1, 0.16], [-a2 + 0.7, 0.18]]) kt.rod(V(x, 0, a2 + 0.5), V(x, H - 4, a2 + 0.5), r, pipeMat, 8);   // propellant/water risers
  kt.box(2 * a2 + 2, 1.2, 2 * a2 + 2, grey, 0, H + 0.6, 0);   // hammerhead
  kt.rod(V(0, H + 1.2, 0), V(0, H + 9, 0), 0.12, grey, 6);    // lightning rod
  kt.box(7, 1.0, 7, concrete, 0, 0.5, 0);                   // footing
  kt.build(TW);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 1.2, 0.6) })); beacon.position.y = H + 9.3; TW.add(beacon);
  // crew access arm: pivots at the tower face, swings 70 degrees away at ignition
  const arm = new THREE.Group(); arm.position.set(0, 0, a2); TW.add(arm); const ka = new Kit();
  const reach = hw + 8.5 - a2 - 1.2;
  ka.box(1.6, 0.14, reach, grate, 0, 0, reach / 2); ka.box(1.6, 2.2, 0.1, grey, 0, 1.1, reach);
  for (const sx of [-0.8, 0.8]) { ka.rod(V(sx, 0, 0), V(sx, 0, reach), 0.07, towerMat, 4); ka.rod(V(sx, 2.3, 0), V(sx, 2.3, reach), 0.06, towerMat, 4); for (let z = 0; z <= reach; z += 1.5) ka.rod(V(sx, 0, z), V(sx, 2.3, Math.min(reach, z + 1.5)), 0.05, towerMat, 4); }
  ka.build(arm);
  // umbilical hoses drooping from the tower to the mount
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.7 });
  for (const [dx, r] of [[-0.6, 0.12], [0.5, 0.09]]) { const a = V(dx, 9, -(hw + 8.5) + a2 + 0.3), b = V(dx * 2, 0.6, -hw - 1.0), m = a.clone().lerp(b, 0.5); m.y -= 2.2; kf.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, m, b]), 20, r, 6), hoseMat); }
  k.build(frame); kf.build(frame);
  g.updateMatrixWorld(true);
  const armY = (w.rocketTop || 14) - 3;
  arm.position.y = Math.max(6, Math.min(36, armY));
  // exits (world space) where the trench breathes out, deluge nozzles (world)
  const toW = v => v.clone().applyMatrix4(frame.matrixWorld);
  return { group: g, frame, arm, tower: TW, exits: [toW(V(-L + 3, 0.5, 0)), toW(V(L - 3, 0.5, 0))], exitDirs: [toW(V(-1, 0, 0)).sub(toW(V(0, 0, 0))), toW(V(1, 0, 0)).sub(toW(V(0, 0, 0)))], nozzles: nozzles.map(toW), center: toW(V(0, 0, 0)) };
}
