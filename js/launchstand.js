// gb3-stand: outdoor Launch Stand for stacks too tall for the hangar: an orbital launch mount (a ring on splayed legs over
// the flame trench) and an integration tower with swing arms, both sized to the current stack. Procedural Three.js lattice
// (no external models, no textures; see assets/launchstand/CREDITS.md). Built lazily the first time it is needed, rebuilt
// only when the stack's size changes, removed and disposed when the hangar is used again, so the hangar pays nothing for it.
// Generic design and name: no logos, names or trademarks of any launch company.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { layout } from './rocket.js';
import { HANGAR } from './hangar.js';
import { DECK } from './stand.js';
import { TRENCH } from './pad.js';

// tallest stack the hangar holds: assembly deck + stack under the roof-truss bottom chord (HANGAR.h - 3.8) with 0.5 m to spare
export const HANGAR_MAX_STACK = HANGAR.h - 3.8 - 0.5 - DECK;   // 23.3 m
export const TOWER_K = 1.12;                                    // tower = 112 % of the rocket's tip height above the ground

const PAD = { x: 0, z: -115 };   // SPOTS.pad (env.js is not imported so Node tests can size the stand)
const padAt = w => w?.pad?.center || PAD, C = (x, z, r) => ({ t: 'c', x, z, r });
const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
function beam(list, a, b, t, d = t) {   // a box from a to b, t x d cross-section
  const dir = b.clone().sub(a), len = dir.length(); if (len < 1e-3) return;
  const g = new THREE.BoxGeometry(t, len, d);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  list.push(g);
}
const box = (list, w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); list.push(g); };
const merged = list => { const g = mergeGeometries(list); for (const x of list) x.dispose(); return g; };

// sizing from the stack alone (pure; tests and flight use it without any geometry)
export function standSize(r) {
  const L = layout(r), h = L.top - L.bottom, R = Math.max(0.9, L.radius);
  const mountH = Math.max(L.engLen + 1.5, THREE.MathUtils.clamp(0.1 * h, 6, 14));   // ring top above the ground
  const baseY = mountH - L.engLen + L.bottom;                                        // rocket's lowest point (nozzle exit sits in the ring)
  const tipY = baseY + h, towerH = TOWER_K * tipY, tw = THREE.MathUtils.clamp(0.07 * towerH, 6, 10);
  const rin = R * 0.96, rout = R + 2.4, face = Math.max(rout + 2, R + 6);           // tower face distance from the rocket axis
  // swing arms: crew access at the top part, plus one at each stage joint (decouplers), at most four
  const arms = [];
  const top = L.items[L.items.length - 1]; if (top) arms.push({ y: baseY - L.bottom + top.y0 + 0.4, r: top.r });
  for (const it of L.items) if (it.d.kind === 'decoupler' && arms.length < 4) arms.push({ y: baseY - L.bottom + it.y0, r: Math.max(it.r, L.items[it.i + 1]?.r || 0) });
  return { L, h, R, mountH, baseY, tipY, towerH, tw, rin, rout, face, arms, key: [h.toFixed(2), R.toFixed(2), L.engLen, arms.map(a => a.y.toFixed(1) + '/' + a.r).join(',')].join('|') };
}
export const needsStand = r => { const L = layout(r); return L.top - L.bottom > HANGAR_MAX_STACK; };

