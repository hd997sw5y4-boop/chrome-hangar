// Flight + engine physics. Fixed-step, deterministic, single rigid body (plan: no joints).
import { PARTS, stats, layout, hasLegs, G0 , legFoot } from './rocket.js';   // gb3-wide: legFoot
import { extraForces } from './rcs.js';   // GB5-RCS

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

// Air density (kg/m^3) at height h (m). The one helper for drag, fins and aero: exponential up to ATMO_FADE, eased to exactly 0 at
// ATMO_TOP (100 km, the Karman line), so there is no drag, side force or damping in vacuum and an orbit above it never decays.
export const ATMO_FADE = 80e3, ATMO_TOP = 100e3;
export const airDensity = h => {
  const a = Math.max(0, h); if (a >= ATMO_TOP) return 0;
  const k = a <= ATMO_FADE ? 0 : (a - ATMO_FADE) / (ATMO_TOP - ATMO_FADE);
  return 1.225 * Math.exp(-a / 8500) * (1 - k * k * (3 - 2 * k));
};

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
// Cut, dry tanks or a failed engine: thrust and fuel flow are zero on this same step — no spool-down push.
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
  } else { e.thr = 0; e.spool = 0; }
  const running = e.on && e.thr > 0 && fuelLeft > 0 && !e.failed;
  const eff = running ? e.thr * e.spool : 0;
  // heat: rules, not dice. Builds above the safe throttle, cools below it.
  if (running && h.safeThrottle < 1 && e.thr > h.safeThrottle + 1e-6) e.heat += h.risePerSec * (e.thr - h.safeThrottle) / (1 - h.safeThrottle) * dt;
  else e.heat = Math.max(0, e.heat - h.coolPerSec * dt);
  e.peakHeat = Math.max(e.peakHeat, e.heat);
  const t0 = running ? h.baseTemp + h.spanTemp * eff : 20 + (e.temp - 20) * Math.exp(-dt / 2.5);
  e.temp = running ? t0 + (h.limitTemp - t0) * Math.min(1, e.heat / 100) : t0;
  if (e.heat >= 100 && !e.failed) { e.failed = true; e.on = false; e.reason = 'overheat'; e.thr = 0; e.spool = 0; }
  const n = d.engines || 1;
  if (n > 1) { const w = weakEngines(n); while (e.out < w.length && e.heat >= w[e.out].th) e.out++; }
  const live = 1 - e.out / n;
  const vacBoost = 1 + 0.1 * (1 - rho / 1.225);
  const liveOn = e.on && e.thr > 0 && fuelLeft > 0 && !e.failed;
  const thrust = liveOn ? d.thrust * e.thr * e.spool * vacBoost * live : 0;
  return { thrust, mdot: liveOn ? d.thrust * e.thr * e.spool * live / (d.isp * G0) : 0 };
}

// ---------- wind ----------
// floor: calm below this height, easing in over the next 200 m (a gentle breeze above it)
export function windAt(base, dirAng, t, h, floor = 0) {
  if (!base) return v3();
  const k = floor > 0 ? Math.min(1, Math.max(0, (h - floor) / 200)) : 1;
  if (k <= 0) return v3();
  const gust = 1 + 0.35 * Math.sin(t * 0.63) + 0.2 * Math.sin(t * 1.7 + 1.3) + 0.1 * Math.sin(t * 3.1 + 0.4);
  const prof = Math.min(2.2, 0.55 + Math.max(0, h) / 400);
  const s = base * gust * prof * k * k * (3 - 2 * k);
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
    wind: opts.wind || 0, windDir: opts.windDir ?? 0.6, windFloor: opts.windFloor || 0, windNow: v3(),
    apex: 0, topSpeed: 0, alt: 0, vs: 0, speed: 0, q: 0, aoa: 0, tilt: 0, landSpeed: 0,
    heavyT: 0, failure: null, events: [], samples: [], sampleT: 0, flippedHint: false, windHint: false,
    reached: null, gimbal: v3(), maxQ: 0,
    flightT: 0, downrange: 0,   // seconds since liftoff, and the furthest the rocket has been from the pad centre (m), for the results screen
    // landing: legs 0 = folded .. 1 = down (auto: tucked for the climb, down again for the descent; legCmd 'out' / 'in' overrides),
    // and a recovery chute packed in the nose cone (deployed by chuteCmd; 'packed' | 'open' | 'torn' | 'cut' | 'none')
    legOut: 1, legCmd: 'auto', chute: hasNose(rocket) ? 'packed' : 'none', chuteCmd: false, chuteK: 0, chuteA: 0, soft: false,
  };
  // body origin (nozzle exit) rests so the lowest point touches the pad top
  f.origin = v3(f.padPos.x, f.padPos.y - L.bottom, f.padPos.z);
  f.pos = add(f.origin, f.up, st.com);
  return f;
}

