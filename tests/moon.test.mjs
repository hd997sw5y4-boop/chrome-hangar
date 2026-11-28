// Headless physics checks for the Moon flight:  node tests/moon.test.mjs
// orbit.js (patched conics, Kepler, SOI switch, TLI timing, energy under warp) and the lunar landing on sim.js.
import fs from 'fs';
import assert from 'assert/strict';
import * as O from '../js/orbit.js';
import { registerParts, starterRocket, G0 } from '../js/rocket.js';
import { newFlight, flightStep, DT } from '../js/sim.js';
import { warpCap, WARPS } from '../js/timewarp.js';
const { V } = O;
const idx = JSON.parse(fs.readFileSync(new URL('../data/parts/index.json', import.meta.url))).parts;
registerParts(idx.map(id => JSON.parse(fs.readFileSync(new URL(`../data/parts/${id}.json`, import.meta.url)))));
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const sky = O.makeSky(Date.UTC(2026, 10, 27, 12));
const leo = (lead, dv = 0, alt = 200e3) => {   // circular orbit in the Moon's plane, `lead` deg behind the Moon, plus dv prograde
  const r0 = O.R_E + alt, vc = Math.sqrt(O.MU_E / r0) + dv, m = V.norm(O.moonPos(sky, 0)), Q = V.cross(sky.H, m), a = -lead * Math.PI / 180;
  return { body: 'E', t: 0, r: V.add(V.mul(m, r0 * Math.cos(a)), Q, r0 * Math.sin(a)), v: V.add(V.mul(m, -vc * Math.sin(a)), Q, vc * Math.cos(a)) };
};

t('constants match the game and the spec', () => {
  assert.equal(G0, O.G0);
  assert.ok(Math.abs(O.MU_E / (O.R_E * O.R_E) - 9.80665) < 1e-9);
  assert.ok(Math.abs(O.MU_M / (O.R_M * O.R_M) - 1.62) < 1e-9);
  assert.equal(O.A_M, 384400e3);
  assert.ok(Math.abs(O.R_SOI / 1e3 - 66000) < 1000, 'SOI ' + O.R_SOI / 1e3);
  assert.ok(Math.abs(O.T_M / 86400 - 27.32) < 0.01);
  assert.ok(Math.abs(V.len(O.moonPos(sky, 12345)) - O.A_M) < 1e-3);
});

t('Kepler propagation closes an orbit and keeps energy on a hyperbola', () => {
  const s = leo(0), el = O.elements(s.r, s.v, O.MU_E), k = O.kepler(s.r, s.v, el.period, O.MU_E);
  assert.ok(V.len(V.sub(k.r, s.r)) < 1e-3);
  const h = leo(0, 4000), E0 = O.energy(h.r, h.v, O.MU_E), k2 = O.kepler(h.r, h.v, 5 * 86400, O.MU_E);
  assert.ok(Math.abs(O.energy(k2.r, k2.v, O.MU_E) / E0 - 1) < 1e-9);
});

