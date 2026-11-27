// Hands-on hangar (Window Workshop style): hover anything with a glow, click / tap / Ⓐ to use it.
// Owns the shared plumbing: hit proxies + hover glow + hints, soft ASMR sounds, camera hand-off for
// "sit at" controls, plus the bay doors (wall lever), light switches and CC0 set dressing.
// The crane, console and fueling live in crane.js, console.js and fueling.js.
import * as THREE from 'three';
import { HANGAR, IS_TOUCH } from './env.js';
import { height } from './terrain.js';
import { applyPBR } from './tex.js';
import { prop } from './models.js';
import { Crane } from './crane.js';
import { Console } from './console.js';
import { Fueling } from './fueling.js';

const H = HANGAR, UP = new THREE.Vector3(0, 1, 0);
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const GLOW = new THREE.Color(0x5fd7ff);
export const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });

const CSS = `
#ixHint{position:absolute;z-index:30;pointer-events:none;transform:translate(-50%,0);padding:6px 12px;border-radius:999px;background:rgba(12,18,26,.72);border:1px solid rgba(127,231,255,.45);color:#e8f8ff;font:600 13px/1.2 system-ui,sans-serif;letter-spacing:.2px;white-space:nowrap;backdrop-filter:blur(6px);opacity:0;transition:opacity .15s}
#ixHint.on{opacity:1}#ixHint kbd{display:inline-block;min-width:18px;padding:1px 6px;margin-right:6px;border-radius:6px;background:rgba(127,231,255,.18);border:1px solid rgba(127,231,255,.5);font:700 11px system-ui}
.ixRipple{position:absolute;z-index:31;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2px solid rgba(127,231,255,.9);animation:ixR .45s ease-out forwards}
@keyframes ixR{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
#ixCursor{position:absolute;z-index:31;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #7fe7ff;box-shadow:0 0 10px #2fb7ff;display:none}
.ixPanel{position:fixed;z-index:40;display:none;gap:8px;align-items:center;font:600 13px system-ui,sans-serif;color:#e8f8ff}
.ixPanel.ixCrane{left:50%;right:auto;top:auto;bottom:calc(18px + var(--sb, 0px));transform:translateX(-50%);flex-wrap:wrap;justify-content:center;max-width:96vw;margin:0}
.ixPanel button{min-width:54px;min-height:54px;border-radius:14px;border:1px solid rgba(127,231,255,.4);background:rgba(12,18,26,.72);color:#e8f8ff;font:700 15px system-ui;touch-action:none;user-select:none;-webkit-user-select:none;backdrop-filter:blur(6px)}
.ixPanel button:active,.ixPanel button.held{background:rgba(47,183,255,.45)}
.ixPanel .tip{padding:6px 12px;border-radius:10px;background:rgba(12,18,26,.6);font-size:12px;font-weight:500;opacity:.9}
body.ixCtl #tray,body.ixCtl #standCtl,body.ixCtl #checkout,body.ixCtl #crosshair,body.ixCtl #aimReason{display:none!important}
#ixPill{position:absolute;z-index:29;left:50%;top:76px;transform:translateX(-50%);display:none;padding:8px 14px;border-radius:12px;background:rgba(12,18,26,.72);border:1px solid rgba(127,231,255,.35);color:#e8f8ff;font:600 13px system-ui;min-width:190px;text-align:center}
#ixPill .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:6px;overflow:hidden}#ixPill .bar i{display:block;height:100%;background:linear-gradient(90deg,#7fe7ff,#bff6ff);width:0}
#ixAbort{position:absolute;z-index:29;right:14px;top:42%;display:none;min-width:92px;min-height:64px;border-radius:14px;border:2px solid #e8b21c;background:repeating-linear-gradient(45deg,rgba(232,178,28,.25) 0 8px,rgba(20,20,20,.5) 8px 16px);color:#fff;font:800 14px system-ui;letter-spacing:1px}
#ixAbort.armed{background:#c8241b;border-color:#ff6a5f;box-shadow:0 0 24px rgba(255,60,40,.6)}
`;

