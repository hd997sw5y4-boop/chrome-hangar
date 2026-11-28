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
#ifdef USE_INSTANCING
    vec4 wp = instanceMatrix * vec4(p, 1.0);
    vec4 mv = modelViewMatrix * wp;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
#else
    vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal);
#endif
    vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
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

// The plume draws are hidden while the engine is off, but the flame's PointLight and the meshes stay in the scene.
// Toggling the whole group used to add/remove a light at ignition, which changes three.js's light count and
// recompiles every lit shader in the scene (the launch hitch), and the plume shaders first compiled on the ignition
// frame. Now the light is always counted and the plume is drawn (black, power 0) for the first few frames after the
// flame is built, so all of that compiles while the rocket is still sitting on the pad.
const PREWARM_FRAMES = 3;
function showPlume(fl, on) {
  const v = on || fl.hold > 0; if (fl.hold > 0) fl.hold--;
  if (v === fl.shown) return; fl.shown = v;
  for (const c of fl.group.children) if (!c.isLight) c.visible = v;
}

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
    this.sheath = mk('#ffd9a0', edge.clone().multiplyScalar(0.8), 0.3, 0.6);   // outer, balloons in thin air
    this.main = mk('#fff4dc', edge, 1.0, 1.7);
    this.core = mk('#ffffff', new THREE.Color('#cfe8ff'), 2.5, 3.0);          // short white-hot core
    // Mach disc + diamond glows + nozzle bloom
    const N = 7, pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1)); pg.setAttribute('bright', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.glows = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: glowVS, fragmentShader: glowFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 800 }, uCol: { value: new THREE.Color(1.0, 0.86, 0.62) }, uK: { value: 3.5 } } }));
    this.glows.frustumCulled = false; this.group.add(this.glows);
    this.light = new THREE.PointLight(0xff9a4a, 0, 260, 1.5); this.light.position.y = -3; this.group.add(this.light);
    this.power = 0; this.hold = PREWARM_FRAMES; this.shown = true;
  }
  setScale(viewH) { this.glows.material.uniforms.scale.value = viewH; }
  setShown(on) { showPlume(this, on); }
  update(t, power, radius, len, rho = 1.2, thrust = 115000) {
    this.setShown(power > 0.01); this.power = power;
    if (!this.shown) { this.light.intensity = 0; return; }   // engine off and prewarm over: no per-frame buffer work
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
      P.bright.setX(i, power * 0.5 * (i === 0 ? 1.4 : diam * Math.exp(-i * 0.35) * (0.8 + 0.2 * Math.sin(t * 50 + i))));
    }
    P.position.needsUpdate = P.size.needsUpdate = P.bright.needsUpdate = true;
    this.light.intensity = power * (250 + thrust / 500) * (0.82 + 0.18 * Math.sin(t * 53) * Math.sin(t * 17));
  }
}

// Per-nozzle plume size. Length follows one engine's thrust, not the cluster total.
export function flameSize(eng, power) {
  const n = Math.max(1, eng.engines || 1);
  return { n, radius: (eng.bellRadius || eng.radius) * 0.95, len: 4 + 12 * power * Math.sqrt((eng.thrust / n) / 115000) };
}
export function attachFlames(engineGroup, color, lite = false) {
  const nz = engineGroup?.userData?.nozzles;
  const f = (nz && nz.length > 1) ? new ClusterFlame(color, nz, lite) : new Flame(color);
  engineGroup.add(f.group);
  return f;
}

