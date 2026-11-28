// Tray view: while the parts tray is open, the camera eases from the walk-around eye to an automatic framing of
// what is being worked on (every spot the picked part can go, else the whole rocket on the stand) and eases back
// to the exact walk-around view when the tray closes. While framed, look input (mouse drag / right stick, with the
// player's sensitivity and invert) orbits, A/D or the left stick orbit too, W/S and the wheel zoom.
import * as THREE from 'three';
import { candidates, layout } from './rocket.js';
import { HANGAR } from './env.js';

const EASE = 0.6;   // seconds for the full move in or out
const smooth = k => k * k * k * (k * (k * 6 - 15) + 10);

export class TrayView {
  constructor(build) {
    this.b = build; this.on = false; this.k = 0;
    this.tgt = new THREE.Vector3(); this.rad = 2; this.az = 0; this.el = 0.3; this.zoom = 1;
    this._box = new THREE.Box3(); this._sph = new THREE.Sphere(); this._v = new THREE.Vector3();
    this._pos = new THREE.Vector3(); this._look = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this._eyeP = new THREE.Vector3(); this._eyeQ = new THREE.Quaternion();
  }
  get active() { return this.k > 0; }
  open() {
    if (this.on || !this.b.w.indoor) return;   // only frame the stand from inside the hangar
    const g = this.goal(), P = this.b.player;
    if (this.k === 0) { this.tgt.copy(g.c); this.rad = g.r; }
    this.az = Math.atan2(P.x - this.tgt.x, P.z - this.tgt.z); this.el = 0.3; this.zoom = 1; this.on = true;
  }
  close() { this.on = false; }
  reset() { this.on = false; this.k = 0; }

  // what to frame: where the picked part can attach, else the rocket, else the empty stand deck
  goal() {
    const b = this.b, box = this._box.makeEmpty();
    if (b.sel && b.sel !== 'delete') { const L = layout(b.g.rocket); for (const c of candidates(b.g.rocket, b.sel)) if (c.ok) box.expandByPoint(b.candWorld(c, L).world); }
    if (!box.isEmpty()) box.expandByScalar(0.7);
    else if (b.rocketGroup?.children.length) box.setFromObject(b.rocketGroup);
    if (box.isEmpty()) { b.w.stand.getWorldPosition(this._v); this._v.y += 1; box.setFromCenterAndSize(this._v, this._v.set(2.6, 2.6, 2.6)); }
    box.getBoundingSphere(this._sph);
    return { c: this._sph.center, r: Math.max(1.2, this._sph.radius) };
  }

  // call right after the walk-around eye is written to the camera; returns true while it owns the camera
  update(dt, inp) {
    const cam = this.b.w.camera;
    this.k = THREE.MathUtils.clamp(this.k + (this.on ? dt : -dt) / EASE, 0, 1);
    if (this.k === 0) return false;
    // orbit / zoom only once settled: the swoop itself ignores input (freeing the mouse can fire one big movement spike)
    if (this.on && inp && this.k === 1) {
      this.az -= inp.look.x + inp.move.x * 1.4 * dt;
      this.el = THREE.MathUtils.clamp(this.el - inp.look.y, -0.15, 1.25);
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(inp.zoom * 0.12 + inp.move.y * 1.1 * dt), 0.45, 2.2);
    }
    const g = this.goal(), f = 1 - Math.exp(-dt * 4);
    this.tgt.lerp(g.c, f); this.rad += (g.r - this.rad) * f;
    // distance that fits the sphere in the narrower field of view, with room above the tray
    const fv = THREE.MathUtils.degToRad(cam.fov) / 2, fh = Math.atan(Math.tan(fv) * cam.aspect);
    const d = Math.max(1.4, this.rad * 1.12 / Math.sin(Math.min(fv, fh))) * this.zoom;
    const ce = Math.cos(this.el), H = HANGAR, p = this._pos;
    p.set(this.tgt.x + Math.sin(this.az) * ce * d, this.tgt.y + Math.sin(this.el) * d, this.tgt.z + Math.cos(this.az) * ce * d);
    p.x = THREE.MathUtils.clamp(p.x, -H.x + 0.8, H.x - 0.8); p.z = THREE.MathUtils.clamp(p.z, -H.z + 0.8, H.z - 0.8);
    p.y = THREE.MathUtils.clamp(p.y, 0.5, H.h - 2);
    this._look.copy(this.tgt); this._look.y -= this.rad * 0.12;   // nudge the subject up, clear of the tray
    this._q.setFromRotationMatrix(this._m.lookAt(p, this._look, cam.up));
    const e = smooth(this.k);
    this._eyeP.copy(cam.position); this._eyeQ.copy(cam.quaternion);
    cam.position.lerpVectors(this._eyeP, p, e); cam.quaternion.slerpQuaternions(this._eyeQ, this._q, e);
    return true;
  }
}