// ---------- soft sounds through the game's SFX bus ----------
export class Sfx {
  constructor(audio) { this.a = audio; }
  hover() { this.a.tone(1750, 0.045, 'sine', 0.022, 0.15); }
  tapFx() { this.a.tone(1100, 0.06, 'sine', 0.05, 0.2); this.a.noise(0.025, 3500, 2, 0.03); }
  click() { this.a.tone(2600, 0.02, 'square', 0.018, 0.08); this.a.noise(0.02, 4200, 3, 0.07, 0, 'bandpass', 0.08); this.a.tone(170, 0.05, 'sine', 0.06, 0); }
  clunk(big = 1) { this.a.noise(0.3 * big, 240, 0.8, 0.32 * Math.min(1.3, big), 0, 'lowpass', 0.45); this.a.tone(62, 0.45 * big, 'sine', 0.24 * Math.min(1.3, big), 0.3, 0, 0.6); this.a.tone(1250, 0.14, 'sine', 0.018, 0.5, 0.02); }
  lever() { this.a.noise(0.16, 1100, 1.4, 0.07, 0, 'bandpass', 0.2); this.a.tone(300, 0.1, 'triangle', 0.035, 0.2, 0, 0.7); this.clunk(0.45); }
  button() { this.a.tone(140, 0.07, 'sine', 0.12, 0.1); this.a.noise(0.03, 1800, 1, 0.06, 0, 'bandpass', 0.05); }
  chime(n = 2) { for (let i = 0; i < n; i++) this.a.tone(660 * Math.pow(1.5, i), 0.35, 'sine', 0.05, 0.45, i * 0.14); }
  alarm() { for (let i = 0; i < 3; i++) { this.a.tone(740, 0.22, 'triangle', 0.07, 0.3, i * 0.5); this.a.tone(560, 0.22, 'triangle', 0.07, 0.3, i * 0.5 + 0.25); } }
  // continuous beds: rumble (heavy doors), motor (crane), hiss (venting cryo)
  loop(type) {
    const c = this.a.ctx; if (!c || !this.a.noiseBuf) return { set() {}, stop() {} };
    const src = c.createBufferSource(); src.buffer = this.a.noiseBuf; src.loop = true; src.playbackRate.value = type === 'hiss' ? 1 : 0.7;
    const f = c.createBiquadFilter(); f.type = { rumble: 'lowpass', motor: 'bandpass', hiss: 'highpass' }[type]; f.frequency.value = { rumble: 150, motor: 380, hiss: 2600 }[type]; f.Q.value = type === 'motor' ? 2.2 : 0.7;
    const g = c.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(this.a.sfx);
    let osc = null;
    if (type !== 'hiss') { osc = c.createOscillator(); osc.type = type === 'rumble' ? 'sine' : 'sawtooth'; osc.frequency.value = type === 'rumble' ? 41 : 57; const og = c.createGain(); og.gain.value = type === 'rumble' ? 0.55 : 0.05; osc.connect(og); og.connect(type === 'motor' ? f : g); osc.start(); }
    src.start(0, Math.random());
    const peak = { rumble: 0.5, motor: 0.16, hiss: 0.05 }[type]; let dead = false;
    return {
      set: v => { if (!dead) g.gain.setTargetAtTime(peak * Math.max(0, v), c.currentTime, 0.12); },
      pitch: p => { if (osc) osc.frequency.setTargetAtTime((type === 'rumble' ? 41 : 57) * p, c.currentTime, 0.2); },
      stop: () => { if (dead) return; dead = true; g.gain.setTargetAtTime(0, c.currentTime, 0.2); setTimeout(() => { try { src.stop(); osc?.stop(); } catch (_) {} }, 1500); },
    };
  }
}

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
export function labelTex(lines, { w = 512, h = 128, bg = 'rgba(0,0,0,0)', fg = '#ffffff', font = 'bold', stroke = null } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach(([t, s], i) => { g.font = `${font} ${s}px Arial`; g.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * s * 1.2); });
  });
}
export function hazardTex() {
  const t = canvasTex(256, 64, (c, w, h) => { c.fillStyle = '#e0a816'; c.fillRect(0, 0, w, h); c.fillStyle = '#16171a'; for (let x = -h; x < w + h; x += 48) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 24, h); c.lineTo(x + 24 + h, 0); c.lineTo(x + h, 0); c.fill(); } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function hitBox(w, h, d) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIT_MAT); m.castShadow = m.receiveShadow = false; return m; }
