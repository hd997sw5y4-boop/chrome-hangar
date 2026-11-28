// Cockpit view: an original crew-capsule interior that rides at the top of the stack, with live glass displays,
// annunciators, stage lights, panel / dome lighting and clamped head-look. All geometry is built in code
// (no external models); the capsule frame is: eye at the origin, looking down -Z along the rocket's nose, +Y = top of the window.
// Input-agnostic: input() maps C to the cockpit camera slot, plus recenter() and look(dx, dy); a phone layout can call those directly.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { layout } from './rocket.js';
import { Instruments, CAUTIONS } from './cockpit-instruments.js';
import { engineGauges } from './cockpit-engine.js';
import { orbitLookAfterHead } from './cockpit-touch.js';
import { installCockpitPhone, noteCockpitTap, shouldBuildPhoneCockpit, buildPhoneCockpit, syncCockpitHint } from './cockpit-phone.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE_DROP = 1.55;          // eye sits this far below the top of the stack
const YAW_MAX = 1.75, PITCH_MIN = -1.05, PITCH_MAX = 1.2;
const G0 = 9.80665;
const REST_PITCH = -0.14;      // resting head angle: a little down toward the displays

// ---------- procedural textures ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function noise(x, w, h, a, seed = 1) { let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); for (let i = 0; i < w * h / 18; i++) { x.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${a * r()})`; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } }
function tex(c, rep = [1, 1], srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// quilted thermal blanket lining with seams and stitching (colour + bump)
function quiltTextures() {
  const W = 1024, H = 512, [c, x] = canvas(W, H), [b, y] = canvas(W, H);
  x.fillStyle = '#8d8a82'; x.fillRect(0, 0, W, H); y.fillStyle = '#808080'; y.fillRect(0, 0, W, H);
  const cw = 128, ch = 128;
  for (let i = 0; i < W / cw; i++) for (let j = 0; j < H / ch; j++) {
    const px = i * cw, py = j * ch, g = y.createRadialGradient(px + cw / 2, py + ch / 2, 4, px + cw / 2, py + ch / 2, cw * 0.62);
    g.addColorStop(0, '#d0d0d0'); g.addColorStop(1, '#505050'); y.fillStyle = g; y.fillRect(px, py, cw, ch);
    const t = (i * 7 + j * 3) % 5; x.fillStyle = `rgba(${t * 3},${t * 3},${t * 2},0.06)`; x.fillRect(px, py, cw, ch);
  }
  for (const ctx of [x, y]) { ctx.strokeStyle = ctx === x ? 'rgba(60,58,52,0.55)' : '#202020'; ctx.lineWidth = 3; for (let i = 0; i <= W; i += cw) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke(); } for (let j = 0; j <= H; j += ch) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(W, j); ctx.stroke(); } }
  x.strokeStyle = 'rgba(40,40,36,0.5)'; x.setLineDash([5, 5]); x.lineWidth = 1.5;
  for (let i = 0; i <= W; i += cw) { x.beginPath(); x.moveTo(i + 9, 0); x.lineTo(i + 9, H); x.stroke(); }
  x.setLineDash([]); noise(x, W, H, 0.08, 7);
  // velcro patches and panel seams
  x.fillStyle = 'rgba(70,70,66,0.55)'; for (let i = 0; i < 6; i++) x.fillRect(60 + i * 160, 40 + (i % 3) * 150, 46, 26);
  return { map: tex(c, [4, 1]), bump: tex(b, [4, 1], false) };
}

