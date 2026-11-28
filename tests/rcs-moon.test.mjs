// GB5: RCS on the Moon (landing leg through sim.js, and the orbit.js space leg via rcs-moon.js). Run: node tests/rcs-moon.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import * as O from '../js/orbit.js';
import { registerParts, starterRocket, stats, G0 } from '../js/rocket.js';
import { newFlight, flightStep, DT } from '../js/sim.js';
import { newRcs } from '../js/rcs.js';
import { rcsSpaceAcc, rcsSpaceBusy, rcsSpaceFine, FINE_RATE } from '../js/rcs-moon.js';
const { V } = O;
const idx = JSON.parse(fs.readFileSync(new URL('../data/parts/index.json', import.meta.url))).parts;
registerParts(idx.map(id => JSON.parse(fs.readFileSync(new URL(`../data/parts/${id}.json`, import.meta.url)))));
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const lunar = (alt, vel, rcs = true) => {
  const f = newFlight(starterRocket(), { padPos: { x: 0, y: 0, z: -115 } });
  f.gee = O.G_M; f.vacuum = true; f.wind = 0; f.phase = 'flying'; f.legOut = 1; f.legAuto = 1; f.assist = true;
  f.pos = { x: 0, y: alt + f.st.com, z: -115 }; f.origin = { x: 0, y: alt, z: -115 }; f.vel = { ...vel }; f.t = 1;
  f.rcs = newRcs(f.st); f.rcs.on = rcs; f.e.cmd = 0;
  return f;
};

t('Moon landing leg: RCS translation changes velocity by F/m, uses monoprop, no aero or heat', () => {
  const f = lunar(5000, { x: 0, y: 0, z: 0 }), g = lunar(5000, { x: 0, y: 0, z: 0 }, false), p0 = f.rcs.prop;
  f.rcs.cmd = { roll: 0, tx: 1, ty: 0, tz: 0 };
  for (let i = 0; i < 240; i++) { flightStep(f, DT); flightStep(g, DT); }   // 2 s
  const m = f.st.mass + f.rcs.prop - f.rcs.cap, dv = f.rcs.F / m * 2;
  assert.ok(Math.abs(f.vel.x - dv) / dv < 0.02, `vx ${f.vel.x} vs ${dv}`);
  assert.ok(Math.abs(f.vel.z) < 1e-9 && Math.abs(f.vel.y - g.vel.y) < 1e-9, 'sideways push only');
  assert.equal(g.vel.x, 0);
  assert.ok(f.rcs.prop < p0, 'monoprop used'); assert.ok(f.rcs.active);
  assert.equal(f.q, 0); assert.equal(f.hull.flux, 0); assert.ok(f.hull.T <= 288.2); assert.ok(!Number.isFinite(f.vterm));
});
t('Moon landing leg: up / down translation along the rocket axis', () => {
  const f = lunar(5000, { x: 0, y: 0, z: 0 }); f.rcs.cmd = { roll: 0, tx: 0, ty: 1, tz: 0 };
  for (let i = 0; i < 120; i++) flightStep(f, DT);
  const m = f.st.mass + f.rcs.prop - f.rcs.cap, dvy = f.rcs.F / m - O.G_M;
  assert.ok(Math.abs(f.vel.y - dvy) < 0.02, `vy ${f.vel.y} vs ${dvy}`);
});
t('Moon landing leg: RCS attitude works with the engine off, and stops at 0 propellant', () => {
  const f = lunar(5000, { x: 0, y: 0, z: 0 }); f.assist = false; f.steer = { x: 1, z: 0 };
  for (let i = 0; i < 60; i++) flightStep(f, DT);
  assert.ok(Math.hypot(f.w.x, f.w.y, f.w.z) > 1e-4, 'turns');
  f.rcs.prop = 0; f.rcs.cmd = { roll: 0, tx: 1, ty: 1, tz: 1 }; const v0 = { ...f.vel }, w0 = { ...f.w };
  for (let i = 0; i < 60; i++) flightStep(f, DT);
  assert.ok(Math.abs(f.vel.x - v0.x) < 1e-12 && Math.abs(f.vel.z - v0.z) < 1e-12 && !f.rcs.active);
});
t('Moon landing leg: RCS cancels a sideways drift so the landing succeeds (and fails without it)', () => {
  const run = rcs => {
    const f = lunar(150, { x: 4, y: -4, z: 0 }, rcs);
    for (let i = 0; i < 120 * 200 && f.phase === 'flying'; i++) {
      const target = -Math.max(1.0, Math.min(8, 1 + f.alt * 0.12));
      const want = f.st.mass * (O.G_M + (target - f.vel.y) * 0.8) / (f.eng.thrust * 1.1);
      f.e.cmd = want < f.eng.minThrottle * 0.6 ? 0 : Math.max(f.eng.minThrottle, Math.min(1, want));
      if (rcs) f.rcs.cmd = { roll: 0, tx: Math.max(-1, Math.min(1, -f.vel.x * 2)), ty: 0, tz: 0 };
      flightStep(f, DT);
    }
    return f;
  };
  const a = run(true), b = run(false);
  assert.equal(a.phase, 'landed', JSON.stringify(a.failure)); assert.ok(a.rcs.prop > 0 && a.rcs.prop < a.rcs.cap);
  assert.notEqual(b.phase, 'landed');
});