// Many nozzles, few draw calls: instanced plume shells, one glow Points buffer, one light.
export class ClusterFlame {
  constructor(color, nozzles, lite = false) {
    this.nozzles = nozzles; this.lite = !!lite;
    this.group = new THREE.Group(); this.group.userData.noAO = true;
    const n = nozzles.length, segs = lite ? 12 : 20, stacks = lite ? 10 : 18;
    const geo = new THREE.CylinderGeometry(1, 1, 1, segs, stacks, true); geo.translate(0, -0.5, 0); geo.userData.keep = true;
    const edge = new THREE.Color(color);
    const mk = (core, ed, coreK, gain) => {
      const m = new THREE.ShaderMaterial({ vertexShader: plumeVS, fragmentShader: plumeFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uExpand: { value: 1.4 }, uDiam: { value: 1 }, uCoreK: { value: coreK }, uLen: { value: 10 }, uGain: { value: gain }, uCore: { value: new THREE.Color(core) }, uEdge: { value: ed.clone() } } });
      m.userData.own = true;
      const o = new THREE.InstancedMesh(geo, m, n); o.frustumCulled = false; o.userData.noAO = true; o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(o); return o;
    };
    this.layers = [];
    if (!lite) this.layers.push([mk('#ffd9a0', edge.clone().multiplyScalar(0.8), 0.3, 0.6), 1.15, 1.25, 1.25]); // sheath
    this.layers.push([mk('#fff4dc', edge, 1.0, 1.7), 1, 1, 1]);
    this.layers.push([mk('#ffffff', new THREE.Color('#cfe8ff'), 2.5, 3.0), 0.32, 0.5, 0]);
    this.sheath = lite ? this.layers[0][0] : this.layers[0][0];
    this.main = lite ? this.layers[0][0] : this.layers[1][0];
    // glow points: 3 diamonds per nozzle on phones, 7 on desktop
    this.gN = lite ? 3 : 7;
    const N = n * this.gN, pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1));
    pg.setAttribute('bright', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.glows = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: glowVS, fragmentShader: glowFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 800 }, uCol: { value: new THREE.Color(1.0, 0.86, 0.62) }, uK: { value: 3.5 } } }));
    this.glows.material.userData.own = true; this.glows.frustumCulled = false; this.group.add(this.glows);
    this.light = new THREE.PointLight(0xff9a4a, 0, 260, 1.5); this.light.position.y = -3; this.group.add(this.light);
    this.power = 0; this.off = new Uint8Array(n);   // off[i] = 1: that bell has shut down
    this.hold = PREWARM_FRAMES; this.shown = true;
    this._o = new THREE.Object3D();
  }
  setOut(i, out = true) { if (i >= 0 && i < this.off.length) this.off[i] = out ? 1 : 0; }
  setScale(viewH) { this.glows.material.uniforms.scale.value = viewH; }
  setShown(on) { showPlume(this, on); }
  update(t, power, radius, len, rho = 1.2, thrust = 115000) {
    this.setShown(power > 0.01); this.power = power;
    if (!this.shown) { this.light.intensity = 0; return; }   // engine off and prewarm over: no per-frame buffer work
    const thin = 1 - Math.min(1, rho / 1.225), expand = 1.35 + thin * 3.5, diam = Math.max(0, 1 - thin * 1.6);
    const L = len * (0.92 + 0.08 * Math.sin(t * 37)) * (1 + thin * 0.8);
    const nz = this.nozzles, n = nz.length;
    for (const [o, lK, rK, exK] of this.layers) {
      const l = L * lK, r = radius * rK, ex = exK ? expand * exK : 1.15;
      const u = o.material.uniforms; u.uTime.value = t; u.uPower.value = power; u.uExpand.value = ex; u.uDiam.value = diam; u.uLen.value = (radius * 2.2 * (1 + thin)) / l;
      for (let i = 0; i < n; i++) {
        const z = nz[i], k = this.off[i] ? 0 : 1; this._o.position.set(z.x, z.y, z.z); this._o.scale.set(r * k + 1e-4, l * k + 1e-4, r * k + 1e-4); this._o.updateMatrix(); o.setMatrixAt(i, this._o.matrix);
      }
      o.instanceMatrix.needsUpdate = true;
    }
    if (!this.lite) this.layers[0][0].material.uniforms.uPower.value = power * (0.35 + thin * 0.8);
    const P = this.glows.geometry.attributes, gN = this.gN, sp = radius * 2.2 * (1 + thin);
    for (let i = 0; i < n; i++) {
      const z = nz[i];
      for (let k = 0; k < gN; k++) {
        const j = i * gN + k, y = k === 0 ? -0.15 : -(k - 0.1) * sp;
        P.position.setXYZ(j, z.x, z.y + y, z.z);
        P.size.setX(j, k === 0 ? radius * 4.5 : radius * (2.0 - k * 0.18) * (1 + thin));
        P.bright.setX(j, this.off[i] ? 0 : power * 0.5 * (k === 0 ? 1.4 : diam * Math.exp(-k * 0.35) * (0.8 + 0.2 * Math.sin(t * 50 + k + i))));
      }
    }
    P.position.needsUpdate = P.size.needsUpdate = P.bright.needsUpdate = true;
    this.light.intensity = power * (250 + thrust / 500) * (0.82 + 0.18 * Math.sin(t * 53) * Math.sin(t * 17));
  }
}

