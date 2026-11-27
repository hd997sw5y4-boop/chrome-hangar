// World: renderer, hangar, apron, test stand, pad, lights, HDRI reflections, graphics presets.
import * as THREE from 'three';
import { HDRLoader } from '../vendor/three/addons/loaders/HDRLoader.js';
import { initMaterials, partMesh } from './parts3d.js';
import { PARTS } from './rocket.js';
import { applyPBR, setTexTier } from './tex.js';
import { setModelTier } from './models.js';
import { Outdoor } from './outdoor.js';
import { Earth, GLOBE_FADE } from './earth.js';

export const SPOTS = {
  stand: new THREE.Vector3(0, 0, 0),
  test: new THREE.Vector3(48, 0, -72),
  pad: new THREE.Vector3(0, 0, -115),
};
export const HANGAR = { x: 22, z: 16, h: 28, door: 10, doorH: 26, pitR: 2.6, pitDepth: 22 };
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const PRESETS = {
  phone: { label: 'Phone', pr: 1.5, shadow: 1024, particles: 500, hdri: '1k' },
  low: { label: 'Low', pr: 1, shadow: 0, particles: 300, hdri: '1k' },
  medium: { label: 'Medium', pr: 1.25, shadow: 1024, particles: 900, hdri: '1k' },
  high: { label: 'High', pr: 1.5, shadow: 2048, particles: 1600, hdri: '1k' },
  ultra: { label: 'Ultra', pr: 2, shadow: 4096, particles: 2600, hdri: '2k' },
};
// Time of day: CC0 Poly Haven pure-sky HDRIs. Each drives the background, PMREM reflections, sun direction/colour and shadows.
// sun/colour data comes from tools/hdri_info.py (assets/hdri/sky_info.json); az = world azimuth (atan2(z, x)) we turn the sun to.
export const SKIES = {
  day:      { label: 'Clear day',     file: 'qwantani_noon_puresky',       az: Math.atan2(-420, -300), sun: 3.0, hemi: 0.3,  bg: 1.0,  env: 1.0,  fog: 0.000075, exp: 1.0,  minEl: 20 },
  sunset:   { label: 'Golden sunset', file: 'qwantani_sunset_puresky',     az: Math.atan2(-0.45, 1), sun: 2.2, hemi: 0.22, bg: 1.0,  env: 1.0,  fog: 0.00009,  exp: 1.0,  minEl: 5 },
  dusk:     { label: 'Dusk',          file: 'qwantani_dusk_2_puresky',     az: Math.atan2(-0.6, 1),  sun: 0.45, hemi: 0.25, bg: 1.0, env: 1.2,  fog: 0.0001,   exp: 1.15, minEl: 4, soft: true },
  overcast: { label: 'Overcast',      file: 'kloofendal_overcast_puresky', az: Math.atan2(-420, -300), sun: 0.7, hemi: 0.6,  bg: 1.0,  env: 1.0,  fog: 0.00013,  exp: 1.0,  minEl: 25, soft: true },
};
let SKYINFO = null;
export const defaultQuality = () => (IS_TOUCH ? 'phone' : 'high');

