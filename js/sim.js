// Flight + engine physics. Fixed-step, deterministic, single rigid body (plan: no joints).
import { PARTS, stats, layout, hasLegs, G0 } from './rocket.js';

export const DT = 1 / 120;
const AREF = Math.PI * 0.9 * 0.9;
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
export const vec = { v3, add, mul, dot, cross, len, norm };

export const airDensity = h => 1.225 * Math.exp(-Math.max(0, h) / 8500);

// ---------- engine ----------
export function newEngine() { return { on: false, thr: 0, cmd: 0, heat: 0, temp: 20, failed: false, spool: 0, peakHeat: 0, out: 0 }; }

// Engine-out in a cluster: a third of the bells (outer ring) are the weak ones and quit one by one as heat
// climbs past 80..98, each taking its share of thrust with it. The rest only go when the whole cluster fails at 100.
const WEAK = {};
export function weakEngines(n) {
  if (WEAK[n]) return WEAK[n];
  const weak = n > 1 ? Math.ceil(n / 3) : 0, start = n === 3 ? 0 : n === 9 ? 1 : n > 9 ? 7 : 0, ring = n - start, out = [];
  for (let j = 0; j < weak; j++) out.push({ idx: start + Math.floor(j * ring / weak), th: 80 + 18 * j / weak });
  return (WEAK[n] = out);
}

// Advances one engine; returns {thrust, mdot}. fuelLeft gates it.
export function engineStep(e, d, dt, fuelLeft, rho = 1.225) {
  const h = d.heat;
  const want = e.cmd >= d.minThrottle - 1e-6 && fuelLeft > 0 && !e.failed;
  if (want && !e.on) { e.on = true; e.spool = 0; }
  if (!want && e.on) { e.on = false; e.reason = fuelLeft <= 0 ? 'dry' : 'off'; }
  if (e.on) {
    e.spool = Math.min(1, e.spool + dt / 0.35);
    const target = Math.min(1, Math.max(d.minThrottle, e.cmd));
    e.thr += Math.sign(target - e.thr) * Math.min(Math.abs(target - e.thr), dt * 1.6);
    e.thr = Math.max(d.minThrottle, e.thr);
  } else e.thr = Math.max(0, e.thr - dt * 4);
  const eff = e.on ? e.thr * e.spool : 0;
  // heat: rules, not dice. Builds above the safe throttle, cools below it.
  if (e.on && h.safeThrottle < 1 && e.thr > h.safeThrottle + 1e-6) e.heat += h.risePerSec * (e.thr - h.safeThrottle) / (1 - h.safeThrottle) * dt;
  else e.heat = Math.max(0, e.heat - h.coolPerSec * dt);
  e.peakHeat = Math.max(e.peakHeat, e.heat);
  const t0 = e.on ? h.baseTemp + h.spanTemp * eff : 20 + (e.temp - 20) * Math.exp(-dt / 2.5);
  e.temp = e.on ? t0 + (h.limitTemp - t0) * Math.min(1, e.heat / 100) : t0;
  if (e.heat >= 100 && !e.failed) { e.failed = true; e.on = false; e.reason = 'overheat'; }
  const n = d.engines || 1;
  if (n > 1) { const w = weakEngines(n); while (e.out < w.length && e.heat >= w[e.out].th) e.out++; }
  const live = 1 - e.out / n;
  const vacBoost = 1 + 0.1 * (1 - rho / 1.225);
  const thrust = d.thrust * eff * vacBoost * live;
  return { thrust, mdot: e.on ? d.thrust * eff * live / (d.isp * G0) : 0 };
}

// ---------- wind ----------
export function windAt(base, dirAng, t, h) {
  if (!base) return v3();
  const gust = 1 + 0.35 * Math.sin(t * 0.63) + 0.2 * Math.sin(t * 1.7 + 1.3) + 0.1 * Math.sin(t * 3.1 + 0.4);
  const prof = Math.min(2.2, 0.55 + Math.max(0, h) / 400);
  const s = base * gust * prof;
  const a = dirAng + 0.25 * Math.sin(t * 0.21);
  return v3(Math.cos(a) * s, 0, Math.sin(a) * s);
}

// ---------- flight ----------
export function newFlight(rocket, opts = {}) {
  const st = stats(rocket, opts.fill ?? 1, 1);
  const L = layout(rocket);
  const f = {
    rocket, fill: opts.fill ?? 1, eng: PARTS[rocket.engine], engLen: L.engLen, legs: hasLegs(rocket),
    fuelFrac: 1, st, padPos: opts.padPos || v3(),
    up: v3(0, 1, 0), w: v3(), vel: v3(), pos: null, t: 0, phase: 'pad',
    e: newEngine(), steer: { x: 0, z: 0 }, assist: opts.assist ?? true,
    wind: opts.wind || 0, windDir: opts.windDir ?? 0.6, windNow: v3(),
    apex: 0, topSpeed: 0, alt: 0, vs: 0, speed: 0, q: 0, aoa: 0, tilt: 0, landSpeed: 0,
    heavyT: 0, failure: null, events: [], samples: [], sampleT: 0, flippedHint: false, windHint: false,
    reached: null, gimbal: v3(), maxQ: 0,
  };
  // body origin (nozzle exit) rests so the lowest point touches the pad top
  f.origin = v3(f.padPos.x, f.padPos.y - L.bottom, f.padPos.z);
  f.pos = add(f.origin, f.up, st.com);
  return f;
}

