// Live part health: every built part tracks structural load, skin heat and wear from the flight sim.
// Pure logic (no three.js / DOM) so it can be tuned headless. step() runs at the physics rate with no allocations.
//   load  — aero bending (dynamic pressure x angle of attack) and g-force against the part's strength (1 = limit)
//   heat  — aero / re-entry heating ~ sqrt(rho) v^3 on the leading end, and engine heat from the sim (1 = limit)
//   hp    — 0..100. Above the limit a part loses hp; below half load it slowly recovers part of what it lost.
// At 0 hp: tanks, mount, nose or a burnt engine take the vehicle with them; fins snap off and fly away.
import { PARTS, layout } from './rocket.js';
import { airDensity, weakEngines, failFlight } from './sim.js';

const G0 = 9.80665;
const Q_REF = 12000;          // Pa: the existing "tipped at speed" break-up line (q 12 kPa at 20 deg) sits right at load ~1
const G_LIM = 26;             // g a plain tank stands (a hard burnout on a big cluster peaks near 17 g)
const HEAT_REF = 4e8;         // sqrt(rho/1.225) * v^3 at heat 1: a hard climb peaks near 0.4, a fall back from space burns
const STR = { mount: 1.4, nose: 1.15, tank: 1, fins: 1, legs: 1, engine: 1 };
const PART_STR = { tank_carbon: 1.3, tank_long: 0.9, tank_tall: 0.95, nose_needle: 1.05, nose_dome: 1.3 };
const HEAT_TOL = { nose: 1.4, tank: 1, mount: 1.6, fins: 0.9, legs: 1, engine: 2.6 };
const PART_HEAT = { nose_dome: 1.7, nose_needle: 1.2, tank_carbon: 0.85 };
export const LV = { ok: 0, warn: 1, crit: 2, bad: 3, lost: 4 };

export class RocketHealth {
  constructor() { this.parts = []; this.warns = []; this.lost = []; this.cool = {}; this.t = 0; }

  reset(rocket, fill = 1) {
    const L = layout(rocket), P = this.parts = [], eng = rocket.engine ? PARTS[rocket.engine] : null;
    const add = o => { const p = Object.assign({ hp: 100, load: 0, heat: 0, eHeat: 0, scar: 0, lost: false, lostT: 0, fuel: -1, str: 1, heatTol: 1, wj: -1 }, o); P.push(p); return p; };
    const count = {};
    for (const it of L.items) count[it.d.kind] = (count[it.d.kind] || 0) + 1;
    const seen = {};
    this.engines = [];
    if (eng && L.engLen) {
      const n = eng.engines || 1, weak = weakEngines(n);
      for (let k = 0; k < n; k++) {
        const w = weak.find(x => x.idx === k);
        this.engines.push(add({ kind: 'engine', id: rocket.engine, name: n > 1 ? `Engine ${k + 1}` : eng.name, nz: k, n, th: w ? w.th : 100, wj: w ? weak.indexOf(w) : -1, eHeat: 0, y0: 0, y1: L.engLen, heatTol: HEAT_TOL.engine }));
      }
    }
    this.stack = [];
    for (const it of L.items) {
      const d = it.d, k = d.kind; seen[k] = (seen[k] || 0) + 1;
      const label = k === 'tank' && count.tank > 1 ? `${d.name} (${seen[k] === 1 ? 'bottom' : seen[k] === count.tank ? 'top' : 'tank ' + seen[k]})` : d.name;
      this.stack.push(add({ kind: k, id: d.id, name: label, i: it.i, y0: it.y0, y1: it.y1, cap: d.fuelMass ? fill : 0, fuel: d.fuelMass ? fill : -1,
        str: (PART_STR[d.id] || 1) * (STR[k] || 1), heatTol: (PART_HEAT[d.id] || 1) * (HEAT_TOL[k] || 1) }));
      if (it.s.fins) add({ kind: 'fins', id: 'fins', name: `Fins on ${label}`, i: it.i, pairs: it.s.fins, y0: it.y0, y1: it.y0 + 1.7, heatTol: HEAT_TOL.fins });
      if (it.s.legs) this.legs = add({ kind: 'legs', id: 'legs', name: 'Landing legs', i: it.i, y0: it.y0, y1: it.y0 + 1, heatTol: HEAT_TOL.legs });
    }
    if (!rocket.stack.some(s => s.legs)) this.legs = null;
    this.top = L.top; this.bottom = L.bottom; this.engLen = L.engLen; this.n = this.stack.length;
    this.warns.length = 0; this.lost.length = 0; this.cool = {}; this.t = 0; this.pv = null; this.gs = 1; this.gLoad = 0; this.aero = 0; this.fluxK = 0;
    this.phase = 'pad'; this.crashed = false; this.landedDone = false; this.failed = false;
    this.fuelLow = false; this.outSeen = 0; this.engFailSeen = false;
    return this;
  }

