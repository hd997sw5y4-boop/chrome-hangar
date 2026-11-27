// Flame, smoke, explosion flash and break-apart debris.
import * as THREE from 'three';
import { disposeTree } from './parts3d.js';

// ---------- exhaust plume ----------
// Layered, view-dependent "volumetric" shells: a white-hot core, the main plume with shock diamonds that fade
// as the air thins, an outer orange sheath that balloons in vacuum, a Mach disc + diamond glows (one Points draw),
// and a flickering light that throws the engine glow onto the pad, tower and ground.
const plumeVS = `uniform float uExpand, uTime; varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){ vUv = uv; float t = -position.y; vT = t;
    float r = mix(1.0, uExpand, pow(t, 0.75)) * (1.0 + 0.04 * sin(t * 30.0 - uTime * 40.0));
    vec3 p = vec3(position.x * r, position.y, position.z * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const plumeFS = `uniform float uTime, uPower, uDiam, uCoreK, uLen, uGain; uniform vec3 uCore, uEdge; varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
  void main(){
    float t = clamp(vT, 0.0, 1.0), edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
    float flick = n(vec2(vUv.x * 9.0, t * 7.0 - uTime * 16.0)) * 0.55 + n(vec2(vUv.x * 23.0, t * 19.0 - uTime * 37.0)) * 0.45;
    float body = pow(1.0 - t, 1.5) * (0.55 + 0.7 * flick);
    float ph = t / max(uLen, 0.02);
    float diam = uDiam * pow(0.5 + 0.5 * cos((ph - 0.9) * 6.2832), 10.0) * exp(-t * 3.5) * step(0.5, ph);
    float core = exp(-t * 7.0) * uCoreK;
    vec3 c = mix(uEdge, uCore, clamp(core + diam * 0.8 + (1.0 - t) * 0.25, 0.0, 1.0));
    float I = (body * 0.9 + core * 3.0 + diam * 2.5) * edge * uPower * uGain;
    gl_FragColor = vec4(c * I, 1.0);
  }`;
const glowVS = `attribute float size; attribute float bright; uniform float scale; varying float vB;
  void main(){ vB = bright; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * scale / -mv.z, 0.0, 600.0); gl_Position = projectionMatrix * mv; }`;
const glowFS = `uniform vec3 uCol; uniform float uK; varying float vB; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = exp(-r * r * 5.0) * (1.0 - r); if (a <= 0.0) discard; gl_FragColor = vec4(uCol * a * vB * uK, 1.0); }`;

export class Flame {
  constructor(color = '#ffb347') {
    this.group = new THREE.Group(); this.group.userData.noAO = true;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 32, 24, true); geo.translate(0, -0.5, 0);
    const edge = new THREE.Color(color);
    const mk = (core, ed, coreK, gain) => {
      const m = new THREE.ShaderMaterial({ vertexShader: plumeVS, fragmentShader: plumeFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uExpand: { value: 1.4 }, uDiam: { value: 1 }, uCoreK: { value: coreK }, uLen: { value: 10 }, uGain: { value: gain }, uCore: { value: new THREE.Color(core) }, uEdge: { value: ed.clone() } } });
      const o = new THREE.Mesh(geo, m); o.frustumCulled = false; o.userData.noAO = true; this.group.add(o); return o;
    };
    this.sheath = mk('#ffd9a0', edge.clone().multiplyScalar(0.8), 0.3, 1.2);   // outer, balloons in thin air
    this.main = mk('#fff4dc', edge, 1.0, 3.2);
    this.core = mk('#ffffff', new THREE.Color('#cfe8ff'), 2.5, 6.0);          // short white-hot core
    // Mach disc + diamond glows + nozzle bloom
    const N = 7, pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1)); pg.setAttribute('bright', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.glows = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: glowVS, fragmentShader: glowFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 800 }, uCol: { value: new THREE.Color(1.0, 0.86, 0.62) }, uK: { value: 9 } } }));
    this.glows.frustumCulled = false; this.group.add(this.glows);
    this.light = new THREE.PointLight(0xff9a4a, 0, 260, 1.5); this.light.position.y = -3; this.group.add(this.light);
    this.group.visible = false; this.power = 0;
  }
  setScale(viewH) { this.glows.material.uniforms.scale.value = viewH; }
  update(t, power, radius, len, rho = 1.2, thrust = 115000) {
    this.group.visible = power > 0.01; this.power = power;
    const thin = 1 - Math.min(1, rho / 1.225), expand = 1.35 + thin * 3.5, diam = Math.max(0, 1 - thin * 1.6);
    const L = len * (0.92 + 0.08 * Math.sin(t * 37)) * (1 + thin * 0.8);
    const sp = radius * 2.2 * (1 + thin);   // diamond spacing ~ 2 nozzle diameters, longer as pressure drops
    for (const [o, l, r, ex] of [[this.sheath, L * 1.15, radius * 1.25, expand * 1.25], [this.main, L, radius, expand], [this.core, L * 0.32, radius * 0.5, 1.15]]) {
      const u = o.material.uniforms; u.uTime.value = t; u.uPower.value = power; u.uExpand.value = ex; u.uDiam.value = diam; u.uLen.value = sp / l;
      o.scale.set(r, l, r);
    }
    this.sheath.material.uniforms.uPower.value = power * (0.35 + thin * 0.8);
    // diamonds: spacing ~ 2.4 nozzle diameters (bigger as pressure drops), first one is the Mach disc
    const P = this.glows.geometry.attributes;
    for (let i = 0; i < 7; i++) {
      const y = i === 0 ? -0.15 : -(i - 0.1) * sp;
      P.position.setY(i, y); P.size.setX(i, i === 0 ? radius * 4.5 : radius * (2.0 - i * 0.18) * (1 + thin));
      P.bright.setX(i, power * (i === 0 ? 1.4 : diam * Math.exp(-i * 0.35) * (0.8 + 0.2 * Math.sin(t * 50 + i))));
    }
    P.position.needsUpdate = P.size.needsUpdate = P.bright.needsUpdate = true;
    this.light.intensity = power * (3000 + thrust / 25) * (0.82 + 0.18 * Math.sin(t * 53) * Math.sin(t * 17));
  }
}

// soft puff sprite: overlapping lobes so particles read as billows, not discs
function smokeTex() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  let sd = 9; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.283, d = r() * S * 0.22, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, R = S * (0.12 + r() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(255,255,255,${0.18 + r() * 0.2})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const m = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = m; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// Smoke / steam particles. Lit by the sky (top brighter), by the engine flame (orange, falls off with distance),
// with per-particle rotation. kind: 0 = exhaust smoke (warm grey), 1 = steam (white).
export class Smoke {
  constructor(max) { this.build(max); }
  build(max) {
    if (this.points) { this.points.removeFromParent(); this.points.geometry.dispose(); }
    this.max = max; this.n = 0; this.cursor = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max);
    this.size = new Float32Array(max); this.heat = new Float32Array(max); this.grow = new Float32Array(max); this.kind = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1); this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1); this.aHeat = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1); this.aKind = new THREE.BufferAttribute(this.kind, 1);
    for (let i = 0; i < max; i++) this.aRot.array[i] = (i * 2.399) % 6.283;
    geo.setAttribute('size', this.aSize); geo.setAttribute('alpha', this.aAlpha); geo.setAttribute('heat', this.aHeat); geo.setAttribute('rot', this.aRot); geo.setAttribute('kind', this.aKind);
    this.mat = this.mat || new THREE.ShaderMaterial({
      uniforms: { map: { value: smokeTex() }, scale: { value: 600 }, uFlame: { value: new THREE.Vector3() }, uFlameI: { value: 0 }, uSky: { value: new THREE.Color(0.75, 0.78, 0.82) }, uSun: { value: new THREE.Color(1, 0.95, 0.88) } },
      transparent: true, depthWrite: false,
      vertexShader: `attribute float size, alpha, heat, rot, kind; uniform float scale, uFlameI; uniform vec3 uFlame; varying float vA, vH, vR, vK, vL;
        void main(){ vA = alpha; vH = heat; vR = rot; vK = kind; vec4 wp = modelMatrix * vec4(position, 1.0); float d = distance(wp.xyz, uFlame);
          vL = uFlameI / (1.0 + d * d / 900.0);
          vec4 mv = viewMatrix * wp; gl_PointSize = min(1024.0, size * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uSky, uSun; varying float vA, vH, vR, vK, vL;
        void main(){ vec2 q = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); q = mat2(c, -s, s, c) * q; vec4 t = texture2D(map, q + 0.5);
          float top = 0.55 + 0.45 * clamp(0.5 - q.y * 1.4, 0.0, 1.0);
          vec3 base = mix(vec3(0.70, 0.67, 0.63), vec3(0.97, 0.97, 0.98), vK);
          vec3 col = base * (uSky * 0.55 + uSun * 0.6 * top) + vec3(1.0, 0.55, 0.22) * (vL * (0.6 + 0.4 * top) + vH * 2.5);
          gl_FragColor = vec4(col, t.a * vA); if (gl_FragColor.a < 0.008) discard; }`,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.points.userData.noAO = true;
  }
  emit(x, y, z, vx, vy, vz, size, life, heat = 0, grow = 1, kind = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.heat[i] = heat; this.grow[i] = grow; this.kind[i] = kind;
  }
  light(pos, intensity, sky, sun) { const u = this.mat.uniforms; u.uFlame.value.copy(pos); u.uFlameI.value = intensity; if (sky) u.uSky.value.copy(sky); if (sun) u.uSun.value.copy(sun); }
  update(dt, wind, viewH) {
    this.mat.uniforms.scale.value = viewH * 0.9;
    const S = this.aSize.array, A = this.aAlpha.array, H = this.aHeat.array, R = this.aRot.array;
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i] += dt;
      if (a > this.life[i]) { A[i] = 0; continue; }
      const k = a / this.life[i], drag = Math.exp(-dt * 1.1);
      this.v[i * 3] = this.v[i * 3] * drag + wind.x * (1 - drag); this.v[i * 3 + 1] = this.v[i * 3 + 1] * drag + (0.8 + this.kind[i] * 1.2) * dt; this.v[i * 3 + 2] = this.v[i * 3 + 2] * drag + wind.z * (1 - drag);
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] = Math.max(0.2, this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt); this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      S[i] = this.size[i] * (1 + Math.sqrt(k) * 3.2 * this.grow[i]);
      A[i] = Math.min(1, a * 5) * Math.pow(1 - k, 1.4) * 0.6;
      H[i] = this.heat[i] * Math.max(0, 1 - a * 2.5);
      R[i] += dt * 0.15 * ((i & 1) ? 1 : -1);
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aHeat.needsUpdate = this.aRot.needsUpdate = this.aKind.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); }
}

// Sparks and burning debris kicked out of the trench at ignition / liftoff: additive streaks with gravity.
export class Sparks {
  constructor(max = 400) {
    this.max = max; this.cursor = 0; this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.aB = new THREE.BufferAttribute(new Float32Array(max), 1); geo.setAttribute('bright', this.aB);
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float bright; uniform float scale; varying float vB; void main(){ vB = bright; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(0.35 * scale / -mv.z, 1.5, 24.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vB; void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(0.0, 1.0 - length(d) * 2.0); if (vB <= 0.0 || a <= 0.0) discard; gl_FragColor = vec4(vec3(1.0, 0.62, 0.25) * vB * a * 12.0, 1.0); }' }));
    this.points.frustumCulled = false; this.points.userData.noAO = true;
  }
  emit(x, y, z, vx, vy, vz, life) { const i = this.cursor; this.cursor = (this.cursor + 1) % this.max; this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.age[i] = 0; this.life[i] = life; }
  update(dt, viewH) {
    this.points.material.uniforms.scale.value = viewH; const B = this.aB.array;
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i] += dt; if (a > this.life[i]) { B[i] = 0; continue; }
      this.v[i * 3 + 1] -= 9.81 * dt; for (let k = 0; k < 3; k++) this.p[i * 3 + k] += this.v[i * 3 + k] * dt;
      if (this.p[i * 3 + 1] < 0.05) { this.p[i * 3 + 1] = 0.05; this.v[i * 3 + 1] *= -0.35; this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6; }
      B[i] = Math.pow(1 - a / this.life[i], 1.5);
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.aB.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); }
}

// Break-apart: each visible piece becomes a free body with gravity and ground bounce.
export class Debris {
  constructor(scene) { this.scene = scene; this.items = []; }
  explode(group, vel, origin) {
    group.updateMatrixWorld(true);
    const pieces = [];
    group.children.forEach(c => pieces.push(c));
    let i = 0;
    for (const c of pieces) {
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      c.matrixWorld.decompose(wp, wq, ws);
      c.removeFromParent(); c.position.copy(wp); c.quaternion.copy(wq); c.scale.copy(ws); this.scene.add(c);
      const out = wp.clone().sub(origin); out.y = Math.abs(out.y) * 0.3 + 2; out.normalize();
      const a = i++ * 2.399; // golden angle spread, deterministic
      const v = new THREE.Vector3(vel.x, vel.y * 0.6, vel.z).add(out.multiplyScalar(6 + (i % 3) * 3)).add(new THREE.Vector3(Math.cos(a) * 4, 3, Math.sin(a) * 4));
      this.items.push({ o: c, v, w: new THREE.Vector3(Math.sin(a) * 3, Math.cos(a * 1.3) * 2, Math.sin(a * 0.7) * 3), rest: false });
    }
  }
  update(dt) {
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const d of this.items) {
      if (d.rest) continue;
      d.v.y -= 9.81 * dt; d.o.position.addScaledVector(d.v, dt);
      e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt); q.setFromEuler(e); d.o.quaternion.multiply(q);
      if (d.o.position.y < 0.3) { d.o.position.y = 0.3; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5); if (Math.abs(d.v.y) < 0.6 && d.v.length() < 1) d.rest = true; }
    }
  }
  clear() { for (const d of this.items) { d.o.removeFromParent(); disposeTree(d.o); } this.items.length = 0; }
}
