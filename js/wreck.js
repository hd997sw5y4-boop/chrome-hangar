// Crash wreckage helpers for flight: a fixed pool of metal shards (one InstancedMesh, one draw call, built at load and kept in the scene
// with one parked instance so its shader is compiled on the first frame, never at the crash), and the "wreck" settle for a partial
// break-up: what is left of the rocket tips over and comes to rest on its side. No allocation per crash or per frame.
import * as THREE from 'three';

const N = 64;
export class ShardPool {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(0.42, 0.06, 0.3);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.85, roughness: 0.35 }), N);
    this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.mesh);
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.r = new Float32Array(N * 3); this.w = new Float32Array(N * 3); this.s = new Float32Array(N); this.live = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.pos = new THREE.Vector3(); this.sc = new THREE.Vector3();
    this.clear();
  }
  clear() { this.live = 0; this.park(); }
  park() { this.m.makeTranslation(0, -500, 0); this.mesh.setMatrixAt(0, this.m); this.mesh.count = 1; this.mesh.instanceMatrix.needsUpdate = true; }
  // n shards from o, thrown out at a speed that grows with the impact; vel = what the rocket carried in
  burst(o, vel, speed, n) {
    n = Math.min(N, Math.round(n)); this.live = n;
    for (let i = 0; i < n; i++) {
      const a = i * 2.399, el = 0.25 + (i % 5) * 0.15, sp = (3 + speed * 0.25) * (0.5 + ((i * 37) % 11) / 11);
      this.p[i * 3] = o.x + Math.cos(a) * 0.6; this.p[i * 3 + 1] = Math.max(0.4, o.y + (i % 3) * 0.4); this.p[i * 3 + 2] = o.z + Math.sin(a) * 0.6;
      this.v[i * 3] = Math.cos(a) * Math.cos(el) * sp + vel.x * 0.15; this.v[i * 3 + 1] = Math.sin(el) * sp + 2; this.v[i * 3 + 2] = Math.sin(a) * Math.cos(el) * sp + vel.z * 0.15;
      this.r[i * 3] = a; this.r[i * 3 + 1] = a * 1.7; this.r[i * 3 + 2] = a * 0.3;
      this.w[i * 3] = Math.sin(a) * 9; this.w[i * 3 + 1] = Math.cos(a * 1.3) * 7; this.w[i * 3 + 2] = Math.sin(a * 0.7) * 8;
      this.s[i] = 0.6 + ((i * 53) % 7) / 7;
    }
    this.mesh.count = n; this.write();
  }
  update(dt) {
    if (!this.live) return;
    for (let i = 0; i < this.live; i++) {
      const j = i * 3; if (this.w[j] === 0 && this.v[j + 1] === 0) continue;
      this.v[j + 1] -= 9.81 * dt; this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      this.r[j] += this.w[j] * dt; this.r[j + 1] += this.w[j + 1] * dt; this.r[j + 2] += this.w[j + 2] * dt;
      if (this.p[j + 1] < 0.05) { this.p[j + 1] = 0.05; this.v[j + 1] *= -0.25; this.v[j] *= 0.5; this.v[j + 2] *= 0.5; this.w[j] *= 0.4; this.w[j + 1] *= 0.4; this.w[j + 2] *= 0.4;
        if (Math.abs(this.v[j + 1]) < 0.5) { this.v[j] = this.v[j + 1] = this.v[j + 2] = 0; this.w[j] = this.w[j + 1] = this.w[j + 2] = 0; this.r[j] = 0; this.r[j + 2] = 0; } }
    }
    this.write();
  }
  write() {
    for (let i = 0; i < this.live; i++) {
      const j = i * 3; this.e.set(this.r[j], this.r[j + 1], this.r[j + 2]); this.q.setFromEuler(this.e);
      this.m.compose(this.pos.set(this.p[j], this.p[j + 1], this.p[j + 2]), this.q, this.sc.setScalar(this.s[i])); this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// What is left after a partial break-up: tips over from where it stood and settles on its side (eased, ~1.1 s, fixed rate).
export class WreckSettle {
  constructor() { this.g = null; this.q0 = new THREE.Quaternion(); this.q1 = new THREE.Quaternion(); this.p0 = new THREE.Vector3(); this.p1 = new THREE.Vector3(); this.ax = new THREE.Vector3(); this.t = 0; }
  start(group, dirX, dirZ) {
    this.g = group; this.t = 0; this.q0.copy(group.quaternion); this.p0.copy(group.position);
    let h = Math.hypot(dirX, dirZ); if (h < 1e-3) { dirX = 1; dirZ = 0; h = 1; }
    this.ax.set(dirZ / h, 0, -dirX / h);   // fall over toward the direction it was moving
    this.q1.setFromAxisAngle(this.ax, Math.PI / 2 * 0.96);
    this.p1.copy(group.position).setY(0.9);
  }
  update(dt) {
    if (!this.g || this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 1.1); const e = this.t * this.t;   // accelerating fall
    this.g.quaternion.slerpQuaternions(this.q0, this.q1, e); this.g.position.lerpVectors(this.p0, this.p1, e);
  }
  clear() { this.g = null; }
}
