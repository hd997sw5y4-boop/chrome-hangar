// GB5: RCS thrusters, fin aero, terminal velocity and re-entry heating (js/rcs.js, js/aero.js, js/heat.js + the sim.js hook).
// Run: node tests/rcs-aero-heat.test.mjs
import fs from 'fs';
import { registerParts, starterRocket, stats, G0 } from '../js/rocket.js';
import { newFlight, flightStep, airDensity, ATMO_TOP, DT } from '../js/sim.js';
import { newRcs, rcsStep, rcsIsp } from '../js/rcs.js';
import { finAero, finInfo, dragArea, terminalVelocity } from '../js/aero.js';
import { heatFlux, heatStep, HEAT, newHull } from '../js/heat.js';

const idx = JSON.parse(fs.readFileSync('data/parts/index.json')).parts;
registerParts(idx.map(id => JSON.parse(fs.readFileSync(`data/parts/${id}.json`))));

let fails = 0, n = 0;
function ok(name, cond, detail = '') {
  n++;
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); }
}
const len = a => Math.hypot(a.x, a.y, a.z);
const finned = () => ({ stack: [{ p: 'mount' }, { p: 'tank_short', fins: 2, legs: true }, { p: 'nose' }], engine: 'spark' });
const bare = () => ({ stack: [{ p: 'mount' }, { p: 'tank_short', legs: true }, { p: 'nose' }], engine: 'spark' });
// a coasting rocket in free flight at altitude alt, velocity vel
function coast(rocket, alt, vel, opts = {}) {
  const f = newFlight(rocket, { wind: 0, assist: opts.assist ?? false });
  f.phase = 'flying'; f.legs = false;
  f.origin.y = alt; f.pos = { x: f.origin.x, y: alt + f.st.com, z: f.origin.z };
  f.vel = { ...vel }; f.alt = alt;
  if (opts.vacuum) f.vacuum = true;
  return f;
}

console.log('vacuum: aero and heat are exactly 0');
{
  ok('airDensity is 0 at and above ATMO_TOP', airDensity(ATMO_TOP) === 0 && airDensity(150e3) === 0 && airDensity(4e5) === 0);
  const f = coast(finned(), 200e3, { x: 300, y: -50, z: 0 });
  f.w = { x: 0.1, y: 0, z: 0 }; f.steer = { x: 1, z: 0 };
  const a = finAero(f, f.st, 0, f.vel, len(f.vel));
  ok('fin force and torque are 0 with rho 0', len(a.F) === 0 && len(a.T) === 0 && a.q === 0);
  ok('heat flux is 0 with rho 0 at 7.8 km/s', heatFlux(0, 7800) === 0);
  f.hull = newHull(300);
  for (let i = 0; i < 1200; i++) heatStep(f, 0, 7800, DT, () => {});
  ok('hull never heats in vacuum (it only cools)', f.hull.flux === 0 && f.hull.T <= 300, `T=${f.hull.T.toFixed(1)}`);
  // full sim: no aero drag at all above ATMO_TOP, so speed only changes by gravity
  const g = coast(finned(), 150e3, { x: 2000, y: 0, z: 0 }, { assist: true });
  g.steer = { x: 0.8, z: 0.3 };
  for (let i = 0; i < 120; i++) flightStep(g);
  ok('a 2 km/s rocket at 150 km keeps exactly its horizontal speed (no drag, no fin force)', g.vel.x === 2000 && g.vel.z === 0, `vx=${g.vel.x}`);
  ok('...and does not heat', g.hull.flux === 0 && g.hull.T < 300);
}

console.log('terminal velocity: 0.5 rho v^2 Cd A drag');
{
  for (const [alt, rk] of [[3000, finned()], [8000, bare()]]) {
    const f = coast(rk, alt, { x: 0, y: -10, z: 0 });
    f.e.cmd = 0;
    for (let i = 0; i < 120 * 90; i++) { f.pos.y = alt + f.st.com; f.origin.y = alt; flightStep(f); }   // hold the altitude so rho is fixed
    const st = stats(f.rocket, f.fill, f.fuelFrac), rho = airDensity(alt);
    const vt = terminalVelocity(st.mass, G0, rho, dragArea(st, f.rocket));
    const v = -f.vel.y;
    ok('still flying, nose up, tail first', f.phase === 'flying' && f.up.y > 0.999, `phase=${f.phase}`);
    ok(`falls at the analytic v_t at ${alt / 1000} km (${vt.toFixed(1)} m/s)`, Math.abs(v - vt) / vt < 0.03, `v=${v.toFixed(2)} vt=${vt.toFixed(2)}`);
    ok('HUD value f.vterm matches', Math.abs(f.vterm - vt) / vt < 0.01, `f.vterm=${f.vterm}`);
  }
}

