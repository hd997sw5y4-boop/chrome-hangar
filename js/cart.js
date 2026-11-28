// Drivable golf cart for messing around the base: a downloaded model (assets/models/golf_cart.glb, credited in
// CREDITS.md, badges and plate text removed) on top of the physics below.
// Walk up and press E (△ on a pad, or click / tap it) to get in, E again to get out. W/S or R2/L2 drive and
// brake/reverse, A/D or the left stick steer, Space / ✕ handbrake (drifts), R / ○ rights it if it tips,
// C / □ honks and calls a robot over, V / R3 swaps chase and seat views, L toggles the headlights.
// Physics: a small custom raycast vehicle (4 sprung wheels, tyre grip with a friction circle, handbrake slide,
// body roll and pitch from real contact forces) plus a box hull that can land on its side or roof. It hits the
// same collision shapes the player walks against (hangar walls, props, stand, doors, pad, fence) and shoves
// loose cones / crates / barrels and robots around. One robot can ride shotgun via cart.seatPassenger(robot).
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.mjs';
import { IS_TOUCH } from './env.js';
import { playerFrame, hangarWalls, doorObstacles, insideHangar, walk as collideWalk, R_PLAYER, C } from './collide.js';
import { FENCE } from './outdoor.js';
import { hitBox } from './interactive.js';
import { aimActuators } from './robots.js';
import { Course, CART_PARK } from './cartcourse.js';
import { Crew } from './robotbreak.js';
import { pen } from './bodies.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => t * t * (3 - 2 * t);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

// model space: ground at y = 0, +z forward, +x = driver's side (left-hand drive), passenger on -x.
// The GLB is authored +z forward with its axles at z = +1.628 / -1.32; MODEL_Z centres the wheelbase on z = 0.
const MODEL_Z = -0.154;
const COM = V3(0, 0.56, -0.05);
const M_CART = 520, M_ROBOT = 95, WHEEL_R = 0.285, MOUNT_Y = 0.43, L0 = 0.22, K_SUS = 17000, C_SUS = 2250, MAXC = 0.19;
// top speed ~65 mph (29 m/s): the drive force holds up through the mid range (quartic fade) and balances the drag near VMAX
const VMAX = 31, VREV = 4.5, DRIVE_N = 1500, V_STEER = 12.5, LAT_MAX = 10;
const INV_I = V3(1 / 580, 1 / 570, 1 / 170);
const FOOT = { hx: 0.76, z0: -1.96, z1: 1.93 };
const FOOT_C = (FOOT.z0 + FOOT.z1) / 2, FOOT_HZ = (FOOT.z1 - FOOT.z0) / 2;
const WHEELS = [{ x: 0.635, z: 1.474, front: true }, { x: -0.635, z: 1.474, front: true }, { x: 0.635, z: -1.474 }, { x: -0.635, z: -1.474 }];
const WHEEL_NODES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const HULL = [];
for (const s of [-1, 1]) {
  HULL.push([s * 0.72, 0.2, 1.9], [s * 0.72, 0.2, -1.9], [s * 0.76, 0.95, -1.92], [s * 0.76, 1.05, 1.1], [s * 0.74, 0.8, 1.85], [s * 0.76, 0.55, 0]);
  HULL.push([s * 0.7, 1.94, 1.5, 1], [s * 0.7, 1.94, -1.88, 1], [s * 0.74, 1.3, 0.2]);
}
HULL.push([0, 0.5, 1.95], [0, 0.2, 0]);
const SEAT = V3(-0.345, -0.055, 0.18), HIP_Y = 0.985;   // passenger root (robot pelvis bone rests at HIP_Y), front passenger seat
const DRIVER_EYE = V3(0.345, 1.55, 0.12);
const APRON = { x0: -70, x1: 110, z0: -205, z1: 15 };

const _ca = V3(), _cb = V3(), _cc = V3();   // camera scratch
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = V3(), _f = V3(), _g = V3(), _n = V3(), _r = V3(), _t = V3(), _t2 = V3(), _up = V3(), _fw = V3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();

// ---------- engine / tyre sound beds ----------
class CartSound {
  constructor(audio) { this.a = audio; this.n = null; }
  start() {
    const A = this.a, c = A.ctx; if (!c || this.n || !A.noiseBuf) return;
    const gain = v => { const g = c.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 1) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const noise = rate => { const s = c.createBufferSource(); s.buffer = A.noiseBuf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random()); return s; };
    const n = this.n = {};
    n.o1 = c.createOscillator(); n.o1.type = 'sawtooth'; n.o2 = c.createOscillator(); n.o2.type = 'sine';
    n.bp = filt('bandpass', 700, 3); n.mg = gain(0); n.wg = gain(0);
    n.o1.connect(n.bp); n.bp.connect(n.mg); n.o2.connect(n.wg); n.wg.connect(n.mg); n.mg.connect(A.sfx); n.o1.start(); n.o2.start();
    n.t = noise(0.9); n.tl = filt('lowpass', 300, 0.7); n.tg = gain(0); n.t.connect(n.tl); n.tl.connect(n.tg); n.tg.connect(A.sfx);
    n.gr = noise(0.75); n.gb = filt('bandpass', 1500, 0.6); n.gg = gain(0); n.gr.connect(n.gb); n.gb.connect(n.gg); n.gg.connect(A.sfx);
    n.sk = noise(1); n.sb = filt('bandpass', 1050, 7); n.sg = gain(0); n.sk.connect(n.sb); n.sb.connect(n.sg); n.sg.connect(A.sfx);
  }
  set(speed, thr, slip, surf) {
    const n = this.n; if (!n) return; const t = this.a.ctx.currentTime, k = clamp(speed / VMAX, 0, 1.2);
    n.o1.frequency.setTargetAtTime(62 + speed * 20 + thr * 14, t, 0.08); n.o2.frequency.setTargetAtTime(380 + speed * 95 + thr * 40, t, 0.08);
    n.bp.frequency.setTargetAtTime(420 + speed * 110, t, 0.1);
    n.mg.gain.setTargetAtTime(0.006 + thr * 0.03 + k * 0.016, t, 0.08); n.wg.gain.setTargetAtTime(0.25 + thr * 0.35, t, 0.1);
    const grav = surf === 'gravel', metal = surf === 'metal';
    n.tl.frequency.setTargetAtTime((metal ? 700 : 240) + speed * 45, t, 0.1);
    n.tg.gain.setTargetAtTime(Math.min(1, speed / 11) * (grav ? 0.05 : metal ? 0.16 : 0.09), t, 0.08);
    n.gg.gain.setTargetAtTime(grav ? Math.min(1, speed / 9) * (0.1 + Math.random() * 0.1) + slip * 0.12 : 0, t, 0.03);
    n.sg.gain.setTargetAtTime(grav ? 0 : clamp(slip - 0.25, 0, 1) * 0.13, t, 0.06);
  }
  stop() {
    const n = this.n; if (!n) return; this.n = null; const t = this.a.ctx.currentTime;
    for (const g of [n.mg, n.tg, n.gg, n.sg]) g.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => { for (const s of [n.o1, n.o2, n.t, n.gr, n.sk]) try { s.stop(); } catch (_) {} }, 900);
  }
}

