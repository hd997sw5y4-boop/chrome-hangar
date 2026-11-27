// The range outside the hangar: heightmap terrain with blended textures, ocean and surf, service
// roads, perimeter fence and gate, tank farm, water tower, lightning masts, flood-light masts,
// control bunker, viewing stand, vehicles, power line, windsocks, and instanced rocks, scrub and
// grass in distance-culled chunks (the cheap LOD that keeps iPhone at 60 fps).
import * as THREE from 'three';
import { GLOBE_FADE, GLOBE_EDGE } from './earth.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { height, slopeAt, SEA, shoreX, buildTerrainLOD, terrainMaterial, waterNormals, siteDist, loadDEM, hasDEM, demRect } from './terrain.js';
import { pieces, prop } from './models.js';
import { applyPBR } from './tex.js';

export const FENCE = { x0: -150, x1: 150, z0: -240, z1: 45, gateZ: -60, gateW: 14 };
export const VIEW_STAND = { x: -186, z: 4 };
const PAD = { x: 0, z: -115 };

let s0 = 97; const rnd = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
const gy = (x, z) => height(x, z) - 0.12;   // terrain surface (mesh is dropped 12 cm under the apron)

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent?.add(m); return m; };
const cyl = (rt, rb, h, mat, x, y, z, parent, seg = 16) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent?.add(m); return m; };
// a cylinder from a to b (pipes, braces, guy wires)
function strut(a, b, r, mat, parent, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true; parent?.add(m); return m;
}
// Merge every plain mesh under `g` by material into one mesh each (fewer draw calls on phones).
function bake(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), by = new Map(), drop = [];
  g.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.noBake) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    for (const k of ['position', 'normal', 'uv']) { const a = geo.attributes[k]; if (!(a.array instanceof Float32Array) || a.isInterleavedBufferAttribute) { const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c); geo.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize)); } }
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const k = o.material.uuid + (o.castShadow ? 's' : '');
    if (!by.has(k)) by.set(k, { mat: o.material, cast: o.castShadow, list: [] });
    by.get(k).list.push(geo); drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const { mat, cast, list } of by.values()) {
    const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = cast; m.receiveShadow = true; g.add(m);
  }
  return g;
}

export class Outdoor {
  constructor(world) {
    this.w = world; this.M = world.M; this.group = new THREE.Group(); world.scene.add(this.group);
    this.chunks = []; this.socks = []; this.time = 0; this.roadPts = [];
  }

  async build(q) {
    this.q = q; this.lite = q === 'phone' || q === 'low';
    const mats = this.mats();
    await Promise.all([this.buildTerrain(), this.buildRoads()]);
    this.buildOcean(); this.buildFence(); this.buildWaterTower(); this.buildTankFarm(); this.buildMasts();
    this.buildBunker(); this.buildViewStand(); this.buildWindsocks();
    await Promise.all([this.buildModels(), this.buildVehicles(), this.buildPowerLine()]);
    await this.buildScatter();
    this.flushWires();
    if (this.lite) {   // iPhone budget: instanced props skip the shadow pass (their bounds span whole chunks), fewer grass tufts
      this.group.traverse(o => { o.castShadow = false; });   // the rocket, pad and hangar still cast
    }
    return mats;
  }

