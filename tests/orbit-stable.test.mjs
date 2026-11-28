// An engine-off orbit must stay put: inverse-square gravity, no drag in vacuum, no damping, no regime-switch loss.
// Drives the real Free Mode space leg (MoonFlight.step, the same call flight.js makes every frame) headless, with the
// renderer / DOM stubbed. Run: node tests/orbit-stable.test.mjs
import { register } from 'node:module';
import fs from 'fs';
import assert from 'assert/strict';
const ROOT = new URL('../', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${ROOT}vendor/three/three.module.js', shortCircuit: true };
  if (ctx.parentURL?.endsWith('/js/moon.js') && spec === './spaceview.js') return { url: 'data:text/javascript,export class SpaceView{constructor(){return new Proxy({},{get:()=>()=>{},set:()=>true})}}', shortCircuit: true };
  if (ctx.parentURL?.endsWith('/js/moon.js') && spec === './env.js') return { url: 'data:text/javascript,export const SPOTS={pad:{x:0,y:0,z:-115}}', shortCircuit: true };
  return next(spec, ctx);
}`));
const O = await import(ROOT + 'js/orbit.js');
const S = await import(ROOT + 'js/sim.js');
const { registerParts } = await import(ROOT + 'js/rocket.js');
const { TimeWarp } = await import(ROOT + 'js/timewarp.js');
const { MoonFlight } = await import(ROOT + 'js/moon.js');
const { V } = O;
const idx = JSON.parse(fs.readFileSync(new URL('data/parts/index.json', ROOT))).parts;
registerParts(idx.map(id => JSON.parse(fs.readFileSync(new URL(`data/parts/${id}.json`, ROOT)))));
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const noop = () => {};
const STOCK = { stack: [{ p: 'mount' }, { p: 'tank_short', fins: 2, legs: true }, { p: 'tank_mini' }, { p: 'nose_needle' }], engine: 'vesper' };

// a normal Free Mode flight (no Moon practice, no mission) with the craft placed in orbit; perigee/apogee altitudes in km
function orbit(perigeeKm, apogeeKm = perigeeKm) {
  const f = S.newFlight(STOCK);
  const fm = { f, g: { audio: { tap: noop, star: noop }, toast: noop, input: { hit: () => false }, resultsOpen: false, menuOpen: false, mission: null, training: null, prompt: noop },
    w: { camera: { position: { x: 0, y: 0, z: 0 } } }, ended: false, camInit: false, countdown: null, capture: noop, copyPose: noop, cur: {}, prev: {}, thr: 0, armed: true };
  const m = Object.create(MoonFlight.prototype);
  Object.assign(m, { fm, w: fm.w, f, view: new Proxy({}, { get: () => noop, set: () => true }), warp: new TimeWarp(), on: true, sky: O.makeSky(Date.UTC(2026, 10, 27, 12)),
    mode: 'flatE', s: null, att: null, point: 'hold', acc: 0, moonLandings: 0, everMoon: false, maxDistE: 0, pred: null, predT: 1, frameKind: null, uiT: 1, practice: false, padPos0: { ...f.padPos },
    hud: { classList: { add: noop, remove: noop } }, pad: { classList: { add: noop, remove: noop, contains: () => true } } });
  const rp = O.R_E + perigeeKm * 1e3, ra = O.R_E + apogeeKm * 1e3, a = (rp + ra) / 2, vp = Math.sqrt(O.MU_E * (2 / rp - 1 / a));
  const mm = V.norm(O.moonPos(m.sky, 0)), Q = V.cross(m.sky.H, mm);
  m.s = { body: 'E', r: V.mul(mm, rp), v: V.mul(Q, vp), t: 0 };
  m.att = V.norm(m.s.v); f.phase = 'flying'; f.legOut = 0; f.e.cmd = 0; f.e.on = false; m.mode = 'space'; m.mapFrame();
  return { f, fm, m, frame: dt => { if (m.step(dt)) fm.acc = 0; } };
}
const alt = m => (V.len(m.s.r) - O.R_E) / 1e3;
const hOf = m => V.len(V.cross(m.s.r, m.s.v));
const E = m => O.energy(m.s.r, m.s.v, O.MU_E);
const period = m => O.elements(m.s.r, m.s.v, O.MU_E).period;

// one orbit at real time (60 fps frames), then the rest under time warp (x1000, the cap near Earth); returns the altitude band seen
function propagate(o, orbits) {
  const P = period(o.m), E0 = E(o.m), h0 = hOf(o.m); let lo = 1e9, hi = -1e9;
  const watch = () => { const a = alt(o.m); lo = Math.min(lo, a); hi = Math.max(hi, a); };
  while (o.f.t < P) { o.frame(1 / 60); watch(); assert.equal(o.m.mode, 'space', 'left the space leg at orbit ' + (o.f.t / P).toFixed(2)); }
  o.m.warp.i = 3;
  while (o.f.t < P * orbits) { o.frame(1 / 60); watch(); assert.equal(o.m.mode, 'space', 'left the space leg at orbit ' + (o.f.t / P).toFixed(2)); }
  return { lo, hi, dE: Math.abs((E(o.m) - E0) / E0), dh: Math.abs((hOf(o.m) - h0) / h0), orbits: o.f.t / P };
}

t('air density: exact old curve below 80 km, eased to zero by 100 km, zero above (the one helper for drag and fins)', () => {
  assert.equal(S.ATMO_TOP, 100e3);
  for (const h of [0, 1000, 10e3, 30e3, 70e3, 80e3]) assert.ok(Math.abs(S.airDensity(h) - 1.225 * Math.exp(-h / 8500)) < 1e-15);
  let prev = Infinity;
  for (let h = 0; h <= 130e3; h += 250) { const r = S.airDensity(h); assert.ok(r <= prev + 1e-18, 'monotonic at ' + h); prev = r; }
  assert.equal(S.airDensity(100e3), 0); assert.equal(S.airDensity(150e3), 0); assert.equal(S.airDensity(1e9), 0);
});

t('200 km circular, engine off, normal Free Mode: 20 orbits, incl. time warp, altitude within 1 km, E and h within 0.1%', () => {
  const o = orbit(200), r = propagate(o, 20);
  console.log(`   ${r.orbits.toFixed(1)} orbits, altitude ${r.lo.toFixed(3)}..${r.hi.toFixed(3)} km, dE ${r.dE.toExponential(1)}, dh ${r.dh.toExponential(1)}`);
  assert.ok(r.orbits >= 20 && r.lo > 199 && r.hi < 201); assert.ok(r.dE < 1e-3 && r.dh < 1e-3);
});

t('150 km circular (inside the old 195 km drag zone) also holds: no drag above the atmosphere', () => {
  const o = orbit(150), r = propagate(o, 20);
  assert.ok(r.lo > 149 && r.hi < 151 && r.dE < 1e-3 && r.dh < 1e-3, JSON.stringify(r));
});

t('elliptical 160 x 520 km (perigee above 100 km): 20 orbits, never below perigee, E and h conserved', () => {
  const o = orbit(160, 520), r = propagate(o, 20);
  console.log(`   ${r.orbits.toFixed(1)} orbits, altitude ${r.lo.toFixed(1)}..${r.hi.toFixed(1)} km, dE ${r.dE.toExponential(1)}, dh ${r.dh.toExponential(1)}`);
  assert.ok(r.lo > 159 && r.hi < 521 && r.dE < 1e-3 && r.dh < 1e-3);
});

t('elliptical 110 x 300 km (perigee just above the atmosphere) holds for 20 orbits', () => {
  const o = orbit(110, 300), r = propagate(o, 20);
  assert.ok(r.lo > 109 && r.dE < 1e-3 && r.dh < 1e-3, JSON.stringify(r));
});

t('a retrograde burn lowers the perigee (and does not otherwise disturb the engine-off orbit afterwards)', () => {
  const o = orbit(200), rp0 = O.elements(o.m.s.r, o.m.s.v, O.MU_E).rp;
  o.m.point = 'retro'; o.fm.thr = 1;
  for (let i = 0; i < 60 * 60 && O.elements(o.m.s.r, o.m.s.v, O.MU_E).rp > O.R_E + 150e3; i++) { o.f.e.cmd = o.fm.thr; o.frame(1 / 60); }   // Vesper until the perigee is ~150 km
  o.fm.thr = 0; o.f.e.cmd = 0; o.frame(1 / 60);
  const el = O.elements(o.m.s.r, o.m.s.v, O.MU_E);
  console.log(`   perigee ${((rp0 - O.R_E) / 1e3).toFixed(0)} -> ${((el.rp - O.R_E) / 1e3).toFixed(1)} km, fuel left ${(o.f.fuelFrac * 100).toFixed(0)}%`);
  assert.ok(el.rp < rp0 - 20e3, 'perigee must drop');
  assert.equal(o.f.e.on, false);
  assert.ok(el.rp > O.R_E + 105e3, 'test burn stays above the atmosphere, so it must then hold');
  const r = propagate(o, 10); assert.ok(r.dE < 1e-3 && r.dh < 1e-3 && r.lo > (el.rp - O.R_E) / 1e3 - 1, JSON.stringify(r));
});

t('a perigee inside the atmosphere decays and the craft comes back down', () => {
  const o = orbit(90, 300); let n = 0, minRp = Infinity;
  const P = period(o.m);
  while (o.m.mode === 'space' && o.f.t < P * 40) { o.frame(1 / 60); if (++n % 600 === 0) minRp = Math.min(minRp, O.elements(o.m.s.r, o.m.s.v, O.MU_E).rp); }
  console.log(`   left the space leg after ${(o.f.t / P).toFixed(1)} orbits (mode ${o.m.mode})`);
  assert.equal(o.m.mode, 'flatE', 'it must re-enter the air');
  assert.ok(o.f.t < P * 40);
});

console.log(pass + ' checks passed');
