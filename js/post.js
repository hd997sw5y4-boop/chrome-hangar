// Post-processing pipeline (three.js addons): scene pass (world + planet into an HDR buffer with a float
// depth texture, 4x MSAA when the AA mode asks for it -> GTAO from that same depth, so there is no second
// whole-scene normal render -> NaN guard) -> depth of field -> HDR bloom -> SMAA (linear, before tone map)
// -> filmic tone map -> grade (vignette, lens dirt, sun shafts, heat shimmer, chase-cam motion blur, a fixed
// sub-LSB dither instead of animated grain, so edges never crawl) -> FXAA (after tone map, when selected).
// AA modes: off, fxaa, smaa, msaa-smaa. Low can run a short scene+AA chain with no bloom/grade.
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { Pass } from '../vendor/three/addons/postprocessing/Pass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from '../vendor/three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from '../vendor/three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from '../vendor/three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from '../vendor/three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { BokehPass } from '../vendor/three/addons/postprocessing/BokehPass.js';

// World (+ planet) into its own MSAA HDR target whose depth resolves into a float depth texture. GTAO reads that
// depth (normals rebuilt from it) and multiplies its result onto the same colour, then the NaN guard writes the
// clean image into the composer chain. Rendering happens into the multisampled buffer and depth is only sampled
// from the resolved texture, so there is never a framebuffer/texture feedback loop.
class ScenePass extends Pass {
  constructor(world, W, H, ao, samples = 0) {
    super(); this.w = world; this.needsSwap = true;
    const depth = new THREE.DepthTexture(W, H); depth.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples, depthTexture: depth });
    this.ao = ao ? new GTAOPass(world.scene, world.camera, W, H, { depthTexture: depth }) : null;
    this.clean = new FullScreenQuad(new THREE.ShaderMaterial(CleanShader));
  }
  setSize(w, h) { this.rt.setSize(w, h); this.ao?.setSize(w, h); }
  render(r, writeBuffer) {
    r.setRenderTarget(this.rt); r.clear(); this.w.renderScene();
    if (this.ao?.enabled) this.ao.render(r, null, this.rt);
    this.clean.material.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(writeBuffer); this.clean.render(r);
  }
  dispose() { this.rt.depthTexture?.dispose(); this.rt.dispose(); this.ao?.dispose(); this.clean.material.dispose(); this.clean.dispose(); }
}

function dirtTex() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  let s = 5; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, R = 30 + r() * 120, gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(255,255,255,${0.10 + r() * 0.12})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2); }
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.35})`; g.beginPath(); g.arc(r() * S, r() * S, 0.6 + r() * 2.6, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 3; for (let i = 0; i < 7; i++) { g.beginPath(); const x = r() * S, y = r() * S; g.moveTo(x, y); g.bezierCurveTo(x + r() * 90, y + r() * 60, x + r() * 140, y - r() * 50, x + r() * 220, y + r() * 30); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, tDirt: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uVig: { value: 0.32 }, uDirtK: { value: 0.22 },
    uBlur: { value: 0 }, uHeat: { value: new THREE.Vector4(0, 0, 0, 0) }, uHeatDir: { value: new THREE.Vector2(0, -1) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uShaft: { value: 0 }, uShaftN: { value: 20 }, uLift: { value: new THREE.Vector3(0.012, 0.010, 0.018) },
    uGain: { value: new THREE.Vector3(1.03, 1.0, 0.95) }, uSat: { value: 1.12 }, uContrast: { value: 1.08 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse, tDirt; uniform vec2 uRes, uHeatDir; uniform float uTime, uVig, uDirtK, uBlur, uShaft, uShaftN, uSat, uContrast;
    uniform vec4 uHeat; uniform vec3 uSun, uLift, uGain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 uv = vUv, asp = vec2(uRes.x / uRes.y, 1.0);
      // heat shimmer behind the exhaust: an elongated region below the nozzle
      if (uHeat.w > 0.0) {
        vec2 d = (uv - uHeat.xy) * asp; float along = dot(d, uHeatDir), across = dot(d, vec2(-uHeatDir.y, uHeatDir.x));
        float m = smoothstep(uHeat.z * 4.0, 0.0, abs(along - uHeat.z * 2.0)) * smoothstep(uHeat.z * (1.0 + max(along, 0.0) / max(uHeat.z, 1e-4) * 0.35), 0.0, abs(across));
        vec2 n = vec2(vn(uv * 60.0 + vec2(0.0, uTime * 9.0)), vn(uv * 60.0 + vec2(17.0, uTime * 11.0))) - 0.5;
        uv += n * 0.012 * m * uHeat.w;
      }
      vec2 c = uv - 0.5; float r2 = dot(c * asp, c * asp);
      vec3 col = texture2D(tDiffuse, uv).rgb;
      // chase-cam motion blur: radial streaks from the centre
      if (uBlur > 0.0) { vec3 acc = col; for (int i = 1; i < 8; i++) { float k = float(i) / 8.0; acc += texture2D(tDiffuse, uv - c * k * uBlur).rgb; } col = acc / 8.0; }
      // sun shafts: march toward the sun through bright sky pixels
      if (uShaft > 0.0 && uSun.z > 0.0) {
        vec2 dir = (uSun.xy - uv); float s = 0.0, wsum = 0.0; float j = h(floor(vUv * uRes));   // fixed jitter: no crawl
        for (int i = 0; i < 32; i++) { if (float(i) >= uShaftN) break; float k = (float(i) + j) / uShaftN; vec3 t = texture2D(tDiffuse, uv + dir * k * 0.85).rgb;
          float w = 1.0 - k; s += smoothstep(0.92, 1.0, dot(t, vec3(0.299, 0.587, 0.114))) * w; wsum += w; }
        float fall = exp(-length((uSun.xy - vUv) * asp) * 2.6);
        col += vec3(1.0, 0.82, 0.58) * (s / wsum) * uShaft * fall * uSun.z;
      }
      // lens dirt lit by bright light around it and by the sun direction
      vec3 b = vec3(0.0); for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472; b += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * 0.09).rgb; }
      float bl = max(0.0, dot(b / 6.0, vec3(0.333)) - 0.55) * 1.6 + uSun.z * exp(-length((uSun.xy - vUv) * asp) * 3.0) * 0.4;
      col += texture2D(tDirt, vUv).rgb * bl * uDirtK * vec3(1.0, 0.9, 0.78);
      // grade: lift / gain, contrast, saturation
      col = col * uGain + uLift * (1.0 - col);
      col = (col - 0.5) * uContrast + 0.5;
      float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, uSat);
      col *= 1.0 - uVig * smoothstep(0.15, 0.95, r2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0) + (h(floor(vUv * uRes)) - 0.5) / 255.0, 1.0);   // static dither against banding
    }`,
};

