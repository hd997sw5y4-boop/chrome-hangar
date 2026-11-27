// The planet, drawn in its own pass (kilometre units, own near/far) behind the local scene, so depth precision holds at any height.
// - Globe: NASA Blue Marble NG day colour, Blue Marble clouds, Black Marble night lights, for everything far from the range.
// - Regional patch around the range: 8 nested imagery + relief levels (1024 km down to 8 km across, tools/bake_levels.py),
//   streamed in as the camera gets close and blended per pixel by view distance, so there is ground to the horizon at
//   every height and no tile edges. A camera-centred grid carries the real relief (USGS 3DEP).
// - Shared water shading (same maths as the local ocean), height-integrated blue haze, glowing limb against black space.
// Local frame: world +x = real west, +y = up, +z = real north; the world origin sits at the levels' lat/lon.
import * as THREE from 'three';
import { HAZE_H } from './haze.js';

export const GLOBE_FADE = { value: 0 };                                       // 0 = local terrain solid, 1 = dissolved into the planet
export const TERRAIN_FADE = { value: new THREE.Vector2(1e9, 2e9) };           // radial band (m) where local terrain + sea hand over to the planet
const NL = 8;
export const LEVELS = { tLvC: { value: null }, tLvN: { value: null }, uLv: { value: new Float32Array(NL) }, uE0: { value: 1024 } };
const R = 6371.0;                                                             // km
const HS = 5000.0;                                                            // relief encoding: h = b^2 * HS (m)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// shared GLSL: level sampling, haze in km space, water
const GLSL_COMMON = `
uniform sampler2DArray tLvC, tLvN; uniform float uLv[${NL}]; uniform float uE0, uKd, uR, uFogD; uniform vec3 uC, uFogC;
float lvEdge(vec2 uv){ return min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)); }
float hazeKm(vec3 c, vec3 p){
  float d = length(p - c) * 1000.0, h0 = max((length(c - uC) - uR) * 1000.0, 0.0), h1 = max((length(p - uC) - uR) * 1000.0, 0.0), dh = h1 - h0;
  float e0 = exp(-h0 / ${HAZE_H.toFixed(1)}), e1 = exp(-h1 / ${HAZE_H.toFixed(1)});
  float m = abs(dh) > 1.0 ? (e0 - e1) * ${HAZE_H.toFixed(1)} / dh : e0;
  return 1.0 - exp(-uFogD * d * m);
}`;
const GLSL_WATER = `
uniform sampler2D tWave; uniform float uWT; uniform vec3 uDeep, uShallow, uHorizon, uZenith, uSunCol;
vec3 waterCol(vec3 Ns, vec3 V, vec3 L, vec2 pm, float dm, float dayK){
  vec3 n1 = texture2D(tWave, pm / 61.0 + vec2(uWT * 0.011, uWT * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWave, pm / 17.0 - vec2(uWT * 0.017, -uWT * 0.013)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tWave, pm / 380.0 + vec2(uWT * 0.003, 0.0)).xyz * 2.0 - 1.0;
  vec3 t = normalize(vec3(n1.x + n2.x * 0.6 + n3.x * 0.8, 6.0, n1.y + n2.y * 0.6 + n3.y * 0.8));
  t = normalize(mix(t, vec3(0.0, 1.0, 0.0), clamp(smoothstep(800.0, 9000.0, dm) * 0.8 + smoothstep(20000.0, 90000.0, dm) * 0.2, 0.0, 1.0)));
  vec3 nn = normalize(Ns * t.y + vec3(t.x, 0.0, t.z));
  vec3 Rf = reflect(-V, nn); float up = max(dot(Rf, Ns), 0.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.5));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(nn, V), 0.0), 5.0);
  fres *= mix(1.0, 0.55, smoothstep(15000.0, 200000.0, dm));        // wave slopes average out the far mirror
  vec3 col = mix(mix(mix(uDeep, uShallow, 0.25 + 0.25 * n1.x), uDeep, smoothstep(8000.0, 60000.0, dm)), sky, fres);
  float ex = mix(380.0, 40.0, smoothstep(6000.0, 300000.0, dm));
  return col + uSunCol * pow(max(dot(Rf, L), 0.0), ex) * 6.0 * (ex + 2.0) / 382.0 * dayK;
}`;