console.log('heating rises with speed and density');
{
  ok('flux grows as v^3', Math.abs(heatFlux(0.01, 4000) / heatFlux(0.01, 2000) - 8) < 1e-9);
  ok('flux grows as sqrt(rho)', Math.abs(heatFlux(0.04, 3000) / heatFlux(0.01, 3000) - 2) < 1e-9);
  const run = (rho, v) => { const f = coast(finned(), 40e3, { x: 0, y: -v, z: 0 }); f.up = { x: 0, y: -1, z: 0 }; f.hull = newHull(250); for (let i = 0; i < 120 * 5; i++) heatStep(f, rho, v, DT, () => {}); return f.hull.T; };
  const a = run(0.004, 1500), b = run(0.004, 2500), c = run(0.02, 2500);
  ok('hotter at higher speed', b > a + 20, `${a.toFixed(0)} -> ${b.toFixed(0)} K`);
  ok('hotter at higher density', c > b + 20, `${b.toFixed(0)} -> ${c.toFixed(0)} K`);
  const f = coast(finned(), 40e3, { x: 0, y: -10, z: 0 }); f.hull = newHull(900);
  for (let i = 0; i < 120 * 300; i++) heatStep(f, 0.004, 10, DT, () => {});
  ok('radiates / convects back toward ambient when slow', f.hull.T < 650, `T=${f.hull.T.toFixed(0)}`);
}

console.log('burn-up above the limit');
{
  const f = coast(finned(), 45e3, { x: 0, y: -4500, z: 0 }); f.up = { x: 0, y: -1, z: 0 };
  let why = null;
  for (let i = 0; i < 120 * 60 && !why; i++) heatStep(f, 0.002, 4500, DT, (ff, kind, extra) => { why = { kind, extra }; ff.phase = 'crashed'; });
  ok('heatStep calls fail(burnup) past the limit', why?.kind === 'burnup' && why.extra.heat === true, JSON.stringify(why));
  ok('damage built up first', f.hull.peak >= HEAT.T_DMG, `peak=${f.hull.peak.toFixed(0)}`);
  const g = coast(finned(), 60e3, { x: 3000, y: -2500, z: 0 });
  g.up = { x: 0.77, y: -0.64, z: 0 };
  for (let i = 0; i < 120 * 120 && g.phase === 'flying'; i++) flightStep(g);
  ok('full sim: a 4 km/s dive into the air breaks up via failFlight', g.phase === 'crashed' && g.failure?.kind === 'burnup', `phase=${g.phase} fail=${JSON.stringify(g.failure)} T=${g.hull?.T}`);
  const s = coast(finned(), 30e3, { x: 0, y: -250, z: 0 });
  for (let i = 0; i < 120 * 10; i++) flightStep(s);
  ok('a 250 m/s fall does not burn up', s.phase === 'flying' && s.hull.T < HEAT.T_DMG, `T=${s.hull.T.toFixed(0)}`);
}

