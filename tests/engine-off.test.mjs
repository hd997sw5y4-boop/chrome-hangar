// After a cut or burnout, thrust is zero on the very next step: the rocket only coasts, then falls.
// Run: node tests/engine-off.test.mjs
import fs from 'fs';
import { registerParts, starterRocket, G0 } from '../js/rocket.js';
import { newEngine, engineStep, newFlight, flightStep, DT } from '../js/sim.js';

const idx = JSON.parse(fs.readFileSync('data/parts/index.json')).parts;
registerParts(idx.map(id => JSON.parse(fs.readFileSync(`data/parts/${id}.json`))));

let fails = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

const d = {
  minThrottle: 0.2, thrust: 115000, isp: 280, engines: 1,
  heat: { safeThrottle: 1, risePerSec: 0, coolPerSec: 20, baseTemp: 800, spanTemp: 400, limitTemp: 3000 }
};

console.log('engineStep: no spool-down thrust');
{
  const e = newEngine(); e.on = true; e.thr = 1; e.spool = 1; e.cmd = 1;
  let r = engineStep(e, d, DT, 200);
  ok('while commanded on, thrust is positive', r.thrust > 1000 && e.on);
  e.cmd = 0;
  r = engineStep(e, d, DT, 200);
  ok('first step after cut: thrust 0, thr 0, spool 0, engine off', r.thrust === 0 && r.mdot === 0 && !e.on && e.thr === 0 && e.spool === 0);
  r = engineStep(e, d, DT, 200);
  ok('it stays at zero', r.thrust === 0 && e.thr === 0);
  e.cmd = 1;
  r = engineStep(e, d, DT, 0);
  ok('no relight with empty tanks', r.thrust === 0 && !e.on);
  e.cmd = 1;
  r = engineStep(e, d, DT, 200);
  ok('relight with fuel starts the engine again', e.on);
  // spool from 0; after 0.4 s it should be making thrust
  for (let i = 0; i < 50; i++) r = engineStep(e, d, DT, 200);
  ok('relight produces thrust once spooled', e.on && r.thrust > 1000, `thrust=${r.thrust | 0} spool=${e.spool.toFixed(2)}`);
}

function launch(opts = {}) {
  const f = newFlight(starterRocket(), { wind: 0, assist: opts.assist ?? true });
  f.e.cmd = 1;
  return f;
}

// ay while still climbing must not be above -gee (drag only makes it more negative)
const SLACK = 0.25;
function coastCheck(f, label) {
  const predApex = f.alt + Math.max(0, f.vel.y) ** 2 / (2 * G0) + 80; // 80 m slack for integration / drag
  let maxAy = -Infinity, firstAy = null, climbed = 0, fell = false, endApex = f.apex, minAy = Infinity;
  const alt0 = f.alt, vy0 = f.vel.y;
  for (let i = 0; i < 120 * 400; i++) {
    const vy = f.vel.y;
    flightStep(f);
    const ay = (f.vel.y - vy) / DT;
    if (vy > 0.05) {
      if (firstAy == null) firstAy = ay;
      maxAy = Math.max(maxAy, ay);
      minAy = Math.min(minAy, ay);
      if (ay > -G0 + SLACK) {
        return { ok: false, why: `${label} step ${i}: ay=${ay.toFixed(3)} > -g+slack=${(-G0 + SLACK).toFixed(3)} on=${f.e.on} thr=${f.e.thr} thrust-like` };
      }
    }
    if (f.apex > predApex) return { ok: false, why: `${label} overshot ballistic apex: ${f.apex.toFixed(1)} > ${predApex.toFixed(1)}` };
    if (f.vel.y < 0 && f.alt < f.apex - 5) { fell = true; climbed = f.apex - alt0; endApex = f.apex; break; }
    if (f.phase === 'crashed' && f.vel.y < 0) { fell = true; endApex = f.apex; break; }
  }
  return { ok: fell && firstAy != null && maxAy <= -G0 + SLACK, firstAy, maxAy, minAy, climbed, apex: endApex, alt0, vy0, fell, predApex };
}