t('local frames round-trip (pad and Moon surface)', () => {
  const B = O.padBasis(sky, 100), p = { x: 1234, y: 80000, z: -5678 }, v = { x: 10, y: 2000, z: -30 };
  const b = O.localToBody(B, O.R_E, { x: 0, z: 0 }, p, v, [0, 0, O.W_E]), back = O.bodyToLocal(B, O.R_E, { x: 0, z: 0 }, b.r, b.v, [0, 0, O.W_E]);
  for (const k of 'xyz') { assert.ok(Math.abs(back.p[k] - p[k]) < 1e-6); assert.ok(Math.abs(back.v[k] - v[k]) < 1e-9); }
  // the pad spins with the Earth: a rocket standing still on it moves ~380 m/s east in inertial space
  const still = O.localToBody(B, O.R_E, { x: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, [0, 0, O.W_E]);
  assert.ok(Math.abs(V.len(still.v) - O.W_E * O.R_E * Math.cos(O.PAD.lat * Math.PI / 180)) < 0.5);
  const M = O.moonBasis(sky, 50, [0.3, 0.4, V.len([0.3, 0.4]) ? Math.sqrt(1 - 0.25) : 0]);
  const o = { x: 0, z: -115 }, q = { x: 50, y: 900, z: -200 }, mb = O.localToBody(M, O.R_M, o, q, v), mq = O.bodyToLocal(M, O.R_M, o, mb.r, mb.v);
  for (const k of 'xyz') assert.ok(Math.abs(mq.p[k] - q[k]) < 1e-6);
});

t('SOI switch: entering and leaving the Moon keeps position and velocity continuous', () => {
  // start 70,000 km from the Moon, falling straight at it (relative to the Moon)
  const t0 = 1000, mp = O.moonPos(sky, t0), mv = O.moonVel(sky, t0), dir = V.norm(mp);
  const s = { body: 'E', t: t0, r: V.add(mp, dir, -70000e3), v: V.add(mv, dir, 1000) };
  let crossed = 0; for (let i = 0; i < 400 && s.body === 'E'; i++) crossed += O.coast(sky, s, 30).crossed;
  assert.equal(s.body, 'M'); assert.ok(crossed >= 1);
  const d = V.len(s.r); assert.ok(d < O.R_SOI && d > O.R_SOI - 400e3, 'just inside the SOI: ' + d / 1e3);
  // same point in Earth coordinates, propagated without switching (Earth-only) for the same time, is close: no jump
  const e = O.toEarth(sky, s); const k = O.kepler(V.add(mp, dir, -70000e3), V.add(mv, dir, 1000), s.t - t0, O.MU_E);
  assert.ok(V.len(V.sub(e.r, k.r)) < 60e3, 'continuity ' + V.len(V.sub(e.r, k.r)));
  // and out again: a fast hyperbolic exit flips back to Earth
  const out = { body: 'M', t: 0, r: [O.R_SOI - 1000e3, 0, 0], v: [3000, 0, 0] };
  O.coast(sky, out, 3600); assert.equal(out.body, 'E');
});

let best = null;
t('TLI from a 200 km LEO with ~3.15 km/s reaches the Moon SOI in about 3 days', () => {
  for (let lead = 100; lead <= 170; lead += 2) {
    const p = O.predict(sky, leo(lead, 3150), { n: 600, horizon: 8 * 86400 });
    if (p.enterSOI != null && (!best || p.closest < best.closest)) best = { lead, ...p };
  }
  assert.ok(best, 'some launch phase must reach the Moon');
  const days = best.enterSOI / 86400;
  console.log(`   best lead ${best.lead} deg, SOI after ${days.toFixed(2)} d, closest ${((best.closest - O.R_M) / 1e3).toFixed(0)} km above the surface`);
  assert.ok(days > 1.8 && days < 4, 'arrival ' + days);
  // too little dv never gets there
  for (let lead = 100; lead <= 170; lead += 5) assert.equal(O.predict(sky, leo(lead, 2900), { n: 300, horizon: 8 * 86400 }).enterSOI, null);
});

t('finite TLI burn (RK4, 120 Hz) also reaches the Moon', () => {
  const s = leo(best.lead + 12); let dv = 0; const a = 6;   // ~0.6 g burn, about 9 minutes, started a little early
  while (dv < 3165) { O.thrustStep(sky, s, DT, V.mul(V.norm(s.v), a)); dv += a * DT; }
  const p = O.predict(sky, s, { n: 600, horizon: 8 * 86400 });
  assert.ok(p.enterSOI != null, 'finite burn reaches the SOI'); console.log(`   finite burn: SOI after ${(p.enterSOI / 86400).toFixed(2)} d`);
});

t('energy is conserved under 100,000x warp (coast chunks) in LEO and in lunar orbit', () => {
  const s = leo(30), E0 = O.energy(s.r, s.v, O.MU_E);
  for (let i = 0; i < 520; i++) O.coast(sky, s, 1667);   // 100,000x at 60 fps for ~10 sim days
  assert.equal(s.body, 'E');
  assert.ok(Math.abs(O.energy(s.r, s.v, O.MU_E) / E0 - 1) < 1e-8, 'LEO drift ' + (O.energy(s.r, s.v, O.MU_E) / E0 - 1));
  const r0 = O.R_M + 100e3, m = { body: 'M', t: 0, r: [r0, 0, 0], v: [0, Math.sqrt(O.MU_M / r0) * 1.05, 0] }, M0 = O.energy(m.r, m.v, O.MU_M);
  for (let i = 0; i < 300; i++) O.coast(sky, m, 1000);
  assert.equal(m.body, 'M');
  assert.ok(Math.abs(O.energy(m.r, m.v, O.MU_M) / M0 - 1) < 1e-8);
  // RK4 coast at the sim step over one LEO orbit drifts very little too
  const q = leo(0), Q0 = O.energy(q.r, q.v, O.MU_E), per = O.elements(q.r, q.v, O.MU_E).period;
  for (let tt = 0; tt < per; tt += DT) O.thrustStep(sky, q, DT, [0, 0, 0]);
  assert.ok(Math.abs(O.energy(q.r, q.v, O.MU_E) / Q0 - 1) < 1e-7);
});

t('warp caps: none near the ground, 10x under thrust, high in deep space', () => {
  assert.equal(warpCap({ flat: true }), 1);
  assert.equal(warpCap({ thrust: true, body: 'E', alt: 300000e3 }), 10);
  assert.equal(warpCap({ body: 'M', alt: 20e3 }), 10);
  assert.equal(warpCap({ body: 'E', alt: 200000e3 }), WARPS[WARPS.length - 1]);
});

// ---- lunar landing through sim.js (same touchdown rules as on Earth) ----
const lunar = (alt, vy, tilt = 0) => {
  const f = newFlight(starterRocket(), { padPos: { x: 0, y: 0, z: -115 } });
  f.gee = O.G_M; f.vacuum = true; f.wind = 0; f.phase = 'flying'; f.legOut = 1; f.legAuto = 1;
  const a = tilt * Math.PI / 180; f.up = { x: Math.sin(a), y: Math.cos(a), z: 0 };
  f.pos = { x: 0, y: alt + f.st.com, z: -115 }; f.origin = { x: 0, y: alt, z: -115 }; f.vel = { x: 0, y: vy, z: 0 }; f.t = 1; f.assist = tilt === 0;
  return f;
};
t('Moon gravity in the flat landing sim is 1.62 m/s^2 with no air', () => {
  const f = lunar(5000, 0); f.e.cmd = 0;
  for (let i = 0; i < 120; i++) flightStep(f, DT);
  assert.ok(Math.abs(-f.vel.y - 1.62) < 0.01, 'dv/dt ' + -f.vel.y); assert.equal(f.q, 0);
});
t('powered landing on the Moon lands (legs, < 5 m/s, upright)', () => {
  const f = lunar(400, -30);
  for (let i = 0; i < 120 * 300 && f.phase === 'flying'; i++) {
    const target = -Math.max(1.0, Math.min(30, 1 + f.alt * 0.12));
    const want = f.st.mass * (O.G_M + (target - f.vel.y) * 0.8) / (f.eng.thrust * 1.1);   // spark can't throttle below a hover here:
    f.e.cmd = want < f.eng.minThrottle * 0.6 ? 0 : Math.max(f.eng.minThrottle, Math.min(1, want));   // pulse it, like a player would
    flightStep(f, DT);
  }
  assert.equal(f.phase, 'landed', JSON.stringify(f.failure)); assert.ok(f.landSpeed < 5); console.log(`   touchdown ${f.landSpeed.toFixed(2)} m/s`);
});
t('falling onto the Moon unpowered crashes; leaning over tips', () => {
  const f = lunar(300, -5); f.e.cmd = 0;
  for (let i = 0; i < 120 * 120 && f.phase === 'flying'; i++) flightStep(f, DT);
  assert.equal(f.phase, 'crashed'); assert.ok(f.landSpeed > 5);
  const g = lunar(0.6, -1, 20); g.e.cmd = 0; g.assist = false;
  for (let i = 0; i < 120 * 10 && g.phase === 'flying'; i++) flightStep(g, DT);
  assert.equal(g.phase, 'crashed'); assert.equal(g.failure.kind, 'tippedLanding');
});
console.log(`${pass} checks passed`);
