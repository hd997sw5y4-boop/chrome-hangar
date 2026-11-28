// Light cockpit interior and the on-screen phone controls.
// Desktop build() in cockpit.js is unchanged: this file runs only when phoneCockpitLod() is true,
// and the touch look / camera button are gated on a real touch device (body.touch / input.isTouch).
import * as THREE from 'three';
import { Instruments } from './cockpit-instruments.js';
import {
  PHONE_LOD, CONTROL_IDS, LOOK_PAD, phoneCockpitLod, isShortViewport,
  lookHitsControl, takeRecenterTap,
} from './cockpit-touch.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const G = PHONE_LOD;

export function cockpitLodEnv(game) {
  const w = typeof innerWidth === 'number' ? innerWidth : 1280;
  const h = typeof innerHeight === 'number' ? innerHeight : 800;
  let coarse = false;
  try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch (_) { coarse = false; }
  return {
    quality: game?.world?.quality || game?.settings?.quality || 'high',
    coarse: !!coarse,
    short: isShortViewport(w, h),
  };
}

export function shouldBuildPhoneCockpit(game) {
  return phoneCockpitLod(cockpitLodEnv(game));
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')];
}

function controlRects() {
  const out = [];
  for (const id of CONTROL_IDS) {
    const el = document.getElementById(id);
    if (!el || el.getClientRects().length === 0) continue;
    out.push(el.getBoundingClientRect());
  }
  return out;
}

// Called once from the Cockpit constructor. Wires look-exclusion; the button itself is wired in flight.js.
export function installCockpitPhone(cockpit) {
  const inp = cockpit?.g?.input;
  if (!inp || inp._ckptPhone) return;
  inp._ckptPhone = true;
  const prev = inp.blockLookAt;
  inp.blockLookAt = (x, y) => {
    if (prev?.(x, y) === true) return true;
    if (!cockpit.on) return false;
    return lookHitsControl(x, y, controlRects(), LOOK_PAD);
  };
  cockpit._tap = { t: 0, x: 0, y: 0 };
}

export function noteCockpitTap(cockpit, inp) {
  const taps = inp?.taps;
  if (!cockpit?.on || !taps?.length) return;
  const rects = controlRects();
  const now = performance.now();
  for (const t of taps) {
    if (lookHitsControl(t.x, t.y, rects, LOOK_PAD)) continue;
    if (takeRecenterTap(cockpit._tap, t, now)) cockpit.recenter();
  }
}

export function syncCockpitButton(cam) {
  const b = document.getElementById('btnCockpit');
  if (!b) return;
  const on = cam === 4;
  const label = on ? 'Outside' : 'Cockpit';
  if (b.textContent !== label) b.textContent = label;
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Back to the outside camera' : 'Sit in the cockpit';
}

export function syncCockpitHint(on) {
  const h = document.getElementById('ckptHint');
  if (!h) return;
  h.classList.remove('show');
  if (!on) return;
  // restart the fade each time the player sits down
  void h.offsetWidth;
  h.classList.add('show');
}

