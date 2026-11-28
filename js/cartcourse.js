// Golf-cart playground on the apron: a steel tabletop jump, a kicker ramp, a cone slalom, and loose
// crates / barrels / cones that get knocked around by the cart, the player's boots and flying robot parts.
// Builds the ramps (their height profiles live in ground.js) and steps every loose rigid body.
import * as THREE from 'three';
import { height } from './terrain.js';
import { RAMPS, groundAt, onRamp as onRampAt } from './ground.js';
import { applyPBR } from './tex.js';
import { prop } from './models.js';
import { Body, bodyPair, SampleBank } from './bodies.js';
import { playerFrame } from './collide.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const CART_PARK = { x: -15.5, z: -22.5, yaw: Math.PI };

export class Course {
  constructor(game) {
    this.g = game; this.w = game.world;
    this.group = new THREE.Group(); this.group.name = 'cartCourse'; this.w.scene.add(this.group);
    this.bodies = []; this.sounds = new SampleBank(game.audio);
    this.buildRamps(); this.buildCones();
  }
  async load() {
    const lite = this.w.quality === 'phone' || this.w.quality === 'low';
    const jobs = [
      prop('plastic_crate_02').then(o => { for (const [x, z, ry] of [[-30.5, -40, 0.1], [-29.8, -41.3, 0.5], [-31.4, -41.6, 1.2], [-30.6, -43, 2.0], [-29.5, -44.4, 0.3]]) this.addLoose(o.clone(), o.userData.size, x, z, ry, 4.5, 'crate'); }),
      prop('Barrel_01').then(o => { for (const [x, z] of (lite ? [[-35, -62], [-35.9, -63.1]] : [[-35, -62], [-35.9, -63.1], [-34.2, -63.4], [-35.2, -64.4]])) this.addLoose(o.clone(), o.userData.size, x, z, Math.random() * 6, 18, 'barrel'); }),
    ];
    await Promise.all(jobs.map(j => j.catch(e => console.warn('course', e?.message || e))));
  }
  addLoose(obj, size, x, z, ry, m, kind) {
    const pivot = new THREE.Group(); obj.position.y = -size.y / 2; pivot.add(obj);
    pivot.position.set(x, height(x, z) + size.y / 2 + 0.002, z); pivot.rotation.y = ry; this.group.add(pivot);
    const b = new Body(pivot, { half: V3(size.x / 2, size.y / 2, size.z / 2), m, kind, e: kind === 'barrel' ? 0.35 : 0.3, mu: kind === 'cone' ? 0.5 : 0.65 });
    b.sleep = true; this.bodies.push(b); return b;
  }

  // ---------- ground: terrain plus ramp profiles ----------
  h(x, z) { return groundAt(x, z); }   // terrain plus ramp profiles (ground.js, shared with walkers)
  n(x, z, out) { const e = 0.08, hx = this.h(x + e, z) - this.h(x - e, z), hz = this.h(x, z + e) - this.h(x, z - e); return out.set(-hx, 2 * e, -hz).normalize(); }
  onRamp(x, z) { return onRampAt(x, z); }