export function led(color) { return new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0, roughness: 0.3 })); }

export class Interactive {
  constructor(game) {
    this.g = game; this.w = game.world; this.sfx = new Sfx(game.audio);
    this.lite = this.w.quality === 'phone' || this.w.quality === 'low';
    this.group = new THREE.Group(); this.group.name = 'interactive'; this.w.hangar.add(this.group);
    this.items = []; this.proxies = []; this.ray = new THREE.Raycaster(); this.hot = null; this.ctl = null; this.returning = null;
    this.pad = { x: innerWidth / 2, y: innerHeight / 2 };
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const mk = (id, cls) => { const d = document.createElement(cls === 'button' ? 'button' : 'div'); d.id = id; document.body.appendChild(d); return d; };
    this.hint = mk('ixHint'); this.cursorEl = mk('ixCursor'); this.pill = mk('ixPill');
    this.doors = new Doors(this); this.lights = new Lights(this);
    this.crane = new Crane(this); this.console = new Console(this); this.fuel = new Fueling(this);
  }
  async load() {
    const jobs = [this.doors.build(), this.lights.build(), this.crane.load(), this.console.load(), this.fuel.load(), this.dress()];
    await Promise.all(jobs.map(j => Promise.resolve(j).catch(e => console.warn('interactive', e?.message || e))));
    this.ready = true;
  }