// Soft round billow sprite: layered value-noise puffs with a smooth circular falloff (no hard lobe facets).
// R = top-lit shading, A = density.
function smokeTex() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), img = g.createImageData(S, S);
  const h = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
  const vn = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v; };
  const fbm = (x, y) => vn(x, y) * 0.55 + vn(x * 2.07 + 17.2, y * 2.07) * 0.28 + vn(x * 4.13 + 9.4, y * 4.13) * 0.17;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, dx = u * 2 - 1, dy = v * 2 - 1, r = Math.hypot(dx, dy);
    const n = fbm(u * 5.5, v * 5.5), n2 = fbm(u * 9.0 + 4.0, v * 9.0 - 2.0);
    const billow = 0.55 + 0.45 * n, edge = Math.max(0, 1 - r);
    const A = Math.pow(Math.min(1, edge * 1.15), 1.6) * (0.35 + 0.65 * billow) * (0.75 + 0.25 * n2);
    const lit = 0.38 + 0.62 * Math.max(0, 0.2 - dy * 0.7 + (n - 0.5) * 0.35 + Math.sqrt(Math.max(0, 1 - r)) * 0.25);
    const o = (y * S + x) * 4; img.data[o] = Math.min(255, lit * 255); img.data[o + 1] = 0; img.data[o + 2] = 0; img.data[o + 3] = Math.min(255, A * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t;
}