  buildRamps() {
    const top = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.85, roughness: 0.42 });
    applyPBR(top, 'diamond_plate', [1, 1], { metal: true, normalScale: 0.9 }).then(m => { for (const t of [m.map, m.roughnessMap, m.normalMap, m.aoMap, m.metalnessMap]) if (t) t.repeat.set(0.45, 0.45); }).catch(() => {});
    const side = new THREE.MeshStandardMaterial({ color: 0x2b2f34, metalness: 0.6, roughness: 0.5 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe0a816, roughness: 0.5, metalness: 0.1 });
    for (const r of RAMPS) {
      const sh = new THREE.Shape(), N = 40;
      sh.moveTo(r.u0, 0);
      for (let i = 0; i <= N; i++) { const u = r.u0 + (r.u1 - r.u0) * i / N; sh.lineTo(u, Math.max(0.012, r.prof(u))); }
      sh.lineTo(r.u1, 0); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: r.hw * 2, bevelEnabled: false, steps: 1, curveSegments: 4 });
      g.rotateY(-Math.PI / 2); g.translate(r.hw, 0, 0);   // shape x -> local +z (along), extrusion -> local -x
      const m = new THREE.Mesh(g, [side, top]); m.castShadow = m.receiveShadow = true;
      const grp = new THREE.Group(); grp.position.set(r.x, 0, r.z); grp.rotation.y = r.yaw; grp.add(m);
      // yellow lip stripe at the take-off edge and painted guide bars along the sides
      for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, r.u1 - r.u0), stripe); b.position.set(s * (r.hw - 0.04), 0.03, (r.u0 + r.u1) / 2); grp.add(b); }
      this.group.add(grp);
    }
  }
  buildCones() {
    const prof = [[0.0, 0], [0.19, 0], [0.19, 0.035], [0.155, 0.04], [0.04, 0.7], [0.0, 0.705]];
    const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    const base = new THREE.BoxGeometry(0.38, 0.035, 0.38); base.translate(0, 0.0175, 0);
    const parts = [lathe.toNonIndexed(), base.toNonIndexed()];
    const col = (g, f) => { const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = f(p.getY(i), p.getX(i), p.getZ(i)); c.set(k, i * 3); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); };
    const orange = [1.0, 0.24, 0.02], white = [0.92, 0.92, 0.9], black = [0.03, 0.03, 0.035];
    col(parts[0], y => y < 0.04 ? black : ((y > 0.36 && y < 0.45) || (y > 0.53 && y < 0.59)) ? white : orange);
    col(parts[1], () => black);
    for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    const geo = mergeTwo(parts); geo.translate(0, -0.3525, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
    const spots = [];
    for (let i = 0; i < 8; i++) spots.push([-22 + (i % 2 ? 0.0 : 0.0), -30 - i * 6.5]);
    spots.push([-25, -25], [-19, -25], [-47.6, -58.5], [-44.4, -58.5], [-47.4, -101], [-44.6, -101]);
    for (const [x, z] of spots) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      const b = this.addLoose(m, V3(0.38, 0.705, 0.38), x, z, 0, 2.6, 'cone');
      b.obj.children[0].position.y = 0;   // geometry is already centred
    }
  }

  // ---------- per frame ----------
  obstacles() { return playerFrame(this.g); }
  update(dt, obs) {
    const steps = Math.min(5, Math.ceil(dt / (1 / 120))), h = dt / steps;
    const live = this.bodies.filter(b => !b.sleep && !b.frozen);
    if (live.length) {
      const near = b => obs.filter(o => Math.abs(o.x - b.p.x) < (o.r || o.hx || 1) + b.reach + 1 && Math.abs(o.z - b.p.z) < (o.r || o.hz || 1) + b.reach + 1);
      const lists = live.map(near);
      for (let s = 0; s < steps; s++) live.forEach((b, i) => b.step(h, this, lists[i]));
      // keep anything that escaped the fence or fell through inside the site
      for (const b of live) if (b.p.y < -5) { b.p.y = 1; b.v.set(0, 0, 0); }
    }
    const bs = this.bodies;
    for (let i = 0; i < bs.length; i++) { if (bs[i].sleep && bs[i].frozen) continue; for (let j = i + 1; j < bs.length; j++) if (!(bs[i].sleep && bs[j].sleep)) bodyPair(bs[i], bs[j]); }
    // impact sounds
    const cam = this.w.camera.position;
    for (const b of bs) {
      if (b.bang > 1.1) {
        const d = cam.distanceTo(b.p), near = clamp(1.4 - d / 35, 0, 1), v = clamp((b.bang - 1) / 7, 0.05, 1) * near;
        if (v > 0.03) {
          if (b.kind === 'cone') { this.sounds.play(['plate_m_0', 'plate_m_1'], v * 0.35, 1.7, 0.08) || this.g.audio.tone(620, 0.06, 'triangle', 0.05 * v, 0.1); }
          else if (b.kind === 'crate') { this.sounds.play(['thud_0'], v * 0.7, 1.25, 0.12) || this.g.audio.noise(0.08, 500, 1, 0.2 * v, 0, 'lowpass'); }
          else if (b.kind === 'barrel') this.sounds.play(['metal_m_0', 'metal_m_1', 'metal_m_3'], v * 0.7, 0.8, 0.25);
          else this.sounds.play(['metal_h_0', 'metal_h_1', 'clank_h_0', 'clank_h_1', 'clank_h_2', 'plate_h_0', 'plate_h_1'], v * 0.55, 1.1, 0.2);
        }
      }
      b.bang = 0;
    }
  }
  // walking into loose things nudges them (boots kick cones, shove crates)
  kick(x, z, r, vx, vz) {
    const sp = Math.hypot(vx, vz); if (sp < 0.3) return;
    for (const b of this.bodies) {
      if (b.frozen || b.p.y - b.half.y > 0.6) continue;
      const dx = b.p.x - x, dz = b.p.z - z, need = b.r + r; if (Math.abs(dx) > need || Math.abs(dz) > need) continue;
      const d = Math.hypot(dx, dz); if (d >= need || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, push = Math.max(0, vx * nx + vz * nz);
      b.wake(); b.p.x += nx * (need - d); b.p.z += nz * (need - d);
      const k = clamp(9 / b.m, 0.25, 1.6);
      b.v.x += nx * push * k; b.v.z += nz * push * k; b.v.y += push * 0.4 * k;
      b.w.x += nz * push * k * 2.5; b.w.z -= nx * push * k * 2.5;
    }
  }
}

function mergeTwo(gs) {
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color']) {
    const n = gs[0].attributes[k].itemSize, len = gs.reduce((s, g) => s + g.attributes[k].array.length, 0), arr = new Float32Array(len);
    let o = 0; for (const g of gs) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, n));
  }
  return out;
}