const hasNose = r => r.stack.length > 0 && PARTS[r.stack[r.stack.length - 1].p]?.kind === 'nose';
export const CHUTE = { vt: 3.8, maxOpen: 140, maxHold: 170, fill: 1.8 };   // sized for ~3.8 m/s at sea level; opening above 140 m/s rips it
export const SOFT_LANDING = 1.5;   // m/s: a touchdown under this earns the soft-landing bonus
const legsDown = f => f.legs && f.legOut > 0.85;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function basis(up) {
  const ref = Math.abs(up.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0);
  const e1 = norm(cross(up, ref)); const e2 = cross(up, e1);
  return [e1, e2];
}

export function contactPoints(f) {
  const O = f.origin, up = f.up, [e1, e2] = basis(up), pts = [];
  const L = layout(f.rocket);
  const lg = legsDown(f), r = lg ? legFoot(f.rocket) : (f.eng ? f.eng.radius : 0.9);   // gb3-wide: wider landers splay their legs further
  const y = lg ? -PARTS.legs.drop : 0;
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(add(add(add(O, up, y), e1, a * r), e2, b * r));
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(add(add(add(O, up, L.top), e1, a * 0.9), e2, b * 0.9));
  return pts;
}

// Also used by the part-health model when a part breaks (structure / burn-up).
export function failFlight(f, kind, extra) { fail(f, kind, extra); }
function fail(f, kind, extra = {}) {
  if (f.failure) return;
  f.failure = { kind, t: f.t, alt: f.alt, speed: f.speed, ...extra };
  f.phase = 'crashed'; f.e.on = false; if (f.chute === 'open') f.chute = 'cut';
  f.events.push({ type: 'crash', kind });
}