// Nested imagery levels in two texture arrays; a level streams in when the camera comes near and drops out of the blend when far.
class Levels {
  constructor(lite) {
    this.cs = lite ? 512 : 1024; this.ns = lite ? 256 : 512;
    const mk = (s, srgb) => {
      const t = new THREE.DataArrayTexture(new Uint8Array(s * s * 4 * NL), s, s, NL);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = lite ? 2 : 4;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
    };
    this.col = mk(this.cs, true); this.nrm = mk(this.ns, false);
    LEVELS.tLvC.value = this.col; LEVELS.tLvN.value = this.nrm;
    this.state = new Uint8Array(NL); this.want = new Uint8Array(NL); this.busy = 0;
  }
  async decode(url, s) {
    const bm = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = this.cv ||= document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, s, s); g.drawImage(bm, 0, 0, s, s); bm.close?.();
    return g.getImageData(0, 0, s, s).data;   // row 0 = south, like the bake
  }
  async fetchLevel(k) {
    this.state[k] = 1; this.busy++;
    try {
      const [c, n] = await Promise.all([this.decode(`assets/earth/levels/col_${k}.webp`, this.cs), this.decode(`assets/earth/levels/nrm_${k}.webp`, this.ns)]);
      this.col.image.data.set(c, k * this.cs * this.cs * 4); this.col.addLayerUpdate(k); this.col.needsUpdate = true;
      this.nrm.image.data.set(n, k * this.ns * this.ns * 4); this.nrm.addLayerUpdate(k); this.nrm.needsUpdate = true;
      this.state[k] = 2;
    } catch (e) { console.warn('earth level', k, e); this.state[k] = 3; }
    this.busy--;
  }
  // p = camera in local km; levels 0-1 always, finer ones within a few extents of the camera (one fetch at a time)
  update(p, dt, kd) {
    const w = LEVELS.uLv.value;
    for (let k = 0; k < NL; k++) {
      const E = 1024 / 2 ** k, dx = Math.max(0, Math.abs(p.x) - E / 2), dz = Math.max(0, Math.abs(p.z) - E / 2), d = Math.hypot(dx, dz, Math.max(0, p.y));
      const reach = kd / 2 ** k * 2.6;                     // the shader starts blending level k in at kd / 2^(k-1)
      if (k < 2 || d < reach) this.want[k] = 1; else if (d > reach * 1.5) this.want[k] = 0;
      if (this.want[k] && this.state[k] === 0 && this.busy < 2) this.fetchLevel(k);
      const tgt = this.want[k] && this.state[k] === 2 ? 1 : 0;
      w[k] = tgt > w[k] ? Math.min(1, w[k] + dt * 1.5) : Math.max(0, w[k] - dt * 1.5);
    }
  }
}