export class LaunchStand {
  constructor(w) {
    this.w = w; this.mode = 'auto'; this.wasTall = false; this.active = false; this.group = null; this.key = ''; this.swing = 0; this.size = null;
    this.seat = new THREE.Group(); this.seat.name = 'launchStandSeat';   // the build view's rocket rides here while the stand is in use
  }
  // which site the current stack uses: a toggle wins until the stack crosses the hangar limit again
  want(r) {
    const tall = needsStand(r);
    if (tall !== this.wasTall) { this.wasTall = tall; this.mode = 'auto'; }
    return this.mode === 'stand' || (this.mode === 'auto' && tall);
  }
  toggle(r) { this.mode = this.want(r) ? 'hangar' : 'stand'; return this.mode; }
  // make the world match the stack: build / resize / remove the stand. Cheap when nothing changed (one layout()).
  sync(r) {
    const on = this.want(r);
    if (!on) { this.release(); return null; }
    const s = standSize(r); this.size = s; this.active = true;
    if (!this.group || s.key !== this.key) this.rebuild(s);
    if (this.w.pad?.tower) this.w.pad.tower.visible = false;   // the old service tower (with its arm) stands where the new tower goes
    return s;
  }
  // flight: pad height for newFlight (0 = the old pad), arms in, seat hidden
  flightPadY(r) {
    const s = this.sync(r); this.seat.visible = false; this.swing = 0; if (this.arms) this.arms.rotation.y = 0;
    return s ? s.baseY : 0;
  }
  flightTick(dt, fm) {   // swing the arms clear from the countdown on
    if (!this.arms) return;
    const want = fm.countdown != null || fm.armed || (fm.f && fm.f.phase !== 'pad') ? 1 : 0;
    this.swing += THREE.MathUtils.clamp(want - this.swing, -dt / 4, dt / 4);
    this.arms.rotation.y = this.swing * 1.25;
  }
  obstacles() {
    if (!this.active || !this.size) return [];
    const s = this.size, P = padAt(this.w), a = -TRENCH.ang, tz = -(s.face + s.tw / 2);
    return [C(P.x, P.z, s.rout + 0.6), C(P.x + Math.sin(a) * tz, P.z + Math.cos(a) * tz, s.tw * 0.62)];
  }
  rebuild(s) {
    this.clearGeo(); this.key = s.key;
    const P = padAt(this.w), root = this.group = new THREE.Group(); root.name = 'launchStand';
    root.position.set(P.x, 0, P.z); root.rotation.y = -TRENCH.ang;   // local +x along the flame trench, tower at local -z (where the old tower stood)
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e959c, metalness: 0.55, roughness: 0.5 });
    const mountMat = new THREE.MeshStandardMaterial({ color: 0x5e6266, metalness: 0.35, roughness: 0.75 });
    const armMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.4, roughness: 0.55 });
    this.mats = [steel, mountMat, armMat];
    // ---- launch mount: thick ring (base skirt sits on it, engines hang through), six splayed legs clear of the trench, hold-downs ----
    const m = [], th = Math.min(2.2, 0.8 + s.R * 0.25), y1 = s.mountH, y0 = y1 - th;
    m.push(new THREE.LatheGeometry([V(s.rin, y0), V(s.rout, y0), V(s.rout, y1), V(s.rin, y1), V(s.rin, y0)].map(v => new THREE.Vector2(v.x, v.y)), 48));
    const foot = Math.max(s.rout + 1.2, 7.6), lt = 0.7 + s.R * 0.08, legA = [Math.PI / 6, Math.PI / 2, 5 * Math.PI / 6, 7 * Math.PI / 6, 3 * Math.PI / 2, 11 * Math.PI / 6];
    const top = a => V(Math.cos(a) * (s.rout - lt), y0, Math.sin(a) * (s.rout - lt)), bot = a => V(Math.cos(a) * foot, 0, Math.sin(a) * foot);
    legA.forEach((a, i) => {
      beam(m, bot(a), top(a), lt, lt); box(m, lt * 2.2, 0.6, lt * 2.2, Math.cos(a) * foot, 0.3, Math.sin(a) * foot, -a);
      const b = legA[(i + 1) % 6], mid = t => bot(a).lerp(top(a), t), midB = t => bot(b).lerp(top(b), t);
      beam(m, mid(0.45), midB(0.45), lt * 0.5); beam(m, mid(0.1), midB(0.8), lt * 0.35);   // ring brace + diagonal
    });
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; box(m, 0.7, 1.2, 0.9, Math.cos(a) * (s.R + 0.45), y1 + 0.6, Math.sin(a) * (s.R + 0.45), -a); }
    root.add(new THREE.Mesh(merged(m), mountMat));
    // ---- integration tower: square lattice, X-braced bays, platform and mast on top ----
    const t = [], tw = s.tw, hw = tw / 2, cz = -(s.face + hw), H = s.towerH, bay = tw * 0.75, ct = 0.35 + tw * 0.04;
    const cor = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]].map(([x, z]) => [x, z + cz]);
    for (const [x, z] of cor) beam(t, V(x, 0, z), V(x, H, z), ct);
    for (let y = 0; y < H - 0.1; y += bay) {
      const yb = Math.min(H, y + bay);
      for (let i = 0; i < 4; i++) {
        const [xa, za] = cor[i], [xb, zb] = cor[(i + 1) % 4];
        beam(t, V(xa, yb, za), V(xb, yb, zb), ct * 0.7); beam(t, V(xa, y, za), V(xb, yb, zb), ct * 0.45); beam(t, V(xb, y, zb), V(xa, yb, za), ct * 0.45);
      }
    }
    box(t, tw + 2, 0.4, tw + 2, 0, H, cz); beam(t, V(0, H, cz), V(0, H + Math.max(6, H * 0.08), cz), 0.3);   // roof platform + lightning mast
    root.add(new THREE.Mesh(merged(t), steel));
    // ---- swing arms (one merged mesh; all pivot on the tower face centre line, so one rotation swings them clear) ----
    const a = [], arms = this.arms = new THREE.Group(); arms.position.set(hw * 0.6, 0, -s.face); root.add(arms);
    for (const { y, r } of s.arms) {
      const reach = s.face - r - 0.5, wd = 1.0, ah = 2.2;   // arm runs along local +z from the tower face to 0.5 m off the skin
      for (const sx of [-wd, wd]) for (const yy of [y, y + ah]) beam(a, V(sx - hw * 0.6, yy, 0), V(sx - hw * 0.6, yy, reach), 0.22);
      for (let z = 0; z <= reach + 0.01; z += reach / Math.max(2, Math.round(reach / 2))) for (const sx of [-wd, wd]) beam(a, V(sx - hw * 0.6, y, z), V(sx - hw * 0.6, y + ah, z), 0.16);
      box(a, wd * 2 + 0.3, 0.15, reach, -hw * 0.6, y + 0.05, reach / 2);   // walkway floor
      box(a, wd * 2 + 0.6, ah + 0.4, 0.5, -hw * 0.6, y + ah / 2, reach);    // white room / umbilical plate at the rocket end
    }
    if (a.length) arms.add(new THREE.Mesh(merged(a), armMat));
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.w.scene.add(root);
    // the seat sits on the ring (build view); layout y 0 of the rocket = nozzle exit
    if (!this.seat.parent) this.w.scene.add(this.seat);
    this.seat.position.set(P.x, s.baseY - DECK, P.z); this.seat.visible = true;
  }
  clearGeo() {
    if (!this.group) return;
    this.group.removeFromParent(); this.group.traverse(o => o.geometry?.dispose()); for (const m of this.mats || []) m.dispose();
    this.group = this.arms = null; this.mats = null; this.key = '';
  }
  release() {
    if (!this.active && !this.group) return;
    this.active = false; this.size = null; this.clearGeo(); this.seat.removeFromParent();
    if (this.w.pad?.tower) this.w.pad.tower.visible = true;
  }
}
// one controller per world (no geometry until the stand is first used)
export const launchStandFor = w => (w.launchStand ??= new LaunchStand(w));