  // ---------- registry ----------
  // it = { hit: Object3D (invisible proxy meshes), glow: [Object3D], label: () => string, use: () => {}, range, enabled: () => bool }
  add(it) {
    it.range ??= 4; it.glowT = 0; it.mats = [];
    it.hit.traverse(o => { if (o.isMesh) { o.userData.ix = it; this.proxies.push(o); } });
    for (const g of it.glow || []) this.glowify(it, g);
    this.items.push(it); return it;
  }
  glowify(it, obj) {
    obj.traverse(o => {
      if (!o.isMesh || !o.material || o.material === HIT_MAT) return;
      const ms = [].concat(o.material).map(m => { if (!m.emissive) return m; const c = m.userData.ixClone ? m : m.clone(); c.userData.ixClone = true; it.mats.push({ m: c, e: c.emissive.clone(), ei: c.emissiveIntensity }); return c; });
      o.material = Array.isArray(o.material) ? ms : ms[0];
    });
  }
  pick(xy) {
    const v = xy ? new THREE.Vector2(xy.x / innerWidth * 2 - 1, -(xy.y / innerHeight) * 2 + 1) : new THREE.Vector2();
    this.ray.setFromCamera(v, this.w.camera); this.ray.far = 60;
    const live = this.proxies.filter(p => { const it = p.userData.ix; return it.enabled?.() !== false && (!it.ctlOnly || this.ctl === it.ctlOnly) && !(it.notIn && this.ctl === it.notIn); });
    for (const h of this.ray.intersectObjects(live, false)) { const it = h.object.userData.ix; if (h.distance <= it.range) return it; }
    return null;
  }
  setHot(it, xy) {
    if (it !== this.hot) { this.hot = it; if (it) this.sfx.hover(); this.g.world.renderer.domElement.style.cursor = it ? 'pointer' : ''; }
    const h = this.hint;
    if (!it) { h.classList.remove('on'); return; }
    const inp = this.g.input, dev = IS_TOUCH ? 'touch' : inp.lastDevice === 'pad' ? 'pad' : 'kb';
    const key = dev === 'touch' ? 'Tap' : dev === 'pad' ? 'Ⓐ' : 'Click';
    const html = `<kbd>${key}</kbd>${it.label()}`; if (h.innerHTML !== html) h.innerHTML = html;
    const p = xy || (this.ctl === this.console && dev === 'pad' ? this.pad : { x: innerWidth / 2, y: innerHeight / 2 });
    h.style.left = p.x + 'px'; h.style.top = (p.y + 26) + 'px'; h.classList.add('on');
  }
  ripple(xy) { const d = document.createElement('div'); d.className = 'ixRipple'; const p = xy || { x: innerWidth / 2, y: innerHeight / 2 }; d.style.left = p.x + 'px'; d.style.top = p.y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 500); }
  use(it, xy) { this.ripple(xy); it.use(xy); it.glowT = 1.6; }

  // ---------- "sit at" controls: camera hand-off ----------
  take(ctl) {
    if (this.ctl === ctl) return;
    const cam = this.w.camera; this.g.input.exitLock(); this.ctl = ctl; this.camT = 0; this.returning = null;
    this.camFrom = { p: cam.position.clone(), q: cam.quaternion.clone() };
    document.body.classList.add('ixCtl'); ctl.onTake?.();
  }
  release(instant = false) {
    const c = this.ctl; if (!c) return; this.ctl = null; c.onRelease?.(); document.body.classList.remove('ixCtl'); this.cursorEl.style.display = 'none';
    const cam = this.w.camera;
    this.returning = instant ? null : { p: cam.position.clone(), q: cam.quaternion.clone(), t: 0 };
  }
  eatEscape() { if (this.ctl && this.g.mode === 'build') { this.release(); this.sfx.tapFx(); return true; } return false; }
  updateCam(dt) {
    const cam = this.w.camera, m = new THREE.Matrix4(), q = new THREE.Quaternion();
    if (this.ctl) {
      const pose = this.ctl.camPose(dt); m.lookAt(pose.pos, pose.look, UP); q.setFromRotationMatrix(m);
      this.camT = Math.min(1, this.camT + dt / 0.85); const k = ease(this.camT);
      cam.position.lerpVectors(this.camFrom.p, pose.pos, k); cam.quaternion.slerpQuaternions(this.camFrom.q, q, k);
      return true;
    }
    if (this.returning) {
      const r = this.returning, P = this.g.build.player; r.t = Math.min(1, r.t + dt / 0.6); const k = ease(r.t);
      q.setFromEuler(new THREE.Euler(P.pitch, P.yaw, 0, 'YXZ'));
      cam.position.lerpVectors(r.p, new THREE.Vector3(P.x, 1.65 + height(P.x, P.z), P.z), k); cam.quaternion.slerpQuaternions(r.q, q, k);
      if (r.t >= 1) this.returning = null;
      return true;
    }
    return false;
  }

  // ---------- per frame (called by the game loop); returns true while it owns the camera / input ----------
  frame(dt, paused) {
    const g = this.g, inBuild = g.mode === 'build' && !(g.intro && !g.intro.done);
    if (!inBuild) { if (this.ctl) this.release(true); this.returning = null; this.doors.forceOpen(); this.lights.reset(); }
    if (paused && this.ctl) this.release(true);
    const active = inBuild && !paused && !g.resultsOpen && this.ready;
    this.doors.update(dt); this.lights.update(dt, inBuild);
    this.crane.update(dt, active && this.ctl === this.crane);
    this.console.update(dt, inBuild, active);
    this.fuel.update(dt, inBuild, active);
    const t = performance.now() / 1000;
    for (const it of this.items) {
      const tgt = it === this.hot ? 1 : 0; it.glowT += (tgt - it.glowT) * Math.min(1, dt * (it.glowT > 1 ? 4 : 10));
      if (it.mats.length && (it.glowT > 0.002 || it._gl)) {
        it._gl = it.glowT > 0.002; const k = it._gl ? Math.min(1.6, it.glowT) * (0.8 + 0.2 * Math.sin(t * 5)) : 0;
        for (const { m, e, ei } of it.mats) { m.emissive.copy(e).lerp(GLOW, Math.min(1, k * 0.3)); m.emissiveIntensity = ei + k * 0.5; }
      }
    }
    if (!active) { this.setHot(null); return false; }
    const owned = this.updateCam(dt);
    if (this.ctl === this.crane) { this.setHot(null); this.crane.control(dt); return true; }
    if (this.returning) { this.setHot(null); return true; }
    // aim: cursor when the mouse is free, a virtual cursor for pads at the console, else screen centre
    const inp = g.input; let xy = null;
    if (this.ctl === this.console) {
      if (inp.lastDevice === 'pad') {
        this.pad.x = THREE.MathUtils.clamp(this.pad.x + inp.move.x * 700 * dt, 10, innerWidth - 10); this.pad.y = THREE.MathUtils.clamp(this.pad.y + inp.move.y * 700 * dt, 10, innerHeight - 10);
        xy = this.pad; this.cursorEl.style.display = 'block'; this.cursorEl.style.left = xy.x + 'px'; this.cursorEl.style.top = xy.y + 'px';
      } else { this.cursorEl.style.display = 'none'; if (!IS_TOUCH) xy = { x: inp.mouse.x, y: inp.mouse.y }; }
    } else if (!IS_TOUCH && !inp.locked && inp.lastDevice !== 'pad' && !g.build.dragging) xy = { x: inp.mouse.x, y: inp.mouse.y };
    const hot = IS_TOUCH && this.ctl ? null : this.pick(xy);
    this.setHot(hot, xy);
    let used = false;
    const tap = inp.taps[0];
    if (tap) { const it = this.pick(tap); if (it) { inp.taps.shift(); this.use(it, tap); used = true; } else if (this.ctl) inp.taps.shift(); }
    if (!used && hot && (inp.mouse.clicked || inp.hit('Pad0') || inp.hit('Enter'))) { inp.mouse.clicked = false; inp.pressed.delete('Pad0'); inp.pressed.delete('Enter'); this.use(hot, xy); }
    if (this.ctl === this.console) { if (inp.hit('Pad1') || inp.hit('KeyX')) this.release(); inp.mouse.clicked = false; return true; }
    return owned;
  }

  // ---------- CC0 Poly Haven set dressing ----------
  async dress() {
    const g = new THREE.Group(); g.name = 'ixDress'; this.group.add(g);
    const at = (o, x, y, z, ry = 0, s = 1) => { o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); g.add(o); return o; };
    const jobs = [
      prop('worn_metal_rack').then(o => { at(o, 21.25, 0, -10.2, -Math.PI / 2); at(o.clone(), 21.25, 0, -11.25, -Math.PI / 2); }),
      prop('plastic_crate_02').then(o => { at(o, 20.1, 0, -12.6, 0.2); at(o.clone(), 20.1, 0.255, -12.6, 0.12); at(o.clone(), 19.5, 0, -12.1, 1.4); }),
      prop('barrel_03').then(o => { at(o, -14.4, 0, 4.9, 0.3); at(o.clone(), -15.1, 0, 4.2, 1.1); at(o.clone(), -14.3, 0, 3.7, 2.2); }),
      prop('hanging_industrial_lamp').then(o => { at(o, 9, 4.2, 5, 0); this.cord(g, 9, 4.2 + o.userData.size.y, 5); }),
    ];
    if (!this.lite) jobs.push(
      prop('industrial_storage_cart').then(o => at(o, 12.6, 0, -10.2, 0.45)),
      prop('portable_welding_cart').then(o => at(o, -9.9, 0, 9.3, 2.6)),
    );
    await Promise.all(jobs.map(j => j.catch(e => console.warn('dress', e.message))));
  }
  cord(g, x, y, z) { const yB = H.h - 3.8; const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, yB - y, 4), this.w.M?.darkMatte || new THREE.MeshStandardMaterial({ color: 0x111111 })); c.position.set(x, (y + yB) / 2, z); g.add(c); }
}

