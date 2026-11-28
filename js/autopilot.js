// Moon autopilot (gb3-moon-rocket). Flies a staged rocket from the Earth pad to a powered landing on the Moon with the player's own
// controls only: throttle, steering (with or without Hold upright), Q-style pointing in space, staging, launch and time warp.
// It never writes position, velocity or mass; every metre per second comes from the engines through sim.js / moon.js / orbit.js.
// Pure logic (no three.js / DOM): flight.js and the node test give it the same small "io" adapter.
//
// io = { f, moon, throttle(x), steer(x, z), assist(on), point(dir | null), stage(), warp(k), launch(), note(text) }
//   f      the sim flight (sim.js)            moon   MoonFlight (mode 'flatE' | 'space' | 'flatM', s = { body, r, v, t }, sky, warp)
//   warp(k) asks for that time-warp level (moon.js still caps it); point(dir) points the rocket (inertial unit vector) in space.
//
// Phases: ASCENT -> ORBIT -> COAST -> TLI -> CRUISE -> CAPTURE -> LANDING -> LANDED. The player takes over with any control.
import * as O from './orbit.js';
import { PARTS, stats } from './rocket.js';
import { stageDry, canStage, split, stageStats } from './staging.js';
import { HEAT } from './heat.js';   // GB5-HEAT: the hull's damage line (read only)
const { V } = O;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const G0 = 9.80665;
export const PHASES = ['ASCENT', 'ORBIT', 'COAST', 'TLI', 'CRUISE', 'CAPTURE', 'LANDING', 'LANDED'];
export const AP = {
  orbitAlt: 170e3,        // parking orbit (circular), m
  minPerigee: 130e3,      // "stable": perigee this high or the ORBIT phase trims it (atmosphere ends at 100 km)
  roundness: 40e3,        // apoapsis - periapsis that still counts as a circular parking orbit, m
  llo: 100e3,             // lunar capture orbit altitude
  tliDv: 3130,            // impulsive estimate used to pick the departure moment (the burn itself is closed-loop)
  maxG: 4,                // upper stages throttle back above this acceleration (g)
  handover: { alt: 13000, vr: -30 },  // where the space-leg braking aims (sideways speed ~0); moon.js hands over to the flat landing sim below 12 km
};
const v3len = a => Math.hypot(a.x, a.y, a.z);

