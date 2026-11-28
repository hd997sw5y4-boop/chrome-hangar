// Moon flight for Free Mode: real Earth / Moon distances, patched-conic gravity, time warp, a predicted path, Moon / Earth
// markers and a lunar landing on the game's own landing physics. Hooked into flight.js with a handful of one-line calls.
//
// Three legs, each run by the right model:
//   'flatE'  the range: the existing rigid-body sim (sim.js), untouched.
//   'space'  above 70 km (or after the practice start): orbit.js owns position / velocity in Earth- or Moon-centred
//            inertial coordinates (float64). The engine still runs through sim.js engineStep (same thrust, Isp, heat), the
//            attitude is held / pointed (prograde, retrograde, radial, normal) or steered with the stick.
//   'flatM'  below 12 km over the Moon once slow sideways (< 250 m/s): back to sim.js flightStep in a local frame on the
//            Moon (gravity 1.62 m/s^2, no air), so touchdown uses exactly the same speed / tilt / legs rules as on Earth.
//            Landed rockets stay put until the player throttles up (lift off again) or ends the flight.
// Nothing about the rocket is changed: no free delta-v. A one-stage build cannot reach orbit, so the pad shows what the
// trip needs and offers a clearly labelled practice start in a 200 km parking orbit.
import * as THREE from 'three';
import * as O from './orbit.js';
import { TimeWarp, warpCap } from './timewarp.js';
import { SpaceView } from './spaceview.js';
import { engineStep, airDensity, failFlight, DT, ATMO_TOP } from './sim.js';
import { stats } from './rocket.js';
import { SPOTS } from './env.js';