// guards the HDR buffer: a stray NaN/Inf from a specular highlight would smear across the whole bloom chain
const CleanShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bvec4 bad = isnan(c); if (bad.x || bad.y || bad.z || any(isinf(c.rgb))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(30.0)), 1.0); }',
};

export const AA_MODES = {
  off: { label: 'Off' },
  fxaa: { label: 'FXAA' },
  smaa: { label: 'SMAA' },
  'msaa-smaa': { label: 'MSAA + SMAA' },
};
// Cheap AA on Low/Phone, SMAA on Medium, MSAA+SMAA on High/Ultra.
export const defaultAA = q => (q === 'high' || q === 'ultra') ? 'msaa-smaa' : q === 'medium' ? 'smaa' : 'fxaa';

export class Post {
  constructor(world) { this.w = world; this.enabled = false; this.dof = { on: false, focus: 30 }; this.aa = 'off'; }
  setup(q, w, h, aa) {
    const r = this.w.renderer;
    this.dispose();
    this.tier = q === 'low' ? 0 : (q === 'phone' || q === 'medium') ? 1 : 2;
    this.aa = AA_MODES[aa] ? aa : defaultAA(q);
    const bloomAmt = Math.max(0, +(this.w._video?.bloom) || 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    // Low with AA off draws straight to the canvas (no composer). Every other combo needs the chain
    // so FXAA/SMAA have a texture, and so canvas MSAA is not relied on (the renderer is created without it).
    // A Bloom slider above 0 also needs the chain, even on Low / Phone with AA off.
    this.enabled = this.tier > 0 || this.aa !== 'off' || bloomAmt > 0;
    if (!this.enabled) return;
    const pr = r.getPixelRatio(), W = Math.max(1, w * pr | 0), H = Math.max(1, h * pr | 0);
    const useMSAA = this.aa === 'msaa-smaa' && r.capabilities.isWebGL2;
    const useSMAA = this.aa === 'smaa' || this.aa === 'msaa-smaa';
    const useFXAA = this.aa === 'fxaa';
    // the chain after the scene pass is full-screen only, so it needs no MSAA or depth of its own
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
    const C = this.composer = new EffectComposer(r, rt); C.setPixelRatio(pr);
    const scene = this.scenePass = new ScenePass(this.w, W, H, this.tier === 2, useMSAA ? 4 : 0);
    C.addPass(scene); C.setSize(w, h);
    if (this.tier === 2) {
      const ao = this.ao = scene.ao;
      ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.6, thickness: 2.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 1.0;
      const bk = this.bokeh = new BokehPass(this.w.scene, this.w.camera, { focus: 30, aperture: 0.00012, maxblur: 0.008 });
      bk.enabled = false; C.addPass(bk);
    }
    if (this.tier > 0 || bloomAmt > 0) {
      // strength comes from the Bloom slider (0 = pass disabled). Resolution stays lower on Medium/Phone.
      const bloom = this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H).multiplyScalar(this.tier === 2 ? 0.5 : 0.35), bloomAmt, 0.5, 4.0);   // only real light sources (flames, lamps, sun glints) cross the threshold
      // energy-conserving threshold: only the light ABOVE the threshold blooms, capped, so chrome glints glow without a white-out
      bloom.materialHighPassFilter.fragmentShader = `uniform sampler2D tDiffuse; uniform float luminosityThreshold; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float k = max(0.0, l - luminosityThreshold) / max(l, 1e-4); gl_FragColor = vec4(min(c * k, vec3(6.0)), 1.0); }`;
      bloom.materialHighPassFilter.needsUpdate = true;
      bloom.enabled = bloomAmt > 0;
      C.addPass(bloom);
    }
    // SMAA in this three.js build (r187) works in linear-sRGB and must run before OutputPass. The old
    // chain put it after tone map + grade, so the High/Ultra SMAA pass was effectively misconfigured.
    if (useSMAA) C.addPass(this.smaa = new SMAAPass());
    C.addPass(new OutputPass());
    if (this.tier > 0) {
      const g = this.grade = new ShaderPass(GradeShader); g.uniforms.tDirt.value = dirtTex(); g.uniforms.uRes.value.set(W, H);
      if (this.tier === 1) g.uniforms.uShaftN.value = 12;
      C.addPass(g);
    }
    // FXAA needs the sRGB image OutputPass produces
    if (useFXAA) C.addPass(this.fxaa = new FXAAPass());
  }
  resize(w, h) {
    if (!this.composer) return;
    const pr = this.w.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    if (this.grade) this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }
  dispose() {
    if (this.composer) {
      this.composer.passes.forEach(p => p.dispose?.());
      this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose();
      this.composer = null; this.ao = this.bokeh = this.scenePass = this.grade = this.bloom = this.smaa = this.fxaa = null;
    }
  }
  // per-frame inputs from the modes
  // Live Bloom slider: 0 turns the pass off. If the composer was skipped (Low + AA off), rebuild it.
  applyBloom(s) {
    const amt = Math.max(0, +(s?.bloom) || 0);
    if (amt > 0 && !this.bloom) {
      this.setup(this.w.quality, this.w.w || 1, this.w.h || 1, s.aa || this.aa || defaultAA(this.w.quality));
      return;
    }
    if (this.bloom) { this.bloom.enabled = amt > 0; this.bloom.strength = amt; }
  }
  setDOF(on, focus = 30, aperture = 0.00012) { this.dof.on = on; if (this.bokeh) { this.bokeh.enabled = on; this.bokeh.uniforms.focus.value = focus; this.bokeh.uniforms.aperture.value = aperture; } }
  setBlur(k) { if (this.grade) this.grade.uniforms.uBlur.value = k; }
  setHeat(v4, dir) { if (this.grade) { this.grade.uniforms.uHeat.value.copy(v4); if (dir) this.grade.uniforms.uHeatDir.value.copy(dir); } }
  info() {
    const r = this.w.renderer, gl = r.getContext();
    return {
      aa: this.aa, tier: this.tier, enabled: this.enabled, webgl2: !!r.capabilities.isWebGL2,
      pixelRatio: r.getPixelRatio(),
      canvasAA: !!(gl.getContextAttributes?.().antialias),
      sceneSamples: this.scenePass?.rt?.samples ?? 0,
      composerSamples: this.composer?.renderTarget1?.samples ?? 0,
      passes: (this.composer?.passes || []).map(p => ({ name: p.constructor.name, enabled: p.enabled !== false })),
    };
  }
  render(dt) {
    const g = this.grade?.uniforms, w = this.w, cam = w.camera;
    if (g) {
      g.uTime.value += dt;
      // sun position on screen for shafts and dirt
      _sp.copy(w.sunDir || _sunUp).multiplyScalar(5000).add(cam.position).project(cam);
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const facing = _fwd.dot(w.sunDir || _sunUp);
      g.uSun.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5, w.indoor ? 0 : THREE.MathUtils.smoothstep(facing, 0.2, 0.75) * (_sp.z < 1 ? 1 : 0));
      g.uShaft.value = w.indoor ? 0 : (w.sky?.soft ? 0.25 : 0.55) * (1 - THREE.MathUtils.smoothstep(w.alt || 0, 3000, 30000));
    }
    if (this.ao) this.ao.enabled = (w.alt || 0) < 3000;
    this.composer.render(dt);
  }
}
const _sp = new THREE.Vector3(), _fwd = new THREE.Vector3(), _sunUp = new THREE.Vector3(0, 1, 0);