export class Autopilot {
  constructor(io) { this.io = io; this.on = false; this.phase = 'OFF'; this.msg = ''; this.events = []; this.stats = { stages: [] }; }
  // ---------------- engage / disengage ----------------
  engage() {
    const f = this.io.f, m = this.io.moon;
    if (!f || f.phase === 'crashed') return this.refuse('Nothing to fly');
    if (!m?.on) return this.refuse('Autopilot flies Free Mode Moon trips only');
    this.on = true; this.t0 = f.t; this.plan = null; this.tli = null; this.mcc = 0; this.capT = null; this.desc = null; this.kick = null;
    if (m.mode === 'flatM') this.set(f.phase === 'landed' ? 'LANDED' : 'LANDING');
    else if (m.mode === 'space' && m.s.body === 'M') this.set('CAPTURE');
    else if (m.mode === 'space') { const el = O.elements(m.s.r, m.s.v, O.MU_E); this.set(el.rp - O.R_E > 110e3 && el.e < 0.9 ? 'ORBIT' : el.e >= 0.9 ? 'CRUISE' : 'ASCENT'); }
    else this.set(f.phase === 'pad' || f.phase === 'flying' ? 'ASCENT' : 'LANDED');
    this.io.note?.('Autopilot on: ' + this.phase);
    return true;
  }
  refuse(why) { this.io.note?.(why); return false; }
  disengage(why = 'off') {
    if (!this.on) return;
    this.on = false; const was = this.phase; this.phase = 'OFF';
    this.io.point(null); this.io.steer(0, 0); this.io.warp(1); this.io.assist(null);
    this.events.push({ type: 'disengage', why, was });
    this.io.note?.(why === 'input' ? 'Autopilot off: you have control' : 'Autopilot off');
  }
  set(p) { if (this.phase !== p) { this.phase = p; this.phaseT = this.io.f.t; this.events.push({ type: 'phase', phase: p, t: this.io.f.t }); } }
  // ---------------- every frame ----------------
  update(dt) {
    if (!this.on) return;
    const io = this.io, f = io.f, m = io.moon;
    if (f.phase === 'crashed') { this.disengage('crashed'); return; }
    // auto-stage: the burning stage is dry and another one is waiting
    if (canStage(f) && stageDry(f)) { this.stats.stages.push({ index: f.stage || 0, t: f.t, alt: f.alt }); io.stage(); }
    if (m.mode === 'space') io.steer(0, 0);   // in space a stick input means "steer by hand" to moon.js; the autopilot points instead
    switch (this.phase) {
      case 'ASCENT': return this.ascent(dt);
      case 'ORBIT': return this.orbit(dt);
      case 'COAST': return this.coast(dt);
      case 'TLI': return this.tliBurn(dt);
      case 'CRUISE': return this.cruise(dt);
      case 'CAPTURE': return this.capture(dt);
      case 'LANDING': return this.landing(dt);
      case 'LANDED': io.throttle(0); io.warp(1); return;
    }
  }
  // ---------------- helpers ----------------
  st() { const f = this.io.f; return stats(f.rocket, f.fill, f.fuelFrac); }
  thrustVac() { const f = this.io.f; return f.eng ? f.eng.thrust * 1.1 : 0; }
  gLimit() { const e = this.io.f.eng; return e ? Math.min(1, (AP.maxG * G0) * this.st().mass / (e.thrust * 1.1)) : 1; }   // keep the crew under maxG
  safeThr() { const e = this.io.f.eng; return e ? Math.min(1, e.heat.safeThrottle) : 1; }
  // GB5 re-entry / ascent heating: past 70% of the hull's damage line, throttle back (slower in the thick air = less heat);
  // at 100% it sits at the engine's lowest throttle. The Moon Rocket's climb never gets near it (peak ~130 °C)
  heatGuard() { const hl = this.io.f.hull; if (!hl) return 1; const td = HEAT.T_DMG * (hl.spec?.tol ?? 1); return clamp(1 - (hl.T - 0.7 * td) / (0.3 * td), 0, 1); }
  // throttle as a fraction, kept inside what the engine can do (0 = off)
  thr(x) { const e = this.io.f.eng; if (!e || x <= 0) { this.io.throttle(0); return; } this.io.throttle(clamp(x, e.minThrottle, this.safeThr())); }
  // warp: highest level whose per-frame step keeps `tEvent` seconds at least ~4 frames away
  warpFor(tEvent, dt) { let k = 1; for (const w of [10, 100, 1000, 10000, 100000]) if (w * dt * 4 < tEvent) k = w; this.io.warp(k); return k; }
  frameOf(s) { const r = V.norm(s.r), n = V.norm(V.cross(s.r, s.v)), h = V.norm(V.cross(n, r)); return { r, n, h }; }
  // ---------------- ASCENT ----------------
  // plan: the orbit plane that holds the pad (at insertion) and the Moon (at arrival, about three days later), so the trip needs no plane change
  planPlane() {
    const m = this.io.moon, sky = m.sky, t = this.io.f.t;
    const Pins = O.padBasis(sky, t + 480).up, M = V.norm(O.moonPos(sky, t + 3.15 * 86400));   // where the Moon is at arrival (~1-2 parking orbits + ~3 days out)
    let n = V.norm(V.cross(Pins, M));
    const B = O.padBasis(sky, t); let d = V.norm(V.cross(n, B.up));
    if (V.dot(d, B.east) < 0) { n = V.mul(n, -1); d = V.mul(d, -1); }
    // ground heading: the inertial direction minus the pad's own spin (the conversion at 70 km adds it back)
    const spin = V.mul(B.east, O.W_E * O.R_E * Math.cos(O.PAD.lat * Math.PI / 180));
    const g = V.sub(V.mul(d, 7800), spin), gl = O.vecToLocal(B, g), hl = Math.hypot(gl.x, gl.z);
    this.plane = { n, head: { x: gl.x / hl, z: gl.z / hl } };
  }
  ascent(dt) {
    const io = this.io, f = io.f, m = io.moon;
    if (!this.plane) this.planPlane();
    if (f.phase === 'pad') { this.thr(this.safeThr()); io.launch(); return; }
    if (m.mode === 'flatE') return this.ascentFlat(dt);
    if (m.mode === 'space') return this.ascentSpace(dt);
  }
  // flat range leg: hold upright off, steer the bell like the player does (the stick tilts the nose toward where it points)
  ascentFlat(dt) {
    const io = this.io, f = io.f, st = this.st(), v = f.vel, sp = v3len(v);
    io.assist(false); this.thr(this.safeThr() * this.heatGuard());
    const H = this.plane.head;
    let ud;
    if (sp < 70 || f.alt < 600) ud = { x: 0, y: 1, z: 0 };
    else {
      // gravity turn: a small kick toward the heading, then follow the velocity; the nose never drops below a floor that keeps
      // the climb steep while the air is thick (aero heating ~ sqrt(rho) v^3 and q limits come from the real health model)
      const vh = Math.hypot(v.x, v.z), gam = Math.atan2(v.y, vh);       // flight-path angle above the horizon
      const floor = clamp((AP.floorA ?? 75) - f.alt / 1000 * (AP.floorB ?? 1.0), AP.floorMin ?? 18, 88) * Math.PI / 180;
      const kick = (AP.kick ?? 4) * Math.PI / 180;
      let el = Math.min(gam, Math.PI / 2 - kick);
      if (this.kickDone || gam < Math.PI / 2 - kick) this.kickDone = true;
      el = Math.max(el, floor);
      ud = { x: H.x * Math.cos(el), y: Math.sin(el), z: H.z * Math.cos(el) };
      // keep the plane: drift sideways off the heading is steered out
      const side = { x: -H.z, z: H.x }, vs = v.x * side.x + v.z * side.z;
      const k = clamp(-vs / Math.max(50, sp) * 2, -0.2, 0.2); ud.x += side.x * k; ud.z += side.z * k;
      const l = v3len(ud); ud.x /= l; ud.y /= l; ud.z /= l;
    }
    this.steerTo(ud, st, dt);
  }
  // attitude by gimbal: steer toward the target with a rate limit sized by what the bell can do (no assist)
  steerTo(ud, st, dt) {
    const io = this.io, f = io.f, up = f.up, eng = f.eng;
    const thrust = f.e.on ? eng.thrust * f.e.thr * f.e.spool : 0;
    const lever = Math.max(0.5, st.com - f.engLen), gmax = Math.tan((eng.gimbalDeg || 0) * Math.PI / 180);
    const amax = Math.max(1e-4, thrust * gmax * lever / st.I);
    const ex = ud.x - up.x * (ud.x * up.x + ud.y * up.y + ud.z * up.z), ey = ud.y - up.y * (ud.x * up.x + ud.y * up.y + ud.z * up.z), ez = ud.z - up.z * (ud.x * up.x + ud.y * up.y + ud.z * up.z);
    const el = Math.hypot(ex, ey, ez), w = f.w;
    const rv = { x: w.y * up.z - w.z * up.y, y: w.z * up.x - w.x * up.z, z: w.x * up.y - w.y * up.x };   // how fast the nose moves
    const wd = Math.min(0.12, Math.sqrt(1.2 * amax * el)), k = el > 1e-6 ? wd / el : 0;
    const tau = 0.35;
    let sx = (ex * k - rv.x) / (amax * tau), sz = (ez * k - rv.z) / (amax * tau);
    const sm = Math.hypot(sx, sz); if (sm > 1) { sx /= sm; sz /= sm; }
    io.steer(sx, sz);
  }
  // space leg: closed-loop guidance to a circular orbit (radial: zero-effort-miss on height and climb rate; across: null the
  // out-of-plane speed; the rest along the horizon). Cuts off when the orbit's energy reaches the circular one.
  ascentSpace(dt) {
    const io = this.io, m = io.moon, s = m.s, f = io.f;
    if (s.body !== 'E') { this.set('CRUISE'); return; }
    io.warp(1);
    const R = V.len(s.r), alt = R - O.R_E, rt = O.R_E + AP.orbitAlt, vc = Math.sqrt(O.MU_E / rt);
    const r = V.norm(s.r), n = this.plane?.n || V.norm(V.cross(s.r, s.v)), h = V.norm(V.cross(n, r));
    const vr = V.dot(s.v, r), vh = V.dot(s.v, h), vn = V.dot(s.v, n);
    const el = O.elements(s.r, s.v, O.MU_E);
    // cut off once the orbit has the energy of the circular one (it is then roughly circular: the guidance has held the climb rate ~0)
    if (vh >= Math.sqrt(O.MU_E / R) && el.rp > O.R_E + AP.minPerigee) { this.thr(0); io.point(null); this.set('ORBIT'); return; }
    const st = this.st(), a = this.thrustVac() * f.e.thr / st.mass || this.thrustVac() * 0.9 / st.mass;
    if (!f.e.on && !stageDry(f)) this.thr(1);
    // time to go from the rocket equation (all stages left), for the speed still missing
    const tgo = clamp(this.burnTime(Math.hypot(vc - vh, vr, vn) * 1.03), 8, 900);
    const gEff = O.MU_E / (R * R) - vh * vh / R;
    // optimal-control steering on height and climb rate (zero-effort miss / velocity): a = 6 ZEM / t^2 - 2 ZEV / t
    const zem = (AP.orbitAlt - alt) - vr * tgo, zev = 0 - vr;
    let ar = gEff + 6 * zem / (tgo * tgo) - 2 * zev / tgo;
    const an = clamp(-vn / Math.max(tgo, 30), -0.3 * a, 0.3 * a);
    this.dbg = { a, tgo, zem, zev, gEff, ar0: ar };
    ar = clamp(ar, -0.7 * a, 0.95 * a);
    const ah = Math.sqrt(Math.max(0, a * a - ar * ar - an * an));
    io.point(V.norm(V.add(V.add(V.mul(r, ar), h, ah), n, an)));
    this.thr(this.gLimit());
  }
  // ---------------- ORBIT: trim to a stable, roughly circular parking orbit ----------------
  orbit(dt) {
    const io = this.io, m = io.moon, s = m.s;
    if (m.mode !== 'space') { this.set('ASCENT'); return; }
    const el = O.elements(s.r, s.v, O.MU_E), R = V.len(s.r), vr = V.dot(s.v, V.norm(s.r));
    const pe = el.rp - O.R_E, ap = el.ra - O.R_E;
    if (pe > AP.minPerigee && ap - pe < AP.roundness) { this.thr(0); io.point(null); this.orbitT = s.t; this.orbitStart = { pe, ap, period: el.period, t: s.t }; this.set('COAST'); return; }
    // raise the perigee with prograde thrust around apoapsis (or anywhere if the apoapsis is already low)
    const nearAp = vr <= 0 ? false : true;
    const tAp = this.timeToApsis(s, 'ap');
    if (this.trimOn || tAp < 15) {
      // circularise: steer the velocity onto the circular one here (horizontal, sqrt(mu/r)); stop when the miss is under 1 m/s
      const r = V.norm(s.r), h = V.norm(V.cross(V.cross(s.r, s.v), s.r)), want = V.mul(h, Math.sqrt(O.MU_E / R)), miss = V.sub(want, s.v);
      this.trimOn = true; io.warp(1);
      if (V.len(miss) < 1 || (this.trimMiss != null && V.len(miss) > this.trimMiss + 0.5)) { this.trimOn = false; this.trimMiss = null; this.thr(0); return; }
      this.trimMiss = V.len(miss); io.point(V.norm(miss));
      const ang = Math.acos(clamp(V.dot(m.att || V.norm(miss), V.norm(miss)), -1, 1)), a = this.thrustVac() / this.st().mass;
      this.thr(ang < 0.08 ? clamp(V.len(miss) / (a * 2), 0.05, 1) : 0);
    } else { this.thr(0); io.point(V.norm(s.v)); this.warpFor(tAp - 20, dt); }
  }
  timeToApsis(s, which) {
    const mu = O.muOf(s.body), el = O.elements(s.r, s.v, mu); if (!(el.e < 1)) return Infinity;
    const a = el.a, e = el.e, R = V.len(s.r), vr = V.dot(s.v, s.r) / R;
    const E = Math.atan2(vr * Math.sqrt(a / mu), 1 - R / a), M = E - e * Math.sin(E), n = Math.sqrt(mu / (a * a * a));
    const Mt = which === 'ap' ? Math.PI : 0; let dM = Mt - M; while (dM < 0) dM += 2 * Math.PI;
    return dM / n;
  }
  // ---------------- COAST in the parking orbit, then pick the departure ----------------
  coast(dt) {
    const io = this.io, m = io.moon, s = m.s;
    this.thr(0); io.point(V.norm(s.v));
    if (!this.tli) {
      const el = O.elements(s.r, s.v, O.MU_E);
      this.tli = this.planTLI(s, s.t + el.period * 1.0);   // at least one full orbit engine-off first
      if (!this.tli) { this.io.note?.('Autopilot: no Moon departure found, holding orbit'); this.tli = { tStart: Infinity }; }
    }
    const left = this.tli.tStart - s.t;
    if (left <= 0.5) { io.warp(1); this.set('TLI'); return; }
    this.warpFor(left, dt);
  }
  // scan departures: an impulsive prograde dv at each moment of the parking orbit (a few sizes, as the Moon's distance varies);
  // keep the one whose path passes the Moon closest to the capture height, then refine the moment and the size.
  planTLI(s0, tEarliest) {
    const sky = this.io.moon.sky, el = O.elements(s0.r, s0.v, O.MU_E), P = el.period, target = O.R_M + AP.llo;
    const at = t => { const k = O.kepler(s0.r, s0.v, t - s0.t, O.MU_E); return { body: 'E', r: k.r, v: k.v, t }; };   // the parking orbit: plain two-body
    const score = (t, dv, c0) => { const c = c0 || at(t); const k = { body: c.body, r: c.r.slice(), v: V.add(c.v, V.norm(c.v), dv), t: c.t }; const a = aimMoon(sky, k, 6 * 86400); return a ? { j: Math.abs(a.rp - target) + (dv - AP.tliDv) * 1500, t, dv, rp: a.rp } : null; };
    let best = null;
    for (let k = 0; k < 16 && !(best && best.j < 20e6); k++) for (let t = tEarliest + k * P; t < tEarliest + (k + 1) * P; t += P / 72) {
      const c = at(t);
      for (const dv of [AP.tliDv - 30, AP.tliDv + 20, AP.tliDv + 70, AP.tliDv + 120]) { const x = score(t, dv, c); if (x && (!best || x.j < best.j)) best = x; }
    }
    if (!best) return null;
    for (let t = best.t - P / 72; t <= best.t + P / 72; t += P / 720) { const x = score(t, best.dv); if (x && x.j < best.j) best = x; }
    for (let dv = best.dv - 40; dv <= best.dv + 40; dv += 4) { const x = score(best.t, dv); if (x && x.j < best.j) best = x; }
    // the real burn is finite (minutes, two stages): fly it in a quick simulation from a few start moments and keep the start
    // and cutoff energy whose pass is closest to the capture height (the closed-loop cutoff in tliBurn then trims the rest)
    const t0 = best.t - this.burnTime(best.dv) * 0.5, sim = ts => this.simBurn(at(ts), best.dv, target);
    let fin = null;
    for (const dt of [0, -40, 40, -80, 80, -20, 20, -60, 60]) { const x = sim(t0 + dt); if (x && (!fin || x.j < fin.j)) fin = x; if (fin && fin.j < 30e3) break; }
    if (fin) for (const step of [10, 3]) for (const dt of [-step, step, -2 * step, 2 * step]) { const x = sim(fin.ts + dt); if (x && x.j < fin.j) fin = x; }
    if (fin && fin.j < 3e6) return { tStart: fin.ts, E: fin.E, rp: fin.rp, dv: fin.dv, sim: true };
    const c = at(best.t), E = O.energy(c.r, V.add(c.v, V.norm(c.v), best.dv), O.MU_E);
    return { tStart: t0, E, rp: best.rp, dv: best.dv };
  }
  // the TLI burn as tliBurn flies it: full throttle, pointed prograde, stage after stage (each stage's own thrust / mass flow,
  // the next one taking over when a tank runs dry). Returns the cutoff (dv flown and orbital energy) with the best Moon pass.
  simBurn(c0, dvPlan, target) {
    const f = this.io.f, sky = this.io.moon.sky, st0 = this.st(), list = [{ mass: st0.mass, fuel: st0.fuel, e: f.eng }];
    const sp = split(f.rocket); if (sp) for (const x of stageStats(sp.upper, f.fill)) list.push({ mass: x.mass, fuel: x.fuel, e: PARTS[x.engineId] });
    const s = { body: c0.body, r: c0.r.slice(), v: c0.v.slice(), t: c0.t };
    let k = 0, m = list[0].mass, fuel = list[0].fuel, done = 0, best = null, nextCheck = dvPlan - 80;
    const h = 0.5;
    for (let i = 0; i < 20000 && k < list.length; i++) {
      const x = list[k]; if (!x.e) break;
      if (fuel <= 0) { k++; if (k >= list.length) break; m = list[k].mass; fuel = list[k].fuel; continue; }
      const T = x.e.thrust * 1.1, mdot = T / (x.e.isp * 1.1 * G0), a = T / m;
      O.thrustStep(sky, s, h, V.mul(V.norm(s.v), a));
      m -= mdot * h; fuel -= mdot * h; done += a * h;
      if (done >= nextCheck) {
        nextCheck += done < dvPlan - 20 || done > dvPlan + 60 ? 10 : 3;
        const am = aimMoon(sky, s, 6 * 86400);
        if (am) { const j = Math.abs(am.rp - target) + Math.abs(done - dvPlan) * 200; if (!best || j < best.j) best = { j, rp: am.rp, dv: done, E: O.energy(s.r, s.v, O.MU_E), ts: c0.t }; }
        if (done > dvPlan + 100) break;
      }
    }
    return best;
  }
  // seconds of full-throttle burning for dv (vacuum), stage after stage (rocket equation, each stage's own mass flow)
  burnTime(dv) {
    const f = this.io.f; let t = 0, left = dv;
    const st0 = this.st(), list = [{ mass: st0.mass, fuel: st0.fuel, e: f.eng }];
    const sp = split(f.rocket); if (sp) for (const x of stageStats(sp.upper, f.fill)) list.push({ mass: x.mass, fuel: x.fuel, e: PARTS[x.engineId] });
    for (const x of list) {
      if (!x.e || left <= 0) break;
      const ve = x.e.isp * 1.1 * G0, mdot = x.e.thrust * 1.1 / ve, dvS = ve * Math.log(x.mass / (x.mass - x.fuel));
      if (left <= dvS) { t += x.mass * (1 - Math.exp(-left / ve)) / mdot; left = 0; break; }
      t += x.fuel / mdot; left -= dvS;
    }
    return t + (left > 0 ? 1e4 : 0);
  }
  tliBurn(dt) {
    const io = this.io, m = io.moon, s = m.s;
    io.warp(1); io.point(V.norm(s.v));
    const E = O.energy(s.r, s.v, O.MU_E), v = V.len(s.v), left = (this.tli.E - E) / v;   // ~m/s still to go
    let stop = s.body === 'M' || left < -60;
    // the last ~40 m/s: cut off at the best predicted pass of the Moon (closes the loop on the finite, multi-stage burn)
    if (!stop && left < 40 && (this.tliN = (this.tliN || 0) + 1) % 3 === 0) {
      const a = aimMoon(m.sky, s, 6 * 86400), j = a ? Math.abs(a.rp - (O.R_M + AP.llo)) : Infinity;
      if (this.tliJ != null && j > this.tliJ && this.tliJ < 5e6) stop = true;   // passed the best pass
      this.tliJ = j;
    }
    if (!stop && left <= 0 && !(this.tliJ < 5e6)) stop = true;   // no close pass in sight: stop on the planned energy, the MCC fixes it
    if (stop) { this.thr(0); this.cruiseT = s.t; this.set('CRUISE'); return; }
    this.thr(left < 15 ? 0.5 : 1);
  }
  // ---------------- CRUISE: mid-course corrections, then wait for the Moon's sphere of influence ----------------
  cruise(dt) {
    const io = this.io, m = io.moon, s = m.s;
    if (s.body === 'M') { this.set('CAPTURE'); return; }
    if (this.mccBurn) return this.flyMcc(dt);
    const due = [this.cruiseT + 3 * 3600, this.cruiseT + 30 * 3600];
    if (this.mcc < due.length && s.t >= due[this.mcc]) {
      this.mcc++;
      const dv = this.solveMcc(s);
      this.stats.mcc = (this.stats.mcc || []).concat([{ t: s.t, dv: dv ? V.len(dv) : null }]);
      if (dv && V.len(dv) > 0.3) { this.mccBurn = { dir: V.norm(dv), dv: V.len(dv), v0: s.v.slice(), t0: null }; return; }
    }
    this.thr(0); io.point(this.mccBurn ? this.mccBurn.dir : V.norm(s.v));
    const next = this.mcc < due.length ? due[this.mcc] - s.t : Infinity;
    const a = aimMoon(m.sky, s), tSoi = a ? a.tEnter - s.t : 86400;
    this.warpFor(Math.min(next, tSoi), dt);
  }
  // b-plane targeting: three-axis impulse (prograde, radial, normal) by Newton steps on the Moon-frame miss vector at SOI entry
  solveMcc(s) {
    const sky = this.io.moon.sky, F = this.frameOf(s), ax = [V.norm(s.v), F.r, F.n];
    const B = d => { const c = { body: s.body, r: s.r.slice(), v: V.add(V.add(V.add(s.v, ax[0], d[0]), ax[1], d[1]), ax[2], d[2]), t: s.t }; const a = aimMoon(sky, c); return a ? a.b : null; };
    const target = bt => { const b = B([0, 0, 0]); if (!b) return null; const l = V.len(b.vec) || 1; return V.mul(b.vec, bt / l); };
    let d = [0, 0, 0], b0 = B(d); if (!b0) return null;
    const bT = bTarget(O.R_M + AP.llo, b0.vinf), T = V.mul(b0.vec, bT / (V.len(b0.vec) || 1));
    for (let it = 0; it < 8; it++) {
      const b = B(d); if (!b) return null;
      const err = V.sub(b.vec, T); if (V.len(err) < 3e3) break;
      // finite-difference Jacobian (3 x 3, rows = b-vector components), least-squares step
      const J = [];
      for (let k = 0; k < 3; k++) { const e = d.slice(); e[k] += 0.5; const bk = B(e); if (!bk) return null; J.push(V.mul(V.sub(bk.vec, b.vec), 1 / 0.5)); }
      const step = lsq(J, V.mul(err, -1));
      const sl = Math.hypot(...step), cap = 60; const k = sl > cap ? cap / sl : 1;
      d = d.map((x, i) => x + step[i] * k);
    }
    return V.add(V.add(V.mul(ax[0], d[0]), ax[1], d[1]), ax[2], d[2]);
  }
  flyMcc(dt) {
    const io = this.io, s = io.moon.s, b = this.mccBurn; io.warp(1); io.point(b.dir);
    const ang = Math.acos(clamp(V.dot(io.moon.att || b.dir, b.dir), -1, 1));
    if (ang > 0.02) { this.thr(0); return; }   // turn first
    const done = V.dot(V.sub(s.v, b.v0), b.dir);
    if (done >= b.dv - 0.05) { this.thr(0); this.mccBurn = null; return; }
    // short burns at low throttle for accuracy
    const st = this.st(), a = this.thrustVac() / st.mass, want = (b.dv - done) / Math.max(dt, 1 / 60) / a;
    this.thr(clamp(want * 0.5, 0, 1));
  }
  // ---------------- CAPTURE into a low lunar orbit ----------------
  capture(dt) {
    const io = this.io, m = io.moon, s = m.s;
    if (m.mode === 'flatM') { this.set('LANDING'); return; }
    if (s.body !== 'M') { this.set('CRUISE'); return; }
    const el = O.elements(s.r, s.v, O.MU_M), R = V.len(s.r), vr = V.dot(s.v, s.r) / R;
    if (el.e < 1 && el.ra - O.R_M < Math.max(1.6 * AP.llo, (el.rp - O.R_M) * 1.5)) { this.thr(0); this.set('LANDING'); return; }
    // time to periapsis on the conic (hyperbola or ellipse)
    const tp = timeToPeri(s.r, s.v, O.MU_M);
    const vp = Math.sqrt(Math.max(0, 2 * (el.E + O.MU_M / el.rp))), vcp = Math.sqrt(O.MU_M / el.rp);
    const bt = this.burnTime(vp - vcp);
    if (this.capOn || (vr < 0 && tp <= bt * 0.55)) {
      this.capOn = true; io.warp(1); io.point(V.mul(V.norm(s.v), -1));
      const ang = Math.acos(clamp(V.dot(m.att, V.mul(V.norm(s.v), -1)), -1, 1));
      this.thr(ang < 0.05 ? 1 : 0);
      if (el.e < 1 && el.ra - O.R_M < Math.max(1.6 * AP.llo, (el.rp - O.R_M) * 1.5)) { this.capOn = false; this.thr(0); this.set('LANDING'); }
      return;
    }
    this.thr(0); io.point(V.mul(V.norm(s.v), -1)); this.warpFor(tp - bt * 0.55 - 30, dt);
  }
  // ---------------- LANDING: braking from orbit, then the flat touchdown ----------------
  landing(dt) {
    const io = this.io, m = io.moon, f = io.f;
    if (f.phase === 'landed') { this.thr(0); this.set('LANDED'); this.io.note?.('Autopilot: landed on the Moon'); return; }
    if (m.mode === 'flatM') return this.touchdown(dt);
    const s = m.s; if (s.body !== 'M') { this.set('CRUISE'); return; }
    io.warp(1);
    const R = V.len(s.r), alt = R - O.R_M, r = V.norm(s.r), st = this.st(), amax = this.thrustVac() / st.mass;
    // horizontal direction (in the orbit plane), surface speed (the Moon turns slowly; moon.js converts with its spin)
    const n = V.norm(V.cross(s.r, s.v)), h = V.norm(V.cross(n, r));
    const vr = V.dot(s.v, r), vh = V.dot(s.v, h), g = O.MU_M / (R * R);
    const H = AP.handover;
    if (!this.desc) {
      // start when a braking burn at ~65% of full thrust would bring the sideways speed to zero by the handover
      const tgo = vh / (0.65 * amax), drop = alt - H.alt;
      const ok = drop < tgo * (Math.abs(vr) + 0.5 * (g - vh * vh / R) * tgo) * 0.9 || alt < 40e3;
      if (!this.deorbit && alt > 30e3) {
        // first lower the periapsis to ~15 km with a small retro burn
        const el = O.elements(s.r, s.v, O.MU_M);
        if (el.rp > O.R_M + 15e3) { io.point(V.mul(V.norm(s.v), -1)); const ang = Math.acos(clamp(V.dot(m.att, V.mul(V.norm(s.v), -1)), -1, 1)); this.thr(ang < 0.05 ? AP.deorbitThr ?? 0.4 : 0); return; }
        this.deorbit = true; this.thr(0);
      }
      if (!ok) { this.thr(0); io.point(V.mul(V.norm(s.v), -1)); const tPe = timeToPeri(s.r, s.v, O.MU_M); this.warpFor(Math.max(10, tPe * 0.5), dt); return; }
      this.desc = { t0: s.t, tgo };
    }
    if (this.desc.final || (vh < 40 && alt < 16e3) || (alt < 20e3 && this.desc.tgo - (s.t - this.desc.t0) < 10)) {
      // arrived over the spot: sink at ~50 m/s with no drift until moon.js hands over to the landing sim (below 12 km)
      this.desc.final = true;
      const ar = g - vh * vh / R + 0.5 * (-50 - vr), ah = -vh / 6, A = Math.hypot(ar, ah);
      io.point(V.norm(V.add(V.mul(r, Math.max(ar, 0.05)), h, ah)));
      if (A < 0.06 * amax) this.io.throttle(0); else this.thr(A / amax);
      return;
    }
    // zero-effort-miss / zero-effort-velocity guidance to the handover point (radial: height and descent rate; horizontal: stop)
    const tgo = Math.max(8, this.desc.tgo - (s.t - this.desc.t0));
    const gEff = g - vh * vh / R;
    const zemR = (H.alt - alt) - vr * tgo + 0.5 * gEff * tgo * tgo, zevR = H.vr - vr + gEff * tgo;
    let ar = 6 * zemR / (tgo * tgo) - 2 * zevR / tgo + gEff;
    let ah = -vh / tgo * 1.0;
    let A = Math.hypot(ar, ah);
    if (A > amax * 0.98) { const k = amax * 0.98 / A; ar *= k; ah *= k; A = amax * 0.98; }
    io.point(V.norm(V.add(V.mul(r, ar), h, ah)));
    this.thr(A / amax);
  }
  // flat lunar leg: Hold upright on, the stick cancels drift, the throttle follows a descent-rate profile
  touchdown(dt) {
    const io = this.io, f = io.f, eng = f.eng; io.assist(true); io.point(null);
    const st = this.st(), mass = st.mass, g = f.gee ?? 1.62, T = eng.thrust * 1.1, alt = f.alt, vs = f.vel.y;
    const avail = T / mass - g, aD = clamp(0.6 * avail, 0.3, 8);
    const vd = -(0.9 + Math.sqrt(2 * aD * Math.max(alt - 1.5, 0)));
    const ff = aD * clamp((-vs - 1.2) / 3, 0, 1);
    const acc = g + ff + 1.5 * (vd - vs);
    let x = acc * mass / T;
    if (alt < 1.0 && vs > -2.5) x = 0;
    if (x < eng.minThrottle * 0.55) this.io.throttle(0); else this.thr(x);
    const vx = f.vel.x, vz = f.vel.z, k = alt > 40 ? 0.08 : 0.25;
    io.steer(clamp(-vx * k, -1, 1), clamp(-vz * k, -1, 1));
  }
}

