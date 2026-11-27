// Drivable overhead crane (Poly Haven CC0 overhead_crane, split into bridge / trolley / hook):
// the bridge rolls along runway beams, the trolley along the bridge, the hook hoists on cables and
// swings like a pendulum. Hook up a spare tank, a crate pallet or a barrel pallet and set it down.
import * as THREE from 'three';
import { pieces } from './models.js';
import { partMesh } from './parts3d.js';
import { HANGAR, IS_TOUCH } from './env.js';
import { hitBox, labelTex, hazardTex } from './interactive.js';
import { prop } from './models.js';

const S = 1.6, H = HANGAR;
const Y0 = 21.96;                         // crane root height (the old static crane's hook bottom stayed at ~15.7 m)
const ATTACH = -1.35 * S;                 // cable anchor under the trolley (model space × scale)
const LIM = { x: [-8.2, 8.2], z: [-11.5, 10] };
const clamp = THREE.MathUtils.clamp;

// split one geometry by triangle centroid height: returns { above, below } (cable band discarded)
function splitY(geo, hi, lo) {
  const g = geo.index ? geo.toNonIndexed() : geo, pos = g.attributes.position, n = pos.count / 3;
  const keys = Object.keys(g.attributes), out = { above: [], below: [] };
  for (let t = 0; t < n; t++) {
    const cy = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3;
    const b = cy > hi ? 'above' : cy < lo ? 'below' : null; if (b) out[b].push(t);
  }
  const mk = list => { if (!list.length) return null; const r = new THREE.BufferGeometry(); for (const k of keys) { const a = g.attributes[k], s = a.itemSize, arr = new Float32Array(list.length * 3 * s); list.forEach((t, i) => { for (let v = 0; v < 3; v++) for (let c = 0; c < s; c++) arr[(i * 3 + v) * s + c] = a.array[(t * 3 + v) * s + c]; }); r.setAttribute(k, new THREE.BufferAttribute(arr, s)); } r.computeBoundingSphere(); r.computeBoundingBox(); return r; };
  return { above: mk(out.above), below: mk(out.below) };
}

