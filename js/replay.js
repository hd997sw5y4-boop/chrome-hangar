// Flight replay: a fixed-size ring buffer of the rocket's pose sampled at 20 Hz of sim time (origin, up, engine output, leg fold = 8 floats
// a sample, 12,000 samples = 10 minutes = 384 KB, allocated once) plus a short event list; and a player that flies a fresh copy of the
// rocket mesh along it from a smoothed chase cam. No re-simulation: it only reads the buffer.
import * as THREE from 'three';
import { flameSize } from './fx.js';
import { setLegFold } from './parts3d.js';

const HZ = 20, CAP = HZ * 600, W = 8, MAX_EV = 64;
export class FlightRecorder {
  constructor() { this.buf = new Float32Array(CAP * W); this.ev = []; this.reset(); }
  reset() { this.n = 0; this.head = 0; this.next = 0; this.ev.length = 0; this.t0 = 0; }
  // once per sim step (cheap: a compare until the next 1/20 s of flight time)
  step(f) {
    if (f.phase === 'pad' || f.flightT < this.next) return;
    this.next += 1 / HZ; if (this.next < f.flightT) this.next = f.flightT + 1 / HZ;   // stay on the 20 Hz grid (sim steps are 1/120 s)
    const i = this.head * W, b = this.buf, e = f.e.on ? f.e.thr * f.e.spool : 0;
    b[i] = f.origin.x; b[i + 1] = f.origin.y; b[i + 2] = f.origin.z; b[i + 3] = f.up.x; b[i + 4] = f.up.y; b[i + 5] = f.up.z; b[i + 6] = e; b[i + 7] = f.legOut ?? 1;
    this.head = (this.head + 1) % CAP; if (this.n < CAP) this.n++; else this.t0 += 1 / HZ;   // ring full: the oldest sample drops off
  }
  event(f, text) { if (f.phase !== 'pad' && this.ev.length < MAX_EV) this.ev.push({ t: f.flightT, text }); }
  get duration() { return Math.max(0, (this.n - 1) / HZ); }
  // sample k (0 = oldest kept) -> buffer offset
  off(k) { k = Math.max(0, Math.min(this.n - 1, k)); return ((this.head - this.n + k + CAP) % CAP) * W; }
  // smoothed pose at replay time t (0..duration): Catmull-Rom on position, normalised lerp on up
  pose(t, o, u) {
    const x = t * HZ, k = Math.floor(x), a = x - k, b = this.buf;
    const i0 = this.off(k - 1), i1 = this.off(k), i2 = this.off(k + 1), i3 = this.off(k + 2);
    const cr = (j) => { const p0 = b[i0 + j], p1 = b[i1 + j], p2 = b[i2 + j], p3 = b[i3 + j]; return 0.5 * ((2 * p1) + (-p0 + p2) * a + (2 * p0 - 5 * p1 + 4 * p2 - p3) * a * a + (-p0 + 3 * p1 - 3 * p2 + p3) * a * a * a); };
    o.set(cr(0), cr(1), cr(2)); u.set(b[i1 + 3] + (b[i2 + 3] - b[i1 + 3]) * a, b[i1 + 4] + (b[i2 + 4] - b[i1 + 4]) * a, b[i1 + 5] + (b[i2 + 5] - b[i1 + 5]) * a).normalize();
    this.legs = b[i1 + 7] + (b[i2 + 7] - b[i1 + 7]) * a;
    return b[i1 + 6] + (b[i2 + 6] - b[i1 + 6]) * a;
  }
}