// ---------- light interior ----------
// Same capsule frame as the desktop build (eye at the origin, -Z out the nose, +Y up) so frame()
// can drop the camera in without a second code path. Windows are an alpha cut in a low-segment
// nose plus an open tip, so the outside world still shows. No quilt canvases, no bolt rings,
// no harness ribbons, no breaker field.
export function buildPhoneCockpit(cockpit) {
  const root = cockpit.root = new THREE.Group();
  root.name = 'cockpit';
  const M = {
    lining: new THREE.MeshStandardMaterial({ color: 0x8a877f, roughness: 0.92, metalness: 0.02, side: THREE.BackSide }),
    paint: new THREE.MeshStandardMaterial({ color: 0x2e3237, roughness: 0.62, metalness: 0.35 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x6a6e76, roughness: 0.42, metalness: 0.72 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.55, metalness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9, metalness: 0 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.82, metalness: 0.08 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.45, metalness: 0.02, emissive: 0xffffff, emissiveIntensity: 1.15 }),
  };
  cockpit.M = M;
  const add = (mesh, parent = root) => { mesh.castShadow = false; mesh.receiveShadow = false; parent.add(mesh); return mesh; };
  const box = (w, h, d, mat, parent = root) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), parent);

  // cabin tube behind the eye, open at both ends
  const shell = add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.5, G.cylSeg, 1, true), M.lining));
  shell.rotation.x = Math.PI / 2; shell.position.z = 0.15;
  for (const z of [0.55, -0.15]) {
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.02, G.ringRad, G.ringTub), M.paint));
    ring.position.z = z;
  }

  // nose cone, same profile as the desktop capsule, with window holes cut by a small alpha map
  const R0 = 1.05, Rtip = 0.43, Z0 = 0.45, Z1 = 1.35;
  const rAt = y => R0 + (Rtip - R0) * Math.pow((y - Z0) / (Z1 - Z0), 0.85);
  const toCap = g => g.rotateX(-Math.PI / 2);
  const steps = G.coneSteps, pts = [];
  for (let i = 0; i <= steps; i++) { const y = Z0 + (Z1 - Z0) * i / steps; pts.push(new THREE.Vector2(rAt(y), y)); }
  const WINS = [[0.72, 0.62, 1.12, 0.22], [-0.72, 0.62, 1.12, 0.22], [1.62, 0.55, 1.0, 0.26], [-1.62, 0.55, 1.0, 0.26]];
  const [ac, ax] = canvas(G.alphaW, G.alphaH);
  ax.fillStyle = '#fff'; ax.fillRect(0, 0, G.alphaW, G.alphaH); ax.fillStyle = '#000';
  for (const [p, y0, y1, hw] of WINS) {
    const u = ((p / (Math.PI * 2)) % 1 + 1) % 1;
    const v0 = (y0 - Z0) / (Z1 - Z0), v1 = (y1 - Z0) / (Z1 - Z0);
    const px = u * G.alphaW, w = hw / (Math.PI * 2) * G.alphaW;
    const top = (1 - v1) * G.alphaH, bot = (1 - v0) * G.alphaH;
    const paint = (x) => ax.fillRect(x, top, w * 2, Math.max(1, bot - top));
    paint(px - w);
    if (px - w < 0) paint(px - w + G.alphaW);
    if (px + w > G.alphaW) paint(px - w - G.alphaW);
  }
  const alpha = new THREE.CanvasTexture(ac); alpha.colorSpace = THREE.NoColorSpace; alpha.anisotropy = 1;
  const coneMat = M.lining.clone(); coneMat.alphaMap = alpha; coneMat.alphaTest = 0.5;
  add(new THREE.Mesh(toCap(new THREE.LatheGeometry(pts, G.coneSeg)), coneMat));

  const cap = (phi, y, inset) => { const r = rAt(y) - inset; return V(r * Math.sin(phi), r * Math.cos(phi), -y); };
  for (const [p, y0, y1] of WINS) {
    const c = cap(p, (y0 + y1) / 2, 0.02);
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.016, G.winRad, G.winTub), M.frame));
    ring.position.copy(c); ring.lookAt(0, 0, 0);
  }

  // open tip hatch: the forward view. No glass card (that transparent pass is pure fill-rate).
  const tip = new THREE.Group(); tip.position.z = -Z1; root.add(tip);
  add(new THREE.Mesh(new THREE.RingGeometry(0.22, Rtip + 0.02, G.tipSeg), M.frame), tip);

  const back = add(new THREE.Mesh(new THREE.CircleGeometry(1.05, G.cylSeg), M.lining.clone()));
  back.material.side = THREE.FrontSide; back.position.z = 0.95; back.rotation.y = Math.PI;

  // glareshield, three displays, knee panel. Same angles as the desktop facets so the scan is familiar.
  const inst = cockpit.inst = new Instruments();
  for (const s of inst.list) s.tex.anisotropy = 1;
  const eye = V(0, 0, 0), RC = 0.58, EL = -0.43;
  const facet = (az, el, w, h, d = RC) => {
    const grp = new THREE.Group();
    grp.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(az) * Math.cos(el) * d);
    grp.lookAt(eye); root.add(grp);
    const m = box(w, h, 0.02, M.paint, grp); m.position.z = -0.02;
    return grp;
  };
  const screenOn = (grp, w, h, texture, y = 0.02) => {
    const mat = M.screen.clone(); mat.emissiveMap = texture;
    const s = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat), grp);
    s.position.set(0, y, 0.006); return s;
  };
  const SW = 0.22;
  screenOn(facet(-0.58, EL, 0.32, 0.32), SW, SW, inst.pfd.tex);
  screenOn(facet(0, EL, 0.32, 0.32), SW, SW, inst.sys.tex);
  screenOn(facet(0.58, EL, 0.32, 0.32), SW, SW, inst.eng.tex);

  const fK = facet(0, -0.98, 0.58, 0.2, 0.58);
  const moonMat = M.screen.clone(); moonMat.emissiveMap = inst.moon.tex;
  cockpit.moonScreen = add(new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), moonMat), fK);
  cockpit.moonScreen.position.set(-0.18, 0.01, 0.008);
  cockpit.moonCover = add(new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), M.dark), fK);
  cockpit.moonCover.position.set(-0.18, 0.01, 0.007);
  cockpit.lamps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.012, G.lampW, G.lampH),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    6,
  );
  const o = new THREE.Object3D();
  for (let i = 0; i < 6; i++) {
    o.position.set(-0.06 + i * 0.032, 0.03, 0.01); o.updateMatrix();
    cockpit.lamps.setMatrixAt(i, o.matrix);
    cockpit.lamps.setColorAt(i, new THREE.Color(0x111111));
  }
  cockpit.lamps.castShadow = false; cockpit.lamps.instanceMatrix.needsUpdate = true; fK.add(cockpit.lamps);

  // side consoles: a throttle lever the frame() code still swings, and a plain hand controller
  const fLs = facet(-1.05, -0.62, 0.3, 0.26, 0.62);
  cockpit.thrLever = new THREE.Group(); cockpit.thrLever.position.set(0, -0.04, 0.01); fLs.add(cockpit.thrLever);
  const arm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, G.leverSeg), M.frame), cockpit.thrLever);
  arm.rotation.x = Math.PI / 2; arm.position.z = 0.04;
  const grip = box(0.05, 0.02, 0.02, M.rubber, cockpit.thrLever); grip.position.z = 0.09;
  const fRs = facet(1.05, -0.62, 0.3, 0.26, 0.62);
  const rhc = box(0.03, 0.1, 0.03, M.rubber, fRs); rhc.position.set(0, -0.02, 0.02); rhc.rotation.x = -0.3;

  const fO = facet(0, 1.15, 0.5, 0.22, 0.9);
  box(0.42, 0.12, 0.01, M.dark, fO).position.z = 0.01;

  const yG = Math.sin(EL + 0.31) * RC;
  const shelf = box(0.7, 0.06, 0.16, M.dark); shelf.position.set(0, yG, -0.42);
  const annMat = M.screen.clone(); annMat.emissiveMap = inst.ann.tex; annMat.emissiveIntensity = 1.2;
  const ann = add(new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.07), annMat));
  ann.position.set(0, yG - 0.02, -0.5);
  cockpit.master = [];
  for (const s of [-1, 1]) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xff9a1a, emissiveIntensity: 0, roughness: 0.4, metalness: 0.2 });
    const b = box(0.06, 0.045, 0.015, mat); b.position.set(s * 0.28, yG - 0.02, -0.5); cockpit.master.push(mat);
  }

  // seat, kept to a few boxes so a look back still reads as a couch
  const seat = new THREE.Group(); root.add(seat);
  box(0.34, 0.28, 0.08, M.seat, seat).position.set(0, 0.02, 0.28);
  for (const s of [-1, 1]) {
    const wing = box(0.06, 0.2, 0.08, M.seat, seat); wing.position.set(s * 0.18, 0.02, 0.22);
    const pad = box(0.08, 0.4, 0.06, M.seat, seat); pad.position.set(s * 0.28, -0.45, 0.16);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, G.strutSeg), M.frame), seat)
      .position.set(s * 0.32, -0.4, 0.12);
  }

  cockpit.flood = new THREE.PointLight(0xffc58a, 0, 1.4, 2); cockpit.flood.position.set(0, yG - 0.08, -0.42);
  cockpit.dome = new THREE.PointLight(0x9cc2ff, 0, 2.4, 2); cockpit.dome.position.set(0, 0.7, 0.2);
  cockpit.lights = [cockpit.flood, cockpit.dome];
  root.add(cockpit.flood, cockpit.dome);
  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  cockpit.w.scene.add(root);
  cockpit.built = true;
}
