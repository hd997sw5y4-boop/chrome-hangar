// node tools/simtest.mjs '<rocket json>' [wind]  -> flies full throttle with assist, prints apex/failure
import fs from 'fs';
import { registerParts, starterRocket, stats } from '../js/rocket.js';
import { newFlight, flightStep, DT } from '../js/sim.js';
const idx = JSON.parse(fs.readFileSync('data/parts/index.json')).parts;
registerParts(idx.map(id => JSON.parse(fs.readFileSync(`data/parts/${id}.json`))));
const r = process.argv[2] ? JSON.parse(process.argv[2]) : starterRocket();
const f = newFlight(r, { wind: +(process.argv[3] || 0) });
const s = stats(r); console.log('mass', s.mass | 0, 'twr', s.twr.toFixed(2), 'margin', s.margin?.toFixed(2), 'len', s.length.toFixed(1));
f.e.cmd = +(process.argv[4] || 1); let maxq = 0, last = 0;
for (let i = 0; i < 120 * 900; i++) { flightStep(f); maxq = Math.max(maxq, f.q);
  if (f.t - last > 10) { last = f.t; console.log('t', f.t.toFixed(0), 'alt', f.alt | 0, 'v', f.speed | 0, 'q', f.q | 0, 'aoa', f.aoa.toFixed(3), 'tilt', f.tilt.toFixed(1), 'fuel', f.fuelFrac.toFixed(2)); }
  if (f.phase === 'crashed' || f.phase === 'landed' || (f.vel.y < 0 && f.alt > 1000 && f.fuelFrac <= 0 && false)) break; }
console.log('apex', f.apex | 0, 'failure', JSON.stringify(f.failure), 'maxq', maxq | 0);
