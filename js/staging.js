// Staging (gb3-moon-rocket): Decouplers split the stack into stages, each with its own engine. Pure logic, no three.js / DOM.
//
// Data: rocket.stack[] may hold { p: 'decoupler' } and, right above it, { p: 'mount', engine: id } for the next stage's engine.
//       Stage 0 burns first: stack[0 .. first Decoupler] + rocket.engine. rocket.js layout()/stats() know about this: upper
//       engines hang under their mounts, and only the bottom stage's tanks drain (the stages above are always full in flight).
// Separation (separate(f)): the bottom stage, up to and including its Decoupler, leaves for real. The flight's rocket becomes the
//       rest of the stack (with that stage's engine as rocket.engine), its mass / inertia / centre of mass come from stats() of the
//       new rocket, the body keeps the velocity of the point that becomes its centre of mass, and the new engine starts cold.
//       Nothing is added: no impulse, no fuel transfer.
// For other modules (e.g. GB5 fins / RCS):
//   activeParts(rocket)      -> the parts that are flying now, with their stack index and y0 / y1 (rocket-local metres)
//   stageIndex(f)            -> how many stages this flight has dropped (0 at launch)
//   stageCount(rocket)       -> stages left in this rocket (1 = no Decoupler)
//   onStage(fn)              -> fn({ f, index, dropped, rocket }) after each separation; also window 'ch-stage' CustomEvent
//   f.events gets { type: 'stage', index, dropped } for flight.js (rebuild mesh / flames / health, spawn the spent stage).
import { PARTS, layout, stats, hasLegs, decouplers, activeEnd, cloneRocket, G0 } from './rocket.js';
import { newEngine } from './sim.js';

const listeners = new Set();
export function onStage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const stageCount = r => decouplers(r).length + 1;
export const stageIndex = f => f?.stage || 0;
export const canStage = f => !!f && decouplers(f.rocket).length > 0 && f.phase === 'flying';
export function activeParts(r) {
  const L = layout(r), e = activeEnd(r), out = [];
  if (r.engine && L.engLen) out.push({ kind: 'engine', id: r.engine, index: -1, y0: 0, y1: L.engLen });
  for (const it of L.items) if (it.i <= e) out.push({ kind: it.d.kind, id: it.s.p, index: it.i, y0: it.y0, y1: it.y1, fins: it.s.fins || 0, legs: !!it.s.legs });
  return out;
}

// split a rocket at its first Decoupler: { lower (the spent stage incl. the Decoupler), upper (what keeps flying), cutY }
export function split(r) {
  const D = decouplers(r); if (!D.length) return null;
  const d = D[0], L = layout(r), up = r.stack.slice(d + 1).map(s => ({ ...s })), eng = up[0]?.engine;
  if (!up.length || PARTS[up[0].p]?.kind !== 'mount' || !PARTS[eng]) return null;
  delete up[0].engine;
  const lower = { stack: r.stack.slice(0, d + 1).map(s => ({ ...s })), engine: r.engine };
  const upper = { stack: up, engine: eng };
  const cutY = L.items[d].y1;   // the new nozzle exit = top of the Decoupler, in the old rocket's frame
  return { lower, upper, cutY };
}

// Per-stage numbers for the build / checkout: each stage carries everything above it. Sea-level and vacuum dv (the sim gives
// engines 10% more push in vacuum), and TWR against g0 at that stage's ignition.
export function stageStats(r, fill = 1) {
  const out = []; let cur = cloneRocket(r);
  for (let k = 0; k < 12 && cur; k++) {
    const st = stats(cur, fill, 1), e = PARTS[cur.engine];
    out.push({ index: k, engine: e?.name || '—', engineId: cur.engine, mass: st.mass, dry: st.dry, fuel: st.fuel, dvSL: st.dv, dvVac: st.dv * 1.1, twr: st.twr, twrVac: st.twr * 1.1, thrust: st.thrust });
    const s = split(cur); cur = s ? s.upper : null;
  }
  return out;
}

// The separation itself, on a sim flight object (sim.js newFlight). Returns the split, or null if there is nothing to drop.
export function separate(f) {
  if (!f || f.phase === 'crashed') return null;
  const s = split(f.rocket); if (!s) return null;
  const st0 = stats(f.rocket, f.fill, f.fuelFrac), up = f.up, comOld = st0.com;
  const st1 = stats(s.upper, f.fill, 1);
  const o = { x: f.origin.x + up.x * s.cutY, y: f.origin.y + up.y * s.cutY, z: f.origin.z + up.z * s.cutY };   // new body origin
  const comAbs = { x: o.x + up.x * st1.com, y: o.y + up.y * st1.com, z: o.z + up.z * st1.com };
  // rigid body: the new centre of mass keeps the velocity it had as a point of the old body (v + w x r)
  const rx = up.x * (s.cutY + st1.com - comOld), ry = up.y * (s.cutY + st1.com - comOld), rz = up.z * (s.cutY + st1.com - comOld), w = f.w;
  const dropped = { rocket: s.lower, origin: { ...f.origin }, up: { ...up }, vel: { ...f.vel }, w: { ...w }, fuelFrac: f.fuelFrac, mass: st0.mass - st1.mass };
  f.vel = { x: f.vel.x + (w.y * rz - w.z * ry), y: f.vel.y + (w.z * rx - w.x * rz), z: f.vel.z + (w.x * ry - w.y * rx) };
  const hadLegs = f.legs;
  f.rocket = s.upper; f.eng = PARTS[s.upper.engine]; f.engLen = layout(s.upper).engLen; f.legs = hasLegs(s.upper);
  if (f.legs && !hadLegs) { f.legOut = 0; f.legAuto = 0; f.legCmd = 'auto'; }   // the lander's legs were stowed on the stack: they start folded
  f.origin = o; f.pos = comAbs; f.st = st1; f.fuelFrac = 1;
  const cmd = f.e.cmd; f.e = newEngine(); f.e.cmd = cmd;   // the next engine starts cold; it lights (spool-up) if the throttle is up
  f.stage = (f.stage || 0) + 1;
  const ev = { type: 'stage', index: f.stage, dropped, cutY: s.cutY, comShift: s.cutY + st1.com - comOld };
  f.events.push(ev);
  for (const fn of listeners) { try { fn({ f, index: f.stage, dropped, rocket: f.rocket }); } catch (e) { console.error(e); } }
  if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('ch-stage', { detail: { index: f.stage, rocket: f.rocket } }));
  return s;
}
// tanks of the burning stage are dry (the autopilot's auto-stage trigger)
export const stageDry = f => !!f && f.st && f.st.fuelCap > 0 && f.fuelFrac <= 1e-6;
export { G0 };