export class Earth {
  constructor(world) {
    this.w = world; this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(60, 1, 1, 1e5);
    this.ready = false; this.loading = null; this.lat = 34.969; this.lon = -120.616; this.t = 0;
  }
  tier() { const q = this.w.quality; return q === 'ultra' ? 8 : (q === 'phone' || q === 'low') ? 2 : 4; }
  // frame: sphere-object -> local (km), sphere centre below the site
  frame(sea = 0) {
    const f = THREE.MathUtils.degToRad(this.lat), l = THREE.MathUtils.degToRad(this.lon);
    const u = new THREE.Vector3(Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f));
    const e = new THREE.Vector3(-Math.sin(l), Math.cos(l), 0);
    const n = new THREE.Vector3(-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f));
    const B = new THREE.Matrix4().set(-e.x, -e.y, -e.z, 0, u.x, u.y, u.z, 0, n.x, n.y, n.z, 0, 0, 0, 0, 1);   // ecef -> local
    const A = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);                        // sphere obj -> ecef
    return new THREE.Matrix4().makeTranslation(0, -R + sea / 1000, 0).multiply(B).multiply(A);
  }
  get lite() { return this.tier() === 2; }
  // streaming starts as soon as we are outdoors (the local terrain borrows the fine levels for its colour too)
  prepare(camera, dt) {
    if (!this.lv) this.lv = new Levels(this.lite);
    if (!this.ready) this.load();
    this.kd = this.lite ? 850 : 1700;
    this.lv.update(new THREE.Vector3(camera.position.x * 0.001, camera.position.y * 0.001, camera.position.z * 0.001), dt, this.kd);
  }
  load() {
    if (this.loading) return this.loading;
    if (!this.lv) this.lv = new Levels(this.lite);
    const k = this.tier(), L = new THREE.TextureLoader(), an = Math.min(8, this.w.renderer.capabilities.getMaxAnisotropy());
    const tx = (n, srgb) => L.loadAsync(`assets/earth/${n}.webp`).then(t => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = an; t.wrapS = THREE.RepeatWrapping; return t; });
    const info = fetch('assets/earth/levels/levels.json').then(r => r.json()).then(j => { this.lat = j.lat; this.lon = j.lon; LEVELS.uE0.value = j.E0; });
    this.loading = Promise.all([tx(`earth_day_${k}k`, true), tx(`earth_night_${Math.min(k, 4)}k`, false), tx(`earth_clouds_${k}k`, false), info])
      .then(([day, night, clouds]) => this.build(day, night, clouds)).catch(e => console.warn('earth', e));
    return this.loading;
  }
  build(day, night, clouds) {
    const lite = this.lite, M = this.frame(this.w.seaLevel || 0), o = this.w.outdoor?.oceanMat?.uniforms;
    const toObj = new THREE.Matrix3().setFromMatrix4(M).invert();   // local direction -> sphere object (rotation only)
    this.U = {
      ...LEVELS, tDay: { value: day }, tNight: { value: night }, tCloud: { value: clouds }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 },
      uCam: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3().setFromMatrixPosition(M) }, uT: { value: 0 }, uCloudK: { value: 0 },
      uFogC: { value: new THREE.Color() }, uFogD: { value: 0 }, uR: { value: R }, uAtmK: { value: 0 }, uKd: { value: 1700 }, uAmb: { value: 0.3 },
      uToObj: { value: toObj }, uSeaK: { value: (this.w.seaLevel || 0) / 1000 }, uNs: { value: this.lv.ns }, uGrid: { value: new THREE.Vector4(0, 0, 4, 1024) }, uHole: { value: 0 },
      tWave: { value: o?.tN.value || null }, uWT: { value: 0 }, uDeep: { value: new THREE.Color(0x06283c) }, uShallow: { value: new THREE.Color(0x1c6a7c) },
      uHorizon: { value: new THREE.Color(0xc3ccd4) }, uZenith: { value: new THREE.Color(0x5f8fc0) }, uSunCol: { value: new THREE.Color(1, 0.92, 0.8) },
    };
    const vs = `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
    // shared shading tail: clouds, night lights, limb tint, haze
    const tail = `
        float c = texture2D(tCloud, cuv + vec2(uT * 0.000004, 0.0)).r; c = smoothstep(0.3, 0.92, c) * uCloudK * 0.9;
        col = mix(col, vec3(1.0) * (flit * uSunI * 0.36 + 0.015), c * 0.92);
        float nightK = smoothstep(0.08, -0.18, ndl0);
        col += vec3(1.0, 0.72, 0.42) * pow(texture2D(tNight, cuv).r, 1.6) * nightK * (1.0 - c * 0.8) * 1.4;
        float mu = clamp(dot(Ns, V), 0.0, 1.0), rim = pow(1.0 - mu, 3.0);
        vec3 atm = mix(vec3(0.9, 0.45, 0.2), vec3(0.32, 0.55, 1.0), smoothstep(-0.05, 0.4, ndl0));
        col = mix(col, atm * uSunI * 0.28 * dayK, clamp(rim * 0.7 + 0.04, 0.0, 1.0) * uAtmK * dayK);
        col = mix(col, uFogC * mix(0.25, 1.0, dayK), hazeKm(uCam, vW));`;
    const ground = new THREE.ShaderMaterial({
      uniforms: this.U, vertexShader: vs,
      fragmentShader: `uniform sampler2D tDay, tNight, tCloud; uniform vec3 uSun, uCam; uniform float uSunI, uT, uCloudK, uAtmK, uAmb;
      ${GLSL_COMMON}
      ${GLSL_WATER}
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){
        // inside the regional patch the patch draws the ground
        vec2 e0 = (vW.xz / uE0) + 0.5; if (vW.y > uC.y && uLv[0] > 0.999 && lvEdge(e0) >= 0.08) discard;
        vec3 Ns = normalize(vN), V = normalize(uCam - vW), L = normalize(uSun);
        float ndl0 = dot(Ns, L), flit = max(ndl0, 0.0), dayK = smoothstep(-0.1, 0.3, ndl0);
        vec3 day = texture2D(tDay, vUv).rgb; vec2 cuv = vUv;
        float water = smoothstep(0.02, 0.0, day.r - day.b * 0.6) * smoothstep(0.12, 0.03, dot(day, vec3(0.33)));
        vec3 col = day * (flit * uSunI * 0.318 + uAmb * dayK);
        float dm = length(uCam - vW) * 1000.0;
        col = mix(col, waterCol(Ns, V, L, vW.xz * 1000.0, dm, dayK), water);
        ${tail}
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    const seg = lite ? [160, 80] : [320, 160];
    const g = new THREE.Mesh(new THREE.SphereGeometry(R, seg[0], seg[1]), ground);
    g.matrixAutoUpdate = false; g.matrix.copy(M); g.matrixWorldNeedsUpdate = true; g.frustumCulled = false; this.globe = g;
    // regional patch: camera-centred grid s in [-1,1]^2, planar km = centre + B s + A s^5, on the sphere plus relief
    const N = lite ? 128 : 224, pos = new Float32Array((N + 1) * (N + 1) * 3), idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = (j * (N + 1) + i) * 3; pos[k] = i / N * 2 - 1; pos[k + 2] = j / N * 2 - 1; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setIndex(idx);
    const patchMat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: true,
      vertexShader: `uniform sampler2DArray tLvN; uniform float uLv[${NL}]; uniform float uE0, uKd, uR, uSeaK, uNs; uniform vec4 uGrid; uniform vec3 uCam;
        varying vec3 vW; varying vec2 vPl; varying float vCover;
        float lvEdge(vec2 uv){ return min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)); }
        void main(){
          vec2 s = position.xz, s2 = s * s;
          vec2 pl = clamp(uGrid.xy + uGrid.z * s + uGrid.w * s * s2 * s2, vec2(-0.5 * uE0), vec2(0.5 * uE0));
          float spk = (uGrid.z + 5.0 * uGrid.w * max(s2.x * s2.x, s2.y * s2.y)) * (2.0 / ${N}.0);   // vertex spacing (km)
          float r2 = dot(pl, pl), up = sqrt(max(uR * uR - r2, 0.0));
          vec3 n = vec3(pl.x, up, pl.y) / uR;
          vec3 base = vec3(pl.x, uSeaK - r2 / (up + uR), pl.y);          // sphere surface, without cancelling 6371 - 6371
          float f = log2(uKd / max(length(base - uCam), 0.001)), h = 0.0, cover = 0.0;
          for (int k = 0; k < ${NL}; k++) {
            float E = uE0 / exp2(float(k)); vec2 uv = pl / E + 0.5;
            float w = smoothstep(0.0, 0.08, lvEdge(uv)) * uLv[k] * (k == 0 ? 1.0 : clamp(f - float(k) + 1.0, 0.0, 1.0));
            if (k == 0) cover = w;
            if (w > 0.001) { float b = textureLod(tLvN, vec3(uv, float(k)), max(0.0, log2(spk * uNs / E))).b; h = mix(h, b * b * ${HS.toFixed(1)}, k == 0 ? 1.0 : w); }
          }
          vW = base + n * (h * 0.001 * cover); vPl = pl; vCover = cover;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: `uniform sampler2D tNight, tCloud; uniform vec3 uSun, uCam; uniform float uSunI, uT, uCloudK, uAtmK, uAmb, uHole; uniform mat3 uToObj;
      ${GLSL_COMMON}
      ${GLSL_WATER}
      varying vec3 vW; varying vec2 vPl; varying float vCover;
      void main(){
        if (length(vPl) < uHole) discard;                                 // the opaque local terrain covers this
        vec3 Ns = normalize(vW - uC), V = normalize(uCam - vW), L = normalize(uSun);
        float d = length(vW - uCam), f = log2(uKd / max(d, 0.001));
        vec2 gx = dFdx(vPl), gy = dFdy(vPl);
        vec3 alb = vec3(0.0); vec4 nr = vec4(0.5, 0.5, 0.0, 1.0);
        for (int k = 0; k < ${NL}; k++) {
          float E = uE0 / exp2(float(k)); vec2 uv = vPl / E + 0.5;
          float w = smoothstep(0.0, 0.08, lvEdge(uv)) * uLv[k] * (k == 0 ? 1.0 : clamp(f - float(k) + 1.0, 0.0, 1.0));
          if (k == 0 || w > 0.001) {
            vec3 q = vec3(uv, float(k)); float m = k == 0 ? 1.0 : w;
            alb = mix(alb, textureGrad(tLvC, q, gx / E, gy / E).rgb, m);
            nr = mix(nr, textureGrad(tLvN, q, gx / E, gy / E), m);
          }
        }
        float land = clamp(nr.a, 0.0, 1.0);
        vec2 t = nr.rg * 2.0 - 1.0; float ty = sqrt(max(1.0 - dot(t, t), 0.05));
        vec3 N = normalize(mix(Ns, normalize(Ns * ty + vec3(t.x, 0.0, t.y)), land));
        float ndl0 = dot(Ns, L), flit = max(ndl0, 0.0), dayK = smoothstep(-0.1, 0.3, ndl0);
        float lit = mix(flit, max(dot(N, L), 0.0), 0.7) * smoothstep(-0.12, 0.1, ndl0);
        vec3 col = alb * (lit * uSunI * 0.48 + uAmb * dayK);
        col = mix(waterCol(Ns, V, L, vPl * 1000.0, d * 1000.0, dayK), col, land);
        // equirect lookups for clouds / night lights (the texture seam is far outside the patch)
        vec3 dO = normalize(uToObj * Ns);
        float u = atan(dO.z, -dO.x) / 6.2831853; u = fract(u); vec2 cuv = vec2(u, 1.0 - acos(clamp(dO.y, -1.0, 1.0)) / 3.14159265);
        ${tail}
        gl_FragColor = vec4(col, vCover);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    const patch = new THREE.Mesh(pg, patchMat); patch.frustumCulled = false; patch.renderOrder = 1; this.patch = patch;
    // limb glow shell: brightness from how close the view ray skims the planet (works from inside or outside the shell)
    const atmMat = new THREE.ShaderMaterial({
      uniforms: this.U, vertexShader: vs, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      fragmentShader: `uniform vec3 uSun, uCam, uC; uniform float uSunI, uR, uAtmK; varying vec3 vW;
      void main(){
        vec3 D = normalize(vW - uCam), O = uCam - uC;
        float b = dot(O, D), tc = max(-b, 0.0); vec3 P = O + D * tc; float h = length(P) - uR;
        float g = exp(-max(h, 0.0) / 7.0) * smoothstep(-1.0, 4.0, h + 4.0);
        float sunK = dot(normalize(P), normalize(uSun));
        vec3 col = mix(vec3(1.0, 0.45, 0.18), vec3(0.3, 0.55, 1.0), smoothstep(-0.1, 0.35, sunK)) * smoothstep(-0.35, 0.2, sunK);
        gl_FragColor = vec4(col * g * uSunI * 0.32 * uAtmK, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    const a = new THREE.Mesh(new THREE.SphereGeometry(R + 90, 96, 48), atmMat);
    a.matrixAutoUpdate = false; a.matrix.copy(M); a.frustumCulled = false; a.renderOrder = 2;
    // stars (follow the camera)
    const n = lite ? 1800 : 4000, p = new Float32Array(n * 3), cl = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = Math.random() * 2 - 1, t = Math.random() * 6.283, r = Math.sqrt(1 - z * z), m = Math.pow(Math.random(), 6) * 1.4 + 0.18, w = Math.random();
      p.set([r * Math.cos(t) * 8e4, z * 8e4, r * Math.sin(t) * 8e4], i * 3); cl.set([m * (0.85 + 0.15 * w), m * 0.9, m * (1.05 - 0.2 * w)], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3)); sg.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    this.starMat = new THREE.PointsMaterial({ size: lite ? 1.6 : 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -1;
    this.scene.add(this.stars, g, patch, a); this.ready = true;
  }
  // draws sky + planet; false until loaded (the local terrain then runs to its own edge)
  render(r, camera, dt) {
    const w = this.w, alt = camera.position.y;
    if (!this.ready) return false;
    this.t += dt;
    const c = this.cam; c.position.copy(camera.position).multiplyScalar(0.001); c.quaternion.copy(camera.quaternion);
    c.fov = camera.fov; c.aspect = camera.aspect;
    // near plane in km: a fraction of altitude, capped, so we never clip the 90 km atmosphere shell or the horizon
    const hKm = Math.max(0.001, alt * 0.001); c.near = Math.max(0.005, Math.min(hKm * 0.08, 2)); c.far = 1e5; c.updateProjectionMatrix();
    const U = this.U; U.uCam.value.copy(c.position); U.uSun.value.copy(w.sunDir || new THREE.Vector3(0, 1, 0)); U.uSunI.value = Math.max(0.6, w.sun.intensity);
    U.uT.value = this.t; U.uCloudK.value = sstep(15000, 120000, alt); U.uAtmK.value = sstep(2000, 25000, alt); U.uKd.value = this.kd || 1700;
    U.uFogC.value.copy(w.scene.fog.color); U.uFogD.value = w.scene.fog.density;
    U.uHole.value = GLOBE_FADE.value > 0 || this.noHole ? 0 : TERRAIN_FADE.value.x * 0.001 - 0.2;
    U.uAmb.value = w.hazeAmb ?? 0.3;
    const o = w.outdoor?.oceanMat?.uniforms;
    if (o) { U.tWave.value = o.tN.value; U.uWT.value = o.uT.value; for (const k of ['uDeep', 'uShallow', 'uHorizon', 'uZenith', 'uSunCol']) U[k].value.copy(o[k].value); }
    // camera-centred patch grid: vertex spacing ~4% of altitude (powers of two, snapped, so the mesh does not swim)
    const sp = 2 ** Math.round(Math.log2(THREE.MathUtils.clamp(hKm * 0.04, 0.03, 4))), N = this.lite ? 128 : 224, snap = sp * 2;
    U.uGrid.value.set(Math.round(c.position.x / snap) * snap, Math.round(c.position.z / snap) * snap, sp * N / 2, 1100);
    this.stars.position.copy(c.position); this.starMat.opacity = sstep(18000, 70000, alt);
    // drop the ground HDRI once stars take over, so space is black rather than a smeared sky photo
    const space = alt > 25000;
    if (space) { this.scene.background = null; }
    else { this.scene.background = w.skyTexForEarth; this.scene.backgroundIntensity = w.scene.backgroundIntensity; this.scene.backgroundRotation.copy(w.scene.backgroundRotation); }
    const prevC = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    if (space) r.setClearColor(0x000000, 1);
    r.render(this.scene, c);
    if (space) r.setClearColor(prevC, prevA);
    return true;
  }
}
