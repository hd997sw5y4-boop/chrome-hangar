// Pad to Moon with the prebuilt Moon Rocket and the autopilot (gb3-moon-rocket), headless: the real sim.js flat legs (with GB5's
// RCS / fin aero / re-entry heat block) + part health, the real moon.js space leg (MoonFlight.step / afterFlat, GB5-RCS hooks),
// GB5's rcs-ui input + space-leg heating, staging.js separations and autopilot.js, stepped per 60 fps frame in flight.js order
// (tests/helpers/game.mjs). Phases are asserted from the physics state, not from what the autopilot says.
// Run: node tests/moon-rocket.test.mjs   (MOON_DATES=2026-12-18T06:00Z,... picks the launch dates; default: two)
import assert from 'assert/strict';
import fs from 'fs';
import { makeFlight, PRESETS, O, R, ST } from './helpers/game.mjs';
import { HEAT } from '../js/heat.js';
const { MoonRocketFlight } = await import('../js/moonrocket.js');
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const km = x => (x / 1e3).toFixed(1);

t('Moon Rocket preset: builds clean, liftoff TWR >= 1.2, stable, 15+ km/s in vacuum over 4 stages', () => {
  const r = PRESETS.moonRocket(), st = R.stats(r, 1, 1), S4 = ST.stageStats(r, 1), tot = S4.reduce((a, x) => a + x.dvVac, 0);
  assert.deepEqual(R.problems(r), []);
  assert.ok(r.stack.length <= R.MAX_STACK);
  assert.ok(st.twr >= 1.2, 'liftoff TWR ' + st.twr);
  assert.equal(R.stability(st).word, 'Stable');
  assert.equal(S4.length, 4);
  assert.ok(tot >= 15000, 'total ' + tot);
  for (const x of S4) console.log(`   ${x.engine.padEnd(22)} ${km(x.mass).padStart(6)} t  dv ${Math.round(x.dvSL)} SL / ${Math.round(x.dvVac)} vac m/s  TWR ${x.twr.toFixed(2)} SL / ${x.twrVac.toFixed(2)} vac`);
  console.log(`   total ${km(tot)} km/s, ${r.stack.length} stack parts, ${R.layout(r).top.toFixed(1)} m tall, ${km(st.mass)} t`);
  const L = S4[3], fl = R.PARTS.flicker, lunarW = L.mass * 1.62, minT = fl.thrust * 1.1 * fl.minThrottle;   // the lander can nearly hover on the Moon
  assert.ok(minT < lunarW * 1.6, `min thrust ${minT} vs lunar weight ${lunarW}`);
});

t('staging: separation drops the spent stage for real (mass, engine, fuel), keeps the velocity, fires the stage event', () => {
  const g = makeFlight(PRESETS.moonRocket()), f = g.f;
  f.phase = 'flying'; f.vel = { x: 10, y: 300, z: 0 }; f.fuelFrac = 0;
  const m0 = R.stats(f.rocket, 1, 0).mass, lowerDry = R.stats(ST.split(f.rocket).lower, 1, 0).mass, seen = [], off = ST.onStage(e => seen.push(e));
  assert.ok(ST.canStage(f) && ST.stageDry(f));
  const s = ST.separate(f); off();
  assert.ok(s); assert.equal(f.stage, 1); assert.equal(ST.stageIndex(f), 1); assert.equal(f.eng.id, 'hydro_upper'); assert.equal(f.fuelFrac, 1);
  const m1 = R.stats(f.rocket, 1, 1).mass;
  assert.ok(lowerDry > 10000 && Math.abs(m0 - m1 - lowerDry) < 1, `dropped ${m0 - m1} kg, the empty stage is ${lowerDry} kg`);
  assert.deepEqual(f.vel, { x: 10, y: 300, z: 0 });
  assert.equal(seen.length, 1); assert.equal(f.events.at(-1).type, 'stage');
  const ap = ST.activeParts(f.rocket);
  assert.ok(ap.every(p => p.index <= R.activeEnd(f.rocket)), 'active parts = the burning stage only');
  assert.equal(ap.reduce((a, p) => a + (p.fins || 0), 0), 0, 'the finned first stage is gone from activeParts');
});

