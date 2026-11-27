// Procedural meshes for every part. Original designs: welded stainless tanks with brushed grain,
// machined dark engine sections, regeneratively cooled bells. No real-vehicle shapes or marks.
// Every part is assembled from primitives and merged into one mesh per material (few draw calls);
// the fine detail (weld beads, panel lines, rivets, stringers, smudges, heat tint) lives in
// generated normal / roughness / colour maps.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { PARTS, layout } from './rocket.js';

let M = null; // shared materials
const cache = new Map();
const TAU = Math.PI * 2, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------- generated maps ----------
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb, rep = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
}
// height canvas -> tangent-space normal map (u wraps around the part)
function normalFrom(hc, k) {
  const W = hc.width, H = hc.height, src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const [c, g] = cnv(W, H), out = g.createImageData(W, H), d = out.data, h = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * k, dy = (h(x, Math.min(H - 1, y + 1)) - h(x, Math.max(0, y - 1))) * k;
    const l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(out, 0, 0); return c;
}
const line = (g, x0, y0, x1, y1, w, col, blur = 0) => { g.save(); g.filter = blur ? `blur(${blur}px)` : 'none'; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore(); };
const dot = (g, x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };

// Hull maps for a part of length len (m). style: 'mirror' | 'brushed' | 'dark' | 'nose'. heat: soot/temper tint at the bottom.
function hullMaps(style, len, heat) {
  const key = `hull:${style}:${len}:${heat ? 1 : 0}`; if (cache.has(key)) return cache.get(key);
  seed = Math.round(len * 977) + style.length * 31 + (heat ? 5 : 0);
  const W = 512, ppm = 90, H = Math.max(128, Math.min(1024, Math.round(len * ppm))), py = H / len, dark = style === 'dark';
  const [hc, hg] = cnv(W, H), [rc, rg] = cnv(W, H), [cc, cg] = cnv(W, H);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, H);
  const base = dark ? 0.42 : style === 'mirror' ? 0.13 : style === 'nose' ? 0.16 : 0.27;
  rg.fillStyle = `rgb(${base * 255 | 0},0,0)`; rg.fillStyle = `rgb(0,${base * 255 | 0},0)`; rg.fillRect(0, 0, W, H);
  cg.fillStyle = dark ? '#2b2e33' : style === 'mirror' ? '#d4d6d9' : style === 'nose' ? '#cfd1d4' : '#c2c5c9'; cg.fillRect(0, 0, W, H);   // stainless F0, not paper white
  if (dark) {   // wound carbon over a liner: diagonal weave
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) { const on = ((x + y) / 8) % 2 < 1; hg.fillStyle = on ? '#8a8a8a' : '#767676'; hg.fillRect(x, y, 8, 8); rg.fillStyle = `rgb(0,${on ? 96 : 120},0)`; rg.fillRect(x, y, 8, 8); }
  } else {
    // internal stringers show through as faint vertical ridges ("oil canning" between them)
    for (let x = 0; x < W; x += 32) { const gr = hg.createLinearGradient(x, 0, x + 32, 0); gr.addColorStop(0, '#7c7c7c'); gr.addColorStop(0.5, '#868686'); gr.addColorStop(1, '#7c7c7c'); hg.fillStyle = gr; hg.fillRect(x, 0, 32, H); }
    // brushed grain: fine horizontal streaks in roughness and a whisper in height
    for (let i = 0; i < H * 3; i++) {
      const y = rnd() * H, x = rnd() * W, w = 40 + rnd() * W, a = rnd() * 0.12;
      rg.fillStyle = rnd() > 0.5 ? `rgba(0,255,0,${a * 0.6})` : `rgba(0,0,0,${a})`; rg.fillRect(x, y, w, 1);
    }
  }
  // circumferential weld rings: ~1.5 m courses
  const n = Math.max(1, Math.round(len / 1.5)), ring = [];
  for (let k = 1; k < n; k++) ring.push(H * k / n);
  for (const y of ring) {
    line(hg, 0, y, W, y, 5, '#a8a8a8', 1.2); line(hg, 0, y, W, y, 2, '#d8d8d8', 0.6);
    line(rg, 0, y, W, y, 9, 'rgba(0,200,0,0.55)', 2);
    if (!dark) { line(cg, 0, y - 5, W, y - 5, 4, 'rgba(214,180,120,0.22)', 3); line(cg, 0, y + 5, W, y + 5, 4, 'rgba(140,150,210,0.18)', 3); line(cg, 0, y, W, y, 2, 'rgba(120,110,100,0.35)', 1); }
  }
  // vertical seams, staggered course to course
  const edges = [0, ...ring, H];
  for (let k = 0; k < edges.length - 1; k++) {
    const x = ((0.13 + k * 0.37) % 1) * W;
    line(hg, x, edges[k], x, edges[k + 1], 4, '#a4a4a4', 1); line(hg, x, edges[k], x, edges[k + 1], 1.5, '#d0d0d0', 0.5);
    line(rg, x, edges[k], x, edges[k + 1], 7, 'rgba(0,190,0,0.5)', 2);
    if (!dark) line(cg, x, edges[k], x, edges[k + 1], 5, 'rgba(200,170,120,0.18)', 2.5);
  }
  // end flanges with bolt rows
  for (const y of [7, H - 7]) {
    line(hg, 0, y, W, y, 10, '#909090', 0.8);
    for (let x = 4; x < W; x += W / 48) { dot(hg, x, y, 2.4, '#e0e0e0'); dot(rg, x, y, 2.4, 'rgb(0,90,0)'); }
  }
  // access panels: recessed outlines ringed with rivets, plus a stencil
  if (len >= 1.5 && style !== 'nose') {
    const panels = len > 5 ? 3 : len > 2.5 ? 2 : 1;
    for (let i = 0; i < panels; i++) {
      const pw = 34 + rnd() * 26, ph = 44 + rnd() * 40, x = ((0.55 + i * 0.29) % 1) * W, y = H * (0.2 + 0.6 * (i + 0.5) / panels) - ph / 2;
      hg.save(); hg.strokeStyle = '#4c4c4c'; hg.lineWidth = 2.2; hg.filter = 'blur(0.6px)'; hg.beginPath(); hg.roundRect(x, y, pw, ph, 5); hg.stroke(); hg.restore();
      rg.save(); rg.fillStyle = 'rgba(0,0,0,0.25)'; rg.fillRect(x, y, pw, ph); rg.restore();
      for (let t = 0; t < 1; t += 1 / 14) { const px = x + pw * t, qy = y + ph * t; for (const [a, b] of [[px, y - 5], [px, y + ph + 5], [x - 5, qy], [x + pw + 5, qy]]) { dot(hg, a, b, 1.5, '#d4d4d4'); dot(rg, a, b, 1.5, 'rgb(0,70,0)'); } }
      if (!dark) { cg.save(); cg.fillStyle = 'rgba(25,27,30,0.75)'; cg.font = 'bold 9px monospace'; cg.fillText(['VENT', 'GSE', 'ACCESS'][i % 3], x + 2, y + ph + 16); cg.restore(); }
    }
  }
  if (style !== 'nose' && !dark && len >= 1.5) {   // livery: one dark band and a hull number, original marks only
    const by = 26; cg.fillStyle = '#16181b'; cg.fillRect(0, by, W, 12); hg.fillStyle = '#7a7a7a'; hg.fillRect(0, by, W, 12);
    cg.save(); cg.fillStyle = 'rgba(20,22,25,0.85)'; cg.font = 'bold 22px sans-serif'; cg.fillText('CH-1', W * 0.18, by + 46); cg.fillText('CH-1', W * 0.68, by + 46); cg.restore();
  }
  if (!dark) {
    // handling smudges and fingerprints (rougher, slightly dull)
    for (let i = 0; i < 10 + len * 4; i++) {
      const x = rnd() * W, y = rnd() * H, r = 8 + rnd() * 30, gr = rg.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,255,0,${0.04 + rnd() * 0.07})`); gr.addColorStop(1, 'rgba(0,255,0,0)'); rg.fillStyle = gr; rg.fillRect(x - r, y - r, r * 2, r * 2);
      const gc = cg.createRadialGradient(x, y, 0, x, y, r); gc.addColorStop(0, 'rgba(150,140,120,0.08)'); gc.addColorStop(1, 'rgba(150,140,120,0)'); cg.fillStyle = gc; cg.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // faint vertical grime / condensation streaks
    for (let i = 0; i < 40; i++) { const x = rnd() * W, y = rnd() * H * 0.7, l = 30 + rnd() * 160; const gr = cg.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(90,85,78,0)'); gr.addColorStop(0.5, `rgba(90,85,78,${0.05 + rnd() * 0.06})`); gr.addColorStop(1, 'rgba(90,85,78,0)'); cg.fillStyle = gr; cg.fillRect(x, y, 1 + rnd() * 3, l); }
  }
  if (heat) {   // temper colours and soot creeping up from the engine
    const hh = Math.min(H * 0.4, 1.3 * py), gr = cg.createLinearGradient(0, H, 0, H - hh);
    gr.addColorStop(0, 'rgba(40,30,26,0.85)'); gr.addColorStop(0.18, 'rgba(70,55,95,0.55)'); gr.addColorStop(0.38, 'rgba(70,95,160,0.42)'); gr.addColorStop(0.62, 'rgba(205,160,90,0.35)'); gr.addColorStop(1, 'rgba(220,190,140,0)');
    cg.fillStyle = gr; cg.fillRect(0, H - hh, W, hh);
    const rr = rg.createLinearGradient(0, H, 0, H - hh); rr.addColorStop(0, 'rgba(0,200,0,0.7)'); rr.addColorStop(1, 'rgba(0,200,0,0)'); rg.fillStyle = rr; rg.fillRect(0, H - hh, W, hh);
  }
  const out = { normal: tex(normalFrom(hc, dark ? 2.5 : 3.2), false), rough: tex(rc, false), color: tex(cc, true) };
  cache.set(key, out); return out;
}

// bell: regen cooling tubes running down the nozzle + temper gradient (throat at the top of v)
function bellMaps() {
  if (cache.has('bell')) return cache.get('bell');
  const W = 1024, H = 256, [hc, hg] = cnv(W, H), [cc, cg] = cnv(W, H), [ec, eg] = cnv(W, H);
  for (let x = 0; x < W; x += 8) { const gr = hg.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#404040'); gr.addColorStop(0.5, '#e0e0e0'); gr.addColorStop(1, '#404040'); hg.fillStyle = gr; hg.fillRect(x, 0, 8, H); }
  for (const y of [H * 0.05, H * 0.45, H * 0.97]) line(hg, 0, y, W, y, 6, '#c0c0c0', 1);   // braze bands
  const gr = cg.createLinearGradient(0, H, 0, 0);   // v=0 (bottom of canvas) is the exit
  gr.addColorStop(0, '#3a3d42'); gr.addColorStop(0.45, '#55545a'); gr.addColorStop(0.7, '#6c5a7a'); gr.addColorStop(0.85, '#9c6a40'); gr.addColorStop(1, '#c08050');
  cg.fillStyle = gr; cg.fillRect(0, 0, W, H);
  const ge = eg.createLinearGradient(0, H, 0, 0); ge.addColorStop(0, '#301000'); ge.addColorStop(0.6, '#a03a08'); ge.addColorStop(1, '#ffffff'); eg.fillStyle = ge; eg.fillRect(0, 0, W, H);
  const out = { normal: tex(normalFrom(hc, 2.2), false), color: tex(cc, true), emissive: tex(ec, true) };
  cache.set('bell', out); return out;
}

// ---------- materials ----------
// local reflection probe for every rocket material (null = scene environment)
let ENV = null; const allMats = new Set();
const track = m => { allMats.add(m); m.envMap = ENV; return m; };
export function setRocketEnv(tex) { if (tex === ENV) return; ENV = tex; for (const m of allMats) { m.envMap = tex; m.needsUpdate = true; } }
export function initMaterials() {
  if (M) return M;
  M = {
    mirror: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 1, anisotropy: 0.35 }),
    brushed: new THREE.MeshPhysicalMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.32, anisotropy: 0.7 }),
    chromeTrim: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x25282d, metalness: 0.8, roughness: 0.4 }),
    darkMatte: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.5, roughness: 0.62 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3 }),
    titanium: new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.48 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.6, roughness: 0.5 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x0d0f12, metalness: 0.3, roughness: 0.5 }),
    hose: new THREE.MeshStandardMaterial({ color: 0x8b8f96, metalness: 0.9, roughness: 0.35 }),
  };
  for (const k in M) track(M[k]);
  Object.assign(M, {
    ghost: new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.38, depthWrite: false }),
    ghostBad: new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.38, depthWrite: false }),
  });
  return M;
}
// hull material for a finish / length (cached; heat = soot and temper tint at the bottom)
export function finishMat(f, len = 2, heat = false, style) {
  const st = style || (f === 'dark' ? 'dark' : f === 'brushed' ? 'brushed' : 'mirror');
  const key = `mat:${st}:${len}:${heat ? 1 : 0}`; if (cache.has(key)) return cache.get(key);
  const t = hullMaps(st, len, heat);
  const m = st === 'dark'
    ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.color, metalness: 0.35, roughness: 1, roughnessMap: t.rough, normalMap: t.normal, normalScale: new THREE.Vector2(0.5, 0.5), clearcoat: 0.7, clearcoatRoughness: 0.12 })
    : new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.color, metalness: 1, roughness: 1, roughnessMap: t.rough, normalMap: t.normal, normalScale: new THREE.Vector2(0.85, 0.85), anisotropy: st === 'brushed' ? 0.45 : 0.2 });
  track(m); cache.set(key, m); return m;
}

// ---------- assembly helpers ----------
const _o = new THREE.Object3D();
function xf(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) { _o.position.set(...p); _o.rotation.set(...r); _o.scale.set(...s); _o.updateMatrix(); return _o.matrix.clone(); }
class Kit {
  constructor() { this.by = new Map(); }
  add(geo, mat, m4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m4) g.applyMatrix4(m4);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.by.has(mat)) this.by.set(mat, []); this.by.get(mat).push(g); geo.dispose?.(); return this;
  }
  // cylinder from a to b
  rod(a, b, r0, r1, mat, seg = 10) {
    const d = b.clone().sub(a), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1));
    return this.add(g, mat, m);
  }
  tube(points, r, mat, seg = 24) { return this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, 8, false), mat); }
  build(group, cast = true) {
    for (const [mat, list] of this.by) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = cast; m.receiveShadow = true; group.add(m); list.forEach(g => g.dispose()); }
    this.by.clear(); return group;
  }
}
function boltRing(k, r, y, n, size, mat) { const b = new THREE.CylinderGeometry(size, size, size * 0.8, 6); for (let i = 0; i < n; i++) { const a = i / n * TAU; k.add(b, mat, xf([Math.cos(a) * r, y, Math.sin(a) * r], [0, -a, Math.PI / 2])); } }

// ---------- parts ----------
function tankMesh(d, heat) {
  const g = new THREE.Group(), k = new Kit(), R = d.radius, L = d.length;
  k.add(new THREE.CylinderGeometry(R, R, L, 72, 1, true), finishMat(d.finish, L, heat), xf([0, L / 2, 0]));
  // joint flanges at both ends with bolt heads
  for (const y of [0.04, L - 0.04]) { k.add(new THREE.CylinderGeometry(R + 0.014, R + 0.014, 0.08, 72, 1, true), M.dark, xf([0, y, 0])); boltRing(k, R + 0.016, y, 36, 0.022, M.chromeTrim); }
  // cable raceway with brackets, and a pressurisation line on the opposite side
  const rw = R + 0.05; k.add(new THREE.BoxGeometry(0.15, L - 0.3, 0.07), M.titanium, xf([0, L / 2, rw]));
  for (let y = 0.35; y < L - 0.25; y += 0.55) k.add(new THREE.BoxGeometry(0.22, 0.05, 0.1), M.dark, xf([0, y, R + 0.03]));
  const a2 = Math.PI * 0.82; k.rod(V(Math.sin(a2) * (R + 0.06), 0.1, Math.cos(a2) * (R + 0.06)), V(Math.sin(a2) * (R + 0.06), L - 0.1, Math.cos(a2) * (R + 0.06)), 0.035, 0.035, M.hose, 8);
  for (let y = 0.4; y < L - 0.2; y += 0.8) k.add(new THREE.TorusGeometry(0.05, 0.012, 4, 10), M.dark, xf([Math.sin(a2) * (R + 0.06), y, Math.cos(a2) * (R + 0.06)], [Math.PI / 2, 0, 0]));
  for (const y of [0, L]) k.add(new THREE.CircleGeometry(R, 48), M.dark, xf([0, y, 0], [y ? -Math.PI / 2 : Math.PI / 2, 0, 0]));
  return k.build(g);
}
function noseMesh(d) {
  const g = new THREE.Group(), k = new Kit(), pts = [], N = 40, R = d.radius, L = d.length, blunt = d.id === 'nose_dome';
  for (let i = 0; i <= N; i++) {   // tangent ogive (blunter for the dome), small flat for the tip cap
    const t = i / N, r = blunt ? R * Math.sqrt(Math.max(0, 1 - t * t)) : R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.5))) * (1 - 0.1 * t);
    pts.push(new THREE.Vector2(Math.max(0.06, r), t * L * 0.985));
  }
  k.add(new THREE.LatheGeometry(pts, 72), finishMat(d.finish, L, false, d.finish === 'dark' ? 'dark' : 'nose'));
  k.add(new THREE.SphereGeometry(0.09, 16, 10, 0, TAU, 0, Math.PI / 2), M.dark, xf([0, L * 0.985 - 0.02, 0], [0, 0, 0], [1, 0.8, 1]));
  k.add(new THREE.CylinderGeometry(R + 0.014, R + 0.014, 0.08, 72, 1, true), M.dark, xf([0, 0.04, 0])); boltRing(k, R + 0.016, 0.04, 36, 0.022, M.chromeTrim);
  // two RCS pods with small nozzles near the base
  for (const a of [Math.PI / 2, -Math.PI / 2]) {
    const r = R * 0.97, x = Math.cos(a) * r, z = Math.sin(a) * r;
    k.add(new THREE.BoxGeometry(0.16, 0.26, 0.2), M.titanium, xf([x, 0.42, z], [0, -a, 0]));
    for (const dy of [-0.06, 0.06]) k.add(new THREE.CylinderGeometry(0.02, 0.035, 0.07, 8), M.dark, xf([x + Math.cos(a) * 0.1, 0.42 + dy, z + Math.sin(a) * 0.1], [0, -a, Math.PI / 2]));
  }
  return k.build(g);
}
function mountMesh(d) {
  const g = new THREE.Group(), k = new Kit(), R = d.radius, L = d.length;
  k.add(new THREE.CylinderGeometry(R, R * 0.95, L, 72, 1, true), M.dark, xf([0, L / 2, 0]));
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; k.add(new THREE.BoxGeometry(0.05, L * 0.86, 0.04), M.titanium, xf([Math.cos(a) * (R - 0.0), L / 2, Math.sin(a) * (R - 0.0)], [0, -a, 0])); }   // stiffener ribs
  boltRing(k, R + 0.01, L - 0.1, 32, 0.03, M.chromeTrim); boltRing(k, R * 0.95 + 0.01, 0.08, 32, 0.026, M.chromeTrim);
  for (const a of [0.4, 2.0, 3.6, 5.2]) k.add(new THREE.BoxGeometry(0.24, 0.12, 0.04), M.darkMatte, xf([Math.cos(a) * (R + 0.01), L * 0.55, Math.sin(a) * (R + 0.01)], [0, -a + Math.PI / 2, 0]));   // vents
  k.add(new THREE.CylinderGeometry(R * 0.94, R * 0.94, 0.05, 48), M.darkMatte, xf([0, 0.025, 0]));   // heat shield
  k.add(new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.06, 32), M.titanium, xf([0, 0.0, 0]));        // thrust plate
  k.add(new THREE.CircleGeometry(R, 48), M.dark, xf([0, L, 0], [-Math.PI / 2, 0, 0]));
  return k.build(g);
}

// Engine-centre offsets for a cluster (tri, 8-around-1, or inner+outer rings). Units in metres.
export function clusterOffsets(n, bellR, gap = 0.05) {
  const out = [], pitch = 2 * bellR + gap;
  const ring = (count, r, a0 = 0) => { for (let i = 0; i < count; i++) { const a = a0 + i / count * TAU; out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); } };
  if (n === 3) ring(3, pitch / Math.sqrt(3), Math.PI / 6);
  else if (n === 9) { out.push({ x: 0, z: 0 }); ring(8, pitch / (2 * Math.sin(Math.PI / 8))); }
  else { out.push({ x: 0, z: 0 }); ring(6, pitch); const o = n - 7; ring(o, pitch / (2 * Math.sin(Math.PI / o)), Math.PI / o); }
  return out;
}
function clusterMesh(d) {
  initMaterials();
  const n = d.engines, L = d.length, bellR = d.bellRadius, gap = d.bellGap ?? 0.05, offs = clusterOffsets(n, bellR, gap);
  const plateR = Math.max(d.radius, Math.max(...offs.map(o => Math.hypot(o.x, o.z))) + bellR + 0.08);
  const g = new THREE.Group(), k = new Kit(), segs = n > 12 ? 20 : 24;
  const plateH = 0.12, bellL = (L - plateH) * 0.7, ch = L - plateH - bellL, top = L, throat = bellR * 0.3;
  // heat-shield plate, rim, underside soot ring, mount flange
  k.add(new THREE.CylinderGeometry(plateR, plateR, plateH, 48), M.darkMatte, xf([0, top - plateH / 2, 0]));
  k.add(new THREE.CylinderGeometry(plateR + 0.02, plateR, 0.04, 48), M.titanium, xf([0, top - plateH - 0.01, 0]));
  k.add(new THREE.CylinderGeometry(plateR * 0.55, plateR * 0.98, 0.035, 40), M.pad, xf([0, top - plateH - 0.03, 0]));
  k.add(new THREE.CylinderGeometry(plateR * 0.42, plateR * 0.42, 0.07, 24), M.titanium, xf([0, top + 0.02, 0]));
  boltRing(k, plateR - 0.06, top - 0.02, n > 9 ? 24 : 18, 0.022, M.chromeTrim);
  boltRing(k, plateR * 0.42, top + 0.05, 12, 0.02, M.chromeTrim);
  // per-engine: collar through the plate, chamber, injector, small turbopump in the 30° gap, feed lines
  for (const o of offs) {
    k.add(new THREE.CylinderGeometry(bellR + 0.04, bellR + 0.055, 0.07, 16), M.titanium, xf([o.x, top - plateH - 0.02, o.z]));
    k.add(new THREE.CylinderGeometry(throat * 1.7, throat * 1.05, ch * 0.5, 16), M.copper, xf([o.x, bellL + ch * 0.25, o.z]));
    k.add(new THREE.SphereGeometry(throat * 1.7, 14, 8, 0, TAU, 0, Math.PI / 2), M.titanium, xf([o.x, bellL + ch * 0.5, o.z], [0, 0, 0], [1, 0.55, 1]));
    k.add(new THREE.CylinderGeometry(throat * 0.9, throat * 1.1, ch * 0.3, 12), M.dark, xf([o.x, top - plateH - ch * 0.12, o.z]));
    k.add(new THREE.TorusGeometry(bellR * 0.72, 0.022, 5, 20), M.copper, xf([o.x, bellL * 0.42, o.z], [Math.PI / 2, 0, 0]));
    k.add(new THREE.TorusGeometry(bellR, 0.02, 5, 24), M.titanium, xf([o.x, 0.01, o.z], [Math.PI / 2, 0, 0]));
    const a0 = Math.atan2(o.z, o.x), a = a0 + Math.PI / 6, pr = bellR * 0.55;
    const px = o.x + Math.cos(a) * pr, pz = o.z + Math.sin(a) * pr, py = bellL + ch * 0.38;
    k.add(new THREE.CylinderGeometry(bellR * 0.13, bellR * 0.13, bellR * 0.38, 12), M.dark, xf([px, py, pz]));
    k.add(new THREE.TorusGeometry(bellR * 0.14, bellR * 0.045, 6, 12), M.titanium, xf([px, py + bellR * 0.1, pz], [Math.PI / 2, 0, 0]));
    k.tube([V(px, py + bellR * 0.18, pz), V(px * 0.4 + o.x * 0.6, top - plateH * 0.4, pz * 0.4 + o.z * 0.6), V(o.x, top - 0.02, o.z)], bellR * 0.045, M.hose, 8);
    k.tube([V(px, py, pz), V(o.x + Math.cos(a0 || a) * throat * 1.6, bellL + ch * 0.28, o.z + Math.sin(a0 || a) * throat * 1.6)], bellR * 0.035, M.hose, 6);
  }
  // ring manifold under the plate plus two cluster-level gimbal actuators
  const manR = n === 3 ? plateR * 0.48 : (n === 9 ? plateR * 0.62 : plateR * 0.55);
  k.add(new THREE.TorusGeometry(manR, 0.035, 6, 32), M.hose, xf([0, top - plateH - 0.08, 0], [Math.PI / 2, 0, 0]));
  for (const a of [Math.PI * 0.75, Math.PI * 1.25]) {
    const p0 = V(Math.cos(a) * plateR * 0.7, top, Math.sin(a) * plateR * 0.7), p1 = V(Math.cos(a) * plateR * 0.38, top - plateH - 0.16, Math.sin(a) * plateR * 0.38), mid = p0.clone().lerp(p1, 0.55);
    k.rod(p0, mid, 0.05, 0.05, M.dark, 8); k.rod(mid, p1, 0.025, 0.025, M.chromeTrim, 8);
  }
  k.build(g);
  // bells share one regen-tube material so a single emissiveIntensity lights every nozzle
  const prof = []; for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push(new THREE.Vector2(throat + (bellR - throat) * (1 - Math.pow(1 - t, 2.2)) * 0.15 + (bellR - throat) * Math.pow(t, 0.62) * 0.85, (1 - t) * bellL)); }
  const bm = bellMaps();
  const nozMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: bm.color, normalMap: bm.normal, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.85, roughness: 0.42, side: THREE.DoubleSide, emissive: 0xff6a2a, emissiveMap: bm.emissive, emissiveIntensity: 0 });
  nozMat.userData.own = true; track(nozMat);
  const unit = new THREE.LatheGeometry(prof.reverse(), segs), bells = [];
  const ik = new Kit(), innerMat = new THREE.MeshBasicMaterial({ color: 0x000000 }); innerMat.userData.own = true;
  for (const o of offs) {
    bells.push(unit.clone().applyMatrix4(xf([o.x, 0, o.z])));
    ik.add(new THREE.CircleGeometry(throat * 1.1, 16), innerMat, xf([o.x, bellL - 0.02, o.z], [Math.PI / 2, 0, 0]));
  }
  unit.dispose();
  const bell = new THREE.Mesh(mergeGeometries(bells, false), nozMat); bell.castShadow = true; bell.receiveShadow = true; g.add(bell); bells.forEach(b => b.dispose());
  ik.build(g, false);
  g.userData.nozMat = nozMat; g.userData.innerMat = innerMat;
  g.userData.nozzles = offs.map(o => ({ x: o.x, y: 0, z: o.z, radius: bellR }));
  return g;
}
export function engineMesh(d) {
  if ((d.engines || 1) > 1) return clusterMesh(d);
  const g = new THREE.Group(), k = new Kit(), L = d.length, R = d.radius, throat = R * 0.3, bellL = L * 0.7, top = L;
  // bell: parabolic contour from throat to exit, regen tubes + temper gradient
  const prof = []; for (let i = 0; i <= 32; i++) { const t = i / 32; prof.push(new THREE.Vector2(throat + (R - throat) * (1 - Math.pow(1 - t, 2.2)) * 0.15 + (R - throat) * Math.pow(t, 0.62) * 0.85, (1 - t) * bellL)); }
  const bm = bellMaps();
  const nozMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: bm.color, normalMap: bm.normal, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.85, roughness: 0.42, side: THREE.DoubleSide, emissive: 0xff6a2a, emissiveMap: bm.emissive, emissiveIntensity: 0 });
  nozMat.userData.own = true; track(nozMat);
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof.reverse(), 64), nozMat); bell.castShadow = true; bell.receiveShadow = true; g.add(bell);
  k.add(new THREE.TorusGeometry(R, 0.03, 6, 64), M.titanium, xf([0, 0.01, 0], [Math.PI / 2, 0, 0]));     // exit stiffener
  k.add(new THREE.TorusGeometry(R * 0.72, 0.035, 6, 48), M.copper, xf([0, bellL * 0.42, 0], [Math.PI / 2, 0, 0])); // coolant manifold
  // chamber, injector dome, gimbal block and thrust frame
  const ch = L - bellL;
  k.add(new THREE.CylinderGeometry(throat * 1.7, throat * 1.05, ch * 0.5, 32), M.copper, xf([0, bellL + ch * 0.25, 0]));
  k.add(new THREE.SphereGeometry(throat * 1.7, 24, 10, 0, TAU, 0, Math.PI / 2), M.titanium, xf([0, bellL + ch * 0.5, 0], [0, 0, 0], [1, 0.55, 1]));
  k.add(new THREE.CylinderGeometry(throat * 0.9, throat * 1.1, ch * 0.35, 16), M.dark, xf([0, top - ch * 0.17, 0]));
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; k.rod(V(Math.cos(a) * throat * 1.6, bellL + ch * 0.5, Math.sin(a) * throat * 1.6), V(Math.cos(a) * throat * 0.7, top, Math.sin(a) * throat * 0.7), 0.025, 0.025, M.titanium, 6); }
  // turbopump: housing + volute + turbine exhaust running down the bell
  const px = R * 0.62, py = bellL + ch * 0.35;
  k.add(new THREE.CylinderGeometry(R * 0.17, R * 0.17, R * 0.5, 20), M.dark, xf([px, py, 0], [0, 0, 0]));
  k.add(new THREE.TorusGeometry(R * 0.18, R * 0.06, 8, 20), M.titanium, xf([px, py + R * 0.12, 0], [Math.PI / 2, 0, 0]));
  k.add(new THREE.CylinderGeometry(R * 0.12, R * 0.12, R * 0.14, 16), M.copper, xf([px, py - R * 0.3, 0]));
  k.tube([V(px, py - R * 0.35, 0), V(px * 1.12, bellL * 0.6, 0), V(R * 0.98, bellL * 0.12, 0), V(R * 1.02, -0.02, 0)], R * 0.06, M.dark, 20);
  // propellant feed lines from the mount to pump and chamber
  k.tube([V(px - R * 0.1, top, R * 0.25), V(px, top - ch * 0.2, R * 0.2), V(px, py + R * 0.25, 0)], R * 0.07, M.hose);
  k.tube([V(-px * 0.6, top, -R * 0.3), V(-px * 0.7, py, -R * 0.2), V(-throat * 1.5, bellL + ch * 0.32, 0)], R * 0.065, M.hose);
  k.tube([V(px, py, 0), V(throat * 2.1, bellL + ch * 0.2, R * 0.1), V(throat * 1.4, bellL + ch * 0.12, 0)], R * 0.05, M.hose);
  // gimbal actuators: cylinder + chrome rod, mount to chamber collar
  for (const a of [Math.PI * 0.75, Math.PI * 1.25]) {
    const p0 = V(Math.cos(a) * R * 0.75, top, Math.sin(a) * R * 0.75), p1 = V(Math.cos(a) * throat * 1.7, bellL + ch * 0.2, Math.sin(a) * throat * 1.7), m = p0.clone().lerp(p1, 0.55);
    k.rod(p0, m, R * 0.07, R * 0.07, M.dark, 10); k.rod(m, p1, R * 0.035, R * 0.035, M.chromeTrim, 8);
  }
  k.build(g);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0x000000 }); innerMat.userData.own = true;
  const inner = new THREE.Mesh(new THREE.CircleGeometry(throat * 1.1, 24), innerMat); inner.rotation.x = Math.PI / 2; inner.position.y = bellL - 0.02; g.add(inner);
  g.userData.nozMat = nozMat; g.userData.innerMat = innerMat;
  g.userData.nozzles = [{ x: 0, y: 0, z: 0, radius: R }];
  return g;
}
function finGeo(d) {
  const s = new THREE.Shape(), sweep = (d.root - d.tip) * 0.35 + 0.2;
  s.moveTo(0, 0); s.lineTo(0, d.root); s.lineTo(d.span, d.root - sweep); s.lineTo(d.span, d.root - sweep - d.tip); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3 });
  geo.translate(0, 0, -0.025);
  // UVs in metres so the hull maps read at the right scale
  const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 5.6, p.getY(i) / 2);
  return geo;
}
// free a rocket's GPU memory (shared materials are kept)
export function disposeTree(o) {
  o.traverse(c => {
    if (c.geometry && !c.geometry.userData.keep) c.geometry.dispose();
    if (c.material && c.material.userData.own) { c.material.dispose(); allMats.delete(c.material); }
  });
}
export function finPair(pairIndex, radius = 0.9) {
  const d = PARTS.fins, g = new THREE.Group(), k = new Kit(), fg = finGeo(d), mat = finishMat('brushed', 2, false, 'brushed');
  for (const s of [0, 1]) {
    const a = (pairIndex ? Math.PI / 2 : 0) + s * Math.PI + Math.PI / 4, c = Math.cos(a), sn = Math.sin(a);
    k.add(fg, mat, xf([c * (radius - 0.02), -0.35, sn * (radius - 0.02)], [0, -a, 0]));
    k.add(new THREE.BoxGeometry(0.14, d.root * 0.92, 0.16), M.dark, xf([c * (radius + 0.03), -0.35 + d.root * 0.47, sn * (radius + 0.03)], [0, -a, 0]));   // root fairing
    for (let y = 0.05; y < d.root - 0.1; y += 0.22) k.add(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), M.chromeTrim, xf([c * (radius + 0.03), -0.35 + y + 0.1, sn * (radius + 0.03)], [0, -a, Math.PI / 2]));
  }
  fg.dispose();
  return k.build(g);
}
export function legSet(dropTo, radius = 0.9) {
  // dropTo = distance from the attach point down to the feet. A-frame: hinge, damper strut with chrome piston, two braces, foot pad.
  // Each leg is its own group pivoting at its hinge so it can fold up flat against the body in flight (setLegFold).
  const d = PARTS.legs, g = new THREE.Group(), legs = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a), at = (r, y) => V(c * r, y, s * r);
    const hinge = at(radius + 0.12, 0.95), foot = at(d.footRadius, -dropTo + 0.16), knee = hinge.clone().lerp(foot, 0.58);
    const k = new Kit(), kb = new Kit();
    kb.add(new THREE.BoxGeometry(0.34, 0.38, 0.24), M.titanium, xf([c * (radius + 0.06), 0.98, s * (radius + 0.06)], [0, -a, 0]));
    k.rod(hinge, knee, 0.1, 0.085, M.dark, 12); k.rod(knee.clone().lerp(hinge, 0.06), foot, 0.055, 0.055, M.chromeTrim, 10);
    k.add(new THREE.SphereGeometry(0.11, 12, 8), M.titanium, xf([hinge.x, hinge.y, hinge.z]));
    const side = V(-s, 0, c), br = new Kit();
    for (const sg of [-1, 1]) { const b0 = at(radius + 0.03, -0.05).add(side.clone().multiplyScalar(sg * 0.42)); br.rod(b0, knee, 0.04, 0.04, M.dark, 8); kb.add(new THREE.BoxGeometry(0.14, 0.16, 0.1), M.titanium, xf([b0.x, b0.y, b0.z], [0, -a, 0])); }
    k.add(new THREE.SphereGeometry(0.085, 12, 8), M.titanium, xf([foot.x, foot.y, foot.z]));
    k.add(new THREE.CylinderGeometry(0.26, 0.34, 0.09, 20), M.dark, xf([foot.x, -dropTo + 0.045, foot.z]));
    k.add(new THREE.CylinderGeometry(0.2, 0.26, 0.06, 20), M.titanium, xf([foot.x, -dropTo + 0.12, foot.z]));
    kb.build(g);   // hinge brackets + brace sockets stay on the body
    const leg = new THREE.Group(); leg.position.copy(hinge); g.add(leg);
    const inner = new THREE.Group(); inner.position.copy(hinge).negate(); leg.add(inner); k.build(inner);
    const braces = new THREE.Group(); inner.add(braces); br.build(braces);
    // folded: strut points up along the body, tucked against the skin
    const dir = foot.clone().sub(hinge).normalize(), up = V(-c * 0.06, 1, -s * 0.06).normalize();
    legs.push({ leg, braces, q: new THREE.Quaternion().setFromUnitVectors(dir, up) });
  }
  g.userData.legParts = legs;
  return g;
}
const _qI = new THREE.Quaternion();
// t = 0 deployed (landing), 1 folded flat against the body (ascent)
export function setLegFold(root, t) {
  root.traverse(o => { const L = o.userData.legParts; if (!L) return; for (const l of L) { l.leg.quaternion.slerpQuaternions(_qI, l.q, t); l.braces.visible = t < 0.35; } });
}
// stowed grid fins near the top of the stack (only on rockets that land)
function gridFins(y, radius = 0.9) {
  const g = new THREE.Group(), k = new Kit(), W = 0.9, H = 0.75, t = 0.035, depth = 0.12;
  const panel = []; const add = (geo, m) => panel.push([geo, m]);
  for (const [w, h, x, yy] of [[W, t * 2, 0, H / 2], [W, t * 2, 0, -H / 2], [t * 2, H, W / 2, 0], [t * 2, H, -W / 2, 0]]) add(new THREE.BoxGeometry(w, h, depth), xf([x, yy, 0]));
  for (let c = -W - H; c < W + H; c += 0.14) for (const sg of [1, -1]) {   // diagonal lattice clipped to the frame
    const p = []; const lo = -W / 2, hi = W / 2, blo = -H / 2, bhi = H / 2;
    for (const x of [lo, hi]) { const yy = sg * x + c; if (yy >= blo && yy <= bhi) p.push([x, yy]); }
    for (const yy of [blo, bhi]) { const x = (yy - c) * sg; if (x > lo && x < hi) p.push([x, yy]); }
    if (p.length < 2) continue; const [a, b] = p, L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
    add(new THREE.BoxGeometry(L, 0.012, depth * 0.9), xf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0], [0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])]));
  }
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, m = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * (radius + 0.17), y, Math.sin(a) * (radius + 0.17)));
    for (const [geo, pm] of panel) k.add(geo, M.titanium, m.clone().multiply(pm));
    k.add(new THREE.BoxGeometry(0.3, 0.22, 0.2), M.dark, xf([Math.cos(a) * (radius + 0.08), y + H / 2 + 0.05, Math.sin(a) * (radius + 0.08)], [0, -a, 0]));
  }
  return k.build(g);
}

export function partMesh(id, heat = false) {
  initMaterials();
  const d = PARTS[id];
  if (d.kind === 'tank') return tankMesh(d, heat);
  if (d.kind === 'nose') return noseMesh(d);
  if (d.kind === 'mount') return mountMesh(d);
  if (d.kind === 'engine') return engineMesh(d);
  if (d.kind === 'fins') { const g = new THREE.Group(); const p = finPair(0); p.position.y = 0.35; g.add(p); return g; }
  if (d.kind === 'legs') return legSet(1.6);
}

// Whole rocket, local origin at the nozzle exit. Each pickable piece is tagged with its target.
export function rocketMesh(r) {
  initMaterials();
  const L = layout(r), g = new THREE.Group(), picks = [];
  const tag = (o, t) => { o.traverse(c => { if (c.isMesh) c.userData.target = t; }); picks.push({ obj: o, t }); };
  if (r.engine && L.engLen) {
    // engine hangs from a gimbal pivot at its top so the bell visibly swivels
    const pivot = new THREE.Group(); pivot.position.y = L.engLen; g.add(pivot);
    const e = engineMesh(PARTS[r.engine]); e.position.y = -L.engLen; pivot.add(e);
    tag(e, { type: 'engine', index: 0 }); g.userData.engine = e; g.userData.gimbal = pivot;
  }
  const firstTank = L.items.findIndex(it => it.d.kind === 'tank'), lastTank = L.items.map(it => it.d.kind).lastIndexOf('tank'), legs = L.items.some(it => it.s.legs);
  for (const it of L.items) {
    const m = partMesh(it.s.p, it.i === firstTank && !!r.engine); m.position.y = it.y0; g.add(m);
    if (legs && it.i === lastTank && it.d.length >= 1.5) { const gf = gridFins(it.y1 - 0.6); m.add(gf); gf.position.y = -it.y0; }
    tag(m, { type: 'stack', index: it.i });
    for (let k = 0; k < (it.s.fins || 0); k++) { const f = finPair(k); f.position.y = it.y0 + 0.35; g.add(f); tag(f, { type: 'fins', index: it.i }); }
    if (it.s.legs) { const l = legSet(it.y0 + PARTS.legs.drop); l.position.y = it.y0; g.add(l); tag(l, { type: 'legs', index: it.i }); }
  }
  g.userData.picks = picks; g.userData.layout = L;
  return g;
}

export function ghostify(obj, bad) {
  initMaterials();
  obj.traverse(c => { if (c.isMesh) { c.material = bad ? M.ghostBad : M.ghost; c.castShadow = false; c.raycast = () => {}; } });
  return obj;
}