function canvasTex(w, h, draw, repeat = 1, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
let s0 = 3; const rnd = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;

export class World {
  constructor(canvas, quality = 'high') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 60000);
    this.scene.fog = new THREE.FogExp2(0xbfc9d2, 0.000075); // aerial perspective: ~40% at 10 km, ~85% at 20 km
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envs = {};
    this.M = initMaterials();
    setTexTier(quality, r); setModelTier(quality);
    this.wind = { x: 2, z: 0.6 };
    this.earth = new Earth(this); this._rt = performance.now();
    this.buildLights(); this.buildHangar(); this.buildOutside(); this.buildTestStand(); this.buildPad();
  }

  // hangar interior + the chosen sky; only one sky is resident at a time (iPhone memory), others load on demand
  async loadHDRIs(size = '1k', skyKey = this.skyKey || 'day') {
    const L = new HDRLoader();
    const hang = await L.loadAsync(`assets/hdri/hangar_interior_${size}.hdr`);
    hang.mapping = THREE.EquirectangularReflectionMapping;
    const old = this.envs.hangar; this.envs.hangar = this.pmrem.fromEquirectangular(hang).texture; hang.dispose(); old?.dispose();
    this.hdriSize = size; this.skyKey = null;
    await this.setSky(skyKey);
  }
  async setSky(key) {
    if (!SKIES[key]) key = 'day';
    if (key === this.skyKey && this.envs.sky) return;
    const want = this._skyReq = key + this.hdriSize;
    if (!SKYINFO) SKYINFO = await fetch('assets/hdri/sky_info.json').then(r => r.json()).catch(() => ({}));
    const S = SKIES[key], tex = await new HDRLoader().loadAsync(`assets/hdri/${S.file}_${this.hdriSize || '1k'}.hdr`);
    if (want !== this._skyReq) { tex.dispose(); return; }          // a newer pick won
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const env = this.pmrem.fromEquirectangular(tex).texture, old = this.envs;
    this.envs = { ...old, sky: env, skyTex: tex }; this.skyTexForEarth = tex; old.sky?.dispose(); old.skyTex?.dispose();
    this.skyKey = key; this.sky = S;
    // turn the HDRI so its sun sits at our chosen azimuth; lights follow the same direction
    const I = SKYINFO[S.file] || { sunDir: [0.5, 0.7, 0.4], sunColor: [1, 0.95, 0.9], horizon: [0.7, 0.75, 0.85], zenith: [0.3, 0.45, 0.8] };
    const d = new THREE.Vector3(...I.sunDir), azH = Math.atan2(d.z, d.x), rot = S.az - azH;
    this.scene.backgroundRotation.set(0, -rot, 0); this.scene.environmentRotation.set(0, -rot, 0);
    const el = Math.max(THREE.MathUtils.degToRad(S.minEl), Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)));
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(S.az), Math.sin(el), Math.cos(el) * Math.sin(S.az));
    this.sun.color.setRGB(...I.sunColor).lerp(new THREE.Color(1, 1, 1), 0.25);
    // normalise sky brightness so every HDRI reads well on screen
    const hl = I.horizon[0] * 0.2126 + I.horizon[1] * 0.7152 + I.horizon[2] * 0.0722;
    this.skyNorm = THREE.MathUtils.clamp(0.95 / Math.max(0.05, hl), 0.35, 4) * S.bg;
    this.skyHorizon = new THREE.Color(...I.horizon); this.skyZenith = new THREE.Color(...I.zenith);
    this.scene.background = tex;
    this.setIndoor(this.indoor ?? true);
    this.applySky();
  }
  // sky + lights for the current HDRI and altitude (space darkens the sky, thins the fog)
  setAltitude(a) { if (Math.abs((this.alt || 0) - a) > 1) { this.alt = a; this.applySky(); } }
  applySky() {
    const S = this.sky; if (!S) return;
    const k = THREE.MathUtils.smoothstep(this.alt || 0, 1500, 40000), sp = 1 - 0.92 * k;
    const sc = this.scene; sc.backgroundIntensity = this.skyNorm * sp;
    if (!this.indoor) sc.environmentIntensity = Math.min(2.5, Math.sqrt(this.skyNorm)) * S.env * (1 - 0.6 * k);
    sc.fog.density = S.fog * (1 - k);
    sc.fog.color.copy(this.skyHorizon).multiplyScalar(this.skyNorm * 0.85 * sp);
    this.sun.intensity = S.sun * (1 + 0.3 * k); this.hemi.intensity = S.hemi * sp;
    this.renderer.toneMappingExposure = S.exp;
    this.sun.shadow.radius = S.soft ? 6 : 1; this.sun.shadow.intensity = S.soft ? 0.55 : 1;
    const o = this.outdoor?.oceanMat?.uniforms;
    if (o) { o.uSun.value.copy(this.sunDir); o.uSunCol.value.copy(this.sun.color).multiplyScalar(S.soft ? 0.25 : 1);
      o.uHorizon.value.copy(this.skyHorizon).multiplyScalar(this.skyNorm * 0.85 * sp); o.uZenith.value.copy(this.skyZenith).multiplyScalar(this.skyNorm * sp); }
    this.followSun(this.sun.target.position);
  }
  setIndoor(v) {
    this.indoor = v;
    if (this.envs.hangar && this.envs.sky) { this.scene.environment = v ? this.envs.hangar : this.envs.sky; this.scene.environmentIntensity = v ? 1.0 : 0.95; if (!v) this.applySky?.(); }
    this.spot.castShadow = v && this.shadowSize > 0;
    this.sun.castShadow = !v && this.shadowSize > 0;
  }

  applyQuality(q, w, h) {
    const p = PRESETS[q] || PRESETS.high;
    this.quality = q; this.preset = p;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pr));
    this.shadowSize = p.shadow;
    this.renderer.shadowMap.enabled = p.shadow > 0;
    for (const l of [this.sun, this.spot]) {
      l.shadow.mapSize.set(p.shadow || 512, p.shadow || 512);
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
    this.setIndoor(this.indoor ?? true);
    this.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
    this.resize(w, h);
    if (p.hdri !== (this.hdriSize || '1k') && this.envs.hangar) this.loadHDRIs(p.hdri, this.skyKey).catch(() => {});
  }
  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  render() {
    const r = this.renderer, cam = this.camera, now = performance.now(), dt = Math.min(0.1, (now - this._rt) / 1000); this._rt = now;
    const alt = cam.position.y, gf = THREE.MathUtils.smoothstep(alt, 25000, 80000);
    GLOBE_FADE.value = gf; if (this.outdoor) this.outdoor.group.visible = gf < 0.999;
    if (alt > 600 && !this.indoor && this.earth.render(r, cam, dt)) {
      // planet pass drew sky + globe; local scene goes on top with fresh depth
      const bg = this.scene.background; this.scene.background = null;
      r.autoClear = false; r.clearDepth(); r.render(this.scene, cam); r.autoClear = true; this.scene.background = bg;
    } else r.render(this.scene, cam);
  }
  async buildOutdoor(q) { this.outdoor = new Outdoor(this); await this.outdoor.build(q); }
  update(dt) { this.outdoor?.update(dt, this.camera, this.wind); }

  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xdfe8f2, 0x3a352e, 0.35); s.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe2bf, 2.2);
    sun.position.set(-300, 260, -420); sun.target.position.set(0, 0, -100);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.camera.near = 50; sun.shadow.camera.far = 1200; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    s.add(sun, sun.target);
    const spot = this.spot = new THREE.SpotLight(0xfff1dc, 900, 70, 0.62, 0.55, 1.6);
    spot.position.set(5, 26, 9); spot.target.position.set(0, 4, 0);
    spot.shadow.camera.near = 4; spot.shadow.camera.far = 70; spot.shadow.bias = -0.0003; spot.shadow.normalBias = 0.03;
    s.add(spot, spot.target);
    const fill = new THREE.PointLight(0xcfe3ff, 120, 40, 1.8); fill.position.set(-12, 10, -6); s.add(fill);
  }
  // keep the sun's shadow box centred on what we're looking at
  followSun(p) {
    if (p !== this.sun.target.position) this.sun.target.position.copy(p);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir || new THREE.Vector3(-300, 260, -420).normalize(), 600);
  }

  buildHangar() {
    const H = HANGAR, s = this.scene, g = this.hangar = new THREE.Group(); s.add(g);
    // polished concrete floor with a hole for the stand pit
    const floorTex = canvasTex(1024, 1024, (c, w, h) => {
      c.fillStyle = '#8d8f91'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const v = 110 + rnd() * 60 | 0; c.fillStyle = `rgba(${v},${v},${v - 4},${0.08 + rnd() * 0.15})`; c.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3); }
      for (let i = 0; i < 12; i++) { c.fillStyle = `rgba(60,60,60,${0.03 + rnd() * 0.04})`; c.beginPath(); c.ellipse(rnd() * w, rnd() * h, 60 + rnd() * 160, 40 + rnd() * 120, rnd() * 3, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(40,40,40,0.55)'; c.lineWidth = 3; c.strokeRect(0, 0, w, h);
    }, 1);
    floorTex.repeat.set(1 / 6, 1 / 6);
    const shape = new THREE.Shape(); shape.moveTo(-H.x, -H.z); shape.lineTo(H.x, -H.z); shape.lineTo(H.x, H.z); shape.lineTo(-H.x, H.z); shape.closePath();
    const hole = new THREE.Path(); hole.absarc(0, 0, H.pitR, 0, Math.PI * 2, true); shape.holes.push(hole);
    const floorGeo = new THREE.ShapeGeometry(shape, 48);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ map: floorTex, color: 0xb8b8b8, roughness: 0.3, metalness: 0.0, envMapIntensity: 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor); this.floor = floor;
    applyPBR(floor.material, 'hangar_concrete_floor', [1 / 5, 1 / 5], { normalScale: 0.5 }).then(m => { m.color.set(0xd8d8d8); m.roughness = 0.85; }).catch(() => {});
    // pit
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(H.pitR, H.pitR, H.pitDepth, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.7, roughness: 0.5, side: THREE.BackSide }));
    pit.position.y = -H.pitDepth / 2; g.add(pit);
    const pitFloor = new THREE.Mesh(new THREE.CircleGeometry(H.pitR, 32), this.M.darkMatte); pitFloor.rotation.x = -Math.PI / 2; pitFloor.position.y = -H.pitDepth; g.add(pitFloor);
    // hazard ring
    const haz = canvasTex(512, 32, (c, w, h) => { c.fillStyle = '#e8b21c'; c.fillRect(0, 0, w, h); c.fillStyle = '#16171a'; for (let x = -h; x < w; x += 32) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 16, h); c.lineTo(x + 16 + h, 0); c.lineTo(x + h, 0); c.fill(); } });
    haz.repeat.set(6, 1);
    const ring = new THREE.Mesh(new THREE.RingGeometry(H.pitR, H.pitR + 0.45, 64, 1), new THREE.MeshStandardMaterial({ map: haz, roughness: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; ring.receiveShadow = true; g.add(ring);
    // railing posts + rail (gap facing the player)
    const rail = new THREE.Mesh(new THREE.TorusGeometry(H.pitR + 0.8, 0.04, 8, 64, Math.PI * 1.5), this.M.chromeTrim);
    rail.rotation.x = -Math.PI / 2; rail.rotation.z = Math.PI * 0.75 + Math.PI; rail.position.y = 1.05; g.add(rail);
    for (let i = 0; i <= 8; i++) { const a = Math.PI * 1.75 + i / 8 * Math.PI * 1.5; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 8), this.M.chromeTrim); p.position.set(Math.cos(a) * (H.pitR + 0.8), 0.525, Math.sin(a) * (H.pitR + 0.8)); g.add(p); }
    // stand: telescoping column + turntable (moved by the build code)
    const stand = this.stand = new THREE.Group(); g.add(stand);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, H.pitDepth + 8, 24), this.M.brushed); col.position.y = -(H.pitDepth + 8) / 2; stand.add(col);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.4, 0.3, 64), this.M.dark); table.position.y = -0.15; table.receiveShadow = true; table.castShadow = true; stand.add(table);
    const glow = this.standGlow = new THREE.Mesh(new THREE.TorusGeometry(2.36, 0.025, 6, 96), new THREE.MeshBasicMaterial({ color: 0x7fe7ff }));
    glow.rotation.x = Math.PI / 2; glow.position.y = 0.01; stand.add(glow);
    // walls: corrugated steel (bump from canvas), door opening on -Z
    const corr = canvasTex(256, 16, (c, w) => { for (let x = 0; x < w; x++) { const v = 128 + 120 * Math.sin(x / w * Math.PI * 16) | 0; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, 16); } }, 1, false);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x9da2a8, metalness: 0.55, roughness: 0.5, envMapIntensity: 0.55, bumpMap: corr, bumpScale: 3, side: THREE.DoubleSide });
    const wall = (w, h, x, y, z, ry) => { const t = wallMat.clone(); t.bumpMap = corr.clone(); t.bumpMap.repeat.set(w / 6, 1); t.bumpMap.needsUpdate = true; applyPBR(t, 'corrugated_iron_02', [w / 4, h / 4], { metal: true, normalScale: 1.2 }).then(mm => { if (mm.normalMap) mm.bumpMap = null; mm.color.set(0xc4c8cc); }).catch(() => {}); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), t); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m); };
    wall(H.x * 2, H.h, 0, H.h / 2, H.z, Math.PI);
    wall(H.z * 2, H.h, -H.x, H.h / 2, 0, Math.PI / 2);
    wall(H.z * 2, H.h, H.x, H.h / 2, 0, -Math.PI / 2);
    const side = H.x - H.door;
    wall(side, H.h, -H.door - side / 2, H.h / 2, -H.z, 0);
    wall(side, H.h, H.door + side / 2, H.h / 2, -H.z, 0);
    wall(H.door * 2, H.h - H.doorH, 0, H.doorH + (H.h - H.doorH) / 2, -H.z, 0);
    // exterior shell: painted corrugated cladding, gable roof, big lettering (seen from the apron and the air)
    {
      const ext = new THREE.MeshStandardMaterial({ color: 0xe6e9ec, metalness: 0.35, roughness: 0.45 });
      const o = 0.3, X = H.x + o, Z = H.z + o;
      const ew = (w, h, x, y, z, ry, rep) => { const t = ext.clone(); applyPBR(t, 'corrugated_iron_02', rep || [w / 4, h / 4], { metal: false, normalScale: 1.3 }).then(mm => mm.color.set(0xeef1f3)).catch(() => {}); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), t); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
      ew(X * 2, H.h, 0, H.h / 2, Z, 0);
      ew(Z * 2, H.h, -X, H.h / 2, 0, -Math.PI / 2);
      ew(Z * 2, H.h, X, H.h / 2, 0, Math.PI / 2);
      const sd = X - H.door - 0.3;
      ew(sd, H.h, -H.door - 0.3 - sd / 2, H.h / 2, -Z, Math.PI);
      ew(sd, H.h, H.door + 0.3 + sd / 2, H.h / 2, -Z, Math.PI);
      ew(H.door * 2 + 0.6, H.h - H.doorH - 0.3, 0, H.doorH + 0.3 + (H.h - H.doorH - 0.3) / 2, -Z, Math.PI);
      // gable roof along x, ridge 4 m above the eaves
      const rise = 4, slope = Math.hypot(Z + 0.6, rise);
      for (const sgn of [-1, 1]) {
        const rm = ext.clone(); applyPBR(rm, 'corrugated_iron_02', [X * 2 / 4, slope / 4], { normalScale: 1.3, rotate: 0 }).then(mm => mm.color.set(0xb9bec4)).catch(() => {});
        const r = new THREE.Mesh(new THREE.PlaneGeometry(X * 2 + 1.2, slope), rm);
        r.position.set(0, H.h + rise / 2, sgn * (Z + 0.6) / 2); r.rotation.x = -Math.PI / 2 + sgn * Math.atan2(rise, Z + 0.6);
        r.castShadow = true; r.receiveShadow = true; g.add(r);
      }
      const gable = new THREE.Shape(); gable.moveTo(-Z - 0.6, 0); gable.lineTo(Z + 0.6, 0); gable.lineTo(0, rise); gable.closePath();
      for (const sx of [-1, 1]) { const gm = new THREE.Mesh(new THREE.ShapeGeometry(gable), ext); gm.position.set(sx * X, H.h, 0); gm.rotation.y = sx * Math.PI / 2; g.add(gm); }
      const letters = (txt, w, h) => { const t = canvasTex(1024, 160, (c, cw, ch) => { c.clearRect(0, 0, cw, ch); c.fillStyle = '#1f2a36'; c.font = 'bold 118px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, cw / 2, ch / 2 + 6); }); t.repeat.set(1, 1); return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })); };
      for (const sx of [-1, 1]) { const l = letters('CHROME HANGAR', 26, 4); l.position.set(sx * (X + 0.05), H.h - 6, 0); l.rotation.y = sx * Math.PI / 2; g.add(l); }
      const b = letters('BAY 01', 10, 1.6); b.position.set(0, H.doorH + 1.3, -Z - 0.05); b.rotation.y = Math.PI; g.add(b);
    }
    // door frame + slid-open door panels
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.8, roughness: 0.4 });
    for (const x of [-H.door, H.door]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, H.doorH, 0.8), frameMat); f.position.set(x, H.doorH / 2, -H.z); g.add(f); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(H.door * 2 + 0.6, 0.6, 0.8), frameMat); top.position.set(0, H.doorH, -H.z); g.add(top);
    // ceiling + trusses + light panels
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(H.x * 2, H.z * 2), new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.8, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H.h; g.add(ceil);
    const beam = new THREE.BoxGeometry(H.x * 2, 0.5, 0.35);
    const beams = new THREE.InstancedMesh(beam, frameMat, 7);
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff4e0, emissiveIntensity: 3.2 });
    const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.12, 0.9), lightMat, 18);
    const m4 = new THREE.Matrix4(); let li = 0;
    for (let i = 0; i < 7; i++) {
      const z = -H.z + (i + 0.5) * (H.z * 2 / 7);
      m4.makeTranslation(0, H.h - 1.2, z); beams.setMatrixAt(i, m4);
      if (i % 2 === 0 || i === 3) for (const x of [-12, 0, 12]) if (li < 18) { m4.makeTranslation(x, H.h - 1.6, z); lights.setMatrixAt(li++, m4); }
    }
    lights.count = li; g.add(beams, lights);
    // mezzanine along the back wall (for the view)
    const mez = new THREE.Mesh(new THREE.BoxGeometry(H.x * 2 - 2, 0.3, 4), frameMat); mez.position.set(0, 7, H.z - 2); mez.castShadow = true; mez.receiveShadow = true; g.add(mez);
    const mrail = new THREE.Mesh(new THREE.BoxGeometry(H.x * 2 - 2, 0.06, 0.06), this.M.chromeTrim); mrail.position.set(0, 8.1, H.z - 4); g.add(mrail);
    for (let x = -H.x + 2; x <= H.x - 2; x += 4) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), this.M.chromeTrim); p.position.set(x, 7.6, H.z - 4); g.add(p); }
    // spare-part racks: tanks lying on cradles, a workbench
    const rack = (x, z, id) => {
      const len = PARTS[id].length, t = partMesh(id); t.rotation.z = Math.PI / 2; t.position.set(x + len / 2, 1.1, z); g.add(t);
      for (const dx of [-len / 2 + 0.6, len / 2 - 0.6]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 2.0), frameMat); c.position.set(x + dx, 0.2, z); g.add(c); }
    };
    rack(-19, 10, 'tank_tall'); rack(-19, 6, 'tank_short'); rack(14, 10, 'tank_short');
    const bench = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 1.4), this.M.brushed); bench.position.set(9, 1.0, 5); bench.castShadow = true; g.add(bench);
    for (const [x, z] of [[-2.3, -0.6], [2.3, -0.6], [-2.3, 0.6], [2.3, 0.6]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), frameMat); l.position.set(9 + x, 0.5, 5 + z); g.add(l); }
  }

  buildOutside() {
    // terrain, roads, structures and scatter live in outdoor.js; the apron is the big concrete slab
    const apronMat = new THREE.MeshStandardMaterial({ color: 0xd2d0cb, roughness: 0.85 });
    applyPBR(apronMat, 'concrete_pavement', [22, 27], { normalScale: 0.7 }).catch(() => {});
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(180, 220, 1, 1), apronMat);
    apron.rotation.x = -Math.PI / 2; apron.position.set(20, -0.02, -95); apron.receiveShadow = true; this.scene.add(apron);
    // expansion-joint grid painted over the slab (one draw)
    const pts = [];
    for (let x = -70; x <= 110; x += 12) pts.push(new THREE.Vector3(x, -0.005, -205), new THREE.Vector3(x, -0.005, 15));
    for (let z = -205; z <= 15; z += 12) pts.push(new THREE.Vector3(-70, -0.005, z), new THREE.Vector3(110, -0.005, z));
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x55534f, transparent: true, opacity: 0.45 })));
  }

  buildTestStand() {
    const p = SPOTS.test, g = new THREE.Group(); g.position.copy(p); this.scene.add(g);
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb0aea8, roughness: 0.85 });
    applyPBR(concrete, 'concrete_floor_worn_001', [2, 2], { normalScale: 0.8 }).catch(() => {});
    // two piers with a flame trench between
    for (const x of [-4.5, 4.5]) { const b = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 12), concrete); b.position.set(x, 1.5, 0); b.castShadow = b.receiveShadow = true; g.add(b); }
    const deflect = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 9), this.M.dark); deflect.position.set(0, 0.8, 2.5); deflect.rotation.x = -0.45; g.add(deflect);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.8, roughness: 0.35 });
    for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.35, 22, 0.35), frameMat); c.position.set(x, 3 + 11, z); c.castShadow = true; g.add(c); }
    this.clamps = [];
    for (const y of [4.5, 10, 16]) {
      const hole = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 32), this.M.chromeTrim); hole.rotation.x = Math.PI / 2;
      const grp = new THREE.Group(); grp.position.y = y;
      for (const [x, z, w, d] of [[0, -2.2, 4.8, 0.3], [0, 2.2, 4.8, 0.3], [-2.2, 0, 0.3, 4.8], [2.2, 0, 0.3, 4.8]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), frameMat); b.position.set(x, 0, z); grp.add(b); }
      grp.add(hole); g.add(grp); this.clamps.push(grp);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 14), concrete); base.position.y = 0.05; base.receiveShadow = true; g.add(base);
    this.testTop = 3.0; // rocket nozzle sits this high over the trench
  }

  buildPad() {
    const p = SPOTS.pad, g = new THREE.Group(); g.position.copy(p); this.scene.add(g);
    const padTex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#6f706f'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 8000; i++) { const v = 90 + rnd() * 70 | 0; c.fillStyle = `rgba(${v},${v},${v},0.25)`; c.fillRect(rnd() * w, rnd() * h, 2, 2); }
      c.strokeStyle = '#e8e8e8'; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, h / 2, w * 0.3, 0, 7); c.stroke();
      c.lineWidth = 8; c.beginPath(); c.moveTo(w / 2 - 40, h / 2); c.lineTo(w / 2 + 40, h / 2); c.moveTo(w / 2, h / 2 - 40); c.lineTo(w / 2, h / 2 + 40); c.stroke();
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(20,20,20,${0.05 + rnd() * 0.08})`; c.beginPath(); c.arc(w / 2 + (rnd() - 0.5) * 120, h / 2 + (rnd() - 0.5) * 120, 20 + rnd() * 60, 0, 7); c.fill(); }
    }, 1);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(20, 64), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.85 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.01; pad.receiveShadow = true; g.add(pad);
    // original lattice tower, offset from the pad
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x9b3b2c, metalness: 0.5, roughness: 0.55 });
    const H = 30, tw = new THREE.Group(); tw.position.set(13, 0, 4);
    const leg = new THREE.BoxGeometry(0.3, H, 0.3);
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { const m = new THREE.Mesh(leg, frameMat); m.position.set(x, H / 2, z); m.castShadow = true; tw.add(m); }
    const brace = new THREE.BoxGeometry(0.12, 4.2, 0.12);
    const n = Math.floor(H / 3), braces = new THREE.InstancedMesh(brace, frameMat, n * 4), o = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < n; i++) for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2; o.position.set(Math.cos(a) * 1.5, i * 3 + 1.5, Math.sin(a) * 1.5);
      o.rotation.set(0, -a + Math.PI / 2, (i % 2 ? 1 : -1) * 0.78); o.updateMatrix(); braces.setMatrixAt(k++, o.matrix);
    }
    braces.castShadow = true; tw.add(braces);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a1a, emissiveIntensity: 4 })); beacon.position.y = H + 0.4; tw.add(beacon);
    g.add(tw);
    // landing guide ring on the ground (target)
    this.padRing = new THREE.Mesh(new THREE.RingGeometry(9.6, 10, 64), new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.5 }));
    this.padRing.rotation.x = -Math.PI / 2; this.padRing.position.y = 0.05; g.add(this.padRing);
  }
}