console.log('RCS: works in vacuum, burns monoprop, stops when empty');
{
  const f = coast(finned(), 200e3, { x: 0, y: 0, z: 0 }, { vacuum: true });
  f.rcs = newRcs(f.st); f.rcs.on = true;
  f.steer = { x: 1, z: 0 };
  const p0 = f.rcs.prop;
  for (let i = 0; i < 60; i++) flightStep(f);
  ok('steer torque spins the rocket in vacuum', len(f.w) > 0.01, `|w|=${len(f.w).toFixed(4)}`);
  ok('it uses monoprop', f.rcs.prop < p0, `${p0} -> ${f.rcs.prop}`);
  ok('attitude firing is a pure couple (no net force)', Math.abs(f.vel.x) < 1e-9 && Math.abs(f.vel.z) < 1e-9);
  f.steer = { x: 0, z: 0 }; f.rcs.cmd.tx = 1;
  const vx0 = f.vel.x;
  for (let i = 0; i < 60; i++) flightStep(f);
  ok('translation pushes sideways', f.vel.x - vx0 > 0.001, `dvx=${(f.vel.x - vx0).toFixed(4)}`);
  f.rcs.cmd.tx = 0; f.rcs.cmd.roll = 1;
  for (let i = 0; i < 30; i++) flightStep(f);
  ok('roll jets spin up the roll rate', f.rcs.wr > 0.001);
  ok('Isp 220 s vacuum, lower at sea level', rcsIsp(0) === 220 && rcsIsp(1.225) < 220);
  // empty tank: nothing happens (same as a twin flight with RCS off)
  const twin = JSON.parse(JSON.stringify(f)); twin.rocket = f.rocket; twin.eng = f.eng; twin.rcs.on = false;
  f.rcs.prop = 0; f.rcs.cmd = { roll: 1, tx: 1, ty: 1, tz: 1 }; f.steer = { x: 1, z: 1 };
  twin.rcs.prop = 0; twin.steer = { x: 1, z: 1 };
  const r0 = f.rcs.wr;
  for (let i = 0; i < 60; i++) { flightStep(f); flightStep(twin); }
  ok('no force, torque or roll at 0 propellant', len({ x: f.w.x - twin.w.x, y: f.w.y - twin.w.y, z: f.w.z - twin.w.z }) < 1e-12 && len({ x: f.vel.x - twin.vel.x, y: f.vel.y - twin.vel.y, z: f.vel.z - twin.vel.z }) < 1e-12 && f.rcs.wr === r0 && f.rcs.prop === 0 && !f.rcs.active);
  // off: nothing
  const r = newRcs(f.st), out = rcsStep(r, { ...f, steer: { x: 1, z: 0 } }, f.st, 0, DT);
  ok('RCS off by default and gives nothing', !r.on && len(out.F) === 0 && len(out.T) === 0 && r.prop === r.cap);
  // rate hold
  const h = coast(finned(), 200e3, { x: 0, y: 0, z: 0 }, { vacuum: true });
  h.rcs = newRcs(h.st); h.rcs.on = true; h.w = { x: 0.2, y: 0, z: 0 };
  for (let i = 0; i < 120 * 4; i++) flightStep(h);
  ok('rate hold (SAS) damps a spin with the stick centred', len(h.w) < 0.05, `|w|=${len(h.w).toFixed(3)}`);
}

console.log('fins: torque grows with q, drag grows with fins');
{
  const f = coast(finned(), 2000, { x: 0, y: 100, z: 0 });
  f.steer = { x: 1, z: 0 };
  const rho = airDensity(2000);
  const t1 = len(finAero(f, f.st, rho, { x: 0, y: 100, z: 0 }, 100).T), t2 = len(finAero(f, f.st, rho, { x: 0, y: 200, z: 0 }, 200).T);
  ok('fin control torque > 0', t1 > 0);
  ok('4x q gives 4x fin torque', Math.abs(t2 / t1 - 4) < 1e-6, `ratio=${(t2 / t1).toFixed(3)}`);
  ok('fin area from the parts list (2 pairs = 6 m^2)', Math.abs(finInfo(f.rocket).A - 6) < 1e-9 && finInfo(bare()).A === 0);
  ok('lost fins stop counting', finInfo(f.rocket, null, new Set([1])).A === 0);
  const sF = stats(finned()), sB = stats(bare());
  ok('drag area grows with fins', dragArea(sF, finned()) > dragArea(sB, bare()));
  const d = finAero(f, f.st, rho, { x: 0, y: 100, z: 0 }, 100).F;
  ok('fins add drag against the airflow', d.y < 0);
  // passive stability: fins aft, flying with an angle of attack -> torque turns the nose into the wind
  f.steer = { x: 0, z: 0 }; f.assist = false;
  const va = { x: 30, y: 100, z: 0 }, a = finAero(f, f.st, rho, va, len(va));
  ok('weathervaning torque turns the nose toward the airflow', a.T.z < 0, `Tz=${a.T.z}`);
}

console.log('engine-off rules are unaffected');
{
  const f = coast(finned(), 3000, { x: 0, y: 120, z: 0 }, { assist: true });
  f.e.cmd = 0; f.rcs = newRcs(f.st); f.rcs.on = true; f.steer = { x: 1, z: 0 };
  let maxAy = -Infinity;
  for (let i = 0; i < 120 * 8 && f.vel.y > 0.05; i++) { const vy = f.vel.y; flightStep(f); maxAy = Math.max(maxAy, (f.vel.y - vy) / DT); }
  ok('coasting with RCS attitude + fins: still ay <= -g', maxAy <= -G0 + 0.25, `maxAy=${maxAy.toFixed(3)}`);
}

console.log(fails ? `${fails} of ${n} failed` : `${n} checks passed`);
process.exit(fails ? 1 : 0);
