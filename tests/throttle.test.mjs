// Headless checks for flight throttle, cutoff, relight and fuel burn. Run: node tests/throttle.test.mjs
import { newEngine, engineStep, DT } from '../js/sim.js';
import { RATE, PAD_CUT, applyKeys, applyAbs, cut, toggle, engineState, canRelight, snapshot } from '../js/throttle.js';

const d = {
  minThrottle: 0.2, thrust: 115000, isp: 280, engines: 1,
  heat: { safeThrottle: 1, risePerSec: 0, coolPerSec: 20, baseTemp: 800, spanTemp: 400, limitTemp: 3000 }
};
const inp = (held = [], hits = []) => ({
  down: c => held.includes(c) ? 1 : 0,
  hit: c => hits.includes(c),
  pad: null
});
let fails = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

console.log('throttle keys');
ok('rate is 50%/s', RATE === 0.5);
let t = applyKeys(0.5, inp(['ShiftLeft']), 1); ok('Shift raises 50% in 1 s', Math.abs(t - 1) < 1e-9, t);
t = applyKeys(0.5, inp(['ControlLeft']), 1); ok('Ctrl lowers 50% in 1 s', Math.abs(t - 0) < 1e-9, t);
t = applyKeys(0.5, inp(['KeyF']), 0.2); ok('F still lowers (existing binding)', Math.abs(t - 0.4) < 1e-9, t);
t = applyKeys(0.4, inp(['KeyR']), 0.2); ok('R still raises (existing binding)', Math.abs(t - 0.5) < 1e-9, t);
t = applyKeys(0.2, inp(['ShiftLeft', 'KeyR']), 1); ok('Shift+R is not double speed', Math.abs(t - 0.7) < 1e-9, t);
t = applyKeys(0.2, inp(['ShiftLeft', 'ControlLeft']), 1); ok('Shift+Ctrl cancel', Math.abs(t - 0.2) < 1e-9, t);
t = applyKeys(0.3, inp([], ['KeyZ'])); ok('Z is full', t === 1);
t = applyKeys(0.8, inp([], ['KeyX'])); ok('X cuts to 0', t === 0);
t = applyKeys(0.8, inp([], ['Pad' + PAD_CUT])); ok('L3 (Pad10) cuts to 0', t === 0);
t = applyKeys(0.9, inp(['MetaLeft']), 1); ok('Cmd/meta is not throttle-down', t === 0.9);

console.log('absolute R2 / cut latch');
{
  const s = { padThrHeld: false, touchThr: null, cutLatch: false };
  const p = { pad: { b: { 7: 0.6 } }, hit: () => false, down: () => 0 };
  t = applyAbs(0, p, s); ok('R2 is absolute throttle', t === 0.6);
  cut(s); s.thr = 0;
  t = applyAbs(0, p, s); ok('R2 is ignored right after a cut', t === 0 && s.cutLatch);
  p.pad.b[7] = 0; t = applyAbs(0, p, s); ok('releasing R2 clears the latch', s.cutLatch === false);
  p.pad.b[7] = 0.4; t = applyAbs(0, p, s); ok('R2 can throttle up again after release', t === 0.4);
  s.cutLatch = true; s.touchThr = 0.55; s.touchFresh = true;
  t = applyAbs(0, p, s); ok('a new touch after a cut may relight', t === 0.55 && s.cutLatch === false);
}

console.log('relight toggle');
{
  const s = { thr: 0.7, lastThr: 0.7, touchThr: null, cutLatch: false };
  const e = newEngine(); e.on = true; e.thr = 0.7; e.cmd = 0.7;
  let r = toggle(s, e, 0.5, 0.2);
  ok('toggle cuts a running engine', r.ok && !r.on && s.thr === 0 && s.cutLatch);
  e.on = false;
  r = toggle(s, e, 0.5, 0.2);
  ok('toggle relights at the last throttle', r.ok && r.on && Math.abs(s.thr - 0.7) < 1e-9);
  s.thr = 0; e.on = false;
  r = toggle(s, e, 0, 0.2);
  ok('no relight with empty tanks', !r.ok && r.dry && s.thr === 0);
  r = toggle(s, { on: false, failed: true }, 0.8, 0.2);
  ok('no relight after a failed engine', !r.ok && s.thr === 0);
  ok('canRelight needs fuel and a healthy engine', canRelight(e, 0.2) && !canRelight(e, 0) && !canRelight({ failed: true }, 1));
}

console.log('engineStep: cutoff, fuel, relight');
{
  const burn = (e, cmd, fuel, steps) => {
    e.cmd = cmd; let used = 0, thrust = 0, on = 0;
    for (let i = 0; i < steps; i++) {
      const r = engineStep(e, d, DT, fuel - used);
      used += r.mdot * DT; thrust = r.thrust; if (e.on) on++;
    }
    return { used, thrust, on, e };
  };
  let e = newEngine();
  let r = burn(e, 0, 200, 120);
  ok('zero throttle: no thrust and no fuel burn', r.used === 0 && r.thrust === 0 && !e.on && r.on === 0);
  e = newEngine();
  r = burn(e, 1, 200, 120);
  ok('full throttle burns fuel and makes thrust', r.used > 1 && r.thrust > 1000 && e.on, `used=${r.used.toFixed(2)} thrust=${r.thrust|0}`);
  const usedOn = r.used;
  r = burn(e, 0, 200 - usedOn, 120);
  ok('cutting the engine stops thrust and fuel burn', r.used === 0 && r.thrust === 0 && !e.on);
  r = burn(e, 1, 200 - usedOn, 60);
  ok('relight with fuel remaining restarts thrust', e.on && r.thrust > 0 && r.used > 0);
  e = newEngine();
  r = burn(e, 1, 0, 60);
  ok('no relight at zero fuel', !e.on && r.used === 0 && r.thrust === 0);
  e = newEngine();
  r = burn(e, 0.1, 200, 120);
  ok('command below min throttle keeps the engine off', !e.on && r.used === 0 && r.thrust === 0);
}

console.log('HUD / cockpit snapshot');
{
  ok('labels', engineState({ on: true }, 0.4) === 'ON' && engineState({ on: false }, 0.4) === 'OFF' && engineState({ on: false }, 0) === 'NO FUEL');
  const snap = snapshot(0.8, { on: true, thr: 0.7, cmd: 0.8, failed: false }, 0.4);
  ok('cockpit fields', snap.thr === 0.7 && snap.thrCmd === 0.8 && snap.on === true && snap.state === 'ON' && snap.failed === false && snap.fuelFrac === 0.4);
  const off = snapshot(0, { on: false, thr: 0.1, cmd: 0, failed: false }, 0.4);
  ok('thr is 0 when the engine is off', off.thr === 0 && off.state === 'OFF');
  const dry = snapshot(1, { on: false, thr: 0, cmd: 1, failed: false }, 0);
  ok('NO FUEL state', dry.state === 'NO FUEL' && dry.thr === 0);
}

if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall ok');
