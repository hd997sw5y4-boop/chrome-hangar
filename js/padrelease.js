// Pad release: hold-down clamp arms grip the rocket's skirt and a tail umbilical feeds its lowest tank.
// At ignition they let go: clamps swing back and down onto the mount, the umbilical plate pulls back to its
// mast and the hoses sag away, with a soft clunk and a vent hiss. Everything here belongs to the pad (never
// parented to the rocket), so the rocket rises cleanly. Landing legs fold flat for ascent and redeploy on descent.
import * as THREE from 'three';
import { SPOTS } from './env.js';
import { setLegFold } from './parts3d.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export class PadRelease {
  constructor(world, audio) {
    this.w = world; this.audio = audio;
    const g = this.group = new THREE.Group(); g.name = 'padRelease'; g.position.set(SPOTS.pad.x, 0, SPOTS.pad.z); world.scene.add(g);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a816, metalness: 0.3, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.8, roughness: 0.38 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 1, roughness: 0.18 });
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.78 });
    this.clamps = [];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, base = new THREE.Group(); base.rotation.y = -a; g.add(base);   // local +x = radially out
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.6), yellow); ped.position.set(1.75, 0.3, 0); ped.castShadow = true; base.add(ped);
      const piv = new THREE.Group(); piv.position.set(1.62, 0.55, 0); base.add(piv);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.26), steel); arm.castShadow = true; piv.add(arm);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.36), steel); piv.add(jaw);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), chrome); piv.add(rod);
      this.clamps.push({ piv, arm, jaw, rod });
    }
    // tail service mast + umbilical plate and hoses
    const ma = Math.PI / 8; this.mastDir = V(Math.cos(ma), 0, Math.sin(ma));
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.7), steel); mast.position.copy(this.mastDir.clone().multiplyScalar(3.4)).setY(2.1); mast.castShadow = true; g.add(mast);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.9), yellow); cap.position.copy(mast.position).setY(4.3); g.add(cap);
    this.mastPort = mast.position.clone().setY(3.6).addScaledVector(this.mastDir, -0.4);
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.4), steel); this.plate.castShadow = true; g.add(this.plate);
    this.hoses = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat); m.castShadow = true; g.add(m); return m; });
    this.reset(null);
  }
  reset(rocketGroup, baseY = 0) {
    this.rocket = rocketGroup; this.t = 0; this.released = false; this.fold = 0; this.foldT = 0; this.lastKey = '';
    const L = rocketGroup?.userData.layout, R = L?.radius || 0.9, base = baseY;
    this.jawY = base + (L?.engLen || 0) + 0.3; this.R = R;
    this.plateY = base + (L?.engLen || 0) + 1.3;
    this.group.visible = !!rocketGroup;
    this.pose(0);
    if (rocketGroup) setLegFold(rocketGroup, 0);
  }
  pose(k) {   // k: 0 = holding the rocket, 1 = released and stowed
    const e = k * k * (3 - 2 * k);
    for (const c of this.clamps) {
      const reach = 1.62 - (this.R + 0.06), rise = this.jawY - 0.55, len = Math.hypot(reach, rise), ang = Math.atan2(rise, reach);
      c.piv.rotation.z = (Math.PI - ang) * (1 - e) + 0.55 * e;   // swing up and back, away from the rocket
      c.arm.scale.x = len; c.arm.position.x = len / 2; c.jaw.position.x = len + 0.04; c.rod.position.set(len * 0.35, -0.16, 0); c.rod.rotation.z = Math.PI / 2;
    }
    // umbilical: plate on the skin, retracts to the mast and drops
    const skin = this.mastDir.clone().multiplyScalar(this.R + 0.08).setY(this.plateY);
    const home = this.mastPort.clone().addScaledVector(this.mastDir, -0.1).setY(this.mastPort.y - 1.2);
    const p = skin.clone().lerp(home, e); this.plate.position.copy(p); this.plate.lookAt(p.clone().add(this.mastDir)); this.plate.rotateY(Math.PI / 2);
    const key = p.toArray().map(v => v.toFixed(2)).join();
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.hoses.forEach((h, i) => { const off = V(0, 0, (i - 0.5) * 0.22), a = this.mastPort.clone().add(off), b = p.clone().addScaledVector(this.mastDir, 0.08).add(off), m = a.clone().lerp(b, 0.5); m.y -= 0.9 + e * 0.4; h.geometry.dispose(); h.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, m, b]), 20, 0.07 - i * 0.015, 8); });
    }
  }
  update(dt, f) {
    if (!this.rocket) return;
    if (!this.released && f.e.on) { this.released = true; this.audio.noise(0.25, 260, 0.8, 0.3, 0, 'lowpass', 0.4); this.audio.tone(60, 0.4, 'sine', 0.22, 0.3, 0, 0.6); this.audio.noise(1.1, 3200, 0.7, 0.07, 0.05, 'highpass', 0.3); }
    if (this.released && this.t < 1) { this.t = Math.min(1, this.t + dt / 0.9); this.pose(this.t); }
    // legs: tuck for the climb, deploy when coming back down low
    if (this.rocket.userData.layout?.items?.some(it => it.s.legs)) {
      const want = f.phase === 'flying' && f.alt > 6 && !(f.vs < -2 && f.alt < 450) ? 1 : 0;
      if (want !== this.foldT) { this.foldT = want; this.audio.noise(0.4, 900, 1, 0.04, 0, 'bandpass', 0.2); }
      const nf = this.fold + THREE.MathUtils.clamp(this.foldT - this.fold, -dt / 1.6, dt / 1.6);
      if (nf !== this.fold) { this.fold = nf; setLegFold(this.rocket, nf * nf * (3 - 2 * nf)); }
    }
  }
}