const { V } = O;
const AREF = Math.PI * 0.9 * 0.9;
const UP_E = 70e3, DOWN_E = 65e3, UP_M = 15e3, DOWN_M = 12e3, SIDE_M = 250;
const POINTS = [['hold', 'Hold'], ['pro', 'Prograde'], ['retro', 'Retrograde'], ['radOut', 'Radial out'], ['radIn', 'Radial in'], ['normal', 'Normal'], ['anti', 'Anti-normal']];
export const NEED = { leo: 9.4, tli: 3.15, land: 0.9 };   // km/s: pad to 200 km orbit, trans-lunar injection, capture + landing
const SPIN_E = [0, 0, O.W_E];
const km = m => Math.round(m / 1000).toLocaleString();
const dur = s => { if (!isFinite(s)) return '—'; s = Math.max(0, s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min ${Math.floor(s % 60)} s`; };
const $ = id => document.getElementById(id);

export class MoonFlight {
  constructor(fm) {
    this.fm = fm; this.w = fm.w; this.view = new SpaceView(fm.w); fm.w.spaceView = this.view; this.warp = new TimeWarp();
    css();
    const ui = $('flightUI');
    this.pad = document.createElement('div'); this.pad.id = 'moonPad'; this.pad.className = 'hidden';
    this.pad.innerHTML = '<div class="row"><span id="mpLine"></span><button id="mpInfo" type="button">?</button><button id="mpOrbit" type="button">Moon practice</button></div><div id="mpMore" class="hidden"><p id="mpNeed"></p><p id="mpHave"></p><small>Moon practice starts the rocket in a 200 km orbit, as if a booster had lifted it. Your own fuel does the rest.</small></div>';
    this.hud = document.createElement('div'); this.hud.id = 'moonHud'; this.hud.className = 'hidden';
    this.hud.innerHTML = '<b id="mhWhere"></b><span id="mhMoon"></span><span id="mhDv"></span><em id="mhTip"></em><div class="row"><button id="mhPoint" type="button"></button><button id="mhSlow" type="button">◂◂</button><button id="mhWarp" type="button"></button><button id="mhFast" type="button">▸▸</button></div>';
    ui.append(this.pad, this.hud);
    $('mpOrbit').onclick = () => { this.fm.g.audio.tap(); this.startOrbit(); };
    $('mpInfo').onclick = () => { this.fm.g.audio.tap(); $('mpMore').classList.toggle('hidden'); };
    $('mhPoint').onclick = () => this.cyclePoint();
    $('mhSlow').onclick = () => this.warpDown();
    $('mhFast').onclick = () => this.warpUp();
    $('mhWarp').onclick = () => { this.warp.reset(); this.uiT = 1; };
    this.on = false;
  }
  // surface distance to the Moon in metres (for the cockpit gauge). null until this flight is in space or on the Moon.
  range() {
    if (!this.on) return null;
    if (this.mode === 'flatM') return this.f.alt;
    if (!this.s) return null;
    const mrel = this.s.body === 'E' ? V.sub(this.s.r, O.moonPos(this.sky, this.s.t)) : this.s.r;
    return V.len(mrel) - O.R_M;
  }
  // ---------- lifecycle (flight.enter / exit) ----------
  reset() {
    const fm = this.fm;
    this.on = !fm.g.mission && !fm.g.training?.active;
    this.f = fm.f; this.sky = O.makeSky(Date.now()); this.mode = 'flatE'; this.s = null; this.att = null; this.point = 'hold';
    this.warp.reset(); this.acc = 0; this.moonLandings = 0; this.lastLand = null; this.everMoon = false; this.maxDistE = 0; this.pred = null; this.predT = 1;
    this.frameKind = null; this.B0 = null; this.anchor = null; this.site = null; this.uiT = 1; this.practice = false; this.padPos0 = { ...this.f.padPos };
    this.view.hideAll(); this.hud.classList.add('hidden'); this.pad.classList.toggle('hidden', !this.on);
    if (this.on) this.padInfo();
  }
  exit() { this.on = false; this.view.hideAll(); this.hud.classList.add('hidden'); this.pad.classList.add('hidden'); }
  // ---------- pad panel: what the trip needs vs. what this rocket has ----------
  padInfo() {
    const f = this.f, st = stats(f.rocket, f.fill, 1), vac = st.dv * 1.1 / 1000, all = NEED.leo + NEED.tli + NEED.land, fromOrbit = NEED.tli + NEED.land;
    $('mpNeed').innerHTML = `From the pad the Moon takes about <b>${all.toFixed(1)} km/s</b> of Δv: ${NEED.leo} to reach orbit, ${NEED.tli} to head for the Moon, ${NEED.land} to slow down and land. From a 200 km orbit: about <b>${fromOrbit.toFixed(1)} km/s</b>.`;
    const ok = vac >= all, okOrbit = vac >= fromOrbit;
    $('mpLine').innerHTML = `Moon: needs <b>${all.toFixed(1)}</b> km/s · this rocket <b class="${ok ? 'good' : okOrbit ? 'warn' : 'badc'}">${vac.toFixed(1)}</b>`;
    $('mpHave').innerHTML = `This rocket: <b class="${ok ? 'good' : okOrbit ? 'warn' : 'badc'}">${vac.toFixed(1)} km/s</b> in space (${(st.dv / 1000).toFixed(1)} at sea level), ${st.parts} parts. ` +
      (ok ? 'Enough on paper; fly a gravity turn east.' : okOrbit ? 'Not enough from the pad (one-stage rockets top out near 6-7 km/s), but enough from the practice orbit.' : `Not enough even from orbit: add tanks (CarbonTank is the lightest per tonne of fuel) and use an efficient engine (Vesper, Spark or Flicker, which also throttle low enough to land). It needs ${fromOrbit.toFixed(1)} km/s.`);
  }
  startOrbit() {
    const f = this.f, fm = this.fm; if (!this.on || f.phase !== 'pad' || fm.countdown != null) return;
    // circular 200 km orbit in the Moon's plane, the Moon ~150 deg ahead: the best moment to burn comes ~5 minutes in
    const r0 = O.R_E + 200e3, vc = Math.sqrt(O.MU_E / r0), m = V.norm(O.moonPos(this.sky, f.t)), Q = V.cross(this.sky.H, m), a = -150 * Math.PI / 180;
    const r = V.add(V.mul(m, r0 * Math.cos(a)), Q, r0 * Math.sin(a)), v = V.add(V.mul(m, -vc * Math.sin(a)), Q, vc * Math.cos(a));
    this.s = { body: 'E', r, v, t: f.t }; this.att = V.norm(v); this.point = 'pro'; this.practice = true;
    f.phase = 'flying'; f.legOut = 0; f.legAuto = 0; f.e.cmd = 0; f.e.on = false; fm.thr = 0; fm.lastThr = fm.lastThr || 1; fm.touchThr = null; fm.cutLatch = false; fm.armed = true; fm.countdown = null;
    $('btnLaunch').classList.add('hidden'); this.pad.classList.add('hidden'); fm.g.prompt?.(null);
    this.mode = 'space'; this.mapFrame(); fm.camInit = false;
    fm.g.toast('Practice orbit: 200 km up, pointed prograde. Burn when the Moon is about 140° ahead.', 4200);
  }
  // ---------- per-frame hooks from flight.update ----------
  // space leg physics; true when it ran (the flat sim is then skipped this frame)
  step(sdt) {
    if (!this.on || this.mode !== 'space') return false;
    const f = this.f, fm = this.fm;
    if (f.phase === 'crashed' || f.phase === 'landed' || fm.ended) { this.mapFrame(); return true; }
    this.input(sdt);
    const s = this.s, R = O.radiusOf(s.body), alt = V.len(s.r) - R, burning = !!f.eng && f.e.cmd >= f.eng.minThrottle - 1e-6 && f.fuelFrac > 0 && !f.e.failed;
    if (this.warp.clamp(warpCap({ thrust: burning, body: s.body, alt }))) this.uiT = 1;
    const total = sdt * this.warp.k;
    if (burning || (s.body === 'E' && alt < ATMO_TOP)) {   // drag only exists below ATMO_TOP; above it the exact Kepler coast
      this.acc += total; let n = 0;
      while (this.acc >= DT && n++ < 1500) { this.acc -= DT; if (this.powered(DT)) break; }
    } else {
      this.acc = 0;
      const stopM = alt > DOWN_M + 300 ? DOWN_M : 0;
      const c = O.coast(this.sky, s, total, { stopAlt: { E: DOWN_E, M: stopM }, maxChunks: 300 });
      f.t += c.done; f.flightT += c.done;
      if (f.eng) engineStep(f.e, f.eng, Math.min(c.done, 5), f.st.fuel, 0);
      if (c.limited && this.warp.down()) this.uiT = 1;
      if (c.crossed) this.soiNote();
      this.checkSpace();
    }
    if (this.mode === 'space') this.mapFrame();
    return true;
  }
  // one 120 Hz powered step (engine + gravity + drag); true if a leg change / failure ended the burst
  powered(h) {
    const f = this.f, s = this.s, st = f.st = stats(f.rocket, f.fill, f.fuelFrac), R = O.radiusOf(s.body), alt = V.len(s.r) - R;
    const rho = s.body === 'E' ? airDensity(alt) : 0, wasOn = f.e.on;
    const { thrust, mdot } = f.eng ? engineStep(f.e, f.eng, h, st.fuel, rho) : { thrust: 0, mdot: 0 };
    if (f.e.on && !wasOn) f.events.push({ type: 'ignite' });
    if (!f.e.on && wasOn) f.events.push({ type: f.e.failed ? 'overheat' : 'cutoff' });
    if (f.e.failed) { failFlight(f, 'overheat'); return true; }
    if (st.fuelCap > 0) f.fuelFrac = Math.max(0, f.fuelFrac - mdot * h / st.fuelCap);
    const push = (f.e.on && thrust > 0) ? thrust : 0;
    const acc = V.mul(this.att, push / st.mass);
    const drag = rho > 1e-10 ? (r, v) => { const vr = V.sub(v, V.cross(SPIN_E, r)), sp = V.len(vr); return V.mul(vr, -0.5 * rho * sp * AREF * st.cd / st.mass); } : null;
    const was = s.body;
    O.thrustStep(this.sky, s, h, acc, drag);
    f.t += h; f.flightT += h;
    if (s.body !== was) this.soiNote();
    return this.checkSpace();
  }
  soiNote() { const s = this.s; if (s.body === 'M') { this.everMoon = true; this.fm.g.toast("In the Moon's pull now", 2600); } else this.fm.g.toast("Out of the Moon's pull: Earth leads again", 2600); this.pred = null; this.predT = 1; }
  // leg changes out of space; true if it left the space leg or crashed
  checkSpace() {
    const s = this.s, f = this.f, R = O.radiusOf(s.body), r = V.len(s.r), alt = r - R, up = V.mul(s.r, 1 / r), vs = V.dot(s.v, up), vh = V.len(V.sub(s.v, V.mul(up, vs)));
    if (s.body === 'E') this.maxDistE = Math.max(this.maxDistE, r - O.R_E);
    if (s.body === 'E' && alt <= DOWN_E && vs < 0) { this.toFlatE(); return true; }
    if (s.body === 'M') {
      if (alt <= DOWN_M && (vh < SIDE_M || alt < 3000)) { this.toFlatM(); return true; }
      if (alt <= 0) { f.landSpeed = V.len(s.v); f.alt = 0; failFlight(f, 'moonImpact'); return true; }
    }
    return false;
  }
  // after every flat sim step: climb out of the range / off the Moon into the space leg
  afterFlat() {
    if (!this.on) return false;
    const f = this.f; if (f.phase !== 'flying') return false;
    if (this.mode === 'flatE' && f.origin.y > UP_E) {
      const B = O.padBasis(this.sky, f.t), k = O.localToBody(B, O.R_E, { x: 0, z: 0 }, f.pos, f.vel, SPIN_E);
      this.s = { body: 'E', r: k.r, v: k.v, t: f.t }; this.att = V.norm(O.localToVec(B, f.up)); this.point = 'hold';
      this.mode = 'space'; this.hud.classList.remove('hidden'); this.uiT = 1;
      this.fm.g.toast('Space: orbit physics on. Q points the rocket, , and . change time warp.', 3600);
      return true;
    }
    if (this.mode === 'flatM') {
      const o = this.site.o;
      if (f.alt > UP_M || Math.hypot(f.pos.x - o.x, f.pos.z - o.z) > 40e3) {
        const B = O.moonBasis(this.sky, f.t, this.site.bodyUp), k = O.localToBody(B, O.R_M, o, f.pos, f.vel, V.mul(this.sky.H, O.N_M));
        this.s = { body: 'M', r: k.r, v: k.v, t: f.t }; this.att = V.norm(O.localToVec(B, f.up)); this.point = 'hold';
        this.mode = 'space'; this.uiT = 1; this.fm.camInit = false; return true;
      }
    }
    return false;
  }
  toFlatE() {
    const f = this.f, s = this.s, B = O.padBasis(this.sky, s.t), k = O.bodyToLocal(B, O.R_E, { x: 0, z: 0 }, s.r, s.v, SPIN_E);
    if (Math.hypot(k.p.x, k.p.z) > 300e3) { k.p.x = SPOTS.pad.x; k.p.z = SPOTS.pad.z + 2000; k.p.y = V.len(s.r) - O.R_E; }   // far from the range: drawn over it
    this.setFlat(k.p, k.v, O.vecToLocal(B, this.att)); delete f.gee; f.vacuum = false; f.padPos = { ...this.padPos0 };
    this.mode = 'flatE'; this.view.hideAll(); this.warp.reset(); this.fm.camInit = false;
    this.fm.g.toast('Back in the air over Earth', 2600);
  }
  toFlatM() {
    const f = this.f, s = this.s, A = O.moonAxes(this.sky, s.t), n = V.norm(s.r);
    const bodyUp = [V.dot(n, A.x), V.dot(n, A.y), V.dot(n, A.z)], o = { x: SPOTS.pad.x, z: SPOTS.pad.z };
    this.site = { bodyUp, o, ll: O.moonLatLon(this.sky, s.t, s.r) };
    const B = O.moonBasis(this.sky, s.t, bodyUp), k = O.bodyToLocal(B, O.R_M, o, s.r, s.v, V.mul(this.sky.H, O.N_M));
    this.setFlat(k.p, k.v, O.vecToLocal(B, this.att));
    f.gee = O.G_M; f.vacuum = true; f.wind = 0; f.windFloor = 0; f.padPos = { x: o.x, y: 0, z: o.z }; f.legCmd = 'auto';
    this.mode = 'flatM'; this.warp.reset(); this.fm.camInit = false; this.everMoon = true;
    this.view.buildCap(this.sky, s.t, bodyUp, o.x, o.z);
    this.fm.g.toast('Landing mode: legs down, under 5 m/s, upright. Follow the landing guide.', 3600);
  }
  setFlat(p, v, upL) {
    const f = this.f, u = new THREE.Vector3(upL.x, upL.y, upL.z).normalize();
    f.st = stats(f.rocket, f.fill, f.fuelFrac);
    f.pos = { x: p.x, y: p.y, z: p.z }; f.vel = { x: v.x, y: v.y, z: v.z }; f.up = { x: u.x, y: u.y, z: u.z }; f.w = { x: 0, y: 0, z: 0 };
    f.origin = { x: p.x - u.x * f.st.com, y: p.y - u.y * f.st.com, z: p.z - u.z * f.st.com };
    this.fm.capture(this.fm.cur); this.fm.copyPose(this.fm.prev, this.fm.cur);
  }
  // ---------- space-leg controls ----------
  input(dt) {
    const f = this.f, s = this.s, B = this.B || O.padBasis(this.sky, s.t);
    const sl = Math.hypot(f.steer.x, f.steer.z);
    if (sl > 0.02) { this.point = 'hold'; const d = O.localToVec(B, { x: f.steer.x, y: 0, z: f.steer.z }); this.att = V.norm(V.add(this.att, d, 0.9 * dt)); return; }
    const tgt = this.target(); if (!tgt) return;
    // slew at up to ~30 deg/s of real time; snap when coasting fast-forward
    const c = Math.max(-1, Math.min(1, V.dot(this.att, tgt))), ang = Math.acos(c), maxA = this.warp.k > 10 && !f.e.on ? 9 : 0.52 * dt;
    if (ang <= maxA || ang < 1e-6) this.att = tgt;
    else { const ax = V.norm(V.cross(this.att, tgt)), k = maxA; this.att = V.norm(V.add(V.mul(this.att, Math.cos(k)), V.cross(ax, this.att), Math.sin(k))); }
  }
  target() {
    const s = this.s, r = V.norm(s.r), v = V.norm(s.v), n = V.norm(V.cross(s.r, s.v));
    return { hold: null, pro: v, retro: V.mul(v, -1), radOut: r, radIn: V.mul(r, -1), normal: n, anti: V.mul(n, -1) }[this.point];
  }
  cyclePoint() { if (this.mode !== 'space') return; const i = POINTS.findIndex(p => p[0] === this.point); this.point = POINTS[(i + 1) % POINTS.length][0]; this.uiT = 1; this.fm.g.audio.tap(); }
  capNow() { const s = this.s; if (!s || this.mode !== 'space') return 1; const f = this.f; return warpCap({ thrust: f.e.on || (f.eng && f.e.cmd >= f.eng.minThrottle - 1e-6 && f.fuelFrac > 0), body: s.body, alt: V.len(s.r) - O.radiusOf(s.body) }); }
  warpUp() { if (this.mode !== 'space') { this.fm.g.toast('Time warp works in space, not near the ground', 2000); return; } if (!this.warp.up(this.capNow())) this.fm.g.toast(this.f.e.on ? 'Engine on: warp up to 10×' : 'Too close to go faster', 1600); this.uiT = 1; }
  warpDown() { this.warp.down(); this.uiT = 1; }
  // ---------- render frame: where the space state sits in the world camera's local metres ----------
  mapFrame() {
    const f = this.f, s = this.s, sky = this.sky, t = s.t, R = O.radiusOf(s.body), r = V.len(s.r), alt = r - R, fm = this.fm;
    let kind = 'deep', p, v, B;
    if (s.body === 'E' && alt < 600e3) {
      B = O.padBasis(sky, t); const k = O.bodyToLocal(B, O.R_E, { x: 0, z: 0 }, s.r, s.v, SPIN_E);
      if (Math.hypot(k.p.x, k.p.z) < 600e3) { kind = 'pad'; p = k.p; v = k.v; }
    }
    const rE = O.toEarth(sky, s).r;
    if (kind === 'deep') {
      if (this.frameKind !== 'deep' || !this.anchor) { this.B0 = O.padBasis(sky, t); this.anchor = rE; this.base = { x: SPOTS.pad.x, y: 1e5, z: SPOTS.pad.z }; }
      B = this.B0;
      let l = O.vecToLocal(B, V.sub(rE, this.anchor));
      if (Math.hypot(l.x, l.y, l.z) > 20e3) {   // re-anchor the floating origin; shift the smoothed camera along
        this.anchor = rE;
        for (const c of [fm.camPos, fm.camLook, fm.dirShot]) if (c) { c.x -= l.x; c.y -= l.y; c.z -= l.z; }
        l = { x: 0, y: 0, z: 0 };
      }
      p = { x: this.base.x + l.x, y: this.base.y + l.y, z: this.base.z + l.z }; v = O.vecToLocal(B, s.v);
    }
    if (kind !== this.frameKind) { fm.camInit = false; this.frameKind = kind; }
    this.B = B;
    if (this.warp.k > 1) fm.camInit = false;   // fast-forward: the camera snaps to the rocket instead of trailing it
    this.setFlat(p, v, O.vecToLocal(B, this.att));
    const up = V.mul(s.r, 1 / r);
    f.alt = alt; f.vs = V.dot(s.v, up); f.speed = V.len(s.v); f.q = 0; f.aoa = 0; f.windNow = { x: 0, y: 0, z: 0 };
    f.tilt = Math.acos(Math.max(-1, Math.min(1, V.dot(this.att, up)))) * 180 / Math.PI;
    if (s.body === 'E') f.apex = Math.max(f.apex, alt);
    f.topSpeed = Math.max(f.topSpeed, f.speed);
  }
  // camera local -> Earth-centred inertial, for the renderer
  camFn() {
    const sky = this.sky, t = this.f.t;
    if (this.mode === 'flatM') { const B = O.moonBasis(sky, t, this.site.bodyUp), o = this.site.o, mE = O.moonPos(sky, t); return { B, fn: lp => V.add(mE, O.localToBody(B, O.R_M, o, lp, { x: 0, y: 0, z: 0 }).r) }; }
    if (this.frameKind === 'deep') { const B = this.B0, A = this.anchor, b = this.base; return { B, fn: lp => V.add(A, O.localToVec(B, { x: lp.x - b.x, y: lp.y - b.y, z: lp.z - b.z })) }; }
    const B = this.B || O.padBasis(sky, t); return { B, fn: lp => O.localToBody(B, O.R_E, { x: 0, z: 0 }, lp, { x: 0, y: 0, z: 0 }).r };
  }
  // ---------- once per frame, before flight.js handles the events ----------
  frame(dt, events) {
    if (!this.on) return;
    const f = this.f, fm = this.fm, inp = fm.g.input;
    if (!fm.g.resultsOpen && !fm.g.menuOpen) {
      if (inp.hit('Period')) this.warpUp();
      if (inp.hit('Comma')) this.warpDown();
      if (inp.hit('KeyQ')) this.cyclePoint();
    }
    // the Moon: a touchdown keeps the rocket there (no auto end); throttle up to lift off again
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (this.mode === 'flatM' && ev.type === 'landed') {
        events.splice(i, 1); this.moonLandings++; this.lastLand = { speed: f.landSpeed, soft: f.soft, ll: this.site.ll };
        fm.g.audio.star?.(0); fm.g.audio.star?.(1);
        fm.g.toast(`Landed on the Moon at ${f.landSpeed.toFixed(1)} m/s. Throttle up to lift off, or press Back to end the flight.`, 5200);
      }
    }
    if (this.mode === 'flatM' && (f.phase === 'landed' || f.phase === 'pad') && !fm.ended && f.eng) {
      const want = f.e.cmd >= f.eng.minThrottle - 1e-6 && f.fuelFrac > 0;
      if (want && f.phase === 'landed') { f.phase = 'pad'; f.heavyT = 0; }
      else if (!want && f.phase === 'pad') { f.phase = 'landed'; f.e.on = false; }
    }
    if (this.mode === 'flatE' && f.phase !== 'pad' && !this.pad.classList.contains('hidden')) this.pad.classList.add('hidden');
    if (this.mode === 'flatE' && f.phase === 'pad' && fm.countdown == null && this.pad.classList.contains('hidden') && f.flightT === 0) { this.pad.classList.remove('hidden'); this.padInfo(); }
    // renderer frame + path + markers
    const V2 = this.view, space = this.mode === 'space', moon = this.mode === 'flatM';
    if (space || moon) {
      const cf = this.camFn();
      V2.setFrame({ B: cf.B, camECI: cf.fn, sky: this.sky, t: this.s && space ? this.s.t : f.t, moon, group: fm.group });
      V2.active = moon || this.frameKind === 'deep'; V2.overlayOn = space && this.frameKind === 'pad';
      this.path(dt, cf);
      V2.markers(this.w.camera, true);
      this.hud.classList.remove('hidden');
    } else { V2.hideAll(); this.hud.classList.add('hidden'); }
    this.uiT += dt; if (this.uiT > 0.25 && (space || moon)) { this.uiT = 0; this.readouts(); }
  }
  path(dt, cf) {
    if (this.mode !== 'space' || this.f.phase === 'crashed') { this.view.setPath([]); return; }
    this.predT += dt;
    if (!this.pred || this.predT > (this.warp.k > 100 ? 0.15 : 0.4)) { this.predT = 0; this.pred = O.predict(this.sky, this.s, { n: 360, horizon: 12 * 86400 }); }
    const P = this.pred, sky = this.sky, mRef = this.s.body === 'E' && P.enterSOI != null ? O.moonPos(sky, P.enterSOI) : O.moonPos(sky, this.s.t);
    const inv = cf.fn(this.w.camera.position), B = cf.B, cp = this.w.camera.position, out = [];
    for (const q of P.pts) {
      const rE = q.m ? V.add(q.r, mRef) : q.r, d = O.vecToLocal(B, V.sub(rE, inv));
      out.push({ x: cp.x + d.x, y: cp.y + d.y, z: cp.z + d.z });
    }
    this.view.setPath(out);
  }
  readouts() {
    const f = this.f, s = this.s;
    const pointName = (POINTS.find(p => p[0] === this.point) || POINTS[0])[1];
    $('mhPoint').textContent = 'Point: ' + pointName + ' (Q)'; $('mhWarp').textContent = 'Warp ' + this.warp.k.toLocaleString() + '×';
    this.hud.querySelector('.row').classList.toggle('hidden', this.mode !== 'space');
    const st = stats(f.rocket, f.fill, f.fuelFrac), dvLeft = st.dv * 1.1;
    $('mhDv').textContent = `Δv left ≈ ${(dvLeft / 1000).toFixed(2)} km/s (vacuum)`;
    let where = '', moon = '', tip = '';
    if (this.mode === 'flatM') {
      where = this.moonLandings && (f.phase === 'landed' || f.phase === 'pad') ? `On the Moon · ${fmtLL(this.site.ll)}` : `Over the Moon · ${Math.round(f.alt).toLocaleString()} m`;
      const side = Math.hypot(f.vel.x, f.vel.z);
      moon = `Sideways ${side.toFixed(1)} m/s (land under 3) · down ${Math.max(0, -f.vs).toFixed(1)} m/s (under 5)`;
      tip = this.moonLandings && f.phase !== 'flying' ? 'Landed. Throttle up to lift off; above 15 km the orbit physics take over again.' : 'Landing: legs down, under 5 m/s, upright (Hold upright helps). The landing guide shows a safe descent speed.';
    } else if (s) {
      const mu = O.muOf(s.body), el = O.elements(s.r, s.v, mu), R = O.radiusOf(s.body), P = this.pred;
      const mrel = s.body === 'E' ? V.sub(s.r, O.moonPos(this.sky, s.t)) : s.r, dm = V.len(mrel) - O.R_M;
      if (s.body === 'E') {
        where = el.e < 1 && el.ra < O.A_M * 0.6 ? (el.rp > R + 100e3 ? `Earth orbit ${km(el.rp - R)} × ${km(el.ra - R)} km` : `Up ${km(f.alt)} km · highest ${km(el.ra - R)} km, then falls back`) : `Heading out · ${km(f.alt)} km from Earth`;
        const ph = phaseAngle(this.sky, s);
        moon = `Moon ${km(dm)} km` + (P?.enterSOI != null ? ` · reach its pull in ${dur(P.enterSOI - s.t)}` : P ? ` · closest pass ${km(P.closest - O.R_M)} km` : '');
        if (P?.enterSOI != null) tip = P.impact?.body === 'M' ? 'On a collision course with the Moon: burn retrograde near it to slow down.' : 'On course for the Moon. Coast with time warp (.); it slows down by itself near the Moon.';
        else if (el.e < 1 && el.rp > R + 100e3 && el.ra < O.A_M * 0.3) tip = `To go to the Moon: point Prograde (Q) and burn ~${NEED.tli} km/s when the Moon is about 140° ahead (now ${Math.round(ph)}°). Stop when "reach its pull" appears.`;
        else if (el.rp < R + 100e3 && el.e < 1) tip = `Not in orbit yet: orbit needs ~7.8 km/s sideways at 200 km. A one-stage rocket cannot get there; try the practice orbit on the pad.`;
        else tip = 'Coasting. Use time warp (.) and watch the closest pass.';
      } else {
        where = el.E < 0 ? `Moon orbit ${km(el.rp - R)} × ${km(Math.min(el.ra, O.R_SOI) - R)} km` : `Passing the Moon · ${km(dm)} km up`;
        moon = `Closest ${km(el.rp - R)} km above the surface` + (P?.impact?.body === 'M' ? ` · surface in ${dur(P.impact.t - s.t)}` : '');
        tip = el.E >= 0 ? 'Point Retrograde (Q) and burn near the closest point to get captured.' : el.rp - R > 20e3 ? 'To land: burn Retrograde to lower the closest point below the surface, then brake. Landing mode starts below 12 km once sideways speed is under 250 m/s.' : `Brake! Kill sideways speed (now ${Math.round(sideSpeed(s))} m/s) before 12 km, then land.`;
      }
    }
    for (const [id, v] of [['mhWhere', where], ['mhMoon', moon], ['mhTip', tip]]) if ($(id).textContent !== v) $(id).textContent = v;
  }
  // ---------- flight end / back ----------
  back() {
    const f = this.f, fm = this.fm;
    if (this.on && this.mode === 'flatM' && this.moonLandings && (f.phase === 'landed' || f.phase === 'pad') && !fm.ended) { fm.endFlight('landed'); return true; }
    return false;
  }
  endInfo(how, info) {
    if (!this.on || !info) return;
    const f = this.f, onMoon = this.mode === 'flatM' || this.s?.body === 'M' && this.mode === 'space';
    const extra = [];
    if (how === 'landed' && this.mode === 'flatM') { info.title = 'Landed on the Moon'; info.reason = `Touched down at ${f.landSpeed.toFixed(1)} m/s at ${fmtLL(this.site.ll)}.`; }
    else if (how === 'crash' && onMoon) { info.title = 'Crashed on the Moon'; if (f.failure?.kind === 'moonImpact') { info.reason = `Hit the surface at ${Math.round(f.landSpeed).toLocaleString()} m/s.`; info.hint = 'burn retrograde earlier to kill the sideways speed; landing mode starts below 12 km under 250 m/s.'; } }
    else if (this.moonLandings) extra.push(`Landed on the Moon ${this.moonLandings === 1 ? 'once' : this.moonLandings + ' times'} on this flight.`);
    if (this.everMoon && how !== 'landed') extra.push("Reached the Moon's pull.");
    if (this.maxDistE > 1000e3) extra.push(`Farthest from Earth: ${km(this.maxDistE)} km.`);
    if (this.practice) extra.push('(Practice start in a 200 km orbit.)');
    if (extra.length) info.reason = (info.reason ? info.reason + ' ' : '') + extra.join(' ');
  }
}
function sideSpeed(s) { const u = V.norm(s.r), vs = V.dot(s.v, u); return V.len(V.sub(s.v, V.mul(u, vs))); }
// angle (deg, 0..360) from the rocket to the Moon measured along the rocket's direction of travel
export function phaseAngle(sky, s) {
  const r = V.norm(s.r), m = V.norm(O.moonPos(sky, s.t)), h = V.norm(V.cross(s.r, s.v));
  const a = Math.atan2(V.dot(V.cross(r, m), h), V.dot(r, m)) * 180 / Math.PI; return (a + 360) % 360;
}
const fmtLL = ll => ll ? `${Math.abs(ll.lat).toFixed(1)}°${ll.lat >= 0 ? 'N' : 'S'} ${Math.abs(ll.lon).toFixed(1)}°${ll.lon >= 0 ? 'E' : 'W'}` : 'the Moon';
function css() {
  if (document.getElementById('moonCss')) return;
  const s = document.createElement('style'); s.id = 'moonCss';
  s.textContent = `
#moonPad,#moonHud{position:absolute;left:50%;transform:translateX(-50%);background:var(--glass,rgba(10,14,20,.72));border:1px solid rgba(127,231,255,.35);border-radius:14px;padding:8px 14px;max-width:min(560px,92vw);font-size:13px;line-height:1.35;text-align:center}
#moonPad{bottom:calc(128px + var(--sb,0px));padding:5px 10px}#moonPad .row{display:flex;gap:8px;align-items:center;justify-content:center}
#moonPad p{margin:6px 0 0}#moonPad small{display:block;color:var(--dim,#9aa6b2);font-size:11px;margin-top:4px}#moonPad button{min-height:32px;padding:2px 12px}#moonPad #mpInfo{min-width:32px;padding:2px 8px}
#moonHud{top:calc(44px + var(--st,0px));display:flex;flex-direction:column;gap:2px;pointer-events:none}#moonHud b{font-size:14px}#moonHud em{font-style:normal;color:var(--dim,#9aa6b2);font-size:12px}
#moonHud .row{display:flex;gap:6px;justify-content:center;margin-top:4px}#moonHud button{pointer-events:auto;min-height:30px;padding:2px 10px;font-size:12px}
#moonPad .good,#moonHud .good{color:#5fe08a}#moonPad .warn{color:#ffd166}#moonPad .badc{color:#ff7b6b}
.mkBody{position:fixed;left:0;top:0;z-index:4;pointer-events:none;font-size:12px;color:#dfe8f0;white-space:nowrap;text-shadow:0 1px 2px #000}
.mkBody i{position:absolute;left:-9px;top:-9px;width:16px;height:16px;border:1.5px solid #7fe7ff;border-radius:50%}.mkBody.earth i{border-color:#6fa8ff}
.mkBody span{position:absolute;left:12px;top:-16px;font-weight:700}.mkBody b{position:absolute;left:12px;top:-2px;font-weight:400;color:#9fb4c6}
.mkBody.edge i{border-style:dashed}body.menuopen .mkBody{display:none}`;
  document.head.appendChild(s);
}
