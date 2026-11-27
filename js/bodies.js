// Tiny rigid-body helper for knock-around things (cones, crates, barrels, robot pieces) and a CC0 sample bank.
// Each body is a box with 8 contact corners: gravity, bounce + Coulomb friction on the ground height field,
// 2D pushes off the walking-collision shapes (walls, props), and sleep once it has settled. Cheap and stable.
import * as THREE from 'three';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _p = V3(), _r = V3(), _t = V3(), _t2 = V3(), _n = V3(), _vel = V3(), _J = V3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Penetration of a circle (x, z, r) into a collide.js obstacle. Normal points out of the obstacle.
export function pen(x, z, r, o) {
  if (o.t === 'c') {
    const dx = x - o.x, dz = z - o.z, need = o.r + r;
    if (Math.abs(dx) > need || Math.abs(dz) > need) return null;
    const d = Math.hypot(dx, dz); if (d >= need) return null;
    return d < 1e-6 ? { nx: 1, nz: 0, d: need } : { nx: dx / d, nz: dz / d, d: need - d };
  }
  if (Math.abs(x - o.x) > o.hx + r || Math.abs(z - o.z) > o.hz + r) return null;
  const cx = clamp(x, o.x - o.hx, o.x + o.hx), cz = clamp(z, o.z - o.hz, o.z + o.hz);
  const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
  if (d2 > 1e-10) { if (d2 >= r * r) return null; const d = Math.sqrt(d2); return { nx: dx / d, nz: dz / d, d: r - d }; }
  const px = x - o.x, pz = z - o.z, ox = o.hx + r - Math.abs(px), oz = o.hz + r - Math.abs(pz);
  return ox < oz ? { nx: Math.sign(px) || 1, nz: 0, d: ox } : { nx: 0, nz: Math.sign(pz) || 1, d: oz };
}

export class Body {
  // obj: Object3D whose origin is the box centre. half: half extents. m: kg.
  constructor(obj, { half, m = 5, e = 0.3, mu = 0.6, kind = 'prop' }) {
    this.obj = obj; this.p = obj.position; this.q = obj.quaternion; this.v = V3(); this.w = V3();
    this.half = half.clone(); this.m = m; this.e = e; this.mu = mu; this.kind = kind;
    const X = half.x * 2, Y = half.y * 2, Z = half.z * 2;
    this.invI = V3(12 / (m * (Y * Y + Z * Z)), 12 / (m * (X * X + Z * Z)), 12 / (m * (X * X + Y * Y)));
    this.r = Math.max(0.08, Math.min(Math.hypot(half.x, half.z), Math.max(half.x, half.y, half.z)) * 0.8);
    this.reach = half.length();
    this.corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.corners.push(V3(sx * half.x, sy * half.y, sz * half.z));
    this.sleep = false; this.still = 0; this.bang = 0; this.frozen = false; this.touch = false;
  }
  wake() { this.sleep = false; this.still = 0; }
  invIw(vec) { _qi.copy(this.q).invert(); vec.applyQuaternion(_qi).multiply(this.invI).applyQuaternion(this.q); return vec; }
  velAt(pt, out) { _r.subVectors(pt, this.p); return out.crossVectors(this.w, _r).add(this.v); }
  impulse(J, pt) { this.v.addScaledVector(J, 1 / this.m); _r.subVectors(pt, this.p); _t.crossVectors(_r, J); this.w.add(this.invIw(_t)); }
  // effective inverse mass along n at pt
  kAt(pt, n) { _r.subVectors(pt, this.p); _t.crossVectors(_r, n); this.invIw(_t); return 1 / this.m + _t2.crossVectors(_t, _r).dot(n); }
  step(dt, ground, obs) {
    if (this.sleep || this.frozen) return;
    this.v.y -= 9.81 * dt; this.p.addScaledVector(this.v, dt);
    const wl = this.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_t.copy(this.w).divideScalar(wl), wl * dt); this.q.premultiply(_q).normalize(); }
    let deep = 0; this.touch = false;
    for (const c of this.corners) {
      _p.copy(c).applyQuaternion(this.q).add(this.p);
      const d = ground.h(_p.x, _p.z) - _p.y; if (d <= 0) continue;
      this.touch = true; if (d > deep) deep = d;
      const n = ground.n(_p.x, _p.z, _n), vn = this.velAt(_p, _vel).dot(n);
      if (vn >= 0) continue;
      if (-vn > this.bang) this.bang = -vn;
      const k = this.kAt(_p, n), jn = -(1 + (vn < -1.2 ? this.e : 0)) * vn / k;
      this.impulse(_J.copy(n).multiplyScalar(jn), _p);
      this.velAt(_p, _vel); _vel.addScaledVector(n, -_vel.dot(n));
      const vt = _vel.length();
      if (vt > 1e-4) { const jt = Math.min(this.mu * jn, vt / k); this.impulse(_J.copy(_vel).multiplyScalar(-jt / vt), _p); }
    }
    if (deep > 0) this.p.y += deep;
    if (this.touch) { this.v.multiplyScalar(Math.max(0, 1 - 0.8 * dt)); this.w.multiplyScalar(Math.max(0, 1 - 2.2 * dt)); }
    if (obs) for (const o of obs) {
      const h = pen(this.p.x, this.p.z, this.r, o); if (!h) continue;
      this.p.x += h.nx * h.d; this.p.z += h.nz * h.d;
      const vn = this.v.x * h.nx + this.v.z * h.nz;
      if (vn < 0) { if (-vn > this.bang) this.bang = -vn; this.v.x -= 1.35 * vn * h.nx; this.v.z -= 1.35 * vn * h.nz; this.w.multiplyScalar(0.85); }
    }
    if (this.touch && this.v.lengthSq() < 0.012 && this.w.lengthSq() < 0.04) {
      if ((this.still += dt) > 0.45) { this.sleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
    } else this.still = 0;
  }
}