// ---------- bay doors: two painted-steel leaves on a top track, driven by a wall lever ----------
class Doors {
  constructor(ix) { this.ix = ix; this.target = 1; this.t = 1; this.from = 1; this.u = 1; this.leaves = []; }
  async build() {
    const ix = this.ix, root = new THREE.Group(); root.name = 'bayDoors'; ix.group.add(root); this.root = root;
    const w = H.door + 0.25, h = H.doorH + 0.5, z = -H.z - 0.75; this.z = z;
    const skin = new THREE.MeshStandardMaterial({ color: 0xd7dde2, metalness: 0.35, roughness: 0.5 });
    applyPBR(skin, 'painted_metal_shutter', [w / 3, h / 3], { normalScale: 1.1 }).catch(() => {});
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.75, roughness: 0.4 });
    const rub = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.82, metalness: 0 });
    const haz = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.55 }); haz.map.repeat.set(1.4, 1);
    for (const s of [-1, 1]) {
      const leaf = new THREE.Group(); root.add(leaf);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.32), skin); body.position.y = h / 2; body.castShadow = body.receiveShadow = true; leaf.add(body);
      for (let i = 0; i <= 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.14), steel); r.position.set(-w / 2 + 0.11 + i * (w - 0.22) / 4, h / 2, 0.23); r.castShadow = true; leaf.add(r); }   // inside stiffeners
      for (const y of [0.25, h * 0.36, h * 0.68, h - 0.3]) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 0.12), steel); r.position.set(0, y, 0.22); leaf.add(r); }
      const seal = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.4), rub); seal.position.y = 0.06; leaf.add(seal);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.42), rub); edge.position.set(-s * (w / 2 - 0.08), h / 2, 0); leaf.add(edge);   // leading-edge bumper
      for (const zz of [0.17, -0.17]) { const hz = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.9), haz); hz.position.set(0, 1.0, zz + Math.sign(zz) * 0.001); hz.rotation.y = zz > 0 ? 0 : Math.PI; leaf.add(hz); }
      const truck = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.5, 0.5), steel); truck.position.y = h + 0.25; leaf.add(truck);
      for (const x of [-w * 0.35, w * 0.35]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16), steel); wh.rotation.x = Math.PI / 2; wh.position.set(x, h + 0.55, 0); leaf.add(wh); }
      leaf.userData = { s, w }; leaf.position.z = z; this.leaves.push(leaf);
    }
    const track = new THREE.Mesh(new THREE.BoxGeometry(H.x * 2 + 2, 0.5, 0.7), steel); track.position.set(0, h + 0.95, z); track.castShadow = true; root.add(track);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(H.x * 2 + 2, 0.04, 0.16), steel); rail.position.set(0, 0.02, z); root.add(rail);
    this.place();
    // ---- wall lever (inside, left of the door) ----
    const L = new THREE.Group(); L.position.set(-12.4, 1.35, -H.z + 0.32); ix.group.add(L);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.16), new THREE.MeshStandardMaterial({ color: 0x5b636c, metalness: 0.55, roughness: 0.45 })); box.castShadow = true; L.add(box);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), new THREE.MeshStandardMaterial({ map: labelTex([['BAY DOORS', 70]], { h: 128, bg: '#16191d', fg: '#e0a816' }), roughness: 0.6 })); plate.position.set(0, 0.42, 0.081); L.add(plate);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.01), new THREE.MeshStandardMaterial({ color: 0x111111 })); slot.position.z = 0.081; L.add(slot);
    const piv = this.pivot = new THREE.Group(); piv.position.z = 0.09; L.add(piv);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.95, roughness: 0.2 })); arm.position.y = 0.21; piv.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc81e14, roughness: 0.3, metalness: 0.1 })); knob.position.y = 0.43; piv.add(knob);
    this.lampG = led(0x22ff66); this.lampR = led(0xff3322); this.lampG.position.set(-0.15, -0.26, 0.085); this.lampR.position.set(0.15, -0.26, 0.085); L.add(this.lampG, this.lampR);
    this.leverA = this.target ? 1 : -1; this.leverV = 0;
    const hit = hitBox(1.0, 1.5, 0.7); L.add(hit);
    ix.add({ hit, glow: [piv, box], range: 4.5, label: () => this.moving ? (this.target ? 'Doors opening… (click to close)' : 'Doors closing… (click to open)') : this.target ? 'Lever down: close bay doors' : 'Lever up: open bay doors', use: () => this.set(!this.target) });
  }
  get moving() { return this.u < 1; }
  set(open) {
    const v = open ? 1 : 0; if (v === this.target) return;
    this.target = v; this.from = this.t; this.u = 0; this.delay = 0.35; this.ix.sfx.lever();
  }
  forceOpen() { if (this.t === 1 && this.target === 1) return; this.target = 1; this.t = 1; this.u = 1; this.rumble?.stop(); this.rumble = null; this.place(); }
  place() {
    const k = this.t;
    for (const l of this.leaves) { const { s, w } = l.userData; l.position.x = s * (w / 2 - 0.12) + s * k * (H.door + 0.6); }
  }
  update(dt) {
    if (!this.leaves.length) return;
    // lever: springy swing toward its target angle
    const tgtA = this.target ? 1 : -1; this.leverV += ((tgtA - this.leverA) * 160 - this.leverV * 14) * dt; this.leverA += this.leverV * dt;
    if (this.pivot) this.pivot.rotation.x = Math.PI / 2 - this.leverA * (Math.PI / 2 - 0.5);   // up = open, down = closed
    const tm = performance.now() / 1000;
    if (this.lampG) { this.lampG.material.emissiveIntensity = this.target && !this.moving ? 3 : this.moving && this.target ? (Math.sin(tm * 10) > 0 ? 3 : 0.2) : 0.05; this.lampR.material.emissiveIntensity = !this.target && !this.moving ? 3 : this.moving && !this.target ? (Math.sin(tm * 10) > 0 ? 3 : 0.2) : 0.05; }
    if (this.u >= 1) return;
    if (this.delay > 0) { this.delay -= dt; return; }
    if (!this.rumble) { this.rumble = this.ix.sfx.loop('rumble'); }
    const DUR = 6.5, prev = this.t; this.u = Math.min(1, this.u + dt / DUR);
    const e = this.u * this.u * this.u * (this.u * (this.u * 6 - 15) + 10);
    this.t = this.from + (this.target - this.from) * e; this.place();
    const sp = Math.abs(this.t - prev) / dt * DUR * 0.55; this.rumble.set(Math.min(1, 0.25 + sp)); this.rumble.pitch?.(0.8 + 0.4 * Math.min(1, sp));
    if (this.u >= 1) { this.rumble.stop(); this.rumble = null; this.ix.sfx.clunk(1.3); }
  }
}