// painted metal panel with engraved border, screws and legends
function panelTexture(w, h, labels = [], col = '#2b2f34') {
  const S = 1024, W = Math.round(S * Math.min(1, w / h)), H = Math.round(S * Math.min(1, h / w)), [c, x] = canvas(W, H);
  x.fillStyle = col; x.fillRect(0, 0, W, H); noise(x, W, H, 0.05, W + H);
  x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 3; x.strokeRect(W * 0.03, H * 0.03, W * 0.94, H * 0.94);
  x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1; x.strokeRect(W * 0.03 + 2, H * 0.03 + 2, W * 0.94, H * 0.94);
  for (const [sx, sy] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94]]) {
    const g = x.createRadialGradient(sx * W - 3, sy * H - 3, 1, sx * W, sy * H, 12); g.addColorStop(0, '#9aa0a6'); g.addColorStop(1, '#2a2d30');
    x.fillStyle = g; x.beginPath(); x.arc(sx * W, sy * H, 11, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#1a1c1e'; x.lineWidth = 3; x.beginPath(); x.moveTo(sx * W - 7, sy * H); x.lineTo(sx * W + 7, sy * H); x.stroke();
  }
  x.font = `700 ${Math.round(W * 0.034)}px "DejaVu Sans", Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [s, u, v, size] of labels) { x.font = `700 ${Math.round(W * (size || 0.034))}px "DejaVu Sans", Arial, sans-serif`; x.fillStyle = '#e6e6e0'; x.fillText(s, u * W, (1 - v) * H); }
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function roughTex() { const [c, x] = canvas(256, 256); x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 256, 256); noise(x, 256, 256, 0.35, 3); return tex(c, [3, 3], false); }

// ---------- geometry helpers ----------
function rrect(w, h, r) { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
function plate(w, h, depth, r = 0.012, bevel = 0.005) {
  const g = new THREE.ExtrudeGeometry(rrect(w, h, r), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  // front-face UVs: shape coords are metres; remap to 0..1 over the plate
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / w + 0.5, uv.getY(i) / h + 0.5);
  return g;
}
function ring(w, h, iw, ih, depth, r = 0.014) {
  const s = rrect(w, h, r); s.holes.push(rrect(iw, ih, r * 0.6));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 3, curveSegments: 6 });
}
function rod(a, b, r, mat, seg = 10) {
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); return m;
}
function toggleGeom() {
  const base = new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 6).rotateX(Math.PI / 2).translate(0, 0, 0.002);
  const collar = new THREE.CylinderGeometry(0.005, 0.0055, 0.008, 12).rotateX(Math.PI / 2).translate(0, 0, 0.007);
  const lever = new THREE.CylinderGeometry(0.0022, 0.0032, 0.024, 8).translate(0, 0.012, 0).rotateX(Math.PI / 2 - 0.42).translate(0, 0, 0.01);
  const tip = new THREE.SphereGeometry(0.0042, 10, 8).translate(0, 0.0235, 0).rotateX(Math.PI / 2 - 0.42).translate(0, 0, 0.01);
  return mergeGeometries([base, collar, lever, tip]);
}
function guardGeom() {
  const rail = x => new THREE.BoxGeometry(0.003, 0.03, 0.016).translate(x, 0.004, 0.008);
  const bridge = new THREE.BoxGeometry(0.026, 0.003, 0.016).translate(0, 0.019, 0.008);
  return mergeGeometries([rail(-0.0125), rail(0.0125), bridge]);
}
function knobGeom() {
  const pts = [V(0, 0), V(0.016, 0), V(0.016, 0.004), V(0.013, 0.006), V(0.012, 0.016), V(0.009, 0.019), V(0, 0.019)].map(p => new THREE.Vector2(p.x, p.y));
  return new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2);
}
function grid(parent, geo, mat, cols, rows, x0, y0, dx, dy, z = 0, jitter = 0) {
  const m = new THREE.InstancedMesh(geo, mat, cols * rows), o = new THREE.Object3D(); let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { o.position.set(x0 + c * dx, y0 - r * dy, z); o.rotation.set(0, 0, jitter && (c + r * 2) % 3 === 0 ? Math.PI : 0); o.updateMatrix(); m.setMatrixAt(i++, o.matrix); }
  parent.add(m); return m;
}

// ---------- the cockpit ----------
export class Cockpit {
  constructor(game, flight) {
    this.g = game; this.fm = flight; this.w = game.world;
    this.on = false; this.built = false; this.yaw = 0; this.pitch = 0; this.yawT = 0; this.pitchT = 0;
    this.prevVel = new THREE.Vector3(); this.gs = 1; this.moonObj = null; this.moonScan = 0; this.prevMoon = null; this.flashT = 0;
    this.tmp = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), a: V(0, 0, 0), b: V(0, 0, 0), c: V(0, 0, 0), u: V(0, 1, 0), h: V(0, 0, 1) };
    this.qX = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2);   // capsule -Z -> rocket +Y, capsule +Y -> rocket +Z
    installCockpitPhone(this);   // touch: keep head-look off the throttle / stick, double-tap recenters
    const st = document.createElement('style');
    st.textContent = 'body.ckpt #fStats,body.ckpt #fMeters{display:none}';
    document.head.appendChild(st);
  }

  // ---- input (keyboard / DualSense); look() and recenter() are the device-free entry points ----
  input(inp) {
    if (inp.hit('KeyC')) this.fm.setCam(4);   // C jumps to the cockpit camera slot (L3 is engine cut)
    if (!this.on) return;
    if (inp.hit('KeyQ') || inp.hit('Pad11')) this.recenter(); // Q / R3
    this.look(inp.look.x, inp.look.y);
    // Touch drag looks the head. Leave mouse / right-stick on inp.look so the outside orbit camera is unchanged.
    if (inp.lookTouch) { const rest = orbitLookAfterHead(inp.look, inp.lookTouch); inp.look.x = rest.x; inp.look.y = rest.y; }
    if (inp.lastDevice === 'touch') noteCockpitTap(this, inp);
  }
  look(dx, dy) { this.yawT = THREE.MathUtils.clamp(this.yawT - dx, -YAW_MAX, YAW_MAX); this.pitchT = THREE.MathUtils.clamp(this.pitchT - dy, PITCH_MIN, PITCH_MAX); }
  recenter() { this.yawT = 0; this.pitchT = REST_PITCH; }
  // enter() is called from FlightMode.setCam when the cockpit slot is selected
  enter() { this.setOn(true); }
  setOn(want) {
    const f = this.fm.f;
    if (want && (!f || f.phase === 'crashed' || !this.fm.group)) return;
    if (want === this.on) return;
    this.on = want;
    if (want) { this.build(); this.recenter(); this.yaw = 0; this.pitch = REST_PITCH; this.prevVel.set(f.vel.x, f.vel.y, f.vel.z); this.inst.update(0, this.data(1 / 60), true); }
    else this.hide();
    document.body.classList.toggle('ckpt', this.on);
    if (this.g.input?.isTouch) syncCockpitHint(this.on);
  }
  off() { this.setOn(false); }
  hide() { if (!this.built) return; this.root.visible = false; for (const l of this.lights) l.intensity = 0; this.fm.camInit = false; }

  // steering reference for flight.shapeSteer: stick up = nose toward the top of the window, right = right.
  steerAxes(fw, rt) {
    if (!this.on || !this.built) return false;
    const T = this.tmp; fw.copy(T.h); fw.y = 0; rt.crossVectors(T.u, T.h); rt.y = 0;
    if (fw.lengthSq() < 1e-4 || rt.lengthSq() < 1e-4) return false;
    fw.normalize(); rt.normalize(); return true;
  }

  // ---- geometry: built once, on first use ----
  build() {
    if (this.built) { this.root.visible = true; return; }
    // Phone / coarse-short viewports get a light interior. The desktop mesh below is not used on that path.
    if (shouldBuildPhoneCockpit(this.g)) { buildPhoneCockpit(this); return; }
    this.built = true;
    const root = this.root = new THREE.Group(); root.name = 'cockpit';
    const q = quiltTextures(), rough = roughTex();
    const M = {
      lining: new THREE.MeshStandardMaterial({ map: q.map, bumpMap: q.bump, bumpScale: 3, roughness: 0.95, metalness: 0, side: THREE.BackSide }),
      paint: new THREE.MeshStandardMaterial({ color: 0x2e3237, roughness: 0.62, metalness: 0.35, roughnessMap: rough }),
      frame: new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.55, metalness: 0.7, roughnessMap: rough }),
      dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.4 }),
      bezel: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.35, metalness: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.18, metalness: 1 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.85, metalness: 0 }),
      key: new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.55, metalness: 0.2, emissive: 0x88b8ff, emissiveIntensity: 0.05 }),
      strap: new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
      seat: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.8, metalness: 0.1 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.1, depthWrite: false }),
    };
    this.M = M;

    // pressure vessel: cylinder section behind, nose cone ahead (lathe around the capsule Z axis), window holes cut by alpha
    const R0 = 1.05, Rtip = 0.43, Z0 = 0.45, Z1 = 1.35, rAt = y => R0 + (Rtip - R0) * Math.pow((y - Z0) / (Z1 - Z0), 0.85);
    const toCap = g => g.rotateX(-Math.PI / 2);          // lathe +Y -> capsule -Z, lathe +Z -> capsule +Y (phi 0 = top)
    root.add(new THREE.Mesh(toCap(new THREE.LatheGeometry([new THREE.Vector2(R0, -1.0), new THREE.Vector2(R0, Z0)], 64)), M.lining));
    const coneN = 12, conePts = []; for (let i = 0; i <= coneN; i++) { const y = Z0 + (Z1 - Z0) * i / coneN; conePts.push(new THREE.Vector2(rAt(y), y)); }
    const WINS = [[0.72, 0.62, 1.12, 0.2], [-0.72, 0.62, 1.12, 0.2], [1.62, 0.55, 1.0, 0.24], [-1.62, 0.55, 1.0, 0.24]];   // [phi, y0, y1, half-width rad]
    const [ac, ax] = canvas(2048, 512); ax.fillStyle = '#fff'; ax.fillRect(0, 0, 2048, 512); ax.fillStyle = '#000';
    for (const [p, y0, y1, hw] of WINS) {
      const u = ((p / (Math.PI * 2)) % 1 + 1) % 1, v0 = (y0 - Z0) / (Z1 - Z0), v1 = (y1 - Z0) / (Z1 - Z0);
      const px = u * 2048, w = hw / (Math.PI * 2) * 2048, top = (1 - v1) * 512, bot = (1 - v0) * 512;
      ax.beginPath(); ax.roundRect(px - w, top, w * 2, bot - top, 26); ax.fill();
      if (px - w < 0) { ax.beginPath(); ax.roundRect(px - w + 2048, top, w * 2, bot - top, 26); ax.fill(); }
      if (px + w > 2048) { ax.beginPath(); ax.roundRect(px - w - 2048, top, w * 2, bot - top, 26); ax.fill(); }
    }
    const coneMat = M.lining.clone(); coneMat.alphaMap = new THREE.CanvasTexture(ac); coneMat.alphaTest = 0.5; coneMat.map = q.map.clone(); coneMat.map.repeat.set(4, 0.6); coneMat.map.needsUpdate = true;
    root.add(new THREE.Mesh(toCap(new THREE.LatheGeometry(conePts, 96)), coneMat));
    // back bulkhead
    const back = new THREE.Mesh(new THREE.CircleGeometry(R0, 48), M.lining); back.position.z = 1.0; back.rotation.y = Math.PI; back.material = M.lining.clone(); back.material.side = THREE.FrontSide; root.add(back);
    // window frames, gaskets and glass on the cone
    const cap = (phi, y, inset) => { const r = rAt(y) - inset; return V(r * Math.sin(phi), r * Math.cos(phi), -y); };
    for (const [p, y0, y1, hw] of WINS) {
      const pts = [], N = 64, cr = 0.32;
      for (let i = 0; i < N; i++) {   // superellipse outline in (phi, y): rounded rectangle
        const t = i / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), e = 0.35;
        const ux = Math.sign(c) * Math.pow(Math.abs(c), e), uy = Math.sign(s) * Math.pow(Math.abs(s), e);
        pts.push(cap(p + ux * hw * (1 - cr * 0.02), (y0 + y1) / 2 + uy * (y1 - y0) / 2, 0.012));
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.019, 10, true), M.frame));
      root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.009, 6, true), M.rubber));
      const gg = new THREE.PlaneGeometry(1, 1, 12, 12), pa = gg.attributes.position;
      for (let i = 0; i < pa.count; i++) { const a = pa.getX(i) + 0.5, b = pa.getY(i) + 0.5, v = cap(p + (a - 0.5) * 2.3 * hw, y0 - 0.04 + b * (y1 - y0 + 0.08), -0.015); pa.setXYZ(i, v.x, v.y, v.z); }
      gg.computeVertexNormals(); const gm = new THREE.Mesh(gg, M.glass); gm.renderOrder = 2; root.add(gm);
      // bolt ring
      const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6), M.chrome, 20), o = new THREE.Object3D();
      for (let i = 0; i < 20; i++) { const P = curve.getPointAt(i / 20), out = cap(p, (y0 + y1) / 2, 0.012); o.position.copy(P).lerp(out, -0.09); o.lookAt(0, 0, 0); o.rotateX(Math.PI / 2); o.updateMatrix(); bolts.setMatrixAt(i, o.matrix); }
      root.add(bolts);
    }
    // nose-tip hatch window straight ahead
    const tip = new THREE.Group(); tip.position.z = -Z1; root.add(tip);
    const tipBulk = new THREE.Mesh(new THREE.RingGeometry(0.27, Rtip + 0.01, 64), M.paint); tip.add(tipBulk);
    const tipFrame = new THREE.Mesh(new THREE.LatheGeometry([0.27, 0.3, 0.33, 0.34, 0.31, 0.27].map((r, i) => new THREE.Vector2(r, [0, 0.005, 0.02, 0.04, 0.05, 0.05][i])), 64).rotateX(Math.PI / 2), M.frame); tip.add(tipFrame);
    const tb = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6).rotateX(Math.PI / 2), M.chrome, 24), o2 = new THREE.Object3D();
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; o2.position.set(Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0.006); o2.updateMatrix(); tb.setMatrixAt(i, o2.matrix); } tip.add(tb);
    const tg = new THREE.Mesh(new THREE.CircleGeometry(0.28, 48), M.glass); tg.position.z = -0.01; tg.renderOrder = 2; tip.add(tg);
    // hatch dogs (latches) around the tip
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2, d = new THREE.Mesh(plate(0.05, 0.025, 0.012, 0.005, 0.003), M.dark); d.position.set(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.01); d.rotation.z = a; tip.add(d); }

    // structural rings and longitudinal stringers
    for (const z of [0.55, -0.02, -0.45]) { const r = new THREE.Mesh(new THREE.TorusGeometry(R0 - 0.02, 0.022, 8, 96), M.paint); r.position.z = z; root.add(r); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + 0.26; root.add(rod(V(Math.sin(a) * (R0 - 0.03), Math.cos(a) * (R0 - 0.03), 0.95), V(Math.sin(a) * (R0 - 0.03), Math.cos(a) * (R0 - 0.03), -0.45), 0.012, M.paint, 6)); }
    // grab handles near the windows
    for (const s of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([V(s * 0.55, 0.78, -0.3), V(s * 0.62, 0.72, -0.36), V(s * 0.68, 0.62, -0.45), V(s * 0.72, 0.52, -0.52)]);
      root.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.012, 8), M.chrome));
    }

    // main console: three faceted panels on an arc below eye level, each with a display, bezel and soft keys
    const eye = V(0, 0, 0), RC = 0.58, EL = -0.43;
    const facet = (az, el, w, h, labels, d = RC) => {
      const grp = new THREE.Group(); grp.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(az) * Math.cos(el) * d); grp.lookAt(eye); root.add(grp);
      const m = new THREE.Mesh(plate(w, h, 0.03), new THREE.MeshStandardMaterial({ map: panelTexture(w, h, labels), roughness: 0.6, metalness: 0.35, roughnessMap: rough }));
      m.position.z = -0.035; grp.add(m); return grp;
    };
    const screenOn = (grp, w, h, texture, y = 0.02) => {
      const bz = new THREE.Mesh(ring(w + 0.04, h + 0.04, w + 0.004, h + 0.004, 0.012), M.bezel); bz.position.set(0, y, 0); grp.add(bz);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.5, metalness: 0.05, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.25 }));
      s.position.set(0, y, 0.004); grp.add(s);
      grid(grp, new THREE.BoxGeometry(0.026, 0.014, 0.008), M.key, 6, 1, -w / 2 + 0.013, y - h / 2 - 0.035, (w - 0.026) / 5, 0, 0.004);
      return s;
    };
    const inst = this.inst = new Instruments();
    const fw = 0.34, fh = 0.36, SW = 0.25;
    const fL = facet(-0.6, EL, fw, fh, [['FLT 1', 0.12, 0.95, 0.03], ['ATT', 0.88, 0.95, 0.03]]);
    const fC = facet(0, EL, fw, fh, [['PROP', 0.12, 0.95, 0.03], ['STG', 0.88, 0.95, 0.03]]);
    const fR = facet(0.6, EL, fw, fh, [['ENG', 0.12, 0.95, 0.03], ['PWR', 0.88, 0.95, 0.03]]);
    screenOn(fL, SW, SW, inst.pfd.tex); screenOn(fC, SW, SW, inst.sys.tex); screenOn(fR, SW, SW, inst.eng.tex);
    // knee panel under the centre display: Moon range gauge, stage lamps, rotary selectors, guarded switches
    const fK = facet(0, -0.98, 0.62, 0.22, [['MOON RNG', 0.17, 0.12, 0.03], ['STAGE', 0.5, 0.88, 0.03], ['PYRO ARM', 0.83, 0.88, 0.028], ['DISP', 0.83, 0.15, 0.028]], 0.58);
    const moonBz = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.01, 10, 48), M.frame); moonBz.position.set(-0.2, 0.01, 0.004); fK.add(moonBz);
    this.moonScreen = new THREE.Mesh(new THREE.CircleGeometry(0.052, 48), new THREE.MeshStandardMaterial({ color: 0, roughness: 0.15, emissive: 0xffffff, emissiveMap: inst.moon.tex, emissiveIntensity: 1.2 }));
    this.moonScreen.position.set(-0.2, 0.01, 0.006); fK.add(this.moonScreen);
    this.moonCover = new THREE.Mesh(new THREE.CircleGeometry(0.052, 48), M.dark); this.moonCover.position.set(-0.2, 0.01, 0.005); fK.add(this.moonCover);
    this.lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 6);
    for (let i = 0; i < 6; i++) { const o = new THREE.Object3D(); o.position.set(-0.075 + i * 0.03, 0.04, 0.006); o.updateMatrix(); this.lamps.setMatrixAt(i, o.matrix); this.lamps.setColorAt(i, new THREE.Color(0x111111)); }
    fK.add(this.lamps);
    grid(fK, new THREE.CylinderGeometry(0.011, 0.011, 0.006, 12).rotateX(Math.PI / 2), M.chrome, 6, 1, -0.075, 0.04, 0.03, 0, 0.001);   // lamp rims
    grid(fK, knobGeom(), M.dark, 3, 1, -0.06, -0.045, 0.06, 0, 0);
    const tgl = toggleGeom(), grd = guardGeom();
    grid(fK, tgl, M.chrome, 3, 2, 0.17, 0.04, 0.04, 0.06, 0, 1);
    grid(fK, grd, new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.5, metalness: 0.3 }), 3, 1, 0.17, 0.04, 0.04, 0, 0);
    // side consoles: switch fields, breakers, throttle lever (left) and hand controller (right)
    const fLs = facet(-1.08, -0.62, 0.34, 0.3, [['CABIN PRESS', 0.3, 0.92, 0.035], ['ECLSS', 0.75, 0.92, 0.035], ['THROTTLE', 0.5, 0.1, 0.04]], 0.62);
    grid(fLs, tgl, M.chrome, 5, 2, -0.12, 0.1, 0.035, 0.05, 0, 1); grid(fLs, knobGeom(), M.dark, 2, 1, 0.08, 0.08, 0.05, 0, 0);
    const slot = new THREE.Mesh(plate(0.03, 0.14, 0.004, 0.012, 0.002), M.rubber); slot.position.set(0, -0.06, 0.002); fLs.add(slot);
    this.thrLever = new THREE.Group(); this.thrLever.position.set(0, -0.06, 0.004); fLs.add(this.thrLever);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10).translate(0, 0.035, 0).rotateX(Math.PI / 2), M.chrome); this.thrLever.add(arm);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 6, 12).rotateZ(Math.PI / 2), M.rubber); grip.position.z = 0.072; this.thrLever.add(grip);
    const fRs = facet(1.08, -0.62, 0.34, 0.3, [['NAV', 0.3, 0.92, 0.035], ['COMM', 0.75, 0.92, 0.035], ['RHC', 0.5, 0.1, 0.04]], 0.62);
    grid(fRs, tgl, M.chrome, 5, 2, -0.12, 0.1, 0.035, 0.05, 0, 1); grid(fRs, knobGeom(), M.dark, 2, 1, 0.08, 0.08, 0.05, 0, 0);
    const rhc = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.03, 0], [0.03, 0.01], [0.012, 0.02], [0.016, 0.06], [0.02, 0.1], [0.017, 0.115], [0, 0.12]].map(p => new THREE.Vector2(p[0], p[1])), 20).rotateX(Math.PI / 2), M.rubber);
    rhc.position.set(0, -0.06, 0.004); rhc.rotation.x = -0.25; fRs.add(rhc);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.02, 20).rotateX(Math.PI / 2), M.dark); boot.position.set(0, -0.06, 0.01); fRs.add(boot);
    // overhead circuit breaker panel (seen when looking up)
    const fO = facet(0, 1.15, 0.6, 0.32, [['MAIN BUS A', 0.25, 0.93, 0.03], ['MAIN BUS B', 0.75, 0.93, 0.03], ['EMERGENCY', 0.5, 0.08, 0.03]], 0.9);
    grid(fO, new THREE.CylinderGeometry(0.0065, 0.0065, 0.014, 10).rotateX(Math.PI / 2), M.rubber, 14, 4, -0.26, 0.09, 0.04, 0.045, 0.002);
    // glareshield over the displays with the annunciator strip and master caution buttons
    const gs = new THREE.Group(); root.add(gs);
    const yG = Math.sin(EL + 0.31) * RC + 0.005;
    const shelf = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.7, 48, 1, Math.PI * 0.5 - 1.0, 2.0), M.dark); shelf.rotation.x = -Math.PI / 2; shelf.position.y = yG; gs.add(shelf);
    shelf.geometry.rotateZ(0); shelf.material = M.dark.clone(); shelf.material.side = THREE.DoubleSide;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 48, 1, true, Math.PI - 1.0, 2.0), M.paint.clone()); lip.material.side = THREE.DoubleSide; lip.position.y = yG - 0.03; gs.add(lip);
    const annBz = new THREE.Mesh(ring(0.25, 0.085, 0.226, 0.07, 0.008, 0.006), M.bezel); annBz.position.set(0, yG - 0.03, -0.455); gs.add(annBz);
    const ann = new THREE.Mesh(new THREE.PlaneGeometry(0.224, 0.07), new THREE.MeshStandardMaterial({ color: 0, roughness: 0.2, emissive: 0xffffff, emissiveMap: inst.ann.tex, emissiveIntensity: 1.3 })); ann.position.set(0, yG - 0.03, -0.452); gs.add(ann);
    this.master = [];
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(plate(0.05, 0.04, 0.012, 0.004, 0.002), new THREE.MeshStandardMaterial({ color: 0x2a1a00, emissive: 0xff9a1a, emissiveIntensity: 0, roughness: 0.3, map: panelTexture(0.05, 0.04, [['MASTER', 0.5, 0.62, 0.16], ['CAUTION', 0.5, 0.36, 0.16]], '#3b2a10') }));
      const a = s * 0.19; b.position.set(Math.sin(a) * 0.455, yG - 0.03, -Math.cos(a) * 0.455); b.lookAt(eye); gs.add(b); this.master.push(b.material);
    }
    // under-panel struts to the floor ring
    for (const s of [-1, 1]) { root.add(rod(V(s * 0.25, -0.5, -0.45), V(s * 0.75, -0.72, -0.2), 0.018, M.frame)); root.add(rod(V(s * 0.25, -0.5, -0.45), V(s * 0.2, -0.98, 0.0), 0.016, M.frame)); }
    root.add(rod(V(-0.46, yG - 0.06, -0.3), V(-0.95, 0.15, -0.25), 0.015, M.frame)); root.add(rod(V(0.46, yG - 0.06, -0.3), V(0.95, 0.15, -0.25), 0.015, M.frame));

    // seat: headrest wings, side frames, five-point harness and buckle
    const seat = new THREE.Group(); root.add(seat);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(plate(0.07, 0.2, 0.05, 0.03, 0.012), M.seat); wing.position.set(s * 0.17, 0.02, 0.2); wing.rotation.y = s * 1.25; seat.add(wing);
      seat.add(rod(V(s * 0.3, -0.25, 0.3), V(s * 0.3, -1.0, 0.1), 0.02, M.frame)); seat.add(rod(V(s * 0.3, -0.25, 0.3), V(s * 0.17, 0.12, 0.32), 0.02, M.frame));
      const pad = new THREE.Mesh(plate(0.1, 0.55, 0.06, 0.04, 0.015), M.seat); pad.position.set(s * 0.3, -0.62, 0.17); pad.rotation.set(-0.2, s * 1.35, 0); seat.add(pad);
    }
    const strap = (pts, wdt = 0.045) => {   // flat webbing ribbon along a curve
      const c = new THREE.CatmullRomCurve3(pts), N = 24, pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) { const t = i / N, p = c.getPointAt(t), tg = c.getTangentAt(t), side = new THREE.Vector3().crossVectors(tg, V(0, 0, 1)).normalize().multiplyScalar(wdt / 2); pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z); uv.push(0, t * 6, 1, t * 6); if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      seat.add(new THREE.Mesh(g, M.strap));
    };
    const buckle = V(0, -0.6, -0.17);
    strap([V(-0.2, -0.16, 0.18), V(-0.17, -0.27, -0.06), V(-0.08, -0.45, -0.15), buckle]);
    strap([V(0.2, -0.16, 0.18), V(0.17, -0.27, -0.06), V(0.08, -0.45, -0.15), buckle]);
    strap([V(-0.3, -0.75, -0.05), V(-0.15, -0.66, -0.16), buckle]); strap([V(0.3, -0.75, -0.05), V(0.15, -0.66, -0.16), buckle]);
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 28).rotateX(Math.PI / 2), M.chrome); bk.position.copy(buckle).add(V(0, 0, -0.01)); seat.add(bk);
    const bk2 = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 28).rotateX(Math.PI / 2), M.dark); bk2.position.copy(buckle).add(V(0, 0, -0.016)); seat.add(bk2);

    // interior lighting: warm flood under the glareshield, cool dome light, and a faint fill from the window glow
    this.flood = new THREE.PointLight(0xffc58a, 0, 1.4, 2); this.flood.position.set(0, yG - 0.078, -0.43);
    this.dome = new THREE.PointLight(0x9cc2ff, 0, 3.2, 2); this.dome.position.set(0, 0.75, 0.35);
    this.lights = [this.flood, this.dome];
    root.add(this.flood, this.dome);
    root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    this.w.scene.add(root);
  }

  // ---- sim -> display data (plain object, also handy for the phone layout) ----
  // GB5-RCS / GB5-HEAT: window.CH.rcs / CH.hull (published by rcs-ui.js), falling back to the sim state
  rcsHull(f) {
    const W = typeof window !== 'undefined' ? window.CH : null, r = W?.rcs || this.g.rcs, hl = W?.hull || this.g.hull;
    const rs = f.rcs, hs = f.hull;
    return {
      rcsOn: r ? r.on : !!rs?.on, rcsPct: r ? r.pct : rs ? (100 * rs.prop) / rs.cap : 100, rcsFiring: r ? r.firing : !!rs?.active,
      hullC: hl ? hl.c : (hs ? hs.T : 288.15) - 273.15, hullLevel: hl ? hl.level : hs?.level || 0, hullDmg: hl ? hl.dmg : hs?.dmg || 0,
    };
  }
  data(dt) {
    const f = this.fm.f, T = this.tmp, u = T.u, h = T.h, e = f.e, eng = f.eng;
    const pitch = Math.asin(THREE.MathUtils.clamp(u.y, -1, 1)) * 180 / Math.PI;
    const r = T.a.crossVectors(u, h), wp = T.b.set(0, 1, 0).addScaledVector(u, -u.y);
    if (wp.lengthSq() > 1e-5) this.roll = Math.atan2(wp.dot(r), wp.dot(h)) * 180 / Math.PI;
    const hv = Math.abs(u.y) > 0.985 ? T.c.copy(h) : T.c.copy(u); hv.y = 0; if (hv.lengthSq() < 1e-6) hv.set(0, 0, -1);
    const hdg = (Math.atan2(hv.x, -hv.z) * 180 / Math.PI + 360) % 360;
    // proper acceleration in G (1 G sitting on the pad)
    const vel = V(f.vel.x, f.vel.y, f.vel.z), acc = vel.clone().sub(this.prevVel).divideScalar(Math.max(dt, 1e-3)); this.prevVel.copy(vel);
    const gNow = f.phase === 'flying' ? acc.add(V(0, G0, 0)).length() / G0 : (f.phase === 'crashed' ? 0 : 1);
    this.gs += (Math.min(gNow, 20) - this.gs) * (1 - Math.exp(-dt * 4));
    // window.CH.engine (also game.engine) from gb3-throttle; fall back to the sim if the hook is missing
    const pub = (typeof window !== 'undefined' ? window.CH?.engine : null) || this.g.engine;
    const { thr: act, thrCmd: cmd, on, failed, fuelFrac, state: engState } = engineGauges(e, f.fuelFrac, pub);
    // tanks drain bottom-up off one shared fuel line: active / next / spent per tank (driven by fuelFrac)
    const items = layout(f.rocket).items.filter(it => it.d.fuelMass > 0), caps = items.map(it => it.d.fuelMass), tot = caps.reduce((a, b) => a + b, 0) || 1;
    let burned = (1 - fuelFrac) * tot, activeSet = false;
    const tanks = caps.map(c => { const used = Math.min(c, Math.max(0, burned)); burned -= c; const frac = 1 - used / c; let state = 'next'; if (frac <= 0.002) state = 'spent'; else if (!activeSet) { state = 'active'; activeSet = true; } return { frac, state }; });
    const nE = eng?.engines || 1, live = 1 - (e.out || 0) / nE, eff = on ? e.thr * e.spool : 0;
    const thrust = eng ? eng.thrust * eff * live / 1000 : 0, mdot = eng ? eng.thrust * eff * live / (eng.isp * G0) : 0;
    const fuel = f.st?.fuel ?? 0, wind = Math.hypot(f.windNow?.x || 0, f.windNow?.z || 0);
    const moon = this.moonDistance(dt);
    const cd = this.fm.countdown;
    const phaseLabel = cd != null ? 'T-' + Math.max(0, Math.ceil(cd)) : f.phase === 'pad' ? 'ON PAD' : f.phase === 'landed' ? 'LANDED' : f.phase === 'crashed' ? 'LOST' : f.vs >= 0 ? 'ASCENT' : 'DESCENT';
    const cautions = {
      'LOW FUEL': fuelFrac < 0.15 && tot > 1, 'ENG HOT': e.heat > 60, 'HIGH G': this.gs > 4.5, 'MAX Q': f.q > 30000,
      'ENG FAIL': !!failed, 'LEGS UP': f.legs && f.legOut < 0.5 && f.phase === 'flying' && f.vs < -2 && f.alt < 120,
      'CHUTE': f.chute === 'torn', 'GUSTS': wind > 6,
    };
    return {
      alt: f.alt, vs: f.vs, speed: f.speed, pitch, roll: this.roll || 0, hdg, assist: f.assist,
      thr: act, thrCmd: cmd, heat: e.heat, temp: e.temp, limitTemp: eng?.heat?.limitTemp || 3000, engOn: on, engFailed: failed, engState,
      ...this.rcsHull(f),
      thrust, g: this.gs, q: f.q, wind, tanks, fuelFrac, burnLeft: mdot > 0 ? fuel / mdot : null, apex: f.apex,
      phase: f.phase, phaseLabel, moon: moon?.d ?? null, moonRate: moon?.rate ?? null, cautions, master: CAUTIONS.some(n => cautions[n]),
    };
  }

  // Moon range: prefer MoonFlight.range() (orbit.js surface distance). Fall back to a scene mesh if present.
  moonDistance(dt) {
    const d0 = this.fm?.moon?.range?.();
    if (d0 != null && Number.isFinite(d0)) {
      const d = Math.max(0, d0);
      const rate = this.prevMoon != null && dt > 0 ? (d - this.prevMoon) / dt : null; this.prevMoon = d;
      this.moonRate = rate == null ? this.moonRate : (this.moonRate ?? rate) + (rate - (this.moonRate ?? rate)) * Math.min(1, dt * 2);
      return { d, rate: this.moonRate };
    }
    this.moonScan -= dt;
    if (!this.moonObj && this.moonScan <= 0) {
      this.moonScan = 1; const w = this.w, g = this.g;
      const c = [w.moon, g.moon, w.earth?.moon, w.scene.getObjectByName('Moon'), w.scene.getObjectByName('moon')].find(Boolean);
      this.moonObj = c || null;
    }
    const m = this.moonObj; if (!m) return null;
    const me = this.fm.rs.p, T = this.tmp.a;
    let d = null;
    if (typeof m.distanceTo === 'function' && !m.isObject3D && !m.isVector3) d = m.distanceTo(me);
    else if (typeof m.distance === 'number') d = m.distance;
    else {
      const o = m.isObject3D ? m : m.mesh?.isObject3D ? m.mesh : m.group?.isObject3D ? m.group : null;
      if (o) { o.getWorldPosition(T); let rad = o.userData?.radius ?? 0; if (!rad && o.geometry) { o.geometry.boundingSphere || o.geometry.computeBoundingSphere(); rad = o.geometry.boundingSphere.radius * o.getWorldScale(this.tmp.b).x; } d = Math.max(0, T.distanceTo(me) - rad); }
      else if (m.isVector3 || (m.position && typeof m.position.x === 'number')) d = (m.isVector3 ? m : m.position).distanceTo ? (m.isVector3 ? m : m.position).distanceTo(me) : null;
    }
    if (d == null || !Number.isFinite(d)) return null;
    const rate = this.prevMoon != null && dt > 0 ? (d - this.prevMoon) / dt : null; this.prevMoon = d;
    this.moonRate = rate == null ? this.moonRate : (this.moonRate ?? rate) + (rate - (this.moonRate ?? rate)) * Math.min(1, dt * 2);
    return { d, rate: this.moonRate };
  }

  // ---- per frame, after the flight camera has been placed: take the camera into the capsule ----
  frame(dt) {
    if (!this.on) return;
    const fm = this.fm, f = fm.f, g = fm.group;
    if (!f || !g || f.phase === 'crashed') { this.off(); return; }
    const T = this.tmp, rs = fm.rs, c = this.w.camera;
    T.u.copy(rs.u); T.q.copy(g.quaternion); T.h.set(0, 0, 1).applyQuaternion(T.q);
    const root = this.root; root.visible = true;
    root.quaternion.copy(T.q).multiply(this.qX);
    root.position.copy(rs.o).addScaledVector(T.u, fm.st0.top - EYE_DROP);
    root.updateMatrixWorld(true);
    // head-look, eased; a slight head lean toward the look direction
    const a = 1 - Math.exp(-dt * 14); this.yaw += (this.yawT - this.yaw) * a; this.pitch += (this.pitchT - this.pitch) * a;
    T.e.set(this.pitch, this.yaw, 0, 'YXZ'); T.q2.setFromEuler(T.e);
    const lean = T.b.set(-Math.sin(this.yaw) * 0.06, Math.max(0, this.pitch) * 0.03, -Math.abs(Math.sin(this.yaw)) * 0.04);
    c.position.copy(lean).applyMatrix4(root.matrixWorld);
    c.quaternion.copy(root.quaternion).multiply(T.q2);
    // engine vibration through the airframe
    const s = Math.min(0.6, fm.shake || 0), t = performance.now() / 1000;
    if (s > 0.001) { c.rotateX(Math.sin(t * 47) * s * 0.006 + Math.sin(t * 13) * s * 0.004); c.rotateY(Math.sin(t * 53 + 1) * s * 0.005); }
    c.fov = 70; c.near = 0.04; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    const post = this.w.post; post.setBlur?.(0); post.setDOF?.(false);
    // the plume light sits 10+ m below behind the heat shield and bulkheads: it must not flood the cabin (fx.js resets it every frame)
    if (fm.flame?.light) fm.flame.light.intensity *= 0.02;
    // displays, lamps, lighting
    const d = this.data(dt); this.inst.update(dt, d);
    const hasMoon = d.moon != null; this.moonScreen.visible = hasMoon; this.moonCover.visible = !hasMoon;
    const col = new THREE.Color();
    for (let i = 0; i < 6; i++) { const tk = d.tanks[i]; col.set(!tk ? 0x0c0c0c : tk.state === 'active' ? 0x3dff7a : tk.state === 'spent' ? 0x2a1e12 : 0xe8f0ff); if (tk?.state === 'active' && !d.engOn) col.multiplyScalar(0.45); this.lamps.setColorAt(i, col); }
    this.lamps.instanceColor.needsUpdate = true;
    this.flashT += dt; const fl = d.master ? (Math.sin(this.flashT * 9) > 0 ? 2.2 : 0.25) : 0;
    for (const m of this.master) m.emissiveIntensity = fl;
    this.thrLever.rotation.x = THREE.MathUtils.lerp(0.55, -0.55, THREE.MathUtils.clamp(fm.thr ?? 0, 0, 1));
    const out = THREE.MathUtils.clamp(this.w.sun?.intensity ?? 1, 0, 3) / 3;   // brighter outside -> panel lights matter less
    this.flood.intensity = 0.16 * (1.15 - out * 0.4) + (d.master ? fl * 0.02 : 0); this.dome.intensity = 0.55 * (1.1 - out * 0.5);
  }
}