  // Short status line under the silhouette; the same key stays quiet for `gap` seconds.
  ready(key, gap) { return this.t - (this.cool[key] ?? -99) >= gap; }
  warn(key, text, lv = LV.warn, gap = 6) {
    if (!this.ready(key, gap)) return;
    this.cool[key] = this.t; this.warns.push({ text, lv });
  }

  step(f, dt) {
    this.t += dt;
    const P = this.parts;
    // fuel: the sim burns every tank evenly
    for (const p of this.stack) if (p.fuel >= 0) p.fuel = p.cap * f.fuelFrac;
    this.engineStep(f);
    if (f.phase === 'crashed') { if (!this.crashed) this.onCrash(f); return; }
    if (f.phase === 'landed') { if (!this.landedDone) this.onLand(f); this.relax(dt); return; }
    if (f.phase !== 'flying') { this.pv = null; return; }
    // proper acceleration from the velocity change (semi-implicit Euler makes this exact), smoothed to skip contact spikes
    if (this.pv) {
      const ax = (f.vel.x - this.pv.x) / dt, ay = (f.vel.y - this.pv.y) / dt + G0, az = (f.vel.z - this.pv.z) / dt;
      const g = Math.sqrt(ax * ax + ay * ay + az * az) / G0;
      this.gs += (g - this.gs) * Math.min(1, dt * 6);
      this.pv.x = f.vel.x; this.pv.y = f.vel.y; this.pv.z = f.vel.z;
    } else this.pv = { x: f.vel.x, y: f.vel.y, z: f.vel.z };
    const q = f.q, sa = Math.sin(f.aoa);
    const aero = (0.06 * q + 2.6 * q * sa) / Q_REF, finA = (0.03 * q + 3.2 * q * sa) / Q_REF;
    const gL = this.gs / G_LIM;
    this.aero = aero; this.gLoad = gL;
    const rho = airDensity(f.origin.y), V = f.speed;
    const flux = Math.sqrt(rho / 1.225) * V * V * V / HEAT_REF;
    this.fluxK = flux;
    const noseFirst = (f.vel.x * f.up.x + f.vel.y * f.up.y + f.vel.z * f.up.z) >= 0;
    const n = this.n, kL = Math.min(1, dt * 5);
    for (const p of P) {
      if (p.lost) continue;
      let load = 0, expo = 0;
      if (p.kind === 'engine') { expo = noseFirst ? 0.05 : 1; }
      else if (p.kind === 'fins') { load = finA / p.str; expo = 0.35; }
      else if (p.kind === 'legs') { load = aero * 0.3; expo = noseFirst ? 0.1 : 0.5; }
      else {
        load = Math.max(aero, gL) / p.str;
        const fromLead = noseFirst ? n - 1 - p.i : p.i + 1;   // tail-first: the engine leads, then the mount
        expo = fromLead === 0 ? 1 : fromLead === 1 ? 0.45 : 0.18;
      }
      p.load += (load - p.load) * kL;
      const hT = flux * expo / p.heatTol;
      p.heat += (hT - p.heat) * Math.min(1, dt / (hT > p.heat ? 3 : 7));
      this.wear(f, p, Math.max(p.load, p.heat), p.heat > p.load, dt);
      if (this.failed) return;
    }
    this.flightWarnings(f);
  }

  engineStep(f) {
    const e = f.e;
    for (const p of this.engines) {
      if (p.lost) continue;
      const rel = Math.min(1, e.heat / p.th);
      p.eHeat = rel;
      if (p.wj >= 0 && p.wj < e.out) { this.lose(p, 'out'); this.warn('out' + p.nz, `ENGINE ${p.nz + 1} OUT`, LV.bad, 99); continue; }
      if (e.failed) { this.lose(p, 'failed'); continue; }
      p.hp = Math.max(0, 100 - p.scar - 100 * rel);
    }
    if (e.failed && !this.engFailSeen) { this.engFailSeen = true; this.warn('ef', this.engines.length > 1 ? 'CLUSTER FAILED: OVERHEAT' : 'ENGINE FAILED: OVERHEAT', LV.bad, 99); }
    if (this.engines.length && !e.failed) {
      let hot = null; for (const p of this.engines) if (!p.lost && (!hot || p.eHeat > hot.eHeat)) hot = p;
      if (hot && hot.eHeat > 0.6 && this.ready('eh', 5)) this.warn('eh', this.engines.length > 1 ? `ENGINE ${hot.nz + 1} OVERHEAT` : 'ENGINE OVERHEAT', hot.eHeat > 0.85 ? LV.bad : LV.warn, 5);
    }
  }