export function flightStep(f, dt = DT) {
  if (f.phase === 'crashed') { f.t += dt; return; }
  const grounded = f.phase === 'landed';
  f.t += dt;
  const st = stats(f.rocket, f.fill, f.fuelFrac);
  const comOld = f.st.com;
  f.st = st;
  // keep the body origin fixed as the CoM shifts with fuel burn
  f.pos = add(f.pos, f.up, st.com - comOld);
  const h = Math.max(0, f.origin.y - st.bottom);
  const rho = f.vacuum ? 0 : airDensity(f.origin.y), gee = f.gee ?? G0;   // gee / vacuum: set by moon.js on the lunar surface leg
  const wasOn = f.e.on;
  const { thrust, mdot } = f.eng ? engineStep(f.e, f.eng, dt, st.fuel, rho) : { thrust: 0, mdot: 0 };
  if (f.e.on && !wasOn) f.events.push({ type: 'ignite' });
  if (!f.e.on && wasOn) f.events.push({ type: f.e.failed ? 'overheat' : 'cutoff' });
  if (f.e.failed && f.phase !== 'pad') { fail(f, 'overheat'); return; }
  if (st.fuelCap > 0) f.fuelFrac = Math.max(0, f.fuelFrac - mdot * dt / st.fuelCap);
  const m = st.mass, up = f.up;

  // gimbal: hold-upright assist (PD) or direct steering. Both only exist as a thrust vector, so they
  // are gated on a live engine — assist must not add force, or hold a climb, after cutoff or burnout.
  let g = v3();
  const gmax = Math.tan((f.eng?.gimbalDeg || 0) * Math.PI / 180);
  const S = v3(f.steer.x, 0, f.steer.z);
  const lever = st.com - f.engLen;
  const push = (f.e.on && thrust > 0) ? thrust : 0;
  if (push > 1 && lever > 0.1) {
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
  let F = mul(tdir, push);
  let T = cross(mul(up, f.engLen - st.com), F);
  F = add(F, v3(0, -m * gee, 0));

  // aerodynamics (drag and side-force damping from airspeed / angle of attack — not a climb force;
  // with the engine off, while still going up, these only add downward drag, so ay <= -gee)
  f.windNow = windAt(f.wind, f.windDir, f.t, h, f.windFloor);   // applied through the aero forces below (fixed step, so framerate independent)
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

  // landing legs: the sim owns the fold so touchdown can depend on it (the mesh just follows f.legOut)
  if (f.legs) {
    // auto: down on the pad, tucked once climbing, back down when descending below 450 m (or low and slow) and held there
    // until it climbs again, so a slow hover-down never meets the ground with the legs still folded
    if (f.phase !== 'flying' || f.alt < 6 || (f.alt < 450 && f.vs < -0.5) || (f.alt < 40 && f.vs < 3)) f.legAuto = 1;
    else if (f.vs > 3) f.legAuto = 0;
    const auto = f.legAuto ?? 1;
    const want = f.legCmd === 'out' ? 1 : f.legCmd === 'in' ? 0 : auto;
    f.legOut = clamp(f.legOut + clamp(want - f.legOut, -dt / 1.6, dt / 1.6), 0, 1);
  }
  // recovery chute: pulls from the nose (so it also swings the rocket upright) and inflates over ~1.8 s
  if (f.chuteCmd && f.chute === 'packed' && f.phase === 'flying') {
    f.chuteCmd = false;
    if (V > CHUTE.maxOpen) { f.chute = 'torn'; f.events.push({ type: 'chuteTorn', speed: V }); }
    else { f.chute = 'open'; f.chuteK = 0; f.chuteA = 2 * m * G0 / (1.225 * CHUTE.vt * CHUTE.vt); f.events.push({ type: 'chute' }); }
  }
  if (f.chute === 'open') {
    f.chuteK = Math.min(1, f.chuteK + dt / CHUTE.fill);
    if (V > CHUTE.maxHold) { f.chute = 'torn'; f.events.push({ type: 'chuteTorn', speed: V }); }
    else if (V > 0.05) {
      const k = f.chuteK * f.chuteK, Fc = mul(norm(va), -q * f.chuteA * k);
      F = add(F, Fc); T = add(T, cross(mul(up, st.top - st.com), Fc)); T = add(T, mul(f.w, -st.I * 1.5 * k));
    }
  }
  // GB5-RCS / GB5-AERO / GB5-HEAT: RCS thrusters, fin aero (0 in vacuum) and re-entry heat (rcs.js). Separate added force + torque;
  // the monoprop burned so far lightens the rocket (mr <= 0, spread over m + mr). A burn-up crashes through failFlight.
  { const x = extraForces(f, st, rho, va, V, dt, gee, failFlight); F = mul(add(add(F, x.F), v3(0, -x.mr * gee, 0)), m / (m + x.mr)); T = add(T, x.T); if (f.phase === 'crashed') return; }

  if (f.phase === 'pad') {
    if (f.e.on && push > m * gee * 1.002) { f.phase = 'flying'; f.events.push({ type: 'liftoff' }); }
    else {
      if (f.e.on && f.e.cmd >= 0.99) { f.heavyT += dt; if (f.heavyT > 3) fail(f, 'tooHeavy', { twr: thrust / (m * gee) }); }
      else f.heavyT = 0;
      if (!f.e.on && f.e.failed) fail(f, 'overheat');
      return;
    }
  }

  // a landed rocket stays planted until the engine beats its weight, so Free Mode can touch down and lift off again
  if (grounded) {
    if (f.e.on && push > m * G0 * 1.002) { f.phase = 'flying'; f.events.push({ type: 'liftoff' }); }
    else {
      f.vel = v3(); f.w = v3();
      f.alt = Math.max(0, f.origin.y + Math.min(0, st.bottom) * f.up.y);
      f.vs = 0; f.speed = 0;
      return;
    }
  }

  f.flightT += dt;
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
  f.downrange = Math.max(f.downrange, Math.hypot(f.origin.x - f.padPos.x, f.origin.z - f.padPos.z));
  f.sampleT += dt; if (f.sampleT >= 0.25) { f.sampleT = 0; f.samples.push(f.alt); }
  if (f.tilt > 60 && st.margin < 0) f.flippedHint = true;
  if (f.tilt > 35 && !f.assist && f.speed < 40 && f.wind) f.windHint = true;

  // structural limit: big angle at speed rips it apart
  if (q > 12000 && f.aoa > 0.35) { fail(f, st.margin < 0 ? 'flipped' : 'breakup'); return; }

  // ground contact
  let minY = Infinity;
  for (const p of contactPoints(f)) minY = Math.min(minY, p.y);
  if (minY <= 0 && f.t > 0.2 && f.vs <= 0.15) {   // ignore contact while climbing away (takeoff after a landing)
    const vh = Math.hypot(f.vel.x, f.vel.z), sp = f.speed;
    f.landSpeed = sp;
    const near = Math.hypot(f.origin.x - f.padPos.x, f.origin.z - f.padPos.z);
    const lg = legsDown(f);
    if (lg && sp < 5 && vh < 3 && f.tilt < 15) {
      f.phase = 'landed'; f.e.cmd = 0; f.e.on = false; f.landDist = near; f.soft = sp < SOFT_LANDING; if (f.chute === 'open') f.chute = 'cut';
      f.vel = v3(); f.w = v3(); f.up = v3(0, 1, 0);
      f.pos = add(f.pos, v3(0, -minY, 0)); f.origin = add(f.pos, f.up, -st.com);
      f.events.push({ type: 'landed' });
    } else {
      let kind = 'hardLanding';
      if (!f.legs && sp < 5) kind = 'noLegs';
      else if (f.legs && !lg && sp < 5) kind = 'legsUp';
      else if (lg && sp < 5 && f.tilt >= 15) kind = 'tippedLanding';
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