t('autopilot never writes position, velocity, mass, fuel, the engine or heat (static check: it only calls the io controls)', () => {
  const src = fs.readFileSync(new URL('../js/autopilot.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const bad of [/\bs\.(r|v)\s*=[^=]/, /\.(pos|vel|origin|w)\s*=[^=]/, /fuelFrac\s*=[^=]/, /\.mass\s*=[^=]/, /\.e\.(cmd|thr|on)\s*=[^=]/, /\bf\.(stage|rocket|eng|hull|rcs)\s*=[^=]/, /\.T\s*=[^=]/])
    assert.ok(!bad.test(src), 'autopilot.js matches ' + bad);
});

function mission(epoch) {
  const g = makeFlight(PRESETS.moonRocket(), { epoch: Date.parse(epoch) }), ap = g.ap, m = g.m;
  ap.engage();
  let coast = null, soi = null, cap = null, rpMinCoast = Infinity, ph = '', fuelAt = [], hullAscent = 0, rcsOn = false;
  for (let i = 0; i < 4e6 && !g.crash && ap.on && ap.phase !== 'LANDED'; i++) {
    g.frame();
    if (g.f.rcs?.on) rcsOn = true;
    if (ap.phase !== ph) { ph = ap.phase; fuelAt.push(`${ph} S${(g.f.stage || 0) + 1} ${(g.f.fuelFrac * 100).toFixed(0)}%`); }
    if (ph === 'ASCENT' || ph === 'ORBIT') hullAscent = Math.max(hullAscent, g.f.hull?.T || 0);
    if (ph === 'LANDING' && !cap && m.mode === 'space' && m.s.body === 'M') { const el = O.elements(m.s.r, m.s.v, O.MU_M); cap = { t: m.s.t, e: el.e, pe: el.rp - O.R_M, ap: el.ra - O.R_M }; }
    if (m.mode === 'space' && m.s.body === 'E' && ap.phase === 'COAST') {
      const el = O.elements(m.s.r, m.s.v, O.MU_E);
      if (!coast) coast = { t0: m.s.t, period: el.period, pe: el.rp - O.R_E, ap: el.ra - O.R_E };
      rpMinCoast = Math.min(rpMinCoast, el.rp - O.R_E); coast.t1 = m.s.t;
      assert.ok(!(g.f.e.on && g.f.e.thr > 0), 'engine off while coasting');
    }
    if (m.mode === 'space' && m.s.body === 'M' && !soi) soi = { t: m.s.t };
  }
  return { g, coast, rpMinCoast, soi, cap, fuelAt, hullAscent, rcsOn };
}

const dates = (process.env.MOON_DATES || '2026-11-27T12:00Z,2026-12-18T06:00Z').split(',');
for (const d of dates) t(`pad -> stable orbit -> TLI -> Moon SOI -> capture -> powered landing, no heat failure (launch ${d})`, () => {
  const w0 = Date.now(), { g, coast, rpMinCoast, soi, cap, fuelAt, hullAscent, rcsOn } = mission(d), f = g.f;
  assert.equal(g.crash, undefined, 'crashed: ' + JSON.stringify(g.crash));
  assert.ok(!f.hull?.burnt, 'no burn-up');
  assert.ok((f.hull?.dmg || 0) === 0, 'no heat damage: ' + f.hull?.dmg);
  assert.ok(g.hullPeak < HEAT.T_DMG, `hull peak ${g.hullPeak.toFixed(0)} K stays under the ${HEAT.T_DMG} K damage line`);
  assert.equal(rcsOn, false, 'RCS stays off on autopilot');
  assert.ok(coast, 'reached a coast in Earth orbit');
  assert.ok(rpMinCoast > 100e3, 'perigee ' + rpMinCoast);
  assert.ok(coast.t1 - coast.t0 >= coast.period, `coasted ${(coast.t1 - coast.t0).toFixed(0)} s of a ${coast.period.toFixed(0)} s orbit`);
  assert.ok(soi, 'entered the Moon\'s sphere of influence');
  assert.ok(cap && cap.e < 1 && cap.pe > 15e3 && cap.ap < 66e6, 'captured into a closed lunar orbit ' + JSON.stringify(cap));
  const ld = g.moonLanded; assert.ok(ld, 'landed on the Moon');
  assert.ok(ld.speed < 5 && ld.tilt < 15, JSON.stringify(ld)); assert.ok(f.legs && f.legOut > 0.85, 'legs down');
  assert.ok(ld.fuel >= 0); assert.equal(g.ap.phase, 'LANDED');
  assert.equal(g.stageEvents.length, 3); for (const s of g.stageEvents) assert.equal(s.fuelFracBefore, 0, 'staged only when dry');
  const lander = R.stats(f.rocket, 1, f.fuelFrac);
  console.log(`   orbit ${km(coast.pe)} x ${km(coast.ap)} km, ${((coast.t1 - coast.t0) / coast.period).toFixed(2)} orbits engine-off before TLI; Moon SOI at ${(soi.t / 3600).toFixed(1)} h; captured ${km(cap.pe)} x ${km(cap.ap)} km`);
  console.log(`   stages 1-3 dropped dry at ${g.stageEvents.map(s => `${(s.t / 60).toFixed(1)} min (${s.mode})`).join(', ')}; MCC ${JSON.stringify((g.ap.stats.mcc || []).map(x => +(x.dv ?? 0).toFixed(1)))} m/s`);
  console.log(`   hull peak ${(g.hullPeak - 273.15).toFixed(0)} °C (ascent ${(hullAscent - 273.15).toFixed(0)} °C; damage starts at ${(HEAT.T_DMG * 1.25 - 273.15).toFixed(0)} °C for the Dome Cap)`);
  console.log(`   active stage fuel at each phase start: ${fuelAt.join(' · ')}`);
  console.log(`   landed ${ld.speed.toFixed(2)} m/s, tilt ${ld.tilt.toFixed(2)} deg; lander fuel left ${Math.round(ld.fuel)} kg (${(f.fuelFrac * 100).toFixed(1)}%, ~${Math.round(f.eng.isp * 1.1 * 9.80665 * Math.log(lander.mass / lander.dry))} m/s); mission ${(ld.t / 3600).toFixed(1)} h; wall ${((Date.now() - w0) / 1000).toFixed(1)} s`);
});

const fly = () => { const g = makeFlight(PRESETS.moonRocket()), mr = new MoonRocketFlight(g.fm); mr.reset(); g.ap = mr.ap; mr.toggle(); assert.ok(mr.ap.on); for (let i = 0; i < 60 * 12; i++) g.frame(); assert.equal(g.f.phase, 'flying'); assert.ok(mr.ap.on); return { g, mr }; };
const mkInp = () => ({ steer: { x: 0, y: 0 }, keys: new Set(), held: new Set(), pad: null, hit(k) { return this.keys.has(k); }, down(k) { return this.held.has(k); } });

t('takeover: autopilot commands never trip it; any player control (stick, throttle, keys, GB5 RCS) turns it off at once', () => {
  { // the autopilot's own throttle / steering over a full frame sequence is not "player input"
    const { g, mr } = fly();
    for (let i = 0; i < 120; i++) { const inp = mkInp(), before = g.fm.thr; mr.checkTakeover(inp, before); g.frame(); }
    assert.ok(mr.ap.on, 'still on after 120 frames of its own commands');
  }
  const tries = [
    ['stick', inp => { inp.steer.x = 0.6; }],
    ['throttle', (inp, fm) => { fm.thr = Math.max(0, fm.thr - 0.1); }],
    ['cut key X', inp => { inp.keys.add('KeyX'); }],
    ['warp key', inp => { inp.keys.add('Period'); }],
    ['RCS toggle N', inp => { inp.keys.add('KeyN'); }],
    ['RCS roll O held', inp => { inp.held.add('KeyO'); }],
    ['RCS switched on (touch button)', (inp, fm) => { fm.f.rcsWant = true; }],
    ['RCS translate (touchpad held)', inp => { inp.pad = { b: { 17: 1 }, L: { x: 0.5, y: 0 } }; }],
  ];
  for (const [name, act] of tries) {
    const { g, mr } = fly();
    const inp = mkInp(), before = g.fm.thr; act(inp, g.fm); mr.checkTakeover(inp, before);
    assert.equal(mr.ap.on, false, name + ' must disengage');
    assert.equal(mr.ap.events.at(-1).why, 'input');
    assert.ok(g.notes.some(n => /you have control/i.test(n)), 'HUD note');
  }
  const { g, mr } = fly();
  mr.input(Object.assign(mkInp(), { hit: k => k === 'Space' })); assert.equal(mr.ap.on, false, 'stage key disengages'); assert.equal(g.f.stage, 1, 'and stages');
  mr.input(Object.assign(mkInp(), { hit: k => k === 'KeyJ' })); assert.equal(mr.ap.on, true, 'J turns it back on'); assert.equal(mr.ap.phase, 'ASCENT');
  mr.input(Object.assign(mkInp(), { hit: k => k === 'KeyJ' })); assert.equal(mr.ap.on, false, 'J again turns it off');
});

t('auto-staging: the autopilot stages when the burning stage runs dry, and not before', () => {
  const g = makeFlight(PRESETS.moonRocket()); g.ap.engage();
  for (let i = 0; i < 60 * 12; i++) g.frame();
  assert.equal(g.f.stage || 0, 0);
  g.f.fuelFrac = 0.01; g.frame(); assert.equal(g.f.stage || 0, 0, 'not while fuel is left');
  let n = 0; while (!(g.f.stage > 0) && n++ < 60 * 30) g.frame();
  assert.equal(g.f.stage, 1); assert.equal(g.stageEvents[0].fuelFracBefore, 0);
  assert.ok(n < 60 * 5, 'staged within seconds of running dry (' + n + ' frames)');
});

t('heat guard: a hot hull in the thick air makes the autopilot throttle back (GB5 heating)', () => {
  const g = makeFlight(PRESETS.moonRocket()); g.ap.engage();
  for (let i = 0; i < 60 * 20; i++) g.frame();
  assert.equal(g.m.mode, 'flatE'); const full = g.fm.thr;
  g.f.hull.T = HEAT.T_DMG * (g.f.hull.spec?.tol ?? 1) * 0.95; g.frame();
  assert.ok(g.fm.thr < full - 0.2, `throttle ${full} -> ${g.fm.thr}`);
  assert.ok(g.fm.thr >= g.f.eng.minThrottle - 1e-9);
});

console.log(pass + ' checks passed');