  // Damage above the limit, slow partial recovery when well below it.
  wear(f, p, s, byHeat, dt) {
    const d = s > 1 ? (s - 1) * (byHeat ? 28 : 60) * dt + 2 * dt : 0;
    if (p.kind === 'engine') {   // engine hp = its own heat margin minus any re-entry scorching
      p.scar += d; p.hp = Math.max(0, 100 - p.scar - 100 * (p.eHeat || 0));
      if (p.hp > 0 || p.scar < 1) return;
    } else {
      if (d) { p.hp -= d; p.scar += d * 0.6; }
      else if (s < 0.5) p.hp = Math.min(100 - p.scar, p.hp + 0.6 * dt);
      if (p.hp > 0) return;
    }
    p.hp = 0;
    if (p.kind === 'fins') { this.lose(p, 'detach'); this.warn('fl' + p.i, 'FINS LOST', LV.bad, 99); return; }
    if (p.kind === 'legs') { this.lose(p, 'detach'); this.warn('ll', 'LEGS TORN OFF', LV.bad, 99); return; }
    this.lose(p, byHeat ? 'burn' : 'break');
    const what = p.kind === 'engine' ? (p.n > 1 ? 'ENGINE CLUSTER' : 'ENGINE') : p.kind === 'nose' ? 'NOSE CONE' : p.kind === 'mount' ? 'ENGINE MOUNT' : 'TANK';
    this.warn('pf', byHeat ? `${what} BURNED THROUGH` : `${what} FAILED: STRUCTURE`, LV.bad, 99);
    this.failed = true;
    failFlight(f, byHeat ? 'burnup' : 'structure', { part: p.name, heat: byHeat });
  }

  lose(p, why) { if (p.lost) return; p.lost = why; p.lostT = this.t; p.hp = 0; this.lost.push(p); }

  relax(dt) { for (const p of this.parts) if (!p.lost) { p.load *= Math.max(0, 1 - dt * 3); p.heat *= Math.max(0, 1 - dt / 7); } }

  onLand(f) {
    this.landedDone = true;
    const s = f.landSpeed, L = this.legs;
    if (L && !L.lost) {
      const d = Math.max(0, (s - 2) / 3) * 70;   // 2 m/s is free; 5 m/s (the limit) costs 70%
      L.hp = Math.max(5, L.hp - d); L.scar += d; L.load = Math.min(1.2, s / 4);
      if (d > 25) this.warn('land', `HARD TOUCHDOWN: LEGS ${Math.round(L.hp)}%`, LV.warn, 99);
      else this.warn('land', `TOUCHDOWN ${s.toFixed(1)} m/s`, LV.ok, 99);
    }
  }

  onCrash(f) {
    this.crashed = true;
    for (const p of this.parts) this.lose(p, 'crash');
    const k = f.failure?.kind;
    this.warn('crash', k === 'overheat' ? 'ENGINE OVERHEAT: VEHICLE LOST' : k === 'breakup' || k === 'flipped' ? 'AERO BREAK-UP: VEHICLE LOST' : 'VEHICLE LOST', LV.bad, 99);
  }

  flightWarnings(f) {
    let sMax = 0, hMax = null, fMin = null;
    for (const p of this.stack) { if (!p.lost && p.load > sMax) sMax = p.load; }
    for (const p of this.parts) { if (p.lost || p.kind === 'engine') continue; if (!hMax || p.heat > hMax.heat) hMax = p; if (p.kind === 'fins' && (!fMin || p.hp < fMin.hp)) fMin = p; }
    if (this.aero > 0.55 && this.aero >= this.gLoad) this.warn('q', sMax > 0.85 ? 'MAX-Q: STRUCTURE CRITICAL' : 'MAX-Q: STRUCTURE STRESS', sMax > 0.85 ? LV.bad : LV.warn, sMax > 0.85 ? 3 : 7);
    if (this.gLoad > 0.55 && this.ready('g', 6)) this.warn('g', `HIGH G: ${this.gs.toFixed(0)} G`, this.gLoad > 0.85 ? LV.bad : LV.warn, 6);
    if (hMax && hMax.heat > 0.55 && this.ready('h', 5)) this.warn('h', hMax.heat > 0.85 ? `${shortName(hMax)} BURNING` : `HULL HEATING: ${shortName(hMax)}`, hMax.heat > 0.85 ? LV.bad : LV.warn, 5);
    if (fMin && fMin.hp < 50) this.warn('fs', 'FINS DAMAGED', LV.warn, 8);
    if (f.st.fuelCap > 0) {
      if (f.fuelFrac <= 0) this.warn('fo', 'FUEL OUT', LV.bad, 99);
      else if (f.fuelFrac < 0.1 && f.e.on) this.warn('fl', 'FUEL LOW', LV.warn, 99);
    }
  }
}

function shortName(p) { return p.kind === 'nose' ? 'NOSE' : p.kind === 'engine' ? 'ENGINE' : p.kind === 'mount' ? 'MOUNT' : p.kind === 'fins' ? 'FINS' : p.kind === 'legs' ? 'LEGS' : 'TANK'; }

// 0 ok / 1 stressed / 2 critical / 3 red / 4 lost, from live load + heat and remaining hp
export function partLevel(p) {
  if (p.lost) return LV.lost;
  const s = Math.max(p.load, p.heat, p.kind === 'engine' ? p.eHeat : 0);
  const a = s >= 1 ? 3 : s >= 0.8 ? 2 : s >= 0.55 ? 1 : 0;
  const b = p.hp < 35 ? 3 : p.hp < 60 ? 2 : p.hp < 85 ? 1 : 0;
  return Math.max(a, b);
}