// Push two bodies apart in xz (simple sphere-ish contact); called once per frame for nearby pairs.
export function bodyPair(a, b) {
  const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z, need = a.r + b.r;
  if (Math.abs(dx) > need || Math.abs(dz) > need) return;
  if (Math.abs(a.p.y - b.p.y) > a.half.y + b.half.y) return;
  const d = Math.hypot(dx, dz); if (d >= need || d < 1e-5) return;
  const nx = dx / d, nz = dz / d, over = need - d, ia = a.frozen ? 0 : 1 / a.m, ib = b.frozen ? 0 : 1 / b.m, s = ia + ib; if (!s) return;
  a.p.x -= nx * over * ia / s; a.p.z -= nz * over * ia / s; b.p.x += nx * over * ib / s; b.p.z += nz * over * ib / s;
  const vn = (b.v.x - a.v.x) * nx + (b.v.z - a.v.z) * nz;
  if (vn < 0) { const j = -1.25 * vn / s; a.v.x -= nx * j * ia; a.v.z -= nz * j * ia; b.v.x += nx * j * ib; b.v.z += nz * j * ib; if (-vn > 0.4) { a.wake(); b.wake(); } }
}

// CC0 hit samples already shipped in assets/sfx (Kenney / OpenGameArt, see CREDITS.md), decoded on first use.
const SAMPLE_NAMES = ['thud_0', 'metal_h_0', 'metal_h_1', 'metal_m_0', 'metal_m_1', 'metal_m_3', 'clank_h_0', 'clank_h_1', 'clank_h_2', 'plate_h_0', 'plate_h_1', 'plate_m_0', 'plate_m_1', 'rattle_0', 'rattle_1'];
export class SampleBank {
  constructor(audio) { this.a = audio; this.buf = {}; this.loading = false; }
  ensure() {
    if (this.loading || !this.a.ctx) return; this.loading = true;
    for (const n of SAMPLE_NAMES) fetch(`assets/sfx/${n}.mp3`).then(r => r.arrayBuffer()).then(b => this.a.ctx.decodeAudioData(b)).then(d => { this.buf[n] = d; }).catch(() => {});
  }
  // play one of the named samples (random pick), vol 0..1, rate playback rate, wet reverb send
  play(names, vol = 0.5, rate = 1, wet = 0.15) {
    const A = this.a; if (!A.ctx || !A.sfx) return; this.ensure();
    const list = [].concat(names).filter(n => this.buf[n]); if (!list.length) return false;
    const c = A.ctx, s = c.createBufferSource(); s.buffer = this.buf[list[Math.random() * list.length | 0]];
    s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = c.createGain(); g.gain.value = clamp(vol, 0, 1.2); s.connect(g); g.connect(A.sfx);
    if (wet && A.verb) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(A.verb); }
    s.start(); return true;
  }
}