// ---- the space leg (orbit.js state), as moon.js powered() drives it ----
const sky = O.makeSky(Date.UTC(2026, 10, 27, 12));
const B = O.padBasis(sky, 0);
const orbitM = () => { const r0 = O.R_M + 30e3, vc = Math.sqrt(O.MU_M / r0); return { body: 'M', t: 0, r: [r0, 0, 0], v: [0, vc, 0] }; };
const spaceRun = (rcs, cmd, secs, att = [1, 0, 0]) => {
  const f = newFlight(starterRocket(), {}); f.phase = 'flying'; const st = f.st = stats(f.rocket, 1, 1);
  f.rcs = newRcs(st); f.rcs.on = rcs; f.rcs.cmd = cmd;
  const s = orbitM(), s0 = { r: s.r.slice(), v: s.v.slice() };
  for (let i = 0; i < secs * 120; i++) {
    const acc = rcsSpaceAcc(f, st, DT, V.mul(att, 0), att, B, O, V);
    O.thrustStep(sky, s, DT, acc, null);
  }
  return { f, s, s0 };
};
t('Moon space leg: RCS translation changes velocity as expected and uses monoprop', () => {
  const a = spaceRun(true, { roll: 0, tx: 1, ty: 0, tz: 0 }, 5), b = spaceRun(false, { roll: 0, tx: 1, ty: 0, tz: 0 }, 5);
  const dir = O.localToVec(B, { x: 1, y: 0, z: 0 }), dvv = V.sub(a.s.v, b.s.v), along = V.dot(dvv, dir);
  const m = stats(a.f.rocket, 1, 1).mass + a.f.rcs.prop - a.f.rcs.cap, want = a.f.rcs.F / m * 5;
  assert.ok(Math.abs(along - want) / want < 0.03, `dv ${along} vs ${want}`);
  assert.ok(a.f.rcs.prop < a.f.rcs.cap, 'monoprop used'); assert.equal(b.f.rcs.prop, b.f.rcs.cap);
  assert.ok(rcsSpaceBusy(a.f) && !rcsSpaceBusy(b.f));
});
t('Moon space leg: up / down translation is along the pointing, and no force without RCS or propellant', () => {
  const a = spaceRun(true, { roll: 0, tx: 0, ty: -1, tz: 0 }, 3), b = spaceRun(false, { roll: 0, tx: 0, ty: -1, tz: 0 }, 3);
  assert.ok(V.dot(V.sub(a.s.v, b.s.v), [1, 0, 0]) < -0.1, 'pushed down along the pointing');
  assert.ok(V.len(V.sub(a.s.v, b.s.v)) > 0.1);
  const f = newFlight(starterRocket(), {}); f.rcs = newRcs(f.st); f.rcs.on = true; f.rcs.prop = 0; f.rcs.cmd = { tx: 1, ty: 1, tz: 1, roll: 0 };
  const acc0 = [0, 0, 0]; assert.equal(rcsSpaceAcc(f, f.st, DT, acc0, [1, 0, 0], B, O, V), acc0); assert.ok(!rcsSpaceBusy(f));
});
t('Moon space leg: fine attitude adds to the slew, only with RCS on and propellant', () => {
  const f = newFlight(starterRocket(), {}); f.rcs = newRcs(f.st);
  assert.equal(rcsSpaceFine(f, f.st, 0.1, 1), 0);
  f.rcs.on = true; const p = f.rcs.prop; assert.equal(rcsSpaceFine(f, f.st, 0.1, 1), FINE_RATE); assert.ok(f.rcs.prop < p);
  f.rcs.prop = 0; assert.equal(rcsSpaceFine(f, f.st, 0.1, 1), 0);
});
console.log(`${pass} checks passed`);