console.log('(a) cut at altitude, assist on');
{
  const f = launch({ assist: true });
  while (!(f.phase === 'flying' && f.alt > 2500) && f.t < 120) flightStep(f);
  ok('got to 2.5 km under power', f.phase === 'flying' && f.alt > 2500, `phase=${f.phase} alt=${f.alt}`);
  f.e.cmd = 0;
  const c = coastCheck(f, 'cut');
  ok('engine off on the next step', !f.e.on && f.e.thr === 0);
  ok('no upward accel from the next step (ay <= -g)', c.ok, c.why || `firstAy=${c.firstAy?.toFixed(3)} maxAy=${c.maxAy?.toFixed(3)}`);
  ok('it coasts then falls', c.fell && c.apex > c.alt0, `apex=${c.apex?.toFixed(1)} from ${c.alt0?.toFixed(1)}`);
}

console.log('(b) tanks run dry');
{
  const f = launch({ assist: true });
  while (!(f.phase === 'flying' && f.alt > 2500) && f.t < 120) flightStep(f);
  f.fuelFrac = 0;
  const c = coastCheck(f, 'dry');
  ok('engine off once the tanks are empty', !f.e.on && f.e.thr === 0 && f.fuelFrac === 0);
  ok('no upward accel after burnout (ay <= -g)', c.ok, c.why || `firstAy=${c.firstAy?.toFixed(3)} maxAy=${c.maxAy?.toFixed(3)}`);
  ok('it coasts then falls', c.fell, `apex=${c.apex?.toFixed(1)}`);
}

console.log('(b2) natural burnout');
{
  const f = launch({ assist: true });
  let saw = false;
  while (f.t < 300 && f.phase !== 'crashed') {
    const fuel = f.fuelFrac;
    flightStep(f);
    if (!saw && fuel > 0 && f.fuelFrac <= 0 && f.phase === 'flying') {
      saw = true;
      // this step may have burned the last of the fuel while still thrusting; the NEXT steps must not
      const c = coastCheck(f, 'natural');
      ok('natural burnout turns the engine off', !f.e.on && f.e.thr === 0);
      ok('no upward accel after natural burnout', c.ok, c.why || `firstAy=${c.firstAy?.toFixed(3)} maxAy=${c.maxAy?.toFixed(3)}`);
      ok('then it falls', c.fell, `apex=${c.apex?.toFixed(1)} alt=${f.alt.toFixed(1)}`);
      break;
    }
  }
  ok('reached a natural burnout', saw);
}

console.log('(c) assist on, engine off — still no climb force');
{
  const f = launch({ assist: true });
  f.assist = true;
  while (!(f.phase === 'flying' && f.alt > 1800) && f.t < 120) flightStep(f);
  f.e.cmd = 0;
  // give it a little tilt / steering so assist would have something to do if it were still pushing
  f.steer.x = 0.6; f.up = { x: 0.08, y: Math.sqrt(1 - 0.08 * 0.08), z: 0 };
  const c = coastCheck(f, 'assist');
  ok('assist stays on as a flag', f.assist === true);
  ok('assist + engine off still has ay <= -g', c.ok, c.why || `firstAy=${c.firstAy?.toFixed(3)} maxAy=${c.maxAy?.toFixed(3)}`);
  ok('then it falls', c.fell);
}

console.log('(d) relight still works with fuel');
{
  const f = launch({ assist: true });
  while (!(f.phase === 'flying' && f.alt > 2000) && f.t < 120) flightStep(f);
  f.e.cmd = 0;
  for (let i = 0; i < 60; i++) flightStep(f);
  ok('stays off after the cut', !f.e.on && f.e.thr === 0);
  const fuel = f.fuelFrac, alt = f.alt;
  ok('fuel remains for a relight', fuel > 0.2);
  f.e.cmd = 1;
  let ayMax = -Infinity, cameOn = false, thrusty = false;
  for (let i = 0; i < 120 * 3; i++) {
    const vy = f.vel.y;
    flightStep(f);
    const ay = (f.vel.y - vy) / DT;
    if (f.e.on) cameOn = true;
    ayMax = Math.max(ayMax, ay);
    if (f.e.on && ay > 0) thrusty = true;
  }
  ok('relight starts the engine', cameOn && f.e.on);
  ok('relight produces upward acceleration', thrusty && ayMax > 0, `ayMax=${ayMax.toFixed(3)} alt ${alt.toFixed(0)}→${f.alt.toFixed(0)}`);
}

if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall ok');