const CSS = `
#cartHint{position:absolute;z-index:30;left:50%;bottom:calc(120px + var(--sb,0px));transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:rgba(12,18,26,.72);border:1px solid rgba(127,231,255,.45);color:#e8f8ff;font:600 13px/1.2 system-ui,sans-serif;white-space:nowrap;backdrop-filter:blur(6px);pointer-events:none;opacity:0;transition:opacity .15s}
#cartHint.on{opacity:1}#cartHint kbd,#cartHud kbd{display:inline-block;min-width:16px;padding:1px 6px;margin-right:6px;border-radius:6px;background:rgba(127,231,255,.18);border:1px solid rgba(127,231,255,.5);font:700 11px system-ui;color:#e8f8ff}
#cartHud{position:absolute;z-index:29;left:16px;bottom:calc(16px + var(--sb,0px));display:none;color:#e8f8ff;font:600 12px system-ui,sans-serif;pointer-events:none}
#cartHud .spd{display:inline-flex;align-items:baseline;gap:5px;padding:8px 14px;border-radius:14px;background:rgba(12,18,26,.66);border:1px solid rgba(127,231,255,.3);backdrop-filter:blur(6px)}
#cartHud .spd b{font:800 30px system-ui;letter-spacing:-1px;min-width:38px;text-align:right}
#cartHud .keys{margin-top:8px;max-width:520px;line-height:1.9;opacity:.85;transition:opacity 1.2s}#cartHud .keys span{margin-right:10px;white-space:nowrap}
#cartTouch{position:absolute;z-index:31;right:14px;bottom:calc(16px + var(--sb,0px));display:none;gap:10px}
#cartTouch button{min-width:62px;min-height:58px;border-radius:14px;border:1px solid rgba(127,231,255,.4);background:rgba(12,18,26,.72);color:#e8f8ff;font:700 14px system-ui;touch-action:none;user-select:none;-webkit-user-select:none}
#cartTouch button.held{background:rgba(47,183,255,.45)}
body.cartOn #tray,body.cartOn #standCtl,body.cartOn #checkout,body.cartOn #crosshair,body.cartOn #aimReason{display:none!important}
body.cartOn #cartHud{display:block}body.cartOn.touch #cartTouch{display:flex}
`;

export class Cart {
  constructor(game) {
    this.g = game; this.w = game.world; this.lite = this.w.quality === 'phone' || this.w.quality === 'low';
    this.course = new Course(game); this.crew = new Crew(game, this.course);
    this.body = new THREE.Group(); this.body.name = 'golfCart'; this.w.scene.add(this.body);
    this.model = new THREE.Group(); this.model.position.copy(COM).negate(); this.body.add(this.model);
    this.buildModel();
    this.p = this.body.position; this.q = this.body.quaternion; this.v = V3(); this.w3 = V3(); this.m = M_CART;
    this.wheels = WHEELS.map((d, i) => ({ ...d, mount: V3(d.x, MOUNT_Y, d.z), comp: 0, contact: false, spin: 0, ext: MOUNT_Y - 0.12, vf: 0, slip: 0, node: this.wheelNodes[i] }));
    this.hull = HULL.map(([x, y, z, roof]) => ({ p: V3(x, y, z).sub(COM), roof: !!roof }));
    this.park();
    this.steer = 0; this.driving = false; this.view = 'chase'; this.lightsOn = true; this.passenger = null; this.boarder = null;
    this.orbit = { yaw: 0, pitch: 0.3, idle: 9, dist: 6.8 }; this.shake = 0; this.camPos = V3(); this.camQ = new THREE.Quaternion();
    this.sound = new CartSound(game.audio); this.crashCd = 0; this.tipT = 0; this.air = 0; this.vPrev = V3(); this.acc = V3();
    this.sway = { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, air: 0 };
    this.lastP = null; this.eHold = false; this.ctl = { drive: 0, brake: 0, hand: false, hold: false, thr: 0 };
    this.ui();
    this.ix = game.interact?.add({ hit: this.hit, glow: [], range: 5, label: () => 'Get in the golf cart', enabled: () => !this.driving && this.g.mode === 'build', use: () => this.enter() });
  }
  async load() { await Promise.all([this.course.load(), this.loadModel()]); }

  park() {
    const P = CART_PARK; this.p.set(P.x, COM.y + 0.01, P.z); this.awake = 2; this.q.setFromAxisAngle(V3(0, 1, 0), P.yaw); this.v?.set(0, 0, 0); this.w3?.set(0, 0, 0);
    this.body.updateMatrixWorld(true);
  }
  yaw() { _fw.set(0, 0, 1).applyQuaternion(this.q); return Math.atan2(_fw.x, _fw.z); }
  toWorld(x, y, z, out = V3()) { return out.set(x, y, z).sub(COM).applyQuaternion(this.q).add(this.p); }

