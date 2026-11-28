// Slow-motion beat when something comes off the rocket (a part breaks or tears away): ~1.5 s of real time where the sim runs at
// down to 0.25x and the camera eases over to a side-on shot that frames the rocket and the piece leaving it, then eases back.
// The sim itself is untouched: it still takes the same fixed 120 Hz steps, just fewer of them per real second, so a flight is
// step-for-step the same with or without the beat. Any key, button or tap skips it (a quick ease back, not a hard cut).
import * as THREE from 'three';

const DUR = 1.5, IN = 0.22, OUT = 0.45, LOW = 0.25, COOL = 2.5;
const ease = x => x * x * (3 - 2 * x);
export class SlowMo {
  constructor() { this.t = -1; this.cool = 0; this.focus = new THREE.Vector3(); this.side = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.tmp = new THREE.Vector3(); this.fwd = new THREE.Vector3(); this.k = 0; this.end = DUR; }
  get active() { return this.t >= 0; }
  reset() { this.t = -1; this.cool = 0; this.k = 0; }
  // focus: where the piece left the rocket (world), vel: rocket velocity, cam: the current camera (the shot keeps its side of the rocket)
  trigger(focus, vel, cam) {
    if (this.active || this.cool > 0) return false;
    this.focus.copy(focus); this.t = 0; this.end = DUR; this.cool = COOL;
    const v = this.tmp.set(vel.x, vel.y, vel.z); if (v.lengthSq() < 1) v.set(0, 1, 0); v.normalize();
    this.side.copy(cam.position).sub(focus); this.side.addScaledVector(v, -this.side.dot(v));   // perpendicular to the flight path, on the camera's side
    if (this.side.lengthSq() < 1e-4) this.side.set(1, 0, 0).cross(v); this.side.normalize();
    return true;
  }
  skip() { if (this.active && this.t < this.end - OUT) this.end = Math.min(this.end, this.t + OUT); }
  // real dt in, sim time scale out (1 when idle). Framerate independent: everything here is a function of elapsed real time.
  update(dt) {
    this.cool = Math.max(0, this.cool - dt);
    if (!this.active) { this.k = 0; return 1; }
    this.t += dt;
    if (this.t >= this.end) { this.t = -1; this.k = 0; return 1; }
    const kin = ease(Math.min(1, this.t / IN)), kout = ease(Math.min(1, (this.end - this.t) / OUT));
    this.k = Math.min(kin, kout);
    return 1 + (LOW - 1) * this.k;
  }
  // after the normal flight camera has placed itself: blend toward the framing shot by k
  frame(c, rocketP, L) {
    if (this.k <= 0) return;
    const mid = this.look.copy(rocketP).lerp(this.focus, 0.5), span = rocketP.distanceTo(this.focus);
    const R = 9 + L * 1.6 + span * 0.9;
    this.pos.copy(mid).addScaledVector(this.side, R).addScaledVector(this.tmp.set(0, 1, 0), R * 0.18);
    this.pos.y = Math.max(1.5, this.pos.y);
    c.getWorldDirection(this.fwd); const d = c.position.distanceTo(mid), lookNow = this.fwd.multiplyScalar(d).add(c.position);
    c.position.lerp(this.pos, this.k); c.lookAt(lookNow.lerp(mid, this.k));
  }
}
