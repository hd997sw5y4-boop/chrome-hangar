// Headless checks that cockpit gauges follow window.CH.engine (and fall back to the sim).
// Run: node tests/cockpit-engine.test.mjs
import { engineGauges, engineReadout } from '../js/cockpit-engine.js';
import { snapshot } from '../js/throttle.js';

let fails = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

const simOn = { on: true, thr: 0.4, cmd: 0.4, failed: false };
const simOff = { on: false, thr: 0.4, cmd: 0, failed: false };

console.log('fallback (no CH.engine)');
{
  const a = engineGauges(simOn, 0.8, null);
  ok('thr follows sim when the engine is on', a.thr === 0.4 && a.thrCmd === 0.4 && a.on === true && a.state === 'ON');
  const b = engineGauges(simOff, 0.8, null);
  ok('thr is 0 and state is OFF when the sim engine is off', b.thr === 0 && b.state === 'OFF' && b.on === false);
  const c = engineGauges(simOff, 0, null);
  ok('NO FUEL when sim fuel is empty', c.state === 'NO FUEL' && c.fuelFrac === 0);
}

console.log('window.CH.engine / snapshot');
{
  const low = engineGauges(simOn, 0.8, snapshot(0, { on: false, thr: 0, cmd: 0, failed: false }, 0.9));
  const mid = engineGauges(simOn, 0.8, snapshot(0.5, { on: true, thr: 0.5, cmd: 0.5, failed: false }, 0.6));
  const high = engineGauges(simOn, 0.8, snapshot(1, { on: true, thr: 1, cmd: 1, failed: false }, 0.3));
  ok('throttle % rises with engine.thr', low.thr === 0 && mid.thr === 0.5 && high.thr === 1);
  ok('readout stays OFF at zero throttle', engineReadout({ ...low, engState: low.state }) === 'OFF');
  ok('readout is ON at mid and full throttle', engineReadout({ ...mid, engState: mid.state }) === 'ON' && engineReadout({ ...high, engState: high.state }) === 'ON');
  ok('total fuel comes from engine.fuelFrac, not the sim', low.fuelFrac === 0.9 && mid.fuelFrac === 0.6 && high.fuelFrac === 0.3 && low.fuelFrac !== 0.8);
  const dry = engineGauges(simOn, 0.8, snapshot(1, { on: false, thr: 0, cmd: 1, failed: false }, 0));
  ok('state NO FUEL from engine.state', dry.state === 'NO FUEL' && engineReadout({ engState: dry.state, fuelFrac: dry.fuelFrac }) === 'NO FUEL' && dry.thr === 0);
  const mismatch = engineGauges({ on: true, thr: 1, cmd: 1, failed: false }, 1, { thr: 0.2, thrCmd: 0.25, on: true, state: 'ON', failed: false, fuelFrac: 0.55 });
  ok('published hook wins over stale sim reads', mismatch.thr === 0.2 && mismatch.thrCmd === 0.25 && mismatch.fuelFrac === 0.55 && mismatch.state === 'ON');
}

if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall ok');