  // ---------- model ----------
  // pivots the physics drives (wheel steer / spin, steering wheel), the beam and the click target; loadModel() fills them from the GLB
  buildModel() {
    this.wheelNodes = WHEELS.map(d => {
      const pivot = new THREE.Group(); pivot.position.set(d.x, WHEEL_R, d.z); this.model.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin);
      return { pivot, spin };
    });
    this.swheel = new THREE.Group(); this.model.add(this.swheel);
    // headlight beam (desktop): one soft spot so the floor in front lights up at dusk or in a dark hangar
    if (!this.lite) {
      const L = this.beam = new THREE.SpotLight(0xfff2dc, 0, 42, 0.62, 0.6, 1.4); L.position.set(0, 0.72, 1.95);
      L.target.position.set(0, 0.1, 9.5); this.model.add(L); this.model.add(L.target); L.castShadow = false;
    }
    this.hit = hitBox(1.6, 1.95, 3.95); this.hit.position.set(0, 0.98, 0); this.model.add(this.hit);
  }
  async loadModel() {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const root = (await loader.loadAsync('assets/models/golf_cart.glb')).scene;
    root.position.z = MODEL_Z; root.updateMatrixWorld(true);
    const lite = this.lite, part = n => root.getObjectByName(n);
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = !lite; o.receiveShadow = true;
      for (const m of [].concat(o.material)) { if (lite && m.normalMap) { m.normalMap = null; m.needsUpdate = true; } if (m.map) m.map.anisotropy = 4; }
    });
    // wheels: move each wheel mesh into its physics pivot (pivot = axle centre, which is also the node's own origin)
    WHEEL_NODES.forEach((name, i) => {
      const n = part(name); if (!n) return;
      n.position.set(0, 0, 0); n.quaternion.identity(); this.wheelNodes[i].spin.add(n);
    });
    // steering wheel: spins about its column, found as the axis of least spread of the rim's vertices
    const sw = part('steering_wheel');
    if (sw) {
      let geo = sw.geometry; sw.traverse(o => { geo ||= o.geometry; }); const axis = this.ringAxis(geo); if (axis.y < 0) axis.negate();
      const tilt = new THREE.Group(); tilt.position.copy(sw.position); tilt.position.z += MODEL_Z;
      tilt.quaternion.setFromUnitVectors(V3(0, 0, 1), axis); this.model.add(tilt);
      const spin = new THREE.Group(); tilt.add(spin);
      sw.position.set(0, 0, 0); sw.quaternion.copy(tilt.quaternion).invert(); spin.add(sw);
      this.swheel = spin;
    }
    // the lamps share one atlas material: split it into a headlight half (atlas top) and a tail / plate half
    const glow = [];
    root.traverse(o => { if (!o.isMesh) return; if (o.material.emissiveMap) this.splitLights(o); else if (!WHEEL_NODES.includes(o.name)) glow.push(o); });
    this.model.add(root); this.root = root;
    if (this.ix) for (const m of glow) this.g.interact.glowify(this.ix, m);
    this.setLights(this.lightsOn && this.driving);
  }
  ringAxis(geo) {   // smallest principal axis of a mesh's vertices (a flat ring's normal)
    const P = geo.attributes.position, c = V3(), v = V3(), n = P.count; for (let i = 0; i < n; i++) c.add(v.fromBufferAttribute(P, i)); c.divideScalar(n);
    const S = [0, 0, 0, 0, 0, 0];   // xx xy xz yy yz zz
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i).sub(c); S[0] += v.x * v.x; S[1] += v.x * v.y; S[2] += v.x * v.z; S[3] += v.y * v.y; S[4] += v.y * v.z; S[5] += v.z * v.z; }
    const e = 1e-6 * (S[0] + S[3] + S[5]), M = new THREE.Matrix3().set(S[0] + e, S[1], S[2], S[1], S[3] + e, S[4], S[2], S[4], S[5] + e).invert();
    const a = V3(0.3, 0.5, 0.8); for (let i = 0; i < 40; i++) a.applyMatrix3(M).normalize();   // inverse power iteration
    return a;
  }
  splitLights(mesh) {
    const g = mesh.geometry, uv = g.attributes.uv, idx = g.index; if (!uv || !idx) return;
    const head = [], tail = [], arr = idx.array;
    for (let t = 0; t < arr.length; t += 3) { const vv = (uv.getY(arr[t]) + uv.getY(arr[t + 1]) + uv.getY(arr[t + 2])) / 3; (vv < 0.34 ? head : tail).push(arr[t], arr[t + 1], arr[t + 2]); }
    g.setIndex(head.concat(tail)); g.clearGroups(); g.addGroup(0, head.length, 0); g.addGroup(head.length, tail.length, 1);
    const hm = mesh.material.clone(), tm = mesh.material.clone(); hm.name = 'cart_head'; tm.name = 'cart_tail';
    mesh.material = [hm, tm]; this.lightMats = { head: hm, tail: tm };
  }
  setLightLevels(head, tail) { const L = this.lightMats; if (!L) return; L.head.emissiveIntensity = head; L.tail.emissiveIntensity = tail; }

  ui() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const mk = (id, html = '') => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
    this.hintEl = mk('cartHint');
    this.hud = mk('cartHud', `<div class="spd"><b>0</b><span>mph</span></div><div class="keys"></div>`);
    this.spdEl = this.hud.querySelector('b'); this.keysEl = this.hud.querySelector('.keys');
    this.touchEl = mk('cartTouch', `<button data-c="exit">Exit</button><button data-c="brake">Brake</button><button data-c="flip">Flip</button><button data-c="horn">Horn</button>`);
    for (const b of this.touchEl.querySelectorAll('button')) {
      const c = b.dataset.c;
      b.addEventListener('touchstart', e => { e.preventDefault(); b.classList.add('held'); if (c === 'brake') this.touchBrake = true; else this.touchCmd = c; }, { passive: false });
      const up = e => { e.preventDefault(); b.classList.remove('held'); if (c === 'brake') this.touchBrake = false; };
      b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    }
  }
  showKeys() {
    const pad = this.g.input.lastDevice === 'pad';
    const k = (a, b) => `<span><kbd>${a}</kbd>${b}</span>`;
    this.keysEl.innerHTML = IS_TOUCH ? '' : pad
      ? k('R2', 'go') + k('L2', 'brake / reverse') + k('L-stick', 'steer') + k('✕', 'handbrake') + k('○', 'flip back') + k('□', 'horn / call robot') + k('R3', 'view') + k('△', 'get out')
      : k('W S', 'drive / reverse') + k('A D', 'steer') + k('Space', 'handbrake') + k('R', 'flip back') + k('C', 'horn / call robot') + k('V', 'view') + k('L', 'lights') + k('E', 'get out');
    this.keysEl.style.opacity = 0.85; clearTimeout(this.keysT); this.keysT = setTimeout(() => { this.keysEl.style.opacity = 0; }, 9000);
    this.keysDev = this.g.input.lastDevice;
  }

  // ---------- obstacles the player and robots walk around (collide.js dynamicObstacles) ----------
  obstacles() {
    if (this._self) return [];
    const out = []; for (const z of [1.42, 0.47, -0.47, -1.42]) { const p = this.toWorld(0, 0, z, _a); out.push(C(p.x, p.z, 0.78)); }
    return out;
  }
  footDist(x, z) {   // distance from a ground point to the cart footprint
    _fw.set(0, 0, 1).applyQuaternion(this.q); const fl = Math.hypot(_fw.x, _fw.z) || 1, fx = _fw.x / fl, fz = _fw.z / fl;
    const c = this.toWorld(0, 0, FOOT_C, _b), dx = x - c.x, dz = z - c.z, lx = dx * fz - dz * fx, lz = dx * fx + dz * fz;
    return Math.hypot(Math.max(0, Math.abs(lx) - FOOT.hx), Math.max(0, Math.abs(lz) - FOOT_HZ));
  }

  // ---------- enter / exit ----------
  enter() {
    if (this.driving || this.g.mode !== 'build') return;
    const inp = this.g.input; this.driving = true; this.eHold = true;
    document.body.classList.add('cartOn'); this.hintEl.classList.remove('on');
    if (!IS_TOUCH) inp.requestLock();
    this.camPos.copy(this.w.camera.position); this.camQ.copy(this.w.camera.quaternion); this.camBlend = 0;
    this.orbit.yaw = 0; this.orbit.idle = 9;
    this.g.audio.unlock(); this.sound.start(); this.course.sounds.ensure();
    this.g.audio.tone(1500, 0.06, 'sine', 0.04, 0.1); this.g.audio.tone(2000, 0.08, 'sine', 0.035, 0.1, 0.08);   // key-on chirp
    this.setLights(true); this.showKeys();
    if (!this.passenger && !this.boarder) this.callRobot(25);
  }
  exit(instant = false) {
    if (!this.driving) return;
    const sp = this.v.length();
    if (!instant && sp > 4) { this.g.toast('Slow down to hop out.', 1400); return; }
    this.driving = false; this.eHold = true;
    document.body.classList.remove('cartOn'); this.sound.stop(); this.setLights(false);
    this.w.camera.fov = 70; this.w.camera.updateProjectionMatrix();
    const P = this.g.build.player, yaw = this.yaw();
    let spot = null;
    for (const [x, z] of [[1.4, 0.1], [-1.4, 0.1], [0, 2.6], [0, -2.7], [2.4, 1.6]]) {
      const w = this.toWorld(x, 0, z, _a); const q = collideWalk(w.x, w.z, R_PLAYER, playerFrame(this.g));
      if (Math.hypot(q.x - w.x, q.z - w.z) < 0.35) { spot = q; break; }
    }
    if (!spot) { const w = this.toWorld(1.4, 0, 0.1, _a); spot = collideWalk(w.x, w.z, R_PLAYER, playerFrame(this.g)); }
    P.x = spot.x; P.z = spot.z; P.yaw = yaw + Math.PI; P.pitch = 0.05; this.lastP = { x: P.x, z: P.z };
    const wantIn = insideHangar(P.x, P.z, 0.2); if (wantIn !== this.w.indoor) this.w.setIndoor(wantIn);
    this.g.build.applyCam();
    if (this.boarder) this.cancelBoard();
    if (this.passenger) this.dropPassenger();
    this.g.audio.tone(900, 0.06, 'sine', 0.035, 0.1);
  }
  setLights(on) {
    this.lightsOn = on; this.setLightLevels(on ? 2.2 : 0, on ? 0.8 : 0);
    if (this.beam) this.beam.intensity = on ? 38 : 0;
  }

  // ---------- passenger ----------
  nearestRobot(maxD) {
    const c = this.p; let best = null, bd = maxD;
    for (const r of this.crew.list) { if (r.broken || r.seat || r.helping || r.boarding) continue; const d = Math.hypot(r.pos.x - c.x, r.pos.z - c.z); if (d < bd) { bd = d; best = r; } }
    return best;
  }
  sidePoint() { const p = this.toWorld(-1.3, 0, 0.25, V3()); return p; }
  callRobot(maxD = 80) {
    if (this.passenger || this.boarder) return false;
    const r = this.nearestRobot(maxD); if (!r) return false;
    const s = this.sidePoint(); this.boarder = r; r.boarding = true; this.boardT = 0;
    this.crew.sendTo(r, s.x, s.z, this.yaw() + Math.PI / 2, 1.7, () => this.tryBoard(r));
    this.g.robots?.whir(0.4, 1.2);
    return true;
  }
  tryBoard(r) {
    if (this.boarder !== r) return;
    if (this.v.length() > 2 || !this.driving) { if (!this.driving) this.cancelBoard(); else { const s = this.sidePoint(); this.crew.sendTo(r, s.x, s.z, this.yaw() + Math.PI / 2, 1.7, () => this.tryBoard(r)); } return; }
    this.seatPassenger(r);
  }
  cancelBoard() { const r = this.boarder; this.boarder = null; if (!r) return; r.boarding = false; this.crew.goHome(r); }
  // Public hook: put a robot in the passenger seat (he hops in, holds on and rides along).
  seatPassenger(r) {
    if (this.passenger || !r || r.broken || r.seat) return false;
    r.task = null; r.boarding = false; r.outIdle = null; r.greet = null; r.knock = null; r.enabled = false; r.solid = false; if (this.boarder === r) this.boarder = null;
    this.body.updateMatrixWorld(true);
    const from = this.model.worldToLocal(r.group.getWorldPosition(V3()));
    const fromYaw = wrapA(r.yaw - this.yaw());
    this.model.add(r.group); r.group.position.copy(from); r.group.rotation.set(0, fromYaw, 0);
    r.seat = { t: 0, from, fromYaw }; this.passenger = r; this.m = M_CART + M_ROBOT;
    Object.assign(this.sway, { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, air: 0 });
    this.g.robots?.whir(0.45, 1.35);
    return true;
  }
  dropPassenger(r = this.passenger, keepPose = false) {
    if (!r || r !== this.passenger) return;
    this.passenger = null; r.seat = null; this.m = M_CART;
    if (keepPose) { this.crew.out.attach(r.group); return; }
    const yaw = this.yaw(), s = this.toWorld(-1.3, 0, 0.25, _a), q = collideWalk(s.x, s.z, 0.3, playerFrame(this.g));
    this.crew.out.add(r.group); r.group.visible = true;
    this.crew.standPose(r, q.x, q.z, yaw - Math.PI / 2); this.crew.idleOut(r);
    this.g.robots?.whir(0.4, 1.1);
  }
  poseRider(dt) {
    const r = this.passenger; if (!r) return;
    const S = r.seat; S.t += dt; const b = r.b, k = smooth(clamp(S.t / 0.6, 0, 1)), sw = this.sway;
    // seat sway: a spring driven by the cart's acceleration in its own frame, jolts on hits
    _qi.copy(this.q).invert(); const a = _a.copy(this.acc).applyQuaternion(_qi);
    const spring = (key, vkey, target) => { sw[vkey] += (-(sw[key] - target) * 55 - sw[vkey] * 7.5) * dt; sw[key] = clamp(sw[key] + sw[vkey] * dt, -0.6, 0.6); };
    spring('x', 'vx', clamp(a.x * 0.03, -0.35, 0.35)); spring('z', 'vz', clamp(-a.z * 0.025, -0.3, 0.3)); spring('y', 'vy', clamp(-(a.y) * 0.004, -0.12, 0.12));
    sw.air += ((this.air > 0.35 ? 1 : 0) - sw.air) * (1 - Math.exp(-6 * dt));
    r.group.position.lerpVectors(S.from, SEAT, k); r.group.position.y += Math.sin(Math.PI * k) * 0.3;
    r.group.rotation.set(0, S.fromYaw * (1 - k), 0);
    const look = clamp(this.steer * 0.9, -0.6, 0.6) * k, A = sw.air * k;
    b.pelvis.position.set(0, HIP_Y, 0); b.pelvis.rotation.set(-0.03 * k + sw.z * 0.3, 0, sw.x * 0.35);
    b.spine.rotation.set(-0.06 * k + sw.z * 0.5, sw.x * 0.15, 0); b.chest.rotation.set(sw.z * 0.4, look * 0.2, sw.x * 0.6);
    b.neck.rotation.set(-sw.z * 0.35 + sw.y * 2.5, look * 0.6, 0); b.head.rotation.set(-sw.z * 0.3 + sw.y * 3, look * 0.4, -sw.x * 0.5);
    for (const [S2, s] of [['L', 1], ['R', -1]]) {
      b['hip' + S2].rotation.set(-1.38 * k, 0, s * 0.06 * k); b['kn' + S2].rotation.set(0.82 * k, 0, 0); b['an' + S2].rotation.set(0.56 * k, 0, 0); b['toe' + S2].rotation.set(0, 0, 0);
      // outboard (right) hand grips the hip-restraint handle, the other rests on his thigh; arms go up over jumps
      const grip = S2 === 'R';
      const sx = grip ? -0.02 : -0.55, sz = grip ? -0.2 : 0.04, el = grip ? -0.12 : -0.4, c = grip ? 1.05 : 0.6;
      b['sh' + S2].rotation.set((sx * k) * (1 - A) - 2.75 * A, 0, sz * k * (1 - A) + s * 0.3 * A);
      b['el' + S2].rotation.set(el * (1 - A) - 0.25 * A, 0, 0); b['wr' + S2].rotation.set(0, 0, 0);
      const cu = c * (1 - A) + 0.2 * A;
      for (let i = 0; i < 4; i++) { b[`f${i}a` + S2].rotation.set(0, 0, -s * cu * (0.8 + i * 0.1)); b[`f${i}b` + S2].rotation.set(0, 0, -s * cu * 1.1); }
      b['thA' + S2].rotation.set(-0.35 - cu * 0.4, 0, s * 0.3); b['thB' + S2].rotation.set(-cu * 0.5, 0, 0);
    }
    aimActuators(b, 'L'); aimActuators(b, 'R');
    r.group.getWorldPosition(_b); r.pos.set(_b.x, r.ground, _b.z); r.yaw = this.yaw();
  }
  jolt(mag, lx = 0, lz = 0) { const s = this.sway; s.vx += lx * mag * 0.5; s.vz += lz * mag * 0.5; s.vy -= mag * 0.03; }

  // ---------- per frame (before the build mode update); returns true while it owns input + camera ----------
  frame(dt, paused) {
    const g = this.g, inp = g.input, inBuild = g.mode === 'build' && !(g.intro && !g.intro.done);
    if (!inBuild) { if (this.driving) this.exit(true); this.hintEl.classList.remove('on'); return false; }
    if (paused) { this.hintEl.classList.remove('on'); return this.driving; }
    if (this.eHold && !inp.down('KeyE')) this.eHold = false;
    const cmd = this.touchCmd; this.touchCmd = null;
    if (this.driving) {
      if (inp.hit('KeyE') || inp.hit('Pad3') || cmd === 'exit') { inp.pressed.delete('Pad3'); this.exit(); }
    } else {
      const P = g.build.player, near = this.footDist(P.x, P.z) < 1.6 && !g.interact?.ctl;
      const show = near && !(g.interact?.hot);
      if (show) { const pad = inp.lastDevice === 'pad'; const h = `<kbd>${IS_TOUCH ? 'Tap' : pad ? '△' : 'E'}</kbd>Get in the golf cart`; if (this.hintEl.innerHTML !== h) this.hintEl.innerHTML = h; }
      this.hintEl.classList.toggle('on', show);
      if (near && (inp.hit('KeyE') || inp.hit('Pad3'))) { inp.pressed.delete('Pad3'); inp.pressed.delete('KeyE'); this.enter(); }
    }
    this.physics(dt, cmd);
    this.course.update(dt, playerFrame(g));
    if (this.driving) { this.camera(dt); return true; }
    return this.eHold;
  }
  // after Robots.update: robot jobs, the rider pose, boot kicks, and re-applying the cart camera over build.idle()
  late(dt) {
    const g = this.g;
    this.crew.update(dt);
    this.poseRider(dt);
    if (this.boarder) {
      this.boardT += dt; const r = this.boarder;
      if (r.broken || this.boardT > 40 || Math.hypot(r.pos.x - this.p.x, r.pos.z - this.p.z) > 60) this.cancelBoard();
      else if ((this._rt = (this._rt || 0) - dt) <= 0) { this._rt = 0.5; const s = this.sidePoint(); this.crew.retarget(r, s.x, s.z, this.yaw() + Math.PI / 2); }
    }
    if (g.mode === 'build') {
      const P = g.build.player;
      if (this.driving) { P.x = this.p.x; P.z = this.p.z; this.lastP = null; }
      else if (dt > 0) { if (this.lastP) this.course.kick(P.x, P.z, R_PLAYER + 0.05, (P.x - this.lastP.x) / dt, (P.z - this.lastP.z) / dt); this.lastP = { x: P.x, z: P.z }; }
    }
    if (this.driving && this.camShow) { this.w.camera.position.copy(this.camShow); this.w.camera.quaternion.copy(this.camQ); }
  }

  // ---------- controls + physics ----------
  controls(cmd) {
    const inp = this.g.input, k = c => inp.down(c) ? 1 : 0, pb = inp.pad?.b || [], L = inp.pad?.L || { x: 0 }, tm = inp.touchMove || { x: 0, y: 0 };
    const c = this.ctl;
    if (!this.driving) { c.drive = 0; c.brake = 0; c.hand = false; c.hold = true; c.thr = 0; this.steerIn = 0; return c; }
    const thr = Math.max(k('KeyW'), k('ArrowUp'), pb[7] || 0, IS_TOUCH ? Math.max(0, -tm.y) : 0);
    const back = Math.max(k('KeyS'), k('ArrowDown'), pb[6] || 0, IS_TOUCH ? Math.max(0, tm.y) : 0);
    c.hand = !!(k('Space') || (pb[0] || 0) > 0.5 || this.touchBrake);
    this.steerIn = clamp(k('KeyA') + k('ArrowLeft') - k('KeyD') - k('ArrowRight') - L.x - (IS_TOUCH ? tm.x : 0), -1, 1);
    _fw.set(0, 0, 1).applyQuaternion(this.q); const vf = this.v.dot(_fw);
    c.drive = 0; c.brake = 0; c.thr = 0;
    if (thr > 0.02) { if (vf < -0.5) c.brake = thr; else { c.drive = thr; c.thr = thr; } }
    else if (back > 0.02) { if (vf > 0.6) c.brake = back; else { c.drive = -back; c.thr = back; } }
    c.hold = !c.drive && !c.hand && Math.abs(vf) < 0.5;
    if (inp.hit('KeyR') || inp.hit('Pad1') || cmd === 'flip') this.flip();
    if (inp.hit('KeyC') || inp.hit('Pad2') || cmd === 'horn') this.horn();
    if (inp.hit('KeyV') || inp.hit('Pad11')) this.view = this.view === 'chase' ? 'seat' : 'chase';
    if (inp.hit('KeyL')) this.setLights(!this.lightsOn);
    if (this.keysDev !== inp.lastDevice) this.showKeys();
    return c;
  }
  horn() {
    const A = this.g.audio; A.tone(415, 0.15, 'square', 0.03, 0.12); A.tone(523, 0.2, 'square', 0.03, 0.12, 0.17);
    if (!this.passenger && !this.boarder) { if (this.callRobot(80)) this.g.toast('Calling a robot over…', 1600); }
  }
  flip() {
    _up.set(0, 1, 0).applyQuaternion(this.q);
    if (this.v.length() > 3 && _up.y > 0.5) return;
    const yaw = this.yaw(); this.q.setFromAxisAngle(V3(0, 1, 0), yaw);
    this.p.y = this.course.h(this.p.x, this.p.z) + COM.y + 0.35; this.v.set(0, 0, 0); this.w3.set(0, 0, 0);
    for (const w of this.wheels) w.comp = 0;
    this.g.audio.tone(300, 0.3, 'sine', 0.06, 0.2, 0, 1.2); this.course.sounds.play(['rattle_0', 'rattle_1'], 0.4, 1.1, 0.1);
    this.tipT = 0;
  }
  invIw(vec) { _qi.copy(this.q).invert(); return vec.applyQuaternion(_qi).multiply(INV_I).applyQuaternion(this.q); }
  impulse(J, pt) { this.v.addScaledVector(J, 1 / this.m); _r.subVectors(pt, this.p); _t.crossVectors(_r, J); this.w3.add(this.invIw(_t)); }
  kAt(pt, n) { _r.subVectors(pt, this.p); _t.crossVectors(_r, n); this.invIw(_t); return 1 / this.m + _t2.crossVectors(_t, _r).dot(n); }
  velAt(pt, out) { _r.subVectors(pt, this.p); return out.crossVectors(this.w3, _r).add(this.v); }

  physics(dt, cmd) {
    const ctl = this.controls(cmd);
    const moving = this.driving || this.v.lengthSq() > 0.0004 || this.w3.lengthSq() > 0.0004 || this.awake > 0;
    this.crashCd -= dt;
    if (moving) {
      this.awake = this.driving ? 1 : Math.max(0, (this.awake || 0) - dt);
      this._self = true; const all = playerFrame(this.g); this._self = false;
      const R = 3.2, obs = all.filter(o => Math.abs(o.x - this.p.x) < R + (o.r || o.hx || 0) && Math.abs(o.z - this.p.z) < R + (o.r || o.hz || 0));
      // full lock at walking pace, easing off with speed (as before up to ~12 m/s), then capped so the cornering
      // pull stays under ~1 g (lateral accel = v^2 * tan(steer) / wheelbase): steady and controllable at 65 mph
      const sp0 = this.v.length(), maxS = Math.min(0.62 - 0.42 * clamp(sp0 / V_STEER, 0, 1), Math.atan(LAT_MAX * 2.95 / Math.max(1, sp0 * sp0)));
      this.steer += (this.steerIn * maxS - this.steer) * (1 - Math.exp(-(this.steerIn ? 7 : 9) * dt));
      // substeps: at least 120 Hz, and never more than 20 cm of travel per step so fast runs can't tunnel through walls or props
      const n = Math.min(16, Math.max(Math.ceil(dt / (1 / 120)), Math.ceil(sp0 * dt / 0.2))), h = dt / n;
      this.vPrev.copy(this.v);
      this.impact = 0; this.hullHit = 0; this.roofHit = 0;
      for (let i = 0; i < n; i++) this.substep(h, ctl, obs);
      this.dynamics(dt);
      if (dt > 0) this.acc.subVectors(this.v, this.vPrev).divideScalar(dt);
      this.events(dt);
    } else this.acc.set(0, 0, 0);
    this.visuals(dt, ctl);
    if (this.driving) {
      const wantIn = insideHangar(this.p.x, this.p.z, this.w.indoor ? -0.4 : 1.0); if (wantIn !== this.w.indoor) this.w.setIndoor(wantIn);
      const sp = this.v.length(), slip = Math.max(...this.wheels.map(w => w.contact ? w.slip : 0));
      const onApron = this.p.x > APRON.x0 && this.p.x < APRON.x1 && this.p.z > APRON.z0 && this.p.z < APRON.z1;
      const surf = this.course.onRamp(this.p.x, this.p.z) ? 'metal' : (insideHangar(this.p.x, this.p.z, 0) || onApron) ? 'concrete' : 'gravel';
      this.sound.set(sp, ctl.thr, slip, surf);
      this.spdEl.textContent = Math.round(sp * 2.237);
    }
  }
  substep(h, ctl, obs) {
    const q = this.q, up = _up.set(0, 1, 0).applyQuaternion(q), G = this.course;
    const F = _a.set(0, -9.81 * this.m, 0), T = _b.set(0, 0, 0);
    const addF = (f, pt) => { F.add(f); _r.subVectors(pt, this.p); T.add(_t.crossVectors(_r, f)); };
    let grounded = 0; const nAvg = _c.set(0, 0, 0);
    _fw.set(0, 0, 1).applyQuaternion(q); const vfb = this.v.dot(_fw);
    for (const wh of this.wheels) {
      const Mw = this.toWorld(wh.mount.x, wh.mount.y, wh.mount.z, _d);
      if (up.y < 0.2) { wh.contact = false; wh.comp = 0; wh.ext = MOUNT_Y - L0; continue; }
      const gh = G.h(Mw.x, Mw.z), dist = (Mw.y - gh) / up.y, comp = L0 + WHEEL_R - dist;
      if (comp <= 0) { wh.contact = false; wh.comp = 0; wh.ext = MOUNT_Y - Math.min(L0, dist - WHEEL_R); continue; }
      const cc = Math.min(comp, MAXC + 0.06);
      let Fz = K_SUS * cc + C_SUS * (cc - wh.comp) / h; wh.comp = cc;
      if (comp > MAXC) Fz += 90000 * (comp - MAXC);
      Fz = clamp(Fz, 0, 40000); wh.contact = true; grounded++; wh.load = Fz; wh.ext = MOUNT_Y - (dist - WHEEL_R);
      const pc = _e.copy(Mw).addScaledVector(up, -dist), n = G.n(pc.x, pc.z, _n); nAvg.add(n);
      addF(_f.copy(up).multiplyScalar(Fz), Mw);
      const st = wh.front ? this.steer : 0;
      const fd = _g.set(Math.sin(st), 0, Math.cos(st)).applyQuaternion(q); fd.addScaledVector(n, -fd.dot(n)).normalize();
      const sd = _t2.crossVectors(n, fd);
      const vc = this.velAt(pc, V3()), vf = vc.dot(fd), vs = vc.dot(sd); wh.vf = vf;
      let Fl = 0;
      if (!wh.front && ctl.drive > 0) Fl += DRIVE_N * ctl.drive * Math.max(0, 1 - (clamp(vfb / VMAX, 0, 1)) ** 4);
      if (!wh.front && ctl.drive < 0) Fl += DRIVE_N * 0.75 * ctl.drive * Math.max(0, 1 - (clamp(-vfb / VREV, 0, 1)) ** 2);
      const sgn = Math.sign(vf), lowV = Math.min(1, Math.abs(vf) / 0.35);
      if (ctl.brake > 0) Fl -= sgn * lowV * 0.85 * Fz * ctl.brake;
      const hb = !wh.front && ctl.hand;
      if (hb) Fl -= sgn * lowV * 0.7 * Fz;
      Fl -= vf * (ctl.drive ? 3 : 24);
      if (ctl.hold) Fl -= sgn * Math.min(Fz * 0.6, Math.abs(vf) * Fz * 2.5);
      let Fs = -vs * Fz * 6;
      const lim = (hb ? 0.42 : 1.0) * Fz, tot = Math.hypot(Fl, Fs);
      wh.slip = tot > lim ? Math.min(2, Math.abs(vs) * 0.5 + (hb ? Math.abs(vf) * 0.15 : 0)) : 0;
      if (tot > lim) { Fl *= lim / tot; Fs *= lim / tot; }
      if (!wh.front && ctl.drive && tot > lim) wh.spinBoost = 1; else wh.spinBoost = 0;
      addF(_f.copy(fd).multiplyScalar(Fl).addScaledVector(sd, Fs), _g.copy(pc).addScaledVector(up, 0.24));
    }
    this.grounded = grounded;
    // light arcade stabiliser: keeps it level on its wheels unless a hit or a jump really throws it
    if (grounded >= 3) {
      nAvg.normalize(); const ax = _d.crossVectors(up, nAvg); T.addScaledVector(ax, 2400);
      _e.copy(this.w3).addScaledVector(up, -this.w3.dot(up)); T.addScaledVector(_e, -220);
    }
    F.addScaledVector(this.v, -0.35 * this.v.length());   // air drag (with the rolling drag above, it settles the top speed near 65 mph)
    this.v.addScaledVector(F, h / this.m); this.w3.add(this.invIw(T.multiplyScalar(h)));
    this.w3.multiplyScalar(1 - 0.15 * h);
    this.p.addScaledVector(this.v, h);
    const wl = this.w3.length(); if (wl > 1e-6) { _q.setFromAxisAngle(_d.copy(this.w3).divideScalar(wl), wl * h); q.premultiply(_q).normalize(); }
    this.contacts(obs);
  }
  // hull vs ground, then the footprint vs walls / props / fence
  contacts(obs) {
    const G = this.course; let deep = 0;
    for (const hp of this.hull) {
      const pt = _d.copy(hp.p).applyQuaternion(this.q).add(this.p), d = G.h(pt.x, pt.z) - pt.y; if (d <= 0) continue;
      if (d > deep) deep = d;
      const n = G.n(pt.x, pt.z, _n), vn = this.velAt(pt, _e).dot(n); if (vn >= 0) continue;
      if (-vn > this.hullHit) this.hullHit = -vn; if (hp.roof && -vn > this.roofHit) this.roofHit = -vn;
      const k = this.kAt(pt, n), jn = -(1 + 0.15) * vn / k; this.impulse(_f.copy(n).multiplyScalar(jn), pt);
      this.velAt(pt, _e); _e.addScaledVector(n, -_e.dot(n)); const vt = _e.length();
      if (vt > 1e-4) { const jt = Math.min(0.55 * jn, vt / k); this.impulse(_f.copy(_e).multiplyScalar(-jt / vt), pt); }
    }
    if (deep > 0) this.p.y += deep * 0.9;
    // footprint OBB in xz
    _fw.set(0, 0, 1).applyQuaternion(this.q); let fl = Math.hypot(_fw.x, _fw.z); if (fl < 0.2) return; const fx = _fw.x / fl, fz = _fw.z / fl, axx = fz, axz = -fx;
    const ctr = this.toWorld(0, 0, FOOT_C, _g), hx = FOOT.hx, hz = FOOT_HZ * Math.min(1, fl + 0.1);
    const hit = (nx, nz, d, px, pz) => {
      this.p.x += nx * d; this.p.z += nz * d;
      const pt = _d.set(px, this.p.y - 0.05, pz), n = _n.set(nx, 0, nz), vn = this.velAt(pt, _e).dot(n); if (vn >= 0) return;
      if (-vn > this.impact) { this.impact = -vn; this.impactN = { x: nx, z: nz }; }
      const k = this.kAt(pt, n), jn = -(1 + 0.32) * vn / k; this.impulse(_f.copy(n).multiplyScalar(jn), pt);
      this.velAt(pt, _e); _e.addScaledVector(n, -_e.dot(n)); const vt = _e.length();
      if (vt > 1e-4) { const jt = Math.min(0.3 * jn, vt / k); this.impulse(_f.copy(_e).multiplyScalar(-jt / vt), pt); }
    };
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [ctr.x + axx * hx * sx + fx * hz * sz, ctr.z + axz * hx * sx + fz * hz * sz]);
    for (const o of obs) {
      if (o.t === 'c') {
        const dx = o.x - ctr.x, dz = o.z - ctr.z, lx = dx * axx + dz * axz, lz = dx * fx + dz * fz;
        const qx = clamp(lx, -hx, hx), qz = clamp(lz, -hz, hz), ex = lx - qx, ez = lz - qz, dd = Math.hypot(ex, ez);
        if (dd >= o.r) continue;
        let nlx, nlz, d;
        if (dd > 1e-6) { nlx = -ex / dd; nlz = -ez / dd; d = o.r - dd; }
        else { const px = hx - Math.abs(lx), pz = hz - Math.abs(lz); if (px < pz) { nlx = -Math.sign(lx) || 1; nlz = 0; d = px + o.r; } else { nlx = 0; nlz = -Math.sign(lz) || 1; d = pz + o.r; } }
        hit(axx * nlx + fx * nlz, axz * nlx + fz * nlz, d, ctr.x + axx * qx + fx * qz, ctr.z + axz * qx + fz * qz);
      } else {
        // SAT: world x, world z, cart side axis, cart forward axis
        const dx = ctr.x - o.x, dz = ctr.z - o.z; let best = null;
        for (const [ux, uz, own] of [[1, 0, 0], [0, 1, 0], [axx, axz, 1], [fx, fz, 1]]) {
          const rC = hx * Math.abs(axx * ux + axz * uz) + hz * Math.abs(fx * ux + fz * uz), rB = o.hx * Math.abs(ux) + o.hz * Math.abs(uz), dist = dx * ux + dz * uz, ov = rC + rB - Math.abs(dist);
          if (ov <= 0) { best = null; break; }
          if (!best || ov < best.ov) best = { ov, nx: ux * (Math.sign(dist) || 1), nz: uz * (Math.sign(dist) || 1), own };
          if (ov <= 0) break;
        }
        if (!best) continue;
        let px, pz;
        if (!best.own) { let m = 1e9; for (const [cx, cz] of corners) { const s = cx * best.nx + cz * best.nz; if (s < m) { m = s; px = cx; pz = cz; } } }
        else { let m = -1e9; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const cx = o.x + sx * o.hx, cz = o.z + sz * o.hz, s = cx * best.nx + cz * best.nz; if (s > m) { m = s; px = cx; pz = cz; } } }
        hit(best.nx, best.nz, best.ov, px, pz);
      }
    }
    // perimeter fence (and the closed gate)
    const F = FENCE, m = 0.5;
    for (const [cx, cz] of corners) {
      if (cx < F.x0 + m) hit(1, 0, F.x0 + m - cx, cx, cz); else if (cx > F.x1 - m) hit(-1, 0, cx - F.x1 + m, cx, cz);
      if (cz < F.z0 + m) hit(0, 1, F.z0 + m - cz, cx, cz); else if (cz > F.z1 - m) hit(0, -1, cz - F.z1 + m, cx, cz);
    }
  }
  // robots and loose bodies (two-body pushes), once per frame
  dynamics(dt) {
    _fw.set(0, 0, 1).applyQuaternion(this.q); const fl = Math.hypot(_fw.x, _fw.z); if (fl < 0.2) return;
    const fx = _fw.x / fl, fz = _fw.z / fl, axx = fz, axz = -fx, ctr = this.toWorld(0, 0, FOOT_C, V3()), hx = FOOT.hx, hz = FOOT_HZ;
    const circle = (x, z, r) => {
      const dx = x - ctr.x, dz = z - ctr.z; if (Math.abs(dx) > 2 + r || Math.abs(dz) > 2 + r) return null;
      const lx = dx * axx + dz * axz, lz = dx * fx + dz * fz, qx = clamp(lx, -hx, hx), qz = clamp(lz, -hz, hz), ex = lx - qx, ez = lz - qz, dd = Math.hypot(ex, ez);
      if (dd >= r) return null;
      let nlx, nlz, d; if (dd > 1e-6) { nlx = -ex / dd; nlz = -ez / dd; d = r - dd; } else { const px = hx - Math.abs(lx), pz = hz - Math.abs(lz); if (px < pz) { nlx = -Math.sign(lx) || 1; nlz = 0; d = px + r; } else { nlx = 0; nlz = -Math.sign(lz) || 1; d = pz + r; } }
      return { nx: axx * nlx + fx * nlz, nz: axz * nlx + fz * nlz, d, px: ctr.x + axx * qx + fx * qz, pz: ctr.z + axz * qx + fz * qz };
    };
    const bottom = this.p.y - 0.46, top = this.p.y + 1.45;
    for (const b of this.course.bodies) {
      if (b.frozen || b.p.y + b.half.y < bottom || b.p.y - b.half.y > top) continue;
      const c = circle(b.p.x, b.p.z, b.r); if (!c) continue;
      const pt = V3(c.px, b.p.y, c.pz), n = V3(c.nx, 0, c.nz);
      const share = this.m / (this.m + b.m); b.p.x -= c.nx * c.d * share; b.p.z -= c.nz * c.d * share; this.p.x += c.nx * c.d * (1 - share); this.p.z += c.nz * c.d * (1 - share);
      const vn = this.velAt(pt, _e).sub(b.v).dot(n); if (vn >= 0) continue;
      const j = -(1 + 0.3) * vn / (this.kAt(pt, n) + 1 / b.m);
      this.impulse(_f.copy(n).multiplyScalar(j), pt);
      const dv = j / b.m; b.wake(); b.v.addScaledVector(n, -dv); b.v.y += Math.min(4, dv * 0.3 + (b.kind === 'cone' ? 0.6 : 0.2));
      b.w.x += -c.nz * dv * 3 + (Math.random() - 0.5) * dv; b.w.z += c.nx * dv * 3 + (Math.random() - 0.5) * dv; b.w.y += (Math.random() - 0.5) * dv * 2;
      b.bang = Math.max(b.bang, -vn);
      if (b.kind === 'piece' || b.kind === 'barrel') this.bumpFx(-vn * 0.5);
    }
    for (const r of this.crew.list) {
      if (r.broken || r.seat || !r.group.visible || (r.group.parent !== this.crew.out && !r.group.parent?.visible)) continue;
      const c = circle(r.pos.x, r.pos.z, 0.32); if (!c) continue;
      const pt = V3(c.px, this.p.y, c.pz), n = V3(c.nx, 0, c.nz), vn = this.velAt(pt, _e).dot(n);
      r.pos.x -= c.nx * c.d; r.pos.z -= c.nz * c.d;
      if (vn >= -0.25) continue;
      if (-vn > 4.2) {
        const j = -vn / (this.kAt(pt, n) + 1 / 30) * 0.6; this.impulse(_f.copy(n).multiplyScalar(j), pt);
        this.crew.break(r, V3(this.v.x * 0.9, 1.5, this.v.z * 0.9)); this.shake = Math.max(this.shake, 0.18); this.jolt(-vn * 0.25, c.nx, 0);
      } else if ((r._kcd || 0) < performance.now()) {
        r._kcd = performance.now() + 500;
        const j = -(1 + 0.2) * vn / (this.kAt(pt, n) + 1 / M_ROBOT); this.impulse(_f.copy(n).multiplyScalar(j), pt);
        const kv = Math.min(2.8, j / M_ROBOT * 1.2 + 0.4); this.crew.knock(r, -c.nx * kv, -c.nz * kv);
        this.bumpFx(-vn * 0.6);
      }
    }
  }
  bumpFx(v) { if (v < 0.6 || this.crashCd > 0) return; this.crashCd = 0.12; this.shake = Math.max(this.shake, Math.min(0.12, v * 0.03)); this.course.sounds.play(['thud_0'], clamp(v / 6, 0.1, 0.6), 1.2, 0.1); }
  events(dt) {
    const A = this.g.audio, S = this.course.sounds;
    if (this.impact > 1.2 && this.crashCd <= 0) {
      const v = this.impact, k = clamp(v / 9, 0.08, 1); this.crashCd = 0.15;
      S.play(['thud_0'], 0.35 + 0.6 * k, 0.9, 0.2);
      if (v > 3) { S.play(['metal_h_0', 'metal_h_1', 'plate_h_0', 'plate_h_1'], 0.25 + 0.6 * k, 0.85, 0.3); A.noise(0.18, 900, 0.7, 0.25 * k, 0, 'lowpass', 0.2); }
      if (v > 6) S.play(['rattle_0', 'rattle_1'], 0.6 * k, 0.9, 0.2);
      A.tone(70, 0.3, 'sine', 0.22 * k, 0.15, 0, 0.5);
      this.shake = Math.max(this.shake, Math.min(0.45, v * 0.045));
      _qi.copy(this.q).invert(); const ln = V3(this.impactN.x, 0, this.impactN.z).applyQuaternion(_qi); this.jolt(v, ln.x, ln.z);
      if (v > 12 && this.passenger) this.throwRider();   // scaled with the higher top speed: ordinary knocks keep him seated
    }
    if (this.hullHit > 2.2 && this.crashCd <= 0) {
      const k = clamp(this.hullHit / 8, 0.1, 1); this.crashCd = 0.15; S.play(['thud_0'], 0.4 + 0.5 * k, 0.75, 0.2); S.play(['plate_m_0', 'plate_m_1'], 0.3 * k, 0.9, 0.2);
      this.shake = Math.max(this.shake, Math.min(0.35, this.hullHit * 0.04)); this.jolt(this.hullHit * 0.5, 0, 0);
      if ((this.roofHit > 1.5 || this.hullHit > 11) && this.passenger) this.throwRider();
    }
    // landing thump from the suspension bottoming out
    const bottomed = this.wheels.some(w => w.comp > MAXC);
    if (bottomed && this.air > 0.25 && this.crashCd <= 0) { this.crashCd = 0.2; S.play(['thud_0'], 0.5, 0.8, 0.15); S.play(['rattle_0', 'rattle_1'], 0.35, 1.2, 0.1); this.shake = Math.max(this.shake, 0.12); this.jolt(4, 0, 0); }
    this.air = this.grounded ? 0 : this.air + dt;
    _up.set(0, 1, 0).applyQuaternion(this.q);
    if (_up.y < 0 && this.passenger && this.v.length() < 6) this.throwRider();
    this.tipT = _up.y < 0.45 && this.v.length() < 1.5 ? this.tipT + dt : 0;
    if (this.p.y < -4) this.flip();
  }
  throwRider() {
    const r = this.passenger; if (!r) return;
    this.crew.break(r, V3(this.v.x, Math.max(2, this.v.y + 2), this.v.z));
  }
  visuals(dt, ctl) {
    for (const wh of this.wheels) {
      const n = wh.node; n.pivot.position.y = clamp(wh.ext, MOUNT_Y - L0, MOUNT_Y - (L0 - MAXC) + 0.02);
      if (wh.front) n.pivot.rotation.y = this.steer;
      const locked = !wh.front && ctl.hand && this.driving;
      if (!locked) wh.spin += ((wh.contact ? wh.vf : wh.spinV || 0) / WHEEL_R + (wh.spinBoost ? 14 : 0)) * dt;
      wh.spinV = wh.contact ? wh.vf : (wh.spinV || 0) * Math.exp(-0.4 * dt);
      n.spin.rotation.x = wh.spin;
    }
    this.swheel.rotation.z = -this.steer * 5.5;
    const braking = this.driving && (ctl.brake > 0 || ctl.hand);
    if (this.driving) this.setLightLevels(this.lightsOn ? 2.2 : 0, braking ? 3.2 : this.lightsOn ? 0.8 : 0);
    // tipped-over helper prompt
    if (this.driving) {
      const show = this.tipT > 1.2, pad = this.g.input.lastDevice === 'pad';
      if (show) { const h = `<kbd>${IS_TOUCH ? 'Flip' : pad ? '○' : 'R'}</kbd>Tipped over: flip back on four wheels`; if (this.hintEl.innerHTML !== h) this.hintEl.innerHTML = h; }
      this.hintEl.classList.toggle('on', show);
    }
  }

  // ---------- chase / seat camera ----------
  camera(dt) {
    const inp = this.g.input, cam = this.w.camera, O = this.orbit, sp = this.v.length();
    const yaw = this.yaw();
    if (inp.look.x || inp.look.y) { O.yaw -= inp.look.x; O.pitch = clamp(O.pitch + inp.look.y * 0.8, -0.15, 1.1); O.idle = 0; } else O.idle += dt;
    if (O.idle > 1.4 && sp > 1.5) { O.yaw *= Math.exp(-1.6 * dt); O.pitch += (0.3 - O.pitch) * (1 - Math.exp(-1.2 * dt)); }
    O.yaw = wrapA(O.yaw);
    if (inp.zoom) O.dist = clamp(O.dist + inp.zoom * 0.6, 3.6, 13);
    let pos, look;
    if (this.view === 'seat') {
      pos = this.toWorld(DRIVER_EYE.x, DRIVER_EYE.y, DRIVER_EYE.z, _ca);
      const a = yaw + O.yaw, pitch = O.pitch - 0.3; look = _cb.set(pos.x + Math.sin(a) * Math.cos(pitch) * 10, pos.y - Math.sin(pitch) * 10, pos.z + Math.cos(a) * Math.cos(pitch) * 10);
      this.camPos.copy(pos);
    } else {
      const target = _ca.set(this.p.x, this.p.y + 0.85, this.p.z), a = yaw + O.yaw, d = O.dist + Math.min(sp, 30) * 0.08;
      const want = _cb.set(target.x - Math.sin(a) * Math.cos(O.pitch) * d, target.y + Math.sin(O.pitch) * d + 0.5, target.z - Math.cos(a) * Math.cos(O.pitch) * d);
      // keep the camera inside the hangar walls / closed doors and above the ground
      const walls = hangarWalls().concat(doorObstacles(this.g)); let k = 1;
      for (let i = 1; i <= 14; i++) {
        const t = i / 14, x = target.x + (want.x - target.x) * t, z = target.z + (want.z - target.z) * t;
        if (walls.some(o => pen(x, z, 0.35, o))) { k = Math.max(0.12, (i - 1) / 14); break; }
      }
      want.lerpVectors(target, want, k); want.y = Math.max(want.y, this.course.h(want.x, want.z) + 0.4);
      if (this.camBlend < 1) { this.camBlend = Math.min(1, this.camBlend + dt / 0.7); this.camPos.lerp(want, smooth(this.camBlend) * 0.35 + 0.05); }
      else this.camPos.lerp(want, 1 - Math.exp(-8 * dt));
      look = target.addScaledVector(_fw.set(Math.sin(yaw), 0, Math.cos(yaw)), 1.2);
    }
    this.shake *= Math.exp(-6 * dt);
    cam.position.copy(this.camPos);
    if (this.shake > 0.002) cam.position.add(_cc.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(this.shake));
    cam.lookAt(look);
    const fov = 68 + clamp(sp, 0, 30) * 0.3; if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * (1 - Math.exp(-3 * dt)); cam.updateProjectionMatrix(); }
    (this.camShow ||= V3()).copy(cam.position); this.camQ.copy(cam.quaternion);
  }
}