// Smoke / steam particles. Lit by the sky (top brighter), by the engine flame (orange, falls off with distance),
// with per-particle rotation. kind: 0 = exhaust smoke (warm grey), 1 = steam (white).
// Soft-particle depth fade + a near-camera / screen-size fade keep a close pad cam from sitting inside a cream wall.
export class Smoke {
  constructor(max) { this.build(max); this.live = 0; }
  build(max) {
    if (this.points) { this.points.removeFromParent(); this.points.geometry.dispose(); }
    this.max = max; this.n = 0; this.cursor = 0; this.live = 0; this.fresh = true;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max);
    this.size = new Float32Array(max); this.heat = new Float32Array(max); this.grow = new Float32Array(max); this.kind = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1); this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1); this.aHeat = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1); this.aKind = new THREE.BufferAttribute(this.kind, 1);
    for (let i = 0; i < max; i++) this.aRot.array[i] = (i * 2.399) % 6.283;
    geo.setAttribute('size', this.aSize); geo.setAttribute('alpha', this.aAlpha); geo.setAttribute('heat', this.aHeat); geo.setAttribute('rot', this.aRot); geo.setAttribute('kind', this.aKind);
    this.mat = this.mat || new THREE.ShaderMaterial({
      uniforms: {
        map: { value: smokeTex() }, scale: { value: 600 }, uFlame: { value: new THREE.Vector3() }, uFlameI: { value: 0 },
        uSky: { value: new THREE.Color(0.62, 0.64, 0.66) }, uSun: { value: new THREE.Color(1, 0.95, 0.88) },
        tDepth: { value: null }, uHasDepth: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.4 }, uFar: { value: 60000 }, uSoft: { value: 2.4 },
      },
      transparent: true, depthWrite: false, depthTest: true,
      vertexShader: `attribute float size, alpha, heat, rot, kind; uniform float scale, uFlameI; uniform vec3 uFlame; varying float vA, vH, vR, vK, vL, vZ, vSoft;
        void main(){ vA = alpha; vH = heat; vR = rot; vK = kind; vec4 wp = modelMatrix * vec4(position, 1.0); float d = distance(wp.xyz, uFlame);
          vL = min(0.35, uFlameI / (1.0 + d * d / 200.0));
          vec4 mv = viewMatrix * wp; vZ = -mv.z;
          float raw = size * scale / max(vZ, 0.15);
          // cap screen size so a close cam never sees a full-frame polygon, and fade huge sprites
          float caps = min(raw, 180.0); vSoft = size;
          vA *= smoothstep(2.2, 12.0, vZ) * min(1.0, 140.0 / max(raw, 1.0)) * (1.0 - smoothstep(2500.0, 12000.0, vZ));   // far puffs melt into the haze instead of hanging as a dark blob over the planet
          gl_PointSize = caps; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map, tDepth; uniform vec3 uSky, uSun; uniform float uHasDepth, uNear, uFar, uSoft; uniform vec2 uRes;
        varying float vA, vH, vR, vK, vL, vZ, vSoft;
        float linDepth(float z){ float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
        void main(){ vec2 q = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); q = mat2(c, -s, s, c) * q;
          float rr = length(q) * 2.0; if (rr > 1.0) discard;
          vec4 t = texture2D(map, q + 0.5);
          float a = t.a * vA * (1.0 - smoothstep(0.72, 1.0, rr));
          if (uHasDepth > 0.5) { float sceneZ = linDepth(texture2D(tDepth, gl_FragCoord.xy / uRes).r); a *= smoothstep(0.0, max(0.6, vSoft * 0.45) + uSoft, sceneZ - vZ); }
          if (a < 0.008) discard;
          float top = t.r;
          vec3 base = mix(vec3(0.28, 0.27, 0.25), vec3(0.62, 0.63, 0.65), vK);
          vec3 col = base * (uSky * 0.38 + uSun * 0.32 * top) * mix(0.55, 1.0, top) + vec3(1.0, 0.48, 0.18) * (vL * 0.35 * (1.0 - top) + vH * 0.28);
          gl_FragColor = vec4(col, a); }`,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.points.userData.noAO = true; this.points.renderOrder = 4;
  }
  // Opaque-scene depth, sampled so puffs fade as they wrap the rocket, pad and ground instead of cutting a hard edge.
  prepareDepth(renderer, scene, camera) {
    if (!this.live) { this.mat.uniforms.uHasDepth.value = 0; return; }
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!this.depthRT || this._dw !== w || this._dh !== h) {
      this.depthRT?.dispose();
      const dt = new THREE.DepthTexture(w, h); dt.format = THREE.DepthFormat; dt.type = THREE.UnsignedIntType;
      this.depthRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
      this._dw = w; this._dh = h;
    }
    const prev = renderer.getRenderTarget(), vis = this.points.visible;
    this.points.visible = false;
    renderer.setRenderTarget(this.depthRT); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(prev); this.points.visible = vis;
    const u = this.mat.uniforms; u.tDepth.value = this.depthRT.depthTexture; u.uHasDepth.value = 1;
    u.uRes.value.set(w, h); u.uNear.value = camera.near; u.uFar.value = camera.far;
  }
  emit(x, y, z, vx, vy, vz, size, life, heat = 0, grow = 1, kind = 0) {
    // take the next free slot; if the ring is full, take the most-aged of the next few so a young, fully visible
    // puff is never the one that vanishes (that was the visible "pop" when the pool filled up)
    let i = this.cursor, best = -1;
    for (let n = 0, j = i; n < 12; n++, j = j + 1 === this.max ? 0 : j + 1) {
      const r = this.age[j] / this.life[j];
      if (!(r < 1)) { i = j; best = Infinity; break; }
      if (r > best) { best = r; i = j; }
    }
    this.cursor = i + 1 === this.max ? 0 : i + 1;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.heat[i] = heat; this.grow[i] = grow; this.kind[i] = kind; this.fresh = true;
  }
  light(pos, intensity, sky, sun) { const u = this.mat.uniforms; u.uFlame.value.copy(pos); u.uFlameI.value = intensity; if (sky) u.uSky.value.copy(sky); if (sun) u.uSun.value.copy(sun); }
  update(dt, wind, viewH) {
    this.mat.uniforms.scale.value = viewH * 0.85;
    if (!this.live && !this.fresh) return;   // nothing alive and nothing new: skip the loop and the five buffer uploads
    this.fresh = false;
    const S = this.aSize.array, A = this.aAlpha.array, H = this.aHeat.array, R = this.aRot.array;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i] += dt;
      if (a > this.life[i]) { A[i] = 0; continue; }
      const k = a / this.life[i], drag = Math.exp(-dt * 1.1);
      this.v[i * 3] = this.v[i * 3] * drag + wind.x * (1 - drag); this.v[i * 3 + 1] = this.v[i * 3 + 1] * drag + (0.8 + this.kind[i] * 1.2) * dt; this.v[i * 3 + 2] = this.v[i * 3 + 2] * drag + wind.z * (1 - drag);
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] = Math.max(0.2, this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt); this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      S[i] = this.size[i] * (1 + Math.sqrt(k) * 1.35 * this.grow[i]);
      A[i] = Math.min(1, a * 5) * Math.pow(1 - k, 1.55) * 0.32;
      H[i] = this.heat[i] * Math.max(0, 1 - a * 2.5);
      R[i] += dt * 0.12 * ((i & 1) ? 1 : -1);
      live++;
    }
    this.live = live;
    this.points.geometry.attributes.position.needsUpdate = true; this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aHeat.needsUpdate = this.aRot.needsUpdate = this.aKind.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); this.fresh = true; }
}