export class ReplayPlayer {
  constructor(game) {
    this.g = game; this.on = false;
    const bar = this.bar = document.createElement('div'); bar.id = 'replayBar'; bar.className = 'hidden';
    bar.innerHTML = '<b>Replay</b><span id="rpT"></span><i><em></em></i><button id="rpSkip" type="button"></button><button id="rpExit" type="button"></button><small id="rpEv"></small>';
    document.getElementById('flightUI').appendChild(bar);
    this.tEl = bar.querySelector('#rpT'); this.fill = bar.querySelector('em'); this.evEl = bar.querySelector('#rpEv');
    bar.querySelector('#rpSkip').onclick = () => this.skip(); bar.querySelector('#rpExit').onclick = () => this.stop();
    this.o = new THREE.Vector3(); this.u = new THREE.Vector3(); this.camP = new THREE.Vector3(); this.camL = new THREE.Vector3(); this.tmp = new THREE.Vector3(); this.want = new THREE.Vector3(); this.upY = new THREE.Vector3(0, 1, 0); this.prevO = new THREE.Vector3(); this.vel = new THREE.Vector3();
  }
  // rec: FlightRecorder, mesh: a fresh rocket group (added here, removed at stop), flame: its flame, L: stack length, onDone: back to results
  start(rec, mesh, flame, L, eng, onDone) {
    if (rec.n < 2) { onDone(); return; }
    this.eng = eng; this.rec = rec; this.mesh = mesh; this.flame = flame; this.L = L; this.onDone = onDone; this.t = 0; this.on = true; this.evI = 0; this.uiT = 1; this.evT = 0;
    this.g.world.scene.add(mesh); rec.pose(0, this.o, this.u); this.prevO.copy(this.o); this.vel.set(0, 0, 0);
    this.camP.copy(this.o).add(this.tmp.set(20, 8, 20)); this.camL.copy(this.o);
    const pad = this.g.input.lastDevice === 'pad', kb = !pad && this.g.input.lastDevice !== 'touch';
    this.bar.querySelector('#rpSkip').innerHTML = 'Skip 5 s' + (pad ? ' <kbd>✕</kbd>' : kb ? ' <kbd>Space</kbd>' : '');
    this.bar.querySelector('#rpExit').innerHTML = 'Exit' + (pad ? ' <kbd>○</kbd>' : kb ? ' <kbd>Esc</kbd>' : '');
    this.evEl.textContent = ''; this.bar.classList.remove('hidden'); this.lf = -1; this.ui(true);
  }
  skip() { if (this.on) { this.t = Math.min(this.rec.duration, this.t + 5); this.prevO.copy(this.o); this.snap = true; } }
  ui(on) { document.getElementById('flightUI').classList.toggle('replaying', on); }
  abort() { this.ui(false); this.onDone = null; if (this.mesh) { this.mesh.removeFromParent(); } this.mesh = null; this.on = false; this.bar.classList.add('hidden'); }
  stop() { if (!this.on) return; this.ui(false); this.on = false; this.bar.classList.add('hidden'); this.mesh?.removeFromParent(); const d = this.onDone; this.onDone = null; this.mesh = null; d?.(); }
  update(dt, inp) {
    if (!this.on) return;
    if (inp.hit('Space') || inp.hit('Enter') || inp.hit('Pad0')) this.skip();
    if (inp.hit('Escape') || inp.hit('KeyB') || inp.hit('Pad1') || inp.hit('Backspace')) { this.stop(); return; }
    const R = this.rec, D = R.duration;
    this.t = Math.min(D, this.t + dt);
    const thr = R.pose(this.t, this.o, this.u);
    if (dt > 0) { this.tmp.copy(this.o).sub(this.prevO).divideScalar(dt); this.vel.lerp(this.tmp, 1 - Math.exp(-dt * 4)); } this.prevO.copy(this.o);
    const m = this.mesh; m.position.copy(this.o); m.quaternion.setFromUnitVectors(this.upY, this.u);
    const lf = Math.round((1 - R.legs) * 50) / 50; if (lf !== this.lf) { this.lf = lf; setLegFold(m, lf * lf * (3 - 2 * lf)); }
    if (this.flame) { this.flame.group.visible = thr > 0.01; if (thr > 0.01) { const w = this.g.world, fs = flameSize(this.eng, thr); this.flame.update(performance.now() / 1000, thr, fs.radius, fs.len, 1.225, this.eng.thrust); this.flame.setScale(w.h * w.renderer.getPixelRatio() / Math.tan(60 * Math.PI / 360) / 2); } }
    // chase cam: behind the direction of travel, above, smoothed both in position and aim
    const c = this.g.world.camera, sp = Math.hypot(this.vel.x, this.vel.z), R0 = 16 + this.L * 1.8;
    const yaw = sp > 2 ? Math.atan2(-this.vel.x, -this.vel.z) : 0.6;
    this.want.set(this.o.x + Math.sin(yaw) * R0, Math.max(1.5, this.o.y + this.L * 0.6 + R0 * 0.25 - THREE.MathUtils.clamp(this.vel.y * 0.08, -6, 6)), this.o.z + Math.cos(yaw) * R0);
    const look = this.tmp.copy(this.o).addScaledVector(this.u, this.L * 0.5);
    if (this.snap) { this.camP.copy(this.want); this.camL.copy(look); this.snap = false; }
    else { this.camP.lerp(this.want, 1 - Math.exp(-dt * 3)); this.camL.lerp(look, 1 - Math.exp(-dt * 6)); }
    c.up.set(0, 1, 0); c.position.copy(this.camP); c.lookAt(this.camL); c.fov = 60; c.near = Math.max(0.3, Math.min(5, this.o.y / 400)); c.far = Math.max(60000, this.o.y * 2.5); c.updateProjectionMatrix();
    // event captions + bar (DOM only ~8x a second)
    const t0 = R.t0 + this.t;
    while (this.evI < R.ev.length && R.ev[this.evI].t <= t0) { this.evEl.textContent = R.ev[this.evI].text; this.evT = 2; this.evI++; }
    if (this.evT > 0) { this.evT -= dt; if (this.evT <= 0) this.evEl.textContent = ''; }
    this.uiT += dt; if (this.uiT > 0.12) { this.uiT = 0; this.tEl.textContent = `${this.t.toFixed(1)} / ${D.toFixed(1)} s`; this.fill.style.width = (D ? this.t / D * 100 : 100).toFixed(1) + '%'; }
    if (this.t >= D) { this.endHold = (this.endHold || 0) + dt; if (this.endHold > 1.2) { this.endHold = 0; this.stop(); } }
  }
}
