// Launch control console: a raked steel desk with real toggle switches, three live camera feeds
// (cheap half-float render targets, one refreshed per frame in turn), a COUNTDOWN button that rolls
// out and launches, and a guarded big red ABORT that really stops the countdown or the flight.
// Dressed with the CC0 Poly Haven metal_office_desk, a code-built status monitor and factory-facade knee walls.
import * as THREE from 'three';
import { HANGAR, SPOTS, IS_TOUCH } from './env.js';
import { prop, pieces } from './models.js';
import { hitBox, labelTex, hazardTex, led } from './interactive.js';

const H = HANGAR, $ = id => document.getElementById(id);
const POS = new THREE.Vector3(15.4, 0, -4.4);   // console centre; operator stands on +x looking toward the stand / door

export class Console {
  constructor(ix) {
    this.ix = ix; this.g = ix.g; this.arm = false; this.count = null; this.feedsOn = true; this.beacon = false;
    this.switches = []; this.frameN = 0; this.coverOpen = 0; this.coverT = 0; this.abortFlash = 0;
  }
  async load() {
    const ix = this.ix, w = ix.w, root = this.root = new THREE.Group(); root.name = 'console';
    root.position.copy(POS); root.rotation.y = Math.PI / 2; ix.group.add(root);
    const gun = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.6, roughness: 0.42 });
    const brushed = new THREE.MeshStandardMaterial({ color: 0x8c939b, metalness: 0.85, roughness: 0.32 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.3, roughness: 0.5 });
    const box = (wd, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = b.receiveShadow = true; root.add(b); return b; };
    // cabinet, plinth, raked panel (front low at the operator, back high), monitor bridge
    const W = 3.2;
    box(W, 0.76, 0.8, gun, 0, 0.42, -0.05); box(W - 0.06, 0.06, 0.76, black, 0, 0.03, -0.03);
    const rake = Math.atan2(0.22, 0.52), panel = new THREE.Group(); panel.position.set(0, 0.92, 0.1); panel.rotation.x = rake; root.add(panel);   // tilted toward the operator
    const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.04, 0.6), brushed); top.castShadow = top.receiveShadow = true; panel.add(top);
    box(W, 0.95, 0.12, gun, 0, 1.47, -0.42); box(W, 0.05, 0.2, black, 0, 1.97, -0.4);
    // silkscreen labels on the panel
    const silk = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.6), new THREE.MeshBasicMaterial({ map: this.silkTex(), transparent: true, toneMapped: true, color: 0x9aa0a6 }));
    silk.rotation.x = -Math.PI / 2; silk.position.y = 0.021; panel.add(silk);
    // ---- screens: three feeds in black bezels ----
    const lite = ix.lite, rw = lite ? 192 : 384, rh = lite ? 108 : 216;
    this.feeds = [
      { name: 'PAD 39 · CAM 2', cam: new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 4000), pose: () => [new THREE.Vector3(SPOTS.pad.x + 46, 13, SPOTS.pad.z + 52), new THREE.Vector3(SPOTS.pad.x, 14, SPOTS.pad.z)], out: true },
      { name: 'BAY 01 · ASSEMBLY', cam: new THREE.PerspectiveCamera(48, 16 / 9, 0.2, 400), pose: () => [new THREE.Vector3(-19, 15, 13), new THREE.Vector3(0, 5, 0)] },
      { name: 'CRANE · HOOK CAM', cam: new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 400), pose: () => { const c = ix.crane; if (!c?.ready) return [new THREE.Vector3(0, 18, -12), new THREE.Vector3(0, 0, -15)]; const p = c.trolley.getWorldPosition(new THREE.Vector3()); p.y -= 2.6; const hb = c.hookBottom(); return [p, hb.setY(hb.y - 3)]; } },
    ];
    this.feeds.forEach((f, i) => {
      f.rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, samples: 0, depthBuffer: true });
      const x = (i - 1) * 1.02, g = new THREE.Group(); g.position.set(x, 1.48, -0.355); g.rotation.y = -(i - 1) * 0.12; root.add(g);
      const bez = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.6, 0.05), black); g.add(bez);
      f.mat = new THREE.MeshBasicMaterial({ map: f.rt.texture, color: new THREE.Color(0.75, 0.78, 0.8) });
      const scr = f.scr = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.52), f.mat); scr.position.z = 0.027; g.add(scr);
      f.ov = document.createElement('canvas'); f.ov.width = 512; f.ov.height = 288; f.ovTex = new THREE.CanvasTexture(f.ov); f.ovTex.colorSpace = THREE.SRGBColorSpace;
      const ov = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.52), new THREE.MeshBasicMaterial({ map: f.ovTex, transparent: true, depthWrite: false })); ov.position.z = 0.029; g.add(ov);
      f.group = g;
    });
    this.drawOverlays(true);
    // ---- toggle switches ----
    const sw = [
      ['MASTER ARM', () => this.arm, v => { this.arm = v; if (v) this.ix.sfx.chime(2); }],
      ['BAY DOORS', () => !!ix.doors.target, v => ix.doors.set(v)],
      ['HIGH BAY', () => ix.lights.on.bay, v => ix.lights.set('bay', v)],
      ['WORK LIGHTS', () => ix.lights.on.area, v => ix.lights.set('area', v)],
      ['FUEL PUMP', () => ix.fuel.pump, v => { ix.fuel.pump = v; }],
      ['BEACON', () => this.beacon, v => { this.beacon = v; }],
      ['FEEDS', () => this.feedsOn, v => { this.feedsOn = v; }],
    ];
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ec, metalness: 1, roughness: 0.18 });
    sw.forEach(([name, get, set], i) => {
      const g = new THREE.Group(); g.position.set(-1.45 + i * 0.27, 0.02, 0.05); panel.add(g);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.02, 16), black); g.add(base);
      const piv = new THREE.Group(); piv.position.y = 0.012; g.add(piv);
      const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.075, 10), chrome); bat.position.y = 0.037; piv.add(bat);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), chrome); tip.position.y = 0.075; piv.add(tip);
      const l = led(i === 0 ? 0xff5533 : 0x33ff88); l.position.set(0, 0.012, -0.1); g.add(l);
      const hit = hitBox(0.24, 0.16, 0.3); g.add(hit);
      const S = { name, get, set, piv, led: l, a: get() ? 1 : -1 }; this.switches.push(S);
      ix.add({ hit, glow: [piv], range: 3.2, label: () => `${name}: ${get() ? 'ON → off' : 'OFF → on'}`, use: () => { set(!get()); ix.sfx.click(); } });
    });
    // ---- COUNTDOWN (green) and guarded ABORT (red) ----
    const mush = (r, c, x) => {
      const g = new THREE.Group(); g.position.set(x, 0.02, 0.02); panel.add(g);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.5, 0.03, 32), new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.5 })); collar.position.y = 0.015; g.add(collar);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.05, 32), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.3 })); cap.position.y = 0.055; g.add(cap);
      return { g, cap };
    };
    const cd = mush(0.055, 0x1e9e4a, 0.62); this.cdCap = cd.cap;
    const ab = mush(0.08, 0xd0281c, 1.18); this.abCap = ab.cap;
    const cdHit = hitBox(0.3, 0.25, 0.32); cd.g.add(cdHit);
    ix.add({ hit: cdHit, glow: [cd.cap], range: 3.2, label: () => this.count != null ? `Counting: T-${Math.ceil(this.count)}` : this.arm ? 'COUNTDOWN: roll out and launch' : 'COUNTDOWN (flip MASTER ARM first)', use: () => this.startCount() });
    // hinged clear guard over ABORT
    const hinge = this.coverHinge = new THREE.Group(); hinge.position.set(0, 0.02, -0.13); ab.g.add(hinge);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, 0.25), new THREE.MeshStandardMaterial({ color: 0xff6a5f, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0, depthWrite: false })); cover.position.set(0, 0.055, 0.125); hinge.add(cover);
    const abHit = hitBox(0.36, 0.3, 0.38); ab.g.add(abHit);
    ix.add({ hit: abHit, glow: [ab.cap], range: 3.2, label: () => this.coverOpen ? 'ABORT!' : 'Lift the guard', use: () => this.abortPress() });
    // ---- the whole desk: sit at the console ----
    const seat = hitBox(W + 0.4, 1.4, 1.2); seat.position.set(0, 1.25, -0.25); root.add(seat);
    ix.add({ hit: seat, glow: [], range: 6, notIn: this, label: () => 'Sit at the launch console', use: () => { ix.take(this); ix.sfx.click(); } });
    // ---- beacon on the monitor bridge ----
    const bcn = this.beaconG = new THREE.Group(); bcn.position.set(1.45, 2.05, -0.42); root.add(bcn);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 0.1, transparent: true, opacity: 0.85, roughness: 0.2 })); bcn.add(dome); this.dome = dome;
    const beam = this.beam = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.2, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.rotation.z = Math.PI / 2; beam.position.x = 1.6; const spin = this.spin = new THREE.Group(); spin.position.y = 0.05; spin.add(beam); bcn.add(spin); beam.userData.noAO = true;
    // ---- CC0 dressing: office desk + status monitor, factory-facade knee wall, a hanging lamp ----
    const dress = [
      prop('metal_office_desk').then(o => { o.position.set(-2.75, 0, -0.05); root.add(o); this.desk = o; this.addStatusScreen(o.userData.size.y, black); }),
      prop('hanging_industrial_lamp').then(o => { o.position.set(0, 3.3, 0.2); root.add(o); const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, H.h - 3.8 - 4.64, 4), black); c.position.set(0, (4.64 + H.h - 3.8) / 2, 0.2); root.add(c); }),
      this.kneeWall(),
    ];
    await Promise.all(dress.map(d => d.catch(e => console.warn('console dress', e.message))));
    this.ready = true;
  }
  async kneeWall() {
    const [base, dado, cap] = await Promise.all(['base_standard_standard_01', 'dado_standard_standard_01', 'cornice03_standard_standard_01'].map(n => pieces('facade_kit', x => x === n)));
    const seg = (ps, y, x, z) => { for (const p of ps) { const m = new THREE.Mesh(p.geometry, p.material); m.position.set(x, y, z); m.rotation.y = Math.PI; m.castShadow = m.receiveShadow = true; this.root.add(m); } };
    for (const x of [-1.5, 1.5]) { seg(base, 0, x, 2.7); seg(dado, base.size.y, x, 2.7); seg(cap, base.size.y + dado.size.y, x, 2.7); }
  }
  // code-built modern status monitor on the office desk (thin bezel on a stand)
  addStatusScreen(deskH, black) {
    const g = new THREE.Group(); g.position.set(-2.75, deskH, -0.15); g.rotation.y = 0.12; this.root.add(g);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.16), black); foot.position.y = 0.008; g.add(foot);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.03), black); neck.position.set(0, 0.15, -0.04); g.add(neck);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.38, 0.025), black); bez.position.set(0, 0.42, -0.02); bez.castShadow = true; g.add(bez);
    const c = this.lapCv = document.createElement('canvas'); c.width = 256; c.height = 160; this.lapTex = new THREE.CanvasTexture(c); this.lapTex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.35), new THREE.MeshBasicMaterial({ map: this.lapTex, color: 0xc8c8c8 })); m.position.set(0, 0.42, -0.006); g.add(m);
  }
  silkTex() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 384; const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height); g.strokeStyle = 'rgba(255,255,255,.55)'; g.fillStyle = '#fff'; g.lineWidth = 3; g.textAlign = 'center'; g.font = 'bold 26px Arial';
    const names = ['MASTER ARM', 'BAY DOORS', 'HIGH BAY', 'WORK LIGHTS', 'FUEL PUMP', 'BEACON', 'FEEDS'];
    names.forEach((n, i) => { const x = (1.6 - 1.45 + i * 0.27) / 3.2 * 2048; g.fillText(n, x, 300); g.strokeRect(x - 78, 110, 156, 210); });
    g.font = 'bold 34px Arial'; g.fillText('COUNTDOWN', (1.6 + 0.62) / 3.2 * 2048, 330); g.fillStyle = '#ff6a5f'; g.fillText('ABORT', (1.6 + 1.18) / 3.2 * 2048, 350);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '22px Arial'; g.textAlign = 'left'; g.fillText('CHROME HANGAR · LAUNCH CONTROL · BAY 01', 40, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  // operator's eye: standing behind the desk, looking over the screens toward the stand
  camPose() {
    const r = this.root; r.updateWorldMatrix(true, false);
    return { pos: r.localToWorld(new THREE.Vector3(0, 1.78, 1.25)), look: r.localToWorld(new THREE.Vector3(0, 1.02, -0.6)) };
  }
  onTake() { this.ix.pad.x = innerWidth / 2; this.ix.pad.y = innerHeight * 0.62; this.panel().style.display = 'flex'; }
  onRelease() { this.panel().style.display = 'none'; }
  panel() {
    if (this.panelEl) return this.panelEl;
    const d = this.panelEl = document.createElement('div'); d.className = 'ixPanel'; d.style.cssText = 'right:16px;bottom:18px';
    d.innerHTML = `${IS_TOUCH ? '' : '<span class="tip">Click switches and buttons · Esc to stand up</span>'}<button style="min-width:110px">Stand up</button>`;
    d.querySelector('button').addEventListener('click', () => this.ix.release());
    document.body.appendChild(d); return d;
  }
  // ---------- countdown / abort ----------
  startCount() {
    const g = this.g, sfx = this.ix.sfx;
    if (this.count != null) return;
    if (!this.arm) { g.toast('Flip MASTER ARM on first.'); g.audio.bad(); this.armNag = 1.2; return; }
    const probs = g.build.problemsFor(); if (probs.length) { g.toast(probs[0]); g.audio.bad(); return; }
    this.count = 10; this.lastBeep = 11; this.beacon = true; sfx.button(); this.ix.fuel.stow?.(true);
    if (!this.ix.doors.target) this.ix.doors.set(true);
    g.toast('Countdown started. Doors opening, beacon on. ABORT is under the guard.', 2600);
  }
  abortPress() {
    const g = this.g, sfx = this.ix.sfx;
    if (!this.coverOpen) { this.coverOpen = 1; this.coverTimer = 6; sfx.lever(); return; }
    sfx.button(); this.coverTimer = 6; this.abortFlash = 3;
    if (this.count != null) { this.count = null; sfx.alarm(); this.arm = false; g.toast('ABORT. Countdown stopped and systems safed.', 2800); }
    else { sfx.alarm(); g.toast('ABORT: nothing running. Everything is safe.', 2000); }
  }
  // flight HUD abort (two taps: lift the guard, then abort)
  hudAbort() {
    if (this.hud) return this.hud;
    const b = this.hud = document.createElement('button'); b.id = 'ixAbort'; b.textContent = 'ABORT'; document.body.appendChild(b);
    b.addEventListener('click', () => {
      const fl = this.g.flight; if (!fl?.f) return;
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'CONFIRM ABORT'; this.ix.sfx.lever(); clearTimeout(this.hudT); this.hudT = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'ABORT'; }, 3500); return; }
      b.classList.remove('armed'); b.textContent = 'ABORT'; this.ix.sfx.alarm();
      if (fl.countdown != null) { fl.countdown = null; $('countdown').classList.add('hidden'); $('btnLaunch').classList.remove('hidden'); this.g.toast('Launch aborted on the pad.'); }
      else if (fl.f.phase === 'flying' && !fl.ended) fl.endFlight('abort');
    });
    return b;
  }
  update(dt, inBuild, active) {
    if (!this.ready) return;
    const g = this.g, t = performance.now() / 1000;
    // flight-mode abort button
    const fl = g.flight, showHud = g.mode === 'flight' && fl?.f && !g.menuOpen && !g.resultsOpen && (fl.countdown != null || (fl.f.phase === 'flying' && !fl.ended));
    const hb = this.hudAbort(); const want = showHud ? 'block' : 'none'; if (hb.style.display !== want) hb.style.display = want;
    if (!inBuild) { this.count = null; return; }
    for (const s of this.switches) { const tgt = s.get() ? 1 : -1; s.a += (tgt - s.a) * Math.min(1, dt * 22); s.piv.rotation.x = s.a * 0.42; s.led.material.emissiveIntensity = s.get() ? 2.4 : 0.03; }
    if (this.armNag > 0) { this.armNag -= dt; this.switches[0].led.material.emissiveIntensity = Math.sin(t * 20) > 0 ? 3 : 0; }
    // guard cover
    if (this.coverOpen && (this.coverTimer -= dt) <= 0) { this.coverOpen = 0; this.ix.sfx.click(); }
    this.coverT += ((this.coverOpen ? 1 : 0) - this.coverT) * Math.min(1, dt * 12); this.coverHinge.rotation.x = -this.coverT * 1.75;
    this.abortFlash = Math.max(0, this.abortFlash - dt);
    this.abCap.material.emissiveIntensity = this.coverOpen ? 0.6 + 0.4 * Math.sin(t * 8) : 0.15;
    this.cdCap.material.emissiveIntensity = this.count != null ? (Math.sin(t * 6) > 0 ? 1.2 : 0.3) : this.arm ? 0.5 : 0.1;
    // beacon
    const bk = this.beacon ? 1 : 0; this.spin.rotation.y += dt * 5 * bk; this.beam.material.opacity += (bk * 0.22 - this.beam.material.opacity) * Math.min(1, dt * 6); this.dome.material.emissiveIntensity = 0.1 + bk * (2.5 + Math.sin(t * 10));
    // countdown
    if (this.count != null && active) {
      this.count -= dt; const n = Math.ceil(this.count);
      if (n < this.lastBeep) { this.lastBeep = n; g.audio.beep(false); }
      if (this.count <= 3.2) { this.count = null; this.beacon = false; this.ix.release(true); g.travel('flight'); if (g.mode === 'flight') setTimeout(() => g.flight?.launch(), 250); return; }
    }
    // laptop + overlays (twice a second)
    this.ovT = (this.ovT || 0) - dt; if (this.ovT <= 0) { this.ovT = 0.5; this.drawOverlays(); this.drawLaptop(); }
    // live feeds: only when somebody can see them
    const cam = this.ix.w.camera, near = cam.position.distanceTo(POS) < 22 || this.ix.ctl === this;
    if (this.feedsOn && near) this.renderFeed();
    for (const f of this.feeds) { const on = this.feedsOn ? 1 : 0; f.mat.color.setRGB(0.75 * on, 0.78 * on, 0.8 * on); }
  }
  renderFeed() {
    const ix = this.ix, w = ix.w, r = w.renderer, lite = ix.lite;
    this.frameN++; if (this.frameN % (lite ? 6 : 2)) return;
    const f = this.feeds[(this.frameN / (lite ? 6 : 2) | 0) % this.feeds.length];
    const [p, l] = f.pose(); f.cam.position.copy(p); f.cam.lookAt(l); f.cam.updateMatrixWorld();
    const sc = w.scene, oldT = r.getRenderTarget(), au = r.shadowMap.autoUpdate, env = sc.environment, ei = sc.environmentIntensity, sunV = w.sun.visible;
    r.shadowMap.autoUpdate = false;
    if (f.out && w.envs?.sky) { sc.environment = w.envs.sky; sc.environmentIntensity = 0.95; w.sun.visible = true; }
    for (const o of this.feeds) o.scr.visible = false;   // no feedback loop: a screen never samples the target being drawn
    r.setRenderTarget(f.rt); r.render(sc, f.cam);
    for (const o of this.feeds) o.scr.visible = true;
    r.setRenderTarget(oldT); r.shadowMap.autoUpdate = au; sc.environment = env; sc.environmentIntensity = ei; w.sun.visible = sunV;
  }
  drawOverlays(first) {
    const d = new Date(), ts = d.toTimeString().slice(0, 8);
    this.feeds.forEach((f, i) => {
      const g = f.ov.getContext('2d'), W = f.ov.width, Hh = f.ov.height; g.clearRect(0, 0, W, Hh);
      if (!this.feedsOn) { g.fillStyle = 'rgba(120,140,160,.5)'; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.fillText('NO SIGNAL', W / 2, Hh / 2); f.ovTex.needsUpdate = true; return; }
      g.font = 'bold 20px monospace'; g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'left'; g.fillText(f.name, 14, 28); g.textAlign = 'right'; g.fillText(ts, W - 14, 28);
      if (d.getSeconds() % 2 === 0) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(W - 120, 22, 7, 0, 7); g.fill(); }
      if (i === 1 && this.count != null) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, Hh / 2 - 60, W, 120); g.fillStyle = '#7fe7ff'; g.textAlign = 'center'; g.font = 'bold 84px monospace'; g.fillText('T-' + String(Math.ceil(this.count)).padStart(2, '0'), W / 2, Hh / 2 + 30); }
      if (this.abortFlash > 0) { g.fillStyle = 'rgba(200,36,27,.55)'; g.fillRect(0, Hh / 2 - 50, W, 100); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 60px monospace'; g.fillText('ABORT', W / 2, Hh / 2 + 22); }
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; const c = 18; for (const [x, y, sx, sy] of [[10, 40, 1, 1], [W - 10, 40, -1, 1], [10, Hh - 10, 1, -1], [W - 10, Hh - 10, -1, -1]]) { g.beginPath(); g.moveTo(x, y + sy * c); g.lineTo(x, y); g.lineTo(x + sx * c, y); g.stroke(); }
      f.ovTex.needsUpdate = true;
    });
  }
  drawLaptop() {
    if (!this.lapCv) return; const g = this.lapCv.getContext('2d'), G = this.g, W = 256, Hh = 160;
    g.fillStyle = '#06121c'; g.fillRect(0, 0, W, Hh); g.font = 'bold 15px monospace'; g.textAlign = 'left';
    const fuel = Math.round((G.fill ?? 1) * 100), probs = G.build?.problemsFor?.() || [];
    const rows = [['VEHICLE', probs.length ? 'NO-GO' : 'GO', probs.length ? '#ff6a5f' : '#5dff9a'], ['PROPELLANT', fuel + '%', '#7fe7ff'], ['PUMP', this.ix.fuel.pump ? 'ON' : 'OFF', '#e8f8ff'], ['HOSE', this.ix.fuel.state.toUpperCase(), '#e8f8ff'], ['DOORS', this.ix.doors.target ? 'OPEN' : 'CLOSED', '#e8f8ff'], ['ARM', this.arm ? 'ARMED' : 'SAFE', this.arm ? '#ffb340' : '#5dff9a']];
    g.fillStyle = '#7fe7ff'; g.fillText('LAUNCH STATUS', 12, 22);
    rows.forEach(([k, v, c], i) => { g.fillStyle = '#8aa0b4'; g.fillText(k, 12, 44 + i * 20); g.fillStyle = c; g.textAlign = 'right'; g.fillText(v, W - 12, 44 + i * 20); g.textAlign = 'left'; });
    this.lapTex.needsUpdate = true;
  }
}