// Sparks and burning debris kicked out of the trench at ignition / liftoff: additive streaks with gravity.
export class Sparks {
  constructor(max = 400) {
    this.max = max; this.cursor = 0; this.live = 0; this.fresh = true; this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.aB = new THREE.BufferAttribute(new Float32Array(max), 1); geo.setAttribute('bright', this.aB);
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float bright; uniform float scale; varying float vB; void main(){ vB = bright; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(0.1 * scale / -mv.z, 1.0, 5.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vB; void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(0.0, 1.0 - length(d) * 2.0); if (vB <= 0.0 || a <= 0.0) discard; gl_FragColor = vec4(vec3(1.0, 0.62, 0.25) * vB * a * 12.0, 1.0); }' }));
    this.points.frustumCulled = false; this.points.userData.noAO = true;
  }
  emit(x, y, z, vx, vy, vz, life) { const i = this.cursor; this.cursor = (this.cursor + 1) % this.max; const j = i * 3; this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz; this.age[i] = 0; this.life[i] = life; this.fresh = true; }
  update(dt, viewH) {
    this.points.material.uniforms.scale.value = viewH; const B = this.aB.array;
    if (!this.live && !this.fresh) return;   // idle: no loop, no upload
    this.fresh = false; let live = 0;
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i] += dt; if (a > this.life[i]) { B[i] = 0; continue; }
      live++;
      this.v[i * 3 + 1] -= 9.81 * dt; for (let k = 0; k < 3; k++) this.p[i * 3 + k] += this.v[i * 3 + k] * dt;
      if (this.p[i * 3 + 1] < 0.05) { this.p[i * 3 + 1] = 0.05; this.v[i * 3 + 1] *= -0.35; this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6; }
      B[i] = Math.pow(1 - a / this.life[i], 1.5);
    }
    this.live = live; this.points.geometry.attributes.position.needsUpdate = true; this.aB.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); this.fresh = true; }
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