// ---------- light switches: high-bay lamps and work lights really switch off ----------
class Lights {
  constructor(ix) { this.ix = ix; this.on = { bay: true, area: true }; this.k = { bay: 1, area: 1 }; this.flick = { bay: 0, area: 0 }; this.dirty = false; this.rockers = {}; }
  grab() {
    if (this.ref) return this.ref; const w = this.ix.w, r = this.ref = { spot: w.spot, bays: w.bays || [], lens: [], fill: null };
    r.spotI = w.spot.intensity; r.baysI = r.bays.map(l => l.intensity);
    w.scene.traverse(o => { if (o.isPointLight && !r.fill) r.fill = o; });
    r.fillI = r.fill?.intensity || 0;
    w.hangar.traverse(o => { if (o.isMesh && o.material?.isMeshBasicMaterial && o.material.color.r > 5) r.lens.push({ m: o.material, c: o.material.color.clone() }); });
    r.bayDir = w.bayDir; r.bayDirI = w.bayDir?.intensity ?? 0;
    return r;
  }
  build() {
    const ix = this.ix, P = new THREE.Group(); P.position.set(-13.5, 1.4, -H.z + 0.3); ix.group.add(P);
    const plateM = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.45, metalness: 0.1 });
    const defs = [['bay', 'HIGH BAY', -0.13], ['area', 'WORK LIGHTS', 0.13]];
    for (const [key, name, x] of defs) {
      const g = new THREE.Group(); g.position.x = x; P.add(g);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.025), plateM); plate.castShadow = true; g.add(plate);
      const rock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.035), new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35 })); rock.position.z = 0.025; g.add(rock);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.045), new THREE.MeshBasicMaterial({ map: labelTex([[name, 64]], { h: 96, fg: '#2a2f36' }), transparent: true })); lab.position.set(0, 0.105, 0.0135); g.add(lab);
      const l = led(0x7fe7ff); l.scale.setScalar(0.6); l.position.set(0, -0.1, 0.016); g.add(l);
      const hit = hitBox(0.25, 0.5, 0.5); g.add(hit);
      this.rockers[key] = { rock, led: l, a: 1 };
      ix.add({ hit, glow: [rock], range: 4, label: () => `${name}: turn ${this.on[key] ? 'off' : 'on'}`, use: () => this.set(key, !this.on[key]) });
    }
  }
  set(key, v) { if (this.on[key] === v) return; this.on[key] = v; this.flick[key] = v ? 0.7 : 0; this.ix.sfx.click(); this.dirty = true; if (v) setTimeout(() => this.ix.g.audio.tone(118, 0.6, 'sine', 0.025, 0.2), 120); }
  reset() { if (!this.dirty) return; this.on.bay = this.on.area = true; this.k.bay = this.k.area = 1; this.apply(); this.dirty = false; }
  update(dt, inBuild) {
    for (const key of ['bay', 'area']) {
      const r = this.rockers[key]; if (r) { r.a += ((this.on[key] ? 1 : -1) - r.a) * Math.min(1, dt * 20); r.rock.rotation.x = -r.a * 0.28; r.led.material.emissiveIntensity = this.on[key] ? 0.15 : 2.5; }
    }
    if (!inBuild || !this.dirty) return;
    for (const key of ['bay', 'area']) {
      let tgt = this.on[key] ? 1 : 0;
      if (this.flick[key] > 0) { this.flick[key] -= dt; tgt = Math.random() < 0.55 ? 0.9 : 0.08; this.k[key] = tgt; continue; }
      this.k[key] += (tgt - this.k[key]) * Math.min(1, dt * (tgt ? 2.2 : 9));
    }
    this.apply();
    if (this.on.bay && this.on.area && this.k.bay > 0.999 && this.k.area > 0.999) { this.k.bay = this.k.area = 1; this.apply(); this.dirty = false; }
  }
  apply() {
    const r = this.grab(), b = this.k.bay, a = this.k.area, w = this.ix.w;
    r.spot.intensity = r.spotI * b; r.bays.forEach((l, i) => l.intensity = r.baysI[i] * b);
    if (r.bayDir) r.bayDir.intensity = r.bayDirI * b;
    for (const { m, c } of r.lens) m.color.copy(c).multiplyScalar(0.03 + 0.97 * b);
    if (r.fill) r.fill.intensity = r.fillI * a;
    if (w.indoor) w.scene.environmentIntensity = 0.6 * (0.3 + 0.45 * b + 0.25 * a);
  }
}
