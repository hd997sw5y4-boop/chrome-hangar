// The whole planet for high flights: NASA Blue Marble NG day colour, Blue Marble clouds, Black Marble night lights.
// Drawn in its own pass (kilometre units, own near/far) behind the local scene, so depth precision holds at any height.
// Local frame: world +x = real west, +y = up, +z = real north (see tools/make_dem.py); the launch site sits at its real lat/lon.
import * as THREE from 'three';

export const GLOBE_FADE = { value: 0 };          // 0 = local terrain solid, 1 = terrain fully dissolved into the globe
const R = 6371.0;                                 // km
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Earth {
  constructor(world) {
    this.w = world; this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(60, 1, 1, 1e5);
    this.ready = false; this.loading = null; this.lat = 34.968; this.lon = -120.616; this.t = 0;
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
  load(info) {
    if (this.loading) return this.loading;
    if (info?.lat) { this.lat = info.lat; this.lon = info.lon; }
    const k = this.tier(), L = new THREE.TextureLoader(), an = Math.min(8, this.w.renderer.capabilities.getMaxAnisotropy());
    const tx = (n, srgb) => L.loadAsync(`assets/earth/${n}.webp`).then(t => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = an; t.wrapS = THREE.RepeatWrapping; return t; });
    this.loading = Promise.all([tx(`earth_day_${k}k`, true), tx(`earth_night_${Math.min(k, 4)}k`, false), tx('earth_clouds_2k', false)]).then(([day, night, clouds]) => this.build(day, night, clouds)).catch(e => console.warn('earth', e));
    return this.loading;
  }
  build(day, night, clouds) {
    const lite = this.tier() === 2, M = this.frame(this.w.seaLevel || 0);
    this.U = {
      tDay: { value: day }, tNight: { value: night }, tCloud: { value: clouds }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 },
      uCam: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3().setFromMatrixPosition(M) }, uT: { value: 0 }, uCloudK: { value: 0 },
      uFogC: { value: new THREE.Color() }, uFogD: { value: 0 }, uR: { value: R }, uAtmK: { value: 0 },
    };
    const vs = `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
    const ground = new THREE.ShaderMaterial({
      uniforms: this.U, vertexShader: vs,
      fragmentShader: `uniform sampler2D tDay, tNight, tCloud; uniform vec3 uSun, uCam, uC, uFogC; uniform float uSunI, uT, uCloudK, uFogD, uR, uAtmK;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){
        vec3 N = normalize(vN), V = normalize(uCam - vW), L = normalize(uSun);
        float ndl = dot(N, L), lit = max(ndl, 0.0);
        vec3 day = texture2D(tDay, vUv).rgb;
        float water = smoothstep(0.02, 0.0, day.r - day.b * 0.6) * smoothstep(0.12, 0.03, dot(day, vec3(0.33)));
        vec3 col = day * (lit * uSunI * 0.55 + 0.012);
        vec3 H = normalize(L + V); col += water * vec3(1.0, 0.92, 0.8) * pow(max(dot(N, H), 0.0), 90.0) * uSunI * 0.6 * lit;
        float c = texture2D(tCloud, vUv + vec2(uT * 0.000004, 0.0)).r; c = smoothstep(0.12, 0.85, c) * uCloudK;
        col = mix(col, vec3(1.0) * (lit * uSunI * 0.62 + 0.015), c * 0.92);
        float nightK = smoothstep(0.08, -0.18, ndl);
        float lights = pow(texture2D(tNight, vUv).r, 1.6);
        col += vec3(1.0, 0.72, 0.42) * lights * nightK * (1.0 - c * 0.8) * 1.4;
        // atmosphere: thick blue at the limb on the day side, orange at the terminator
        float mu = clamp(dot(N, V), 0.0, 1.0), rim = pow(1.0 - mu, 3.0);
        float dayK = smoothstep(-0.25, 0.35, ndl);
        vec3 atm = mix(vec3(0.9, 0.45, 0.2), vec3(0.32, 0.55, 1.0), smoothstep(-0.05, 0.4, ndl));
        col = mix(col, atm * uSunI * 0.5 * dayK, clamp(rim * 0.85 + 0.08, 0.0, 1.0) * uAtmK * dayK);
        // same aerial perspective as the local scene's FogExp2 (metres)
        float d = length(uCam - vW) * 1000.0, fog = 1.0 - exp(-uFogD * uFogD * d * d);
        col = mix(col, uFogC, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    const seg = lite ? [160, 80] : [320, 160];
    const g = new THREE.Mesh(new THREE.SphereGeometry(R, seg[0], seg[1]), ground);
    g.matrixAutoUpdate = false; g.matrix.copy(M); g.matrixWorldNeedsUpdate = true; g.frustumCulled = false; this.globe = g;
    // limb glow shell: brightness from how close the view ray skims the planet (works from inside or outside the shell)
    const atmMat = new THREE.ShaderMaterial({
      uniforms: this.U, vertexShader: vs, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      fragmentShader: `uniform vec3 uSun, uCam, uC; uniform float uSunI, uR, uAtmK; varying vec3 vW;
      void main(){
        vec3 D = normalize(vW - uCam), O = uCam - uC;
        float b = dot(O, D), tc = max(-b, 0.0); vec3 P = O + D * tc; float h = length(P) - uR;
        float g = exp(-max(h, 0.0) / 9.0) * smoothstep(-1.0, 4.0, h + 4.0);
        float sunK = dot(normalize(P), normalize(uSun));
        vec3 col = mix(vec3(1.0, 0.45, 0.18), vec3(0.3, 0.55, 1.0), smoothstep(-0.1, 0.35, sunK)) * smoothstep(-0.35, 0.2, sunK);
        gl_FragColor = vec4(col * g * uSunI * 0.55 * uAtmK, 1.0);
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
    this.scene.add(this.stars, g, a); this.ready = true;
  }
  // altitude in metres of the camera; returns true if this pass should draw
  active(alt) { return alt > 1200; }
  render(r, camera, dt) {
    const w = this.w, alt = camera.position.y;
    if (!this.ready) { if (alt > 600) this.load(w.demInfo); return false; }
    this.t += dt;
    const c = this.cam; c.position.copy(camera.position).multiplyScalar(0.001); c.quaternion.copy(camera.quaternion);
    c.fov = camera.fov; c.aspect = camera.aspect; c.near = Math.max(0.005, alt * 0.0005 * 0.4); c.far = 1e5; c.updateProjectionMatrix();
    const U = this.U; U.uCam.value.copy(c.position); U.uSun.value.copy(w.sunDir || new THREE.Vector3(0, 1, 0)); U.uSunI.value = Math.max(0.6, w.sun.intensity);
    U.uT.value = this.t; U.uCloudK.value = sstep(6000, 30000, alt); U.uAtmK.value = sstep(2000, 25000, alt);
    U.uFogC.value.copy(w.scene.fog.color); U.uFogD.value = w.scene.fog.density;
    this.stars.position.copy(c.position); this.starMat.opacity = sstep(18000, 70000, alt);
    this.scene.background = w.skyTexForEarth; this.scene.backgroundIntensity = w.scene.backgroundIntensity;
    this.scene.backgroundRotation.copy(w.scene.backgroundRotation);
    r.render(this.scene, c);
    return true;
  }
}