  mats() {
    if (this.m) return this.m;
    const S = (c, r = 0.5, mt = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    const concrete = S(0xb4b1aa, 0.9, 0); applyPBR(concrete, 'concrete_wall_008', [1, 1], { normalScale: 0.6 }).catch(() => {});
    const rusty = S(0xffffff, 0.8, 0.4); applyPBR(rusty, 'rusty_painted_metal', [1, 1], { metal: true }).catch(() => {});
    this.m = {
      white: S(0xe8ebee, 0.42, 0.25), grey: S(0x7a828b, 0.45, 0.7), dark: S(0x2c3036, 0.5, 0.6), red: S(0xa63a2a, 0.55, 0.4),
      yellow: S(0xe5ae1c, 0.5, 0.1), concrete, rusty, glass: S(0x0e151c, 0.08, 0.9), tire: S(0x121315, 0.92, 0),
      alu: S(0xc9ced4, 0.35, 0.85), orange: S(0xe0662a, 0.6, 0.05), earth: (() => { const e = S(0xb8b0a0, 0.98, 0); applyPBR(e, 'aerial_grass_rock', [3, 2], { normalScale: 0.8 }).catch(() => {}); return e; })(),
      lamp: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d8, emissiveIntensity: 2.5 }),
      redLight: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 4 }),
    };
    return this.m;
  }

  // ---------- terrain + water ----------
  async buildTerrain() {
    // real coastal elevation if shipped; the procedural range otherwise
    this.w.demInfo = await loadDEM('assets/terrain/coast_dem').catch(() => null); this.w.seaLevel = SEA;
    const L = new THREE.TextureLoader();
    const tx = (n, kind, srgb) => L.loadAsync(`assets/tex/${n}_${kind}_1k.webp`).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; });
    const names = this.terrainSet || ['coast_sand_01', 'dry_ground_01', 'sparse_grass', 'rocky_terrain_02'];
    const [sand, dirt, grass, rock] = await Promise.all(names.map(n => tx(n, 'diff', true)));
    let nor = null;
    if (!this.lite) { const [a, b, c, d] = await Promise.all(names.map(n => tx(n, 'nor', false))); nor = { sand: a, dirt: b, grass: c, rock: d }; }
    let macro = null;
    if (hasDEM()) {   // aerial imagery that matches the elevation grids (mirrored the same way in tools/make_dem.py)
      const im = n => L.loadAsync(`assets/terrain/${n}.webp`).then(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false; t.needsUpdate = true; return t; });   // row 0 = south = grid z0
      const [hi, lo] = await Promise.all([im(this.lite ? 'albedo_hi_1k' : 'albedo_hi_2k'), im('albedo_lo_1k')]).catch(() => []);
      if (hi && lo) { macro = { hi, lo, hiR: demRect(false), loR: demRect(true) }; this.w.earth?.setRegion(lo, macro.loR); }
    }
    this.terrainMat = terrainMaterial({ sand, dirt, grass, rock }, nor, macro);
    const t = buildTerrainLOD(this.terrainMat, this.lite);
    t.refine(new THREE.Vector3(0, 2, -60), Infinity);   // settle around the hangar and pad before the first frame
    this.group.add(t); this.terrain = t;
  }
  buildOcean() {
    const nm = waterNormals();
    // cheap ocean: two scrolling normal samples, analytic sky reflection with Fresnel, sun glint, scene fog
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        tN: { value: nm }, uT: { value: 0 }, uSun: { value: new THREE.Vector3(-300, 260, -420).normalize() },
        uDeep: { value: new THREE.Color(0x06283c) }, uShallow: { value: new THREE.Color(0x1c6a7c) },
        uHorizon: { value: new THREE.Color(0xc3ccd4) }, uZenith: { value: new THREE.Color(0x5f8fc0) }, uSunCol: { value: new THREE.Color(1, 0.92, 0.8) }, uGF: GLOBE_FADE, uGE: GLOBE_EDGE,
      }]),
      vertexShader: `varying vec3 vW; varying float vD;
        #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D tN; uniform float uT; uniform vec3 uSun, uDeep, uShallow, uHorizon, uZenith, uSunCol; uniform float uGF, uGE; varying vec3 vW;
        #include <fog_pars_fragment>
        void main(){
          float gFade = max(uGF, uGE * smoothstep(7000.0, 11000.0, max(abs(vW.x), abs(vW.z)))); if (gFade > 0.995) discard;
          vec2 p = vW.xz;
          vec3 n1 = texture2D(tN, p / 61.0 + vec2(uT * 0.011, uT * 0.007)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tN, p / 17.0 - vec2(uT * 0.017, -uT * 0.013)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(tN, p / 380.0 + vec2(uT * 0.003, 0.0)).xyz * 2.0 - 1.0;
          vec3 nn = normalize(vec3(n1.x + n2.x * 0.6 + n3.x * 0.8, 6.0, n1.y + n2.y * 0.6 + n3.y * 0.8));
          vec3 V = normalize(cameraPosition - vW); float dist = length(cameraPosition - vW);
          nn = normalize(mix(nn, vec3(0.0, 1.0, 0.0), smoothstep(800.0, 9000.0, dist) * 0.8));
          vec3 R = reflect(-V, nn); R.y = abs(R.y);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(nn, V), 0.0), 5.0);
          vec3 water = mix(uDeep, uShallow, 0.25 + 0.25 * n1.x);
          vec3 col = mix(water, sky, fres);
          col += uSunCol * pow(max(dot(R, uSun), 0.0), 380.0) * 6.0;
          gl_FragColor = vec4(col, 1.0 - gFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uGF = GLOBE_FADE; mat.uniforms.uGE = GLOBE_EDGE;   // shared, not cloned by UniformsUtils.merge
    this.oceanMat = mat;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), mat); sea.rotation.x = -Math.PI / 2; sea.position.y = SEA; sea.receiveShadow = false; sea.name = 'ocean';
    this.group.add(sea);
    // surf lines where the beach meets the water
    const foam = canvasTex(64, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const y = rnd() * h, x = Math.pow(rnd(), 1.6) * w; c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`; c.fillRect(x, y, 2 + rnd() * 5, 1 + rnd() * 3); }
      const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    });
    this.foam = foam;
    const water = z => { let a = shoreX(z) - 400, b = shoreX(z) + 600; for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (height(m, z) > SEA) a = m; else b = m; } return (a + b) / 2; };
    for (const [off, wd, op] of [[0, 7, 0.85], [9, 5, 0.45], [22, 4, 0.25]]) {
      const pos = [], uv = [], idx = []; let k = 0;
      for (let z = -11000; z <= 11000; z += 15) {
        const x = water(z) + off; pos.push(x, SEA + 0.04, z, x + wd, SEA + 0.04, z); uv.push(0, z / 30, 1, z / 30);
        if (k) idx.push(k * 2 - 2, k * 2 - 1, k * 2, k * 2 - 1, k * 2 + 1, k * 2); k++;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: foam.clone(), transparent: true, opacity: op, depthWrite: false, fog: true }));
      m.userData.surf = off; m.renderOrder = 1; this.group.add(m); (this.surf ||= []).push(m);
    }
  }

  // ---------- roads ----------
  async buildRoads() {
    const img = await new THREE.ImageLoader().loadAsync('assets/tex/asphalt_02_diff_1k.webp');
    const tex = canvasTex(256, 1024, (c, w, h) => {
      c.drawImage(img, 0, 0, 1024, 1024, 0, 0, w, h);
      c.fillStyle = 'rgba(30,30,32,0.35)'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(235,235,230,0.85)'; c.fillRect(w * 0.05, 0, w * 0.025, h); c.fillRect(w * 0.925, 0, w * 0.025, h);
      c.fillStyle = 'rgba(230,175,40,0.9)'; for (let y = 0; y < h; y += h / 2) c.fillRect(w * 0.49, y, w * 0.02, h / 4);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.05})`; c.beginPath(); c.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 30, 10 + rnd() * 60, 0, 0, 7); c.fill(); }
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.roadMat = mat;
    const R = [
      { w: 7, closed: true, p: [[-76, 21], [116, 21], [116, -211], [-76, -211]] },
      { w: 7, p: [[-76, -60], [-120, -60], [-170, -58], [-260, -40], [-420, 10], [-700, 90], [-1100, 160], [-1500, 260], [-2200, 430], [-3200, 650]] },
      { w: 6, p: [[-168, -58], [-172, -25], [-178, 18], [-182, 26]] },
      { w: 6, p: [[116, -110], [220, -122], [380, -152], [520, -190], [640, -210]] },
    ];
    this.roads = R.map(r => this.road(r, mat));
    // car park at the viewing stand
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.9, map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(VIEW_STAND.x, gy(VIEW_STAND.x, 30) + 0.05, 30); lot.receiveShadow = true; this.group.add(lot);
  }
  road({ w, p, closed }, mat) {
    let pts = p.map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (closed) { // chamfer corners so the loop has rounded bends
      const out = [];
      for (let i = 0; i < pts.length; i++) { const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length]; out.push(b.clone().lerp(a, 12 / a.distanceTo(b)), b.clone().lerp(c, 12 / c.distanceTo(b))); }
      pts = out;
    }
    const curve = new THREE.CatmullRomCurve3(pts, !!closed, 'centripetal');
    const n = Math.max(8, Math.round(curve.getLength() / 4)), sp = curve.getSpacedPoints(n);
    const pos = [], uv = [], idx = []; let v = 0;
    for (let i = 0; i < sp.length; i++) {
      const a = sp[Math.max(0, i - 1)], b = sp[Math.min(sp.length - 1, i + 1)], t = new THREE.Vector3().subVectors(b, a).normalize(), nx = -t.z * w / 2, nz = t.x * w / 2, c = sp[i];
      if (i) v += c.distanceTo(sp[i - 1]);
      for (const s of [-1, 1]) { const x = c.x + nx * s, z = c.z + nz * s, inside = siteDist(x, z) < 0; pos.push(x, gy(x, z) + (inside ? 0.07 : 0.22), z); }
      uv.push(0, v / 16, 1, v / 16);
      if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      this.roadPts.push([c.x, c.z, w / 2 + 2.5]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m);
    return sp;
  }
  nearRoad(x, z) { for (const [rx, rz, r] of this.roadPts) if (Math.abs(rx - x) < r && Math.abs(rz - z) < r && (rx - x) ** 2 + (rz - z) ** 2 < r * r) return true; return false; }

  // ---------- perimeter fence with gate, guard booth and boom barrier ----------
  buildFence() {
    const F = FENCE, M = this.m, g = new THREE.Group();
    const link = canvasTex(64, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(190,196,200,1)'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke(); });
    const linkMat = new THREE.MeshStandardMaterial({ map: link, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, color: 0xd5dade });
    const segs = [
      [[F.x0, F.z1], [F.x1, F.z1]], [[F.x1, F.z1], [F.x1, F.z0]], [[F.x1, F.z0], [F.x0, F.z0]],
      [[F.x0, F.z0], [F.x0, F.gateZ - F.gateW / 2]], [[F.x0, F.gateZ + F.gateW / 2], [F.x0, F.z1]],
    ];
    const postPos = [];
    for (const [[ax, az], [bx, bz]] of segs) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.1), linkMat.clone()); panel.material.map = link.clone(); panel.material.map.repeat.set(L / 0.07 / 8, 2.1 / 0.07 / 8); panel.material.map.needsUpdate = true;
      panel.position.set((ax + bx) / 2, 1.15, (az + bz) / 2); panel.rotation.y = -Math.atan2(bz - az, bx - ax); panel.userData.noBake = true; g.add(panel);
      for (let i = 0; i <= n; i++) postPos.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
      for (const y of [2.25, 2.4, 2.55]) this.wire(new THREE.Vector3(ax, y, az), new THREE.Vector3(bx, y, bz), 0, this.group);
    }
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 2.6, 6), M.grey, postPos.length), o = new THREE.Object3D();
    postPos.forEach(([x, z], i) => { o.position.set(x, 1.3, z); o.updateMatrix(); posts.setMatrixAt(i, o.matrix); });
    posts.castShadow = true; g.add(posts);
    // gate: booth + striped boom
    const booth = new THREE.Group(); booth.position.set(F.x0 + 6, 0, F.gateZ + F.gateW / 2 + 3);
    box(3, 2.6, 3, M.white, 0, 1.3, 0, booth); box(3.4, 0.2, 3.4, M.dark, 0, 2.7, 0, booth);
    for (const [x, z, ry] of [[-1.51, 0, Math.PI / 2], [1.51, 0, Math.PI / 2], [0, -1.51, 0], [0, 1.51, 0]]) { const w = box(2.2, 1.0, 0.02, M.glass, x, 1.75, z, booth); w.rotation.y = ry; }
    g.add(booth);
    const stripe = canvasTex(256, 16, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f2f2f2' : '#d6281f'; c.fillRect(i * 32, 0, 32, h); } });
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, F.gateW - 1), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.5 }));
    boom.position.set(F.x0 - 1, 1.05, F.gateZ); boom.material.map.rotation = Math.PI / 2; boom.userData.noBake = true; g.add(boom);
    box(0.4, 1.1, 0.4, M.yellow, F.x0 - 1, 0.55, F.gateZ - F.gateW / 2 + 0.3, g);
    this.group.add(bake(g));
  }

  // ---------- big structures ----------
  buildWaterTower() {
    const M = this.m, g = new THREE.Group(), H = 30; g.position.set(132, 0, -150);
    const legTop = 3.2, legBot = 6.5;
    const tops = [], bots = [];
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; tops.push(new THREE.Vector3(Math.cos(a) * legTop, H, Math.sin(a) * legTop)); bots.push(new THREE.Vector3(Math.cos(a) * legBot, 0, Math.sin(a) * legBot)); }
    for (let i = 0; i < 4; i++) strut(bots[i], tops[i], 0.32, M.white, g, 10);
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4, t1 = (k + 1) / 4, P = (i, t) => bots[i].clone().lerp(tops[i], t);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; strut(P(i, t0), P(j, t1), 0.06, M.grey, g, 6); strut(P(j, t0), P(i, t1), 0.06, M.grey, g, 6); strut(P(i, t1), P(j, t1), 0.08, M.white, g, 6); }
    }
    cyl(0.5, 0.5, H, M.grey, 0, H / 2, 0, g, 12);
    const logo = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#e8ebee'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d5d8f'; c.fillRect(0, 18, w, 92); c.fillStyle = '#fff'; c.font = 'bold 64px Arial'; c.textBaseline = 'middle'; for (let i = 0; i < 2; i++) c.fillText('CHROME HANGAR RANGE', 40 + i * 512, h / 2); });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 8, 40, 1, true), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.42, metalness: 0.25, side: THREE.DoubleSide }));
    tank.position.y = H + 4; tank.castShadow = true; g.add(tank);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(6.5, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.white); bottom.scale.y = 0.5; bottom.position.y = H; bottom.castShadow = true; g.add(bottom);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.7, 2.6, 40), M.white); roof.position.y = H + 9.3; roof.castShadow = true; g.add(roof);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.05, 6, 64), M.grey); rail.rotation.x = Math.PI / 2; rail.position.y = H + 1.1; g.add(rail);
    const walk = new THREE.Mesh(new THREE.RingGeometry(6.5, 7.3, 48), M.dark); walk.rotation.x = -Math.PI / 2; walk.position.y = H + 0.05; g.add(walk);
    const bl = cyl(0.15, 0.15, 0.3, M.redLight, 0, H + 10.8, 0, g, 8);
    // deluge pipe running to the pad on low supports
    const a = new THREE.Vector3(0, 0.7, 0), b = new THREE.Vector3(PAD.x + 24 - g.position.x, 0.7, PAD.z - g.position.z);
    strut(a, b, 0.45, M.white, g, 12);
    for (let t = 0.05; t < 1; t += 0.08) { const p = a.clone().lerp(b, t); box(0.3, 0.5, 1.2, M.concrete, p.x, 0.25, p.z, g); }
    this.group.add(bake(g));
  }
  buildTankFarm() {
    const M = this.m, g = new THREE.Group();
    // liquid-oxygen sphere on legs
    const s = new THREE.Group(); s.position.set(-48, 0, -175);
    const sph = new THREE.Mesh(new THREE.SphereGeometry(6, 40, 24), M.white); sph.position.y = 9; sph.castShadow = true; s.add(sph);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(6.02, 0.12, 6, 64), M.grey); belt.rotation.x = Math.PI / 2; belt.position.y = 9; s.add(belt);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; strut(new THREE.Vector3(Math.cos(a) * 6.4, 0, Math.sin(a) * 6.4), new THREE.Vector3(Math.cos(a) * 6, 9, Math.sin(a) * 6), 0.22, M.grey, s, 8); }
    box(16, 0.4, 16, M.concrete, 0, 0.2, 0, s);
    cyl(0.18, 0.18, 6, M.grey, 4.5, 15.5, 0, s, 8); cyl(0.3, 0.18, 0.6, M.grey, 4.5, 18.8, 0, s, 8); // vent stack
    g.add(s);
    // two horizontal fuel tanks on saddles
    for (const z of [-166, -178]) {
      const t = new THREE.Group(); t.position.set(48, 0, z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 22, 32), M.white); body.rotation.z = Math.PI / 2; body.position.y = 3.4; body.castShadow = true; t.add(body);
      for (const x of [-11, 11]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 12), M.white); cap.scale.x = 0.45; cap.position.set(x, 3.4, 0); t.add(cap); }
      for (const x of [-7, 0, 7]) { box(0.8, 1.8, 5, M.concrete, x, 0.9, 0, t); const r = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.08, 6, 40), M.grey); r.rotation.y = Math.PI / 2; r.position.set(x, 3.4, 0); t.add(r); }
      box(1, 0.1, 22, M.dark, 0, 5.9, 0, t).rotation.y = Math.PI / 2;
      g.add(t);
    }
    box(30, 0.3, 24, M.concrete, 48, 0.15, -172, g);
    // feed lines to the pad
    for (const [x0, z0] of [[-48, -168], [42, -172]]) {
      const a = new THREE.Vector3(x0, 0.6, z0), b = new THREE.Vector3(PAD.x + Math.sign(x0) * 21, 0.6, PAD.z - 6);
      strut(a, b, 0.25, M.alu, g, 10); strut(a.clone().add(new THREE.Vector3(0, 0, 0.8)), b.clone().add(new THREE.Vector3(0, 0, 0.8)), 0.18, M.alu, g, 10);
      for (let t = 0.06; t < 1; t += 0.12) { const p = a.clone().lerp(b, t); box(0.25, 0.45, 1.6, M.dark, p.x, 0.22, p.z + 0.4, g); }
    }
    this.group.add(bake(g));
  }
  buildMasts() {
    const M = this.m, g = new THREE.Group();
    // flood-light masts around the pad and the test stand
    const lampHead = (x, z, H2, face) => {
      const m = new THREE.Group(); m.position.set(x, 0, z);
      cyl(0.22, 0.42, H2, M.grey, 0, H2 / 2, 0, m, 10); box(3.6, 0.15, 1.4, M.dark, 0, H2, 0, m);
      for (let i = 0; i < 6; i++) { const lx = -1.5 + (i % 3) * 1.5, ly = H2 + 0.7 + Math.floor(i / 3) * 0.9; box(1.1, 0.75, 0.35, M.dark, lx, ly, 0.1, m); const lens = box(0.95, 0.6, 0.04, M.lamp, lx, ly, 0.3, m); lens.castShadow = false; }
      cyl(0.6, 0.8, 0.5, M.concrete, 0, 0.25, 0, m, 12);
      m.rotation.y = face; g.add(m);
    };
    for (const [x, z] of [[-34, -150], [34, -150], [-34, -80], [34, -80]]) lampHead(x, z, 26, Math.atan2(PAD.x - x, PAD.z - z));
    for (const [x, z] of [[30, -55], [66, -90]]) lampHead(x, z, 18, Math.atan2(48 - x, -72 - z));
    this.group.add(bake(g));
  }
  // wires are collected (in world space) and drawn as one LineSegments at the end
  wire(a, b, sag, parent) {
    parent.updateMatrixWorld(true);
    const A = a.clone().applyMatrix4(parent.matrixWorld), B = b.clone().applyMatrix4(parent.matrixWorld), n = sag > 0 ? 16 : 1;
    let prev = A;
    for (let i = 1; i <= n; i++) { const t = i / n, p = A.clone().lerp(B, t); p.y -= sag * 4 * t * (1 - t); (this.wirePts ||= []).push(prev, p); prev = p; }
  }
  flushWires() {
    if (!this.wirePts?.length) return;
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(this.wirePts), new THREE.LineBasicMaterial({ color: 0x3a3e44 }));
    this.group.add(l); this.wirePts = [];
  }
  buildBunker() {
    const M = this.m, g = new THREE.Group(); g.position.set(-118, 0, -135); g.rotation.y = Math.PI / 2 - 0.35;
    // earth berm (truncated pyramid) around a concrete block with slit windows
    const berm = new THREE.Mesh(new THREE.CylinderGeometry(13, 19, 5, 4, 1), M.earth); berm.rotation.y = Math.PI / 4; berm.scale.set(1.25, 1, 0.8); berm.position.y = 2.5; berm.castShadow = berm.receiveShadow = true; g.add(berm);
    box(20, 6, 11, M.concrete, 0, 3, -5.5, g);
    const roof = box(21, 1.2, 12, M.concrete, 0, 6.4, -5.5, g); roof.scale.set(1, 1, 1);
    for (let i = -3; i <= 3; i++) { const w = box(1.6, 0.35, 0.1, M.glass, i * 2.4, 4.9, -11.05, g); }
    box(2.4, 3.2, 0.25, M.dark, 6.5, 1.6, -11.1, g); box(2.8, 0.2, 0.6, M.yellow, 6.5, 3.35, -11.2, g);
    // roof kit: antenna mast, dish, aircon, beacon
    cyl(0.08, 0.12, 9, M.grey, -7, 11.5, -6, g, 8); const dish = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 8, 0, Math.PI * 2, 0, 0.9), M.white); dish.rotation.x = -1.0; dish.position.set(4, 8.2, -4); g.add(dish);
    cyl(0.1, 0.1, 1.2, M.grey, 4, 7.3, -4, g, 6);
    cyl(0.18, 0.18, 0.3, M.redLight, -7, 16.1, -6, g, 8);
    // sign
    const sign = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#1c2228'; c.fillRect(0, 0, w, h); c.fillStyle = '#e5ae1c'; c.fillRect(0, h - 12, w, 12); c.fillStyle = '#fff'; c.font = 'bold 52px Arial'; c.textBaseline = 'middle'; c.fillText('LAUNCH CONTROL 1', 20, h / 2 - 4); });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 })); sm.position.set(-3, 5.4, -11.12); sm.rotation.y = Math.PI; sm.userData.noBake = true; g.add(sm);
    this.bunker = g; this.group.add(bake(g));
  }
  buildViewStand() {
    const M = this.m, g = new THREE.Group(), V = VIEW_STAND;
    const y0 = gy(V.x, V.z); g.position.set(V.x, y0, V.z);
    g.rotation.y = Math.atan2(PAD.x - V.x, PAD.z - V.z);     // +Z faces the pad
    const L = 26, tiers = 7;
    for (let i = 0; i < tiers; i++) {
      const y = 0.5 + i * 0.48, z = -i * 0.95;
      box(L, 0.08, 0.5, M.alu, 0, y + 0.45, z + 0.1, g);       // seat plank
      box(L, 0.05, 0.6, M.grey, 0, y, z - 0.35, g);             // foot board
      box(L, 0.42, 0.04, M.grey, 0, y + 0.2, z + 0.32, g);
    }
    for (let x = -L / 2; x <= L / 2 + 0.01; x += 3.25) {
      const back = new THREE.Vector3(x, 0, -(tiers - 1) * 0.95 - 0.5), front = new THREE.Vector3(x, 0, 0.5);
      strut(front, front.clone().setY(0.6), 0.06, M.grey, g, 6); strut(back, back.clone().setY(0.5 + (tiers - 1) * 0.48 + 0.5), 0.07, M.grey, g, 6);
      strut(front.clone().setY(0.55), back.clone().setY(0.5 + (tiers - 1) * 0.48 + 0.45), 0.06, M.grey, g, 6);
      strut(back, back.clone().setY(8), 0.09, M.white, g, 8);
    }
    const canopy = box(L + 2, 0.2, 8.5, M.white, 0, 8.1, -3.2, g); canopy.rotation.x = -0.08;
    box(L, 0.05, 0.05, M.alu, 0, 1.6, 0.6, g);
    const sign = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#1d5d8f'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 72px Arial'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText('PUBLIC VIEWING STAND', w / 2, h / 2); });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 })); sm.position.set(0, 7.4, 1.0); sm.userData.noBake = true; g.add(sm);
    box(L + 6, 0.3, 10, M.concrete, 0, 0.0, -2.8, g);
    // cinematic camera: in an aisle between the 3.25 m posts, just in front of the
    // canopy and the front rail, so thin poles and wires sit behind the lens
    g.updateMatrixWorld(true);
    this.standCam = new THREE.Vector3(1.625, 5.85, 4.4).applyMatrix4(g.matrixWorld);
    this.group.add(bake(g));
  }
  buildWindsocks() {
    const M = this.m;
    const tex = canvasTex(128, 32, (c, w, h) => { for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? '#f4f4f0' : '#f0601e'; c.fillRect(i * w / 5, 0, w / 5, h); } });
    for (const [x, z] of [[62, -40], [-60, -200], [-160, 20]]) {
      const g = new THREE.Group(); g.position.set(x, gy(x, z), z);
      cyl(0.06, 0.09, 7, M.grey, 0, 3.5, 0, g, 8);
      const pivot = new THREE.Group(); pivot.position.y = 6.9; g.add(pivot);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 20), M.grey); ring.rotation.y = Math.PI / 2; pivot.add(ring);
      const geo = new THREE.CylinderGeometry(0.42, 0.16, 2.6, 14, 6, true); geo.rotateZ(Math.PI / 2); geo.translate(1.3, 0, 0);
      tex.rotation = 0;
      const sock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 })); sock.castShadow = true; pivot.add(sock);
      this.group.add(g); this.socks.push({ pivot, sock, ph: rnd() * 6 });
    }
  }

  // ---------- CC0 models ----------
  async buildModels() {
    const g = new THREE.Group(); this.group.add(g);
    const place = async (name, list, filter, opts) => {
      const ps = await pieces(name, filter, opts), o = new THREE.Object3D();
      for (const p of ps) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
        list.forEach(([x, z, ry = 0, s = 1, y], i) => { o.position.set(x, y ?? gy(x, z), z); o.rotation.set(0, ry, 0); o.scale.setScalar(s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im);
      }
    };
    // street lamps along the perimeter road and out the access road
    const lamps = [];
    for (let x = -60; x <= 100; x += 40) lamps.push([x, 28, Math.PI], [x, -218, 0]);
    for (let z = -190; z <= 0; z += 40) lamps.push([123, z, -Math.PI / 2], [-83, z, Math.PI / 2]);
    const acc = this.roads[1];
    for (let i = 14; i < Math.min(acc.length - 1, 120); i += 12) { const a = acc[i - 1], b = acc[i + 1], c = acc[i], t = new THREE.Vector3().subVectors(b, a).normalize(); lamps.push([c.x - t.z * 6, c.z + t.x * 6, Math.atan2(t.x, t.z) + Math.PI / 2]); }
    const jobs = [
      place('street_lamp_01', lamps, null, { scale: 2.1 }),
      place('concrete_road_barrier', [[610, -216, 0.3], [612, -205, 0.3], [614, -194, 0.3], [-140, -51, 0], [-140, -69, 0], [20, -200, 0], [-20, -200, 0], [60, -205, 0.1]], null),
      place('utility_box_01', [[-104, -128, 1.2], [-104, -126.6, 1.2], [128, -140, 0], [-28, -18, 0], [30, -18, 0]], null),
      place('exterior_aircon_unit', [[-110, -146, 1.2], [-108, -149, 1.2]], n => n === 'exterior_aircon_unit_rusted'),
      place('portable_generator', [[-98, -132, 0.5], [55, -60, 2.1]], null),
      place('small_lpg_tank', [[-100, -136, 0], [-100.6, -136.5, 0], [-99.4, -136.6, 0]], null),
      place('metal_jerrycan', [[54, -61.5, 0.3], [-97, -133, 1]], null),
      place('fire_hydrant', [[16, 18.5, 0.2], [-30, 18.5, 2.1], [14, -92, 1.0], [-120, -128, 0.5], [44, -172, 2.6]], n => n === 'fire_hydrant'),
      place('old_tyre', [[-112, -118, 0, 1, undefined], [-111.4, -118.6, 0.7], [62, -183, 1.3], [-99, -136, 2.2]], null),
      place('Barrel_01', [[60, -185, 0], [60.7, -185.4, 0.4], [60.2, -186.1, 1], [-110, -120, 0], [-110.6, -120.5, 0]], null),
      place('wooden_crate_02', [[22, -20, 0.2], [23.2, -20.4, 1.4], [22.6, -20.2, 0.6, 1, 0.45]], null),
      place('security_light', [[-15, -16.45, Math.PI, 1.6, 9], [15, -16.45, Math.PI, 1.6, 9]], null),
      place('namaqualand_boulder_02', [[-150, -70, 0.4, 1.4], [-150, -50, 2.0, 1.2], [612, -225, 1, 1.6], [-190, 44, 0.8, 1.1], [-160, 64, 2.5, 1.3]], null),
    ];
    await Promise.all(jobs);
  }
  async buildVehicles() {
    const M = this.m, g = new THREE.Group();
    const wheel = (x, z, r, parent) => { const w = cyl(r, r, 0.38, M.tire, x, r, z, parent, 16); w.rotation.z = Math.PI / 2; const h = cyl(r * 0.55, r * 0.55, 0.4, M.alu, x, r, z, parent, 12); h.rotation.z = Math.PI / 2; };
    const truck = (kind, color, x, z, ry) => {
      const t = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.35 });
      t.position.set(x, gy(x, z), z); t.rotation.y = ry;
      box(2.3, 0.35, 9, M.dark, 0, 0.9, 0, t);
      box(2.4, 2.2, 2.2, paint, 0, 2.0, 3.4, t); const ws = box(2.2, 0.9, 0.05, M.glass, 0, 2.55, 4.52, t); ws.rotation.x = -0.12;
      for (const sx of [-1.21, 1.21]) box(0.04, 0.7, 1.2, M.glass, sx, 2.5, 3.6, t);
      box(2.3, 0.3, 0.2, M.grey, 0, 1.0, 4.55, t); for (const sx of [-0.9, 0.9]) box(0.4, 0.18, 0.05, M.lamp, sx, 1.3, 4.52, t);
      if (kind === 'box') { box(2.45, 2.7, 6, M.white, 0, 2.45, -1.0, t); box(2.47, 0.35, 6.02, paint, 0, 1.35, -1.0, t); }
      else { const tk = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 5.8, 24), M.alu); tk.rotation.x = Math.PI / 2; tk.position.set(0, 2.25, -1.0); tk.castShadow = true; t.add(tk); for (const zz of [-3.4, 1.4]) { const c = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 8), M.alu); c.scale.z = 0.3; c.position.set(0, 2.25, zz + 0.5); t.add(c); } box(0.4, 0.2, 5.6, M.grey, 0, 3.45, -1, t); }
      for (const zz of [3.3, -2.0, -3.3]) { wheel(-1.05, zz, 0.52, t); wheel(1.05, zz, 0.52, t); }
      g.add(t);
    };
    truck('box', 0x1d5d8f, 26, -30, 0.4);
    truck('tanker', 0xc7c9cc, 66, -186, -Math.PI / 2);
    truck('box', 0xd0562a, -104, -112, 1.9);
    // tarp-covered cars (CC0 model) in the viewing-stand car park and by the hangar
    const car = await pieces('covered_car');
    const spots = [[-196, 26, 0.0], [-192.5, 26, 0.03], [-171, 25, -0.05], [-167, 25, 0.02], [32, 10, 1.57], [32, 4.5, 1.6]];
    const o = new THREE.Object3D();
    for (const p of car) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, spots.length);
      spots.forEach(([x, z, ry], i) => { o.position.set(x, gy(x, z) + 0.05, z); o.rotation.set(0, ry, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.castShadow = true; im.computeBoundingSphere(); this.group.add(im);
    }
    this.group.add(bake(g));
  }
  async buildPowerLine() {
    // CC0 modular electricity pole (Poly Haven), assembled from its "preset_01" pieces, along the access road
    const ps = await pieces('modular_electricity_poles', n => n.startsWith('preset_01'));
    const list = [], tops = [];
    let prev = null;
    for (let d = 0; d < 2600; d += 70) {
      const k = d / 2600, x = -150 - d * 0.97, z = -70 + d * 0.22 * (0.5 + k) - 12;
      const ry = Math.atan2(-0.22, -0.97); list.push([x, gy(x, z), z, ry]);
      const top = new THREE.Vector3(x, gy(x, z) + 5.5, z); if (prev) for (const off of [-0.55, 0, 0.55]) { const s = new THREE.Vector3(Math.sin(ry) * off, 0, Math.cos(ry) * off); this.wire(prev.clone().add(s), top.clone().add(s), 0.9, this.group); }
      prev = top;
    }
    // groups of 8 poles, each culled by distance like the scatter chunks
    const o = new THREE.Object3D();
    for (let k = 0; k < list.length; k += 8) {
      const part = list.slice(k, k + 8), grp = new THREE.Group(), mid = part[part.length >> 1];
      grp.userData = { x: mid[0], z: mid[2], items: [] };
      for (const p of ps) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, part.length);
        part.forEach(([x, y, z, ry], i) => { o.position.set(x, y, z); o.rotation.set(0, ry + Math.PI / 2, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
        im.castShadow = true; im.computeBoundingSphere(); im.userData.far = this.lite ? 900 : 1600; grp.add(im); grp.userData.items.push(im);
      }
      this.group.add(grp); this.chunks.push(grp);
    }
  }

  // ---------- rocks, scrub and grass: instanced per 400 m chunk, culled by distance ----------
  async buildScatter() {
    const lite = this.lite;
    const kinds = [
      { model: 'rock_moss_set_01', nodes: ['rock01', 'rock03', 'rock05'], n: lite ? 200 : 560, far: lite ? 700 : 2000, s: [0.4, 1.5], r: [60, 1700], slopeMax: 9, beach: true, shadow: true, sink: 0.25 },
      { model: 'namaqualand_boulder_02', nodes: [null], n: lite ? 60 : 180, far: lite ? 700 : 2000, s: [0.5, 2.2], r: [60, 1700], slopeMax: 9, beach: true, shadow: true, sink: 0.1 },
      { model: 'shrub_02', nodes: ['shrub_02_b', 'shrub_02_d'], n: lite ? 220 : 520, far: lite ? 240 : 520, s: [0.5, 1.2], r: [20, 1300], slopeMax: 0.6, shadow: !lite },
      { model: 'wild_rooibos_bush', nodes: ['wild_rooibos_bush_d', 'wild_rooibos_bush_e'], n: lite ? 300 : 1300, far: lite ? 180 : 480, s: [1.2, 2.6], r: [12, 1100], slopeMax: 0.6, shadow: !lite },
      { model: 'cheiridopsis_succulent', nodes: ['succulent_a', 'succulent_d'], n: lite ? 160 : 520, far: lite ? 110 : 260, s: [1.4, 2.4], r: [10, 900], slopeMax: 0.6, shadow: false },
      { model: 'shrub_03', nodes: [null], n: lite ? 180 : 600, far: lite ? 140 : 320, s: [2.0, 3.6], r: [10, 1100], slopeMax: 0.6, beach: true, shadow: false },
      { model: 'searsia_lucida', nodes: [null], n: lite ? 0 : 320, far: 900, s: [0.8, 1.4], r: [60, 1400], slopeMax: 0.5, shadow: true },
      { model: 'grass_medium_01', nodes: ['tall_a', 'tall_b', 'tall_c'], n: lite ? 900 : 6500, far: lite ? 70 : 230, s: [2.2, 3.6], r: [4, 420], slopeMax: 0.5, shadow: false },
    ];
    const C = 400, cx = -10, cz = -95, chunks = new Map();
    const F = FENCE;
    for (const k of kinds) {
      if (!k.n) continue;
      const variants = await Promise.all(k.nodes.map(nm => pieces(k.model, nm ? (n => n.includes(nm)) : null)));
      let placed = 0, tries = 0;
      while (placed < k.n && tries++ < k.n * 30) {
        // bias toward the site: radius from a squared distribution
        const a = rnd() * Math.PI * 2, rr = k.r[0] + (k.r[1] - k.r[0]) * rnd() ** 1.7;
        const sd0 = rr, x = cx + Math.cos(a) * (sd0 + 160), z = cz + Math.sin(a) * (sd0 + 170);
        if (x > F.x0 - 4 && x < F.x1 + 4 && z > F.z0 - 4 && z < F.z1 + 4) continue;
        const h = height(x, z);
        if (h < SEA + (k.beach ? 0.1 : 0.9)) continue;
        if (slopeAt(x, z) > k.slopeMax) continue;
        if (this.nearRoad(x, z)) continue;
        if (Math.hypot(x - VIEW_STAND.x, z - VIEW_STAND.z) < 24 || Math.hypot(x - VIEW_STAND.x, z - 30) < 26) continue;
        const v = (rnd() * variants.length) | 0, key = `${Math.floor(x / C)},${Math.floor(z / C)}`;
        if (!chunks.has(key)) chunks.set(key, { x: (Math.floor(x / C) + 0.5) * C, z: (Math.floor(z / C) + 0.5) * C, sets: new Map() });
        const ch = chunks.get(key), sk = k.model + v;
        if (!ch.sets.has(sk)) ch.sets.set(sk, { k, ps: variants[v], list: [] });
        const s = k.s[0] + (k.s[1] - k.s[0]) * rnd();
        ch.sets.get(sk).list.push([x, h - 0.12 - (k.sink || 0) * s, z, rnd() * Math.PI * 2, s]);
        placed++;
      }
    }
    const o = new THREE.Object3D();
    for (const ch of chunks.values()) {
      const grp = new THREE.Group(); grp.userData = { x: ch.x, z: ch.z, items: [] };
      for (const { k, ps, list } of ch.sets.values()) {
        for (const p of ps) {
          const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
          list.forEach(([x, y, z, ry, s], i) => { o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.scale.setScalar(s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
          im.castShadow = !!k.shadow; im.receiveShadow = true; im.computeBoundingSphere(); im.userData.far = k.far;
          grp.add(im); grp.userData.items.push(im);
        }
      }
      this.group.add(grp); this.chunks.push(grp);
    }
    this.scatterCount = [...chunks.values()].reduce((a, c) => a + [...c.sets.values()].reduce((b, s) => b + s.list.length, 0), 0);
  }

  // ---------- per frame ----------
  update(dt, cam, wind = { x: 2, z: 0.6 }) {
    this.time += dt;
    this.terrain?.refine(cam.position, 2);
    if (this.oceanMat) this.oceanMat.uniforms.uT.value = this.time;
    if (this.surf) for (const s of this.surf) { s.material.map.offset.x = (Math.sin(this.time * 0.5 + s.userData.surf) * 0.18); }
    const px = cam.position.x, pz = cam.position.z, alt = Math.max(0, cam.position.y);
    for (const ch of this.chunks) {
      const dx = Math.max(0, Math.abs(px - ch.userData.x) - 200), dz = Math.max(0, Math.abs(pz - ch.userData.z) - 200), d = Math.hypot(dx, dz, alt);
      let any = false; for (const im of ch.userData.items) { im.visible = d < im.userData.far; any ||= im.visible; }
      ch.visible = any;
    }
    const ws = Math.hypot(wind.x, wind.z), dir = Math.atan2(-wind.z, wind.x);
    for (const s of this.socks) {
      s.pivot.rotation.y = dir + Math.sin(this.time * 0.7 + s.ph) * 0.12;
      s.sock.rotation.z = -THREE.MathUtils.clamp(1.25 - ws * 0.12, 0.05, 1.25) + Math.sin(this.time * 6 + s.ph) * 0.04;
    }
  }
}