function basis(up) {
  const ref = Math.abs(up.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0);
  const e1 = norm(cross(up, ref)); const e2 = cross(up, e1);
  return [e1, e2];
}

export function contactPoints(f) {
  const O = f.origin, up = f.up, [e1, e2] = basis(up), pts = [];
  const L = layout(f.rocket);
  const r = f.legs ? PARTS.legs.footRadius : (f.eng ? f.eng.radius : 0.9);
  const y = f.legs ? -PARTS.legs.drop : 0;
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(add(add(add(O, up, y), e1, a * r), e2, b * r));
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(add(add(add(O, up, L.top), e1, a * 0.9), e2, b * 0.9));
  return pts;
}

// Also used by the part-health model when a part breaks (structure / burn-up).
export function failFlight(f, kind, extra) { fail(f, kind, extra); }
function fail(f, kind, extra = {}) {
  if (f.failure) return;
  f.failure = { kind, t: f.t, alt: f.alt, speed: f.speed, ...extra };
  f.phase = 'crashed'; f.e.on = false;
  f.events.push({ type: 'crash', kind });
}

export function flightStep(f, dt = DT) {
  if (f.phase === 'crashed' || f.phase === 'landed') { f.t += dt; return; }
  f.t += dt;
  const st = stats(f.rocket, f.fill, f.fuelFrac);
  const comOld = f.st.com;
  f.st = st;
  // keep the body origin fixed as the CoM shifts with fuel burn
  f.pos = add(f.pos, f.up, st.com - comOld);
  const h = Math.max(0, f.origin.y - st.bottom);
  const rho = airDensity(f.origin.y);
  const wasOn = f.e.on;
  const { thrust, mdot } = f.eng ? engineStep(f.e, f.eng, dt, st.fuel, rho) : { thrust: 0, mdot: 0 };
  if (f.e.on && !wasOn) f.events.push({ type: 'ignite' });
  if (!f.e.on && wasOn) f.events.push({ type: f.e.failed ? 'overheat' : 'cutoff' });
  if (f.e.failed && f.phase !== 'pad') { fail(f, 'overheat'); return; }
  if (st.fuelCap > 0) f.fuelFrac = Math.max(0, f.fuelFrac - mdot * dt / st.fuelCap);
  const m = st.mass, up = f.up;

  // gimbal: hold-upright assist (PD) or direct steering
  let g = v3();
  const gmax = Math.tan((f.eng?.gimbalDeg || 0) * Math.PI / 180);
  const S = v3(f.steer.x, 0, f.steer.z);
  const lever = st.com - f.engLen;
  if (thrust > 1 && lever > 0.1) {
    if (f.assist) {
      const target = norm(add(v3(0, 1, 0), S, Math.tan(22 * Math.PI / 180)));
      const err = cross(up, target);
      const wDes = mul(err, 1.6);
      const tau = mul(add(wDes, f.w, -1), 3.2 * st.I);
      g = mul(cross(up, tau), 1 / (lever * thrust));
    } else {
      const Sp = add(S, up, -dot(S, up));
      g = mul(Sp, -gmax);
    }
    const gl = len(g); if (gl > gmax) g = mul(g, gmax / gl);
  }
  f.gimbal = g;
  const tdir = norm(add(up, g));
  let F = mul(tdir, thrust);
  let T = cross(mul(up, f.engLen - st.com), F);
  F = add(F, v3(0, -m * G0, 0));

  // aerodynamics
  f.windNow = windAt(f.wind, f.windDir, f.t, h);
  const va = add(f.vel, f.windNow, -1);
  const V = len(va);
  const q = 0.5 * rho * V * V;
  if (V > 0.05 && f.phase !== 'pad') {
    const vax = dot(va, up);
    const vlat = add(va, up, -vax);
    F = add(F, mul(norm(va), -q * AREF * st.cd));
    const Fn = mul(vlat, -0.5 * rho * V * AREF * st.cn * 0.5);
    F = add(F, Fn);
    T = add(T, cross(mul(up, st.cop - st.com), Fn));
    const side = st.length * 1.8;
    const vl = len(vlat);
    const Fx = mul(vlat, -0.5 * rho * vl * side * 0.4);
    F = add(F, Fx);
    T = add(T, cross(mul(up, (st.top + st.bottom) / 2 - st.com), Fx));
    const damp = 0.5 * rho * V * AREF * st.cn * (st.length * 0.35) ** 2;
    T = add(T, mul(f.w, -damp));
    f.aoa = Math.atan2(vl, Math.abs(vax));
  } else f.aoa = 0;
  T = add(T, mul(f.w, -st.I * 0.05));
  f.q = q; f.maxQ = Math.max(f.maxQ, q);

  if (f.phase === 'pad') {
    if (thrust > m * G0 * 1.002) { f.phase = 'flying'; f.events.push({ type: 'liftoff' }); }
    else {
      if (f.e.on && f.e.cmd >= 0.99) { f.heavyT += dt; if (f.heavyT > 3) fail(f, 'tooHeavy', { twr: thrust / (m * G0) }); }
      else f.heavyT = 0;
      if (!f.e.on && f.e.failed) fail(f, 'overheat');
      return;
    }
  }

  // integrate (semi-implicit Euler)
  f.vel = add(f.vel, F, dt / m);
  f.pos = add(f.pos, f.vel, dt);
  const ang = mul(T, 1 / st.I);
  f.w = add(f.w, ang, dt);
  f.w = add(f.w, up, -dot(f.w, up)); // no roll in v1
  f.up = norm(add(up, cross(f.w, up), dt));
  f.origin = add(f.pos, f.up, -st.com);

  // telemetry
  f.alt = Math.max(0, f.origin.y + Math.min(0, st.bottom) * f.up.y);
  f.vs = f.vel.y; f.speed = len(f.vel);
  f.tilt = Math.acos(Math.max(-1, Math.min(1, f.up.y))) * 180 / Math.PI;
  f.apex = Math.max(f.apex, f.alt); f.topSpeed = Math.max(f.topSpeed, f.speed);
  f.sampleT += dt; if (f.sampleT >= 0.25) { f.sampleT = 0; f.samples.push(f.alt); }
  if (f.tilt > 60 && st.margin < 0) f.flippedHint = true;
  if (f.tilt > 35 && !f.assist && f.speed < 40 && f.wind) f.windHint = true;

  // structural limit: big angle at speed rips it apart
  if (q > 12000 && f.aoa > 0.35) { fail(f, st.margin < 0 ? 'flipped' : 'breakup'); return; }

  // ground contact
  let minY = Infinity;
  for (const p of contactPoints(f)) minY = Math.min(minY, p.y);
  if (minY <= 0 && f.t > 0.2) {
    const vh = Math.hypot(f.vel.x, f.vel.z), sp = f.speed;
    f.landSpeed = sp;
    const near = Math.hypot(f.origin.x - f.padPos.x, f.origin.z - f.padPos.z);
    if (f.legs && sp < 5 && vh < 3 && f.tilt < 15) {
      f.phase = 'landed'; f.e.cmd = 0; f.e.on = false; f.landDist = near;
      f.vel = v3(); f.w = v3(); f.up = v3(0, 1, 0);
      f.pos = add(f.pos, v3(0, -minY, 0)); f.origin = add(f.pos, f.up, -st.com);
      f.events.push({ type: 'landed' });
    } else {
      let kind = 'hardLanding';
      if (!f.legs && sp < 5) kind = 'noLegs';
      else if (f.legs && sp < 5 && f.tilt >= 15) kind = 'tippedLanding';
      else if (f.flippedHint) kind = 'flipped';
      else if (f.windHint) kind = 'wind';
      else if (f.fuelFrac <= 0) kind = 'outOfFuel';
      else if (f.eng && f.eng.minThrottle >= 0.5 && f.apex > 30) kind = 'cantThrottle';
      f.landDist = near;
      fail(f, kind);
    }
  }
}