export class Crane {
  constructor(ix) {
    this.ix = ix; this.g = ix.g; this.ready = false;
    this.x = 0; this.z = 7; this.L = 3.2; this.vx = 0; this.vz = 0; this.vL = 0;
    this.sw = { x: 0, z: 0, vx: 0, vz: 0 }; this.loadObj = null; this.liftables = [];
    this.orbit = { yaw: 0.5, pitch: 0.42, dist: 13 }; this.held = {}; this.look = new THREE.Vector3(0, 8, 7);
  }
  async load() {
    const ix = this.ix, opt = { keepOrigin: true, scale: S };
    const [rails, bridge, winch] = await Promise.all(['overhead_crane_rails', 'overhead_crane', 'overhead_crane_winch'].map(n => pieces('overhead_crane', x => x === n, opt)));
    const root = this.root = new THREE.Group(); root.name = 'crane'; root.position.y = Y0; ix.group.add(root);
    const bg = this.bridgeG = new THREE.Group(); root.add(bg);
    const mesh = (p, parent) => { const m = new THREE.Mesh(p.geometry, p.material.clone()); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    const bridgeMeshes = [...rails, ...bridge].map(p => mesh(p, bg));
    const tg = this.trolley = new THREE.Group(); bg.add(tg);
    // winch: body stays on the trolley, the hook block hangs on code cables
    const hookParts = []; let hb = new THREE.Box3();
    for (const p of winch) {
      const { above, below } = splitY(p.geometry, -1.32 * S, -2.5 * S);
      if (above) mesh({ geometry: above, material: p.material }, tg);
      if (below) { below.computeBoundingBox(); hb.union(below.boundingBox); hookParts.push({ geometry: below, material: p.material }); }
    }
    const hc = hb.isEmpty() ? new THREE.Vector3(-0.47 * S, -2.5 * S, 0) : new THREE.Vector3((hb.min.x + hb.max.x) / 2, hb.max.y, (hb.min.z + hb.max.z) / 2);
    this.hookH = hb.isEmpty() ? 2.2 : hb.max.y - hb.min.y;
    const swing = this.swing = new THREE.Group(); swing.position.set(hc.x, ATTACH, hc.z); tg.add(swing);
    const hook = this.hook = new THREE.Group(); swing.add(hook);
    for (const p of hookParts) { p.geometry.translate(-hc.x, -hc.y, -hc.z); mesh(p, hook); }
    const cableM = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 });
    this.cables = [-0.07, 0.07].map(dx => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 6), cableM); c.position.x = dx; swing.add(c); return c; });
    // runway beams + hangers to the roof trusses
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.55, roughness: 0.42 });
    const top = Y0 - 0.77 * S, yB = H.h - 3.8;
    for (const sx of [-1, 1]) {
      const x = sx * 6.25 * S, len = 27;
      for (const [w, h, y] of [[0.5, 0.06, top - 0.03], [0.05, 0.6, top - 0.36], [0.5, 0.06, top - 0.69]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), steel); b.position.set(x, y, -0.8); b.castShadow = true; root.parent.add(b); }
      for (let i = 0; i < 7; i++) { const zz = -H.z + (i + 0.5) * (H.z * 2 / 7); if (Math.abs(zz + 0.8) > len / 2) continue; const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, yB - top, 6), steel); r.position.set(x, (yB + top) / 2, zz); root.parent.add(r); }
    }
    // control pendant hanging off the bridge
    const pend = this.pendant = new THREE.Group(); bg.add(pend);
    const px = 7.2, pTop = -2.03 * S, pY = 1.45 - Y0;
    const pc = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, pTop - pY, 5), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })); pc.position.set(px, (pTop + pY) / 2, 0.55); pend.add(pc);
    const pb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.09), new THREE.MeshStandardMaterial({ color: 0xe0a816, roughness: 0.5 })); pb.position.set(px, pY - 0.1, 0.55); pb.castShadow = true; pend.add(pb);
    const bm = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 });
    [[0x1d7a3a, 0.06], [0xc81e14, -0.04], [0x2a2f36, -0.14]].forEach(([c, y]) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), bm(c)); b.rotation.x = Math.PI / 2; b.position.set(px, pY - 0.1 + y, 0.6); pend.add(b); });
    const label = () => 'Drive the overhead crane';
    const ph = hitBox(1.1, 1.6, 1.1); ph.position.set(px, pY, 0.55); pend.add(ph);
    ix.add({ hit: ph, glow: [pb], range: 5, label, use: () => this.take() });
    const bh = hitBox(12.6 * S, 2.6 * S, 2.2 * S); bh.position.set(0, -0.4 * S, 1.0 * S); bg.add(bh);
    ix.add({ hit: bh, glow: bridgeMeshes, range: 45, label, use: () => this.take() });
    await this.makeLiftables();
    this.place(); this.ready = true;
  }
  async makeLiftables() {
    const ix = this.ix, steel = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.7, roughness: 0.45 });
    const sling = new THREE.MeshStandardMaterial({ color: 0xe0a816, roughness: 0.7 });
    const lugM = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.95, roughness: 0.25 });
    const add = (obj, x, z, lugY, r, name) => {
      const g = new THREE.Group(); g.add(obj); g.position.set(x, 0, z); ix.group.add(g);
      const lug = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 18), lugM); lug.position.y = lugY; g.add(lug);
      const L = { g, lugY, r, name, h: lugY + 0.12, vy: 0, held: false };
      // 4-leg sling from the lug down to the load's corners
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = new THREE.Vector3(0, lugY - 0.1, 0), b = new THREE.Vector3(sx * r * 0.55, lugY * 0.55, sz * r * 0.45), d = b.clone().sub(a);
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, d.length(), 4), sling); s.position.copy(a).addScaledVector(d, 0.5); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(s);
      }
      this.liftables.push(L); return L;
    };
    // a spare fuel tank lying on saddles
    try {
      const t = partMesh('tank_short'), grp = new THREE.Group(); const box = new THREE.Box3().setFromObject(t), len = box.max.y - box.min.y;
      t.rotation.z = Math.PI / 2; t.position.set((box.max.y + box.min.y) / 2, 1.2, 0); grp.add(t);
      for (const dx of [-len * 0.32, len * 0.32]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 1.7), steel); c.position.set(dx, 0.15, 0); c.castShadow = true; grp.add(c); }
      add(grp, 5.5, -10, 2.45, Math.max(1.8, len / 2 + 0.2), 'spare tank');
    } catch (e) { console.warn('crane tank', e.message); }
    // a pallet of plastic crates and a pallet of barrels
    const pallet = () => { const p = new THREE.Group(); const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.1), new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.6 })); top.material.map.repeat.set(2, 1); top.position.y = 0.06; top.castShadow = top.receiveShadow = true; p.add(top); return p; };
    const crate = await prop('plastic_crate_02').catch(() => null);
    if (crate) { const p = pallet(); for (const [x, y, z] of [[-0.3, 0.12, -0.23], [0.3, 0.12, -0.23], [-0.3, 0.12, 0.23], [0.3, 0.12, 0.23], [0, 0.37, 0]]) { const c = crate.clone(); c.position.set(x, y, z); c.rotation.y = z > 0 ? Math.PI : 0; p.add(c); } add(p, -3.5, -10.8, 1.55, 0.8, 'crate pallet'); }
    const barrel = await prop('barrel_03').catch(() => null);
    if (barrel) { const p = pallet(); for (const [x, z] of [[-0.3, -0.25], [0.32, -0.24], [0, 0.28]]) { const c = barrel.clone(); c.scale.setScalar(0.85); c.position.set(x, 0.12, z); p.add(c); } add(p, -2.8, 11.6, 1.75, 0.8, 'barrel pallet'); }
  }
  take() { if (!this.ready) return; this.ix.take(this); this.ix.sfx.click(); this.g.toast(IS_TOUCH ? 'Crane: use the arrows, ▲▼ to hoist, Grab to hook a load.' : this.g.input.lastDevice === 'pad' ? 'Crane: left stick move · RT/LT hoist · Ⓐ grab · Ⓑ done' : 'Crane: WASD move · Q/E hoist · Space grab · Esc done', 3800); }
  onTake() { this.panel().style.display = 'flex'; const P = this.g.build.player; this.orbit.yaw = Math.atan2(P.x - this.x, P.z - this.z); this.motor = this.ix.sfx.loop('motor'); }
  onRelease() { this.panel().style.display = 'none'; this.held = {}; this.motor?.stop(); this.motor = null; this.panelEl?.querySelectorAll('.held').forEach(b => b.classList.remove('held')); }
  panel() {
    if (this.panelEl) return this.panelEl;
    const d = this.panelEl = document.createElement('div'); d.className = 'ixPanel'; d.style.cssText = 'left:50%;bottom:18px;transform:translateX(-50%);flex-wrap:wrap;justify-content:center;max-width:96vw';
    const tip = this.g.input.lastDevice === 'pad' ? 'LS move · RT/LT hoist · Ⓐ grab · Ⓑ done' : 'WASD move · Q/E hoist · Space grab · drag to look · Esc done';
    d.innerHTML = `<button data-k="l">◀</button><button data-k="f">▲</button><button data-k="b">▼</button><button data-k="r">▶</button><span style="width:14px"></span><button data-k="up">Hoist ▲</button><button data-k="down">Hoist ▼</button><button data-c="grab" style="min-width:84px">Grab</button><button data-c="exit">Done</button>${IS_TOUCH ? '' : `<span class="tip">${tip}</span>`}`;
    d.querySelectorAll('[data-k]').forEach(b => { const k = b.dataset.k; const on = e => { e.preventDefault(); this.held[k] = true; b.classList.add('held'); this.g.audio.unlock(); }; const off = () => { this.held[k] = false; b.classList.remove('held'); }; b.addEventListener('pointerdown', on); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off); });
    d.querySelector('[data-c=grab]').addEventListener('click', () => this.grab());
    d.querySelector('[data-c=exit]').addEventListener('click', () => this.ix.release());
    document.body.appendChild(d); this.grabBtn = d.querySelector('[data-c=grab]'); return d;
  }
  hookBottom(v = new THREE.Vector3()) { this.hook.updateWorldMatrix(true, false); return this.hook.localToWorld(v.set(0, -this.hookH, 0)); }
  grab() {
    const sfx = this.ix.sfx;
    if (this.loadObj) {
      const L = this.loadObj, p = L.g.position;
      if (Math.hypot(p.x, p.z) < H.pitR + 1 + L.r) { this.g.toast('Not over the stand pit: move it clear first.'); this.g.audio.bad(); return; }
      L.held = false; L.vy = 0; this.loadObj = null; sfx.clunk(0.4); this.g.toast(`Released the ${L.name}.`, 1400); return;
    }
    const hb = this.hookBottom();
    let best = null, bd = 1.6;
    for (const L of this.liftables) { const lp = L.g.position, d = Math.hypot(hb.x - lp.x, hb.z - lp.z), dy = Math.abs(hb.y - (lp.y + L.lugY)); if (d < bd && dy < 1.4) { bd = d; best = L; } }
    if (!best) { this.g.toast('Lower the hook onto a lifting ring (yellow slings) to grab.', 2200); this.g.audio.bad(); return; }
    best.held = true; this.loadObj = best; sfx.lever(); this.g.toast(`Hooked the ${best.name}. Hoist it up!`, 1600);
  }
  control(dt) {
    const inp = this.g.input, k = c => inp.down(c) ? 1 : 0, h = this.held, pb = inp.pad?.b || [];
    // camera-relative drive: forward = away from the camera on the floor plane
    const fx = -Math.sin(this.orbit.yaw), fz = -Math.cos(this.orbit.yaw), rx = -fz, rz = fx;
    let mx = inp.move.x + (h.r ? 1 : 0) - (h.l ? 1 : 0) + k('ArrowRight') - k('ArrowLeft'), my = inp.move.y + (h.b ? 1 : 0) - (h.f ? 1 : 0) + k('ArrowDown') - k('ArrowUp');
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    const wx = fx * -my + rx * mx, wz = fz * -my + rz * mx;
    const hoist = (k('KeyE') + k('KeyF') + k('PageDown') + (h.down ? 1 : 0) + (pb[6] || 0)) - (k('KeyQ') + k('KeyR') + k('PageUp') + (h.up ? 1 : 0) + (pb[7] || 0));
    this.cmd = { vx: wx * 3.4, vz: wz * 3.4, vL: clamp(hoist, -1, 1) * 1.9 };
    if (inp.hit('Space') || inp.hit('Pad0') || inp.hit('Enter')) this.grab();
    if (inp.hit('Pad1') || inp.hit('KeyX')) { this.ix.release(); return; }
    inp.mouse.clicked = false; inp.taps.length = 0;
    this.orbit.yaw -= inp.look.x; this.orbit.pitch = clamp(this.orbit.pitch + inp.look.y, 0.05, 1.25);
    this.orbit.dist = clamp(this.orbit.dist * Math.exp(inp.zoom * 0.12), 5, 32);
    if (this.grabBtn) { const t = this.loadObj ? 'Release' : 'Grab'; if (this.grabBtn.textContent !== t) this.grabBtn.textContent = t; }
  }
  camPose() {
    const hb = this.hookBottom(new THREE.Vector3()); this.look.lerp(hb.setY(Math.max(1.5, hb.y)), 0.12);
    const o = this.orbit, c = Math.cos(o.pitch);
    const pos = new THREE.Vector3(this.look.x + Math.sin(o.yaw) * c * o.dist, this.look.y + Math.sin(o.pitch) * o.dist, this.look.z + Math.cos(o.yaw) * c * o.dist);
    pos.x = clamp(pos.x, -H.x + 1, H.x - 1); pos.z = clamp(pos.z, -H.z + 1, H.z - 1); pos.y = clamp(pos.y, 1.2, H.h - 5);
    return { pos, look: this.look };
  }
  place() {
    this.bridgeG.position.z = this.z - 1.045 * S; this.trolley.position.x = this.x;
    this.hook.position.y = -this.L;
    for (const c of this.cables) { c.scale.y = this.L; c.position.y = -this.L / 2; }
    this.swing.rotation.set(-this.sw.z, 0, this.sw.x);
  }
  update(dt, controlling) {
    if (!this.ready) return;
    const c = controlling && this.cmd ? this.cmd : { vx: 0, vz: 0, vL: 0 }; if (!controlling) this.cmd = null;
    const acc = (v, t, a) => v + clamp(t - v, -a * dt, a * dt);
    const ovx = this.vx, ovz = this.vz;
    this.vx = acc(this.vx, c.vx, 2.6); this.vz = acc(this.vz, c.vz, 2.6); this.vL = acc(this.vL, c.vL, 3.5);
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    this.x = clamp(nx, ...LIM.x); this.z = clamp(nz, ...LIM.z);
    if (this.x !== nx) { if (Math.abs(this.vx) > 0.8) this.ix.sfx.clunk(0.35); this.vx = 0; }
    if (this.z !== nz) { if (Math.abs(this.vz) > 0.8) this.ix.sfx.clunk(0.35); this.vz = 0; }
    // hoist limits: under the trolley, above the floor (or the load's height)
    const anchorY = Y0 + ATTACH, maxL = anchorY - this.hookH - 0.15 - (this.loadObj ? this.loadObj.h - 0.05 : 0);
    const nL = this.L + this.vL * dt; this.L = clamp(nL, 1.0, maxL); if (this.L !== nL) this.vL = 0;
    // pendulum sway from trolley / bridge acceleration
    const Lc = this.L + this.hookH * 0.5 + (this.loadObj ? 1.2 : 0), ax = (this.vx - ovx) / Math.max(dt, 1e-4), az = (this.vz - ovz) / Math.max(dt, 1e-4);
    for (const [a, v, A] of [['x', 'vx', ax], ['z', 'vz', az]]) { const s = this.sw; s[v] += (-(9.81 / Lc) * s[a] - A / Lc - 0.6 * s[v]) * dt; s[a] = clamp(s[a] + s[v] * dt, -0.35, 0.35); }
    this.place();
    if (this.motor) { const sp = Math.min(1, (Math.abs(this.vx) + Math.abs(this.vz)) / 3.4 + Math.abs(this.vL) / 1.9); this.motor.set(sp); this.motor.pitch?.(0.8 + 0.5 * sp); }
    // loads: carried ones hang under the hook, dropped ones fall and settle
    const hb = this.loadObj ? this.hookBottom() : null;
    for (const L of this.liftables) {
      const p = L.g.position;
      if (L.held && hb) { p.set(hb.x, hb.y - L.lugY - 0.05, hb.z); L.g.rotation.z = this.sw.x * 0.5; L.g.rotation.x = -this.sw.z * 0.5; continue; }
      L.g.rotation.x *= 0.9; L.g.rotation.z *= 0.9;
      let ground = 0; for (const o of this.liftables) if (o !== L && !o.held && Math.hypot(o.g.position.x - p.x, o.g.position.z - p.z) < (o.r + L.r) * 0.7) ground = Math.max(ground, o.g.position.y + o.h - 0.15);
      if (p.y > ground + 1e-3 || L.vy) {
        L.vy -= 9.81 * dt; p.y += L.vy * dt;
        if (p.y <= ground) { p.y = ground; const imp = -L.vy; if (imp > 1.2) { this.ix.sfx.clunk(Math.min(1.3, imp / 5)); L.vy = imp * 0.18; } else L.vy = 0; }
      }
    }
  }
}