// ---------------- orbit geometry helpers ----------------
function lsq(J, e) {   // solve min |J^T x - e|: J is three column vectors (d b / d u_k); normal equations with a little damping
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
  for (let i = 0; i < 3; i++) { y[i] = V.dot(J[i], e); for (let k = 0; k < 3; k++) A[i][k] = V.dot(J[i], J[k]) + (i === k ? 1e-3 * (V.dot(J[i], J[i]) + 1) : 0); }
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A), x = [0, 0, 0];
  for (let c = 0; c < 3; c++) { const M = A.map((row, i) => row.map((v, k) => (k === c ? y[i] : v))); x[c] = det(M) / D; }
  return x;
}
// b-vector at the Moon's sphere entry (Moon frame): the miss vector of the incoming straight line, and v_inf
export function aimMoon(sky, s0, horizon = 8 * 86400) {
  const c = { body: s0.body, r: s0.r.slice(), v: s0.v.slice(), t: s0.t };
  if (c.body === 'E') for (let i = 0; i < 4000 && c.body === 'E'; i++) { O.coast(sky, c, 600, { maxChunks: 400 }); if (c.t - s0.t > horizon) return null; }
  if (c.body !== 'M') return null;
  const el = O.elements(c.r, c.v, O.MU_M), vhat = V.norm(c.v), vec = V.sub(c.r, V.mul(vhat, V.dot(c.r, vhat)));
  return { rp: el.rp, e: el.e, tEnter: c.t, vinf: Math.sqrt(Math.max(1, 2 * el.E)), b: { vec, vinf: Math.sqrt(Math.max(1, 2 * el.E)) } };
}
// impact parameter for a periapsis radius rp at hyperbolic excess speed vinf
export const bTarget = (rp, vinf) => rp * Math.sqrt(1 + 2 * O.MU_M / (rp * vinf * vinf));
export function timeToPeri(r, v, mu) {
  const R = V.len(r), el = O.elements(r, v, mu), vr = V.dot(r, v) / R;
  if (el.e < 1) {
    const a = el.a, e = el.e, E = Math.atan2(vr * Math.sqrt(a / mu), 1 - R / a), M = E - e * Math.sin(E), n = Math.sqrt(mu / (a * a * a));
    let dM = -M; while (dM < 0) dM += 2 * Math.PI; return dM / n;
  }
  const a = mu / (2 * el.E), e = el.e, coshF = (1 + R / a) / e, F = Math.acosh(Math.max(1, coshF)) * Math.sign(vr || 1), M = e * Math.sinh(F) - F, n = Math.sqrt(mu / (a * a * a));
  return -M / n;   // negative once past periapsis
}