// ---------- static fire ----------
export function newStatic(rocket, fill) {
  return { rocket, fill, eng: PARTS[rocket.engine], e: newEngine(), fuelFrac: 1, t: 0, fireT: 0, thrSum: 0, thrust: 0, mdot: 0, events: [] };
}
export function staticStep(s, dt = DT) {
  s.t += dt;
  const st = stats(s.rocket, s.fill, s.fuelFrac);
  const was = s.e.on, failed0 = s.e.failed;
  const r = engineStep(s.e, s.eng, dt, st.fuel);
  s.thrust = r.thrust; s.mdot = r.mdot;
  if (st.fuelCap) s.fuelFrac = Math.max(0, s.fuelFrac - r.mdot * dt / st.fuelCap);
  if (s.e.on) { s.fireT += dt; s.thrSum += s.e.thr * dt; }
  if (s.e.on && !was) s.events.push({ type: 'ignite' });
  if (!s.e.on && was) s.events.push({ type: s.e.failed && !failed0 ? 'overheat' : (st.fuel <= 0 ? 'dry' : 'cutoff') });
  s.burnLeft = r.mdot > 0 ? st.fuel / r.mdot : (s.eng ? st.fuel / (s.eng.thrust / (s.eng.isp * G0)) : 0);
  s.st = st;
}
