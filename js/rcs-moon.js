// GB5-RCS: RCS during the Moon / space leg (orbit.js state; flightStep does not run there). Pure logic, no three.js.
// The Moon landing leg (flatM, below 12 km) already runs through flightStep with f.vacuum, so rcs.js works there as on Earth
// and there is no aero or heat (rho = 0). This file adds the same RCS to the space leg's descent from orbit:
//  - translation (sideways = camera-relative local x/z, up/down = along the rocket's pointing) as a small acceleration
//    added to the thrust acceleration in moon.js powered(); it never touches the pointing / pointing-hold logic
//  - fine attitude: with RCS on, steering turns the rocket a little faster / finer on top of the space leg's own slew
import { newRcs, rcsIsp } from './rcs.js';
import { G0 } from './rocket.js';

const TRANS = c => Math.abs(c?.tx || 0) + Math.abs(c?.ty || 0) + Math.abs(c?.tz || 0) > 0.02;
export const FINE_RATE = 0.35;   // rad/s added to the space leg's steer slew while RCS is on

// is the RCS translating (so the space leg has to take powered steps instead of an exact coast)?
export const rcsSpaceBusy = f => !!(f.rcs && f.rcs.on && f.rcs.prop > 0 && TRANS(f.rcs.cmd));

// One powered step of length h. acc: the thrust acceleration vector (orbit.js array), att: pointing, B: local basis,
// O / V from orbit.js. Returns the acceleration with the RCS push added; burns monoprop.
export function rcsSpaceAcc(f, st, h, acc, att, B, O, V) {
  f.rcs ??= newRcs(st);
  const r = f.rcs, c = r.cmd || {};
  r.active = false; r.thrust = 0;
  if (!r.on || !(r.prop > 0) || !TRANS(c)) return acc;
  const cl = x => Math.max(-1, Math.min(1, x || 0));
  const hx = cl(c.tx), hz = cl(c.tz), ty = cl(c.ty);
  const used = Math.hypot(hx, hz) * r.F + Math.abs(ty) * r.F;
  const dm = used / (rcsIsp(0) * G0) * h, k = dm > r.prop ? r.prop / dm : 1;
  r.prop = Math.max(0, r.prop - dm * k);
  r.active = true; r.thrust = used * k;
  const m = st.mass + r.prop - r.cap, a = r.F * k / m;
  let out = acc;
  if (hx || hz) out = V.add(out, O.localToVec(B, { x: hx, y: 0, z: hz }), a);
  if (ty) out = V.add(out, att, a * ty);
  return out;
}

// Fine attitude: extra steer slew rate (rad/s) while RCS is on with propellant; burns a little monoprop (pure couple).
export function rcsSpaceFine(f, st, dt, steerLen) {
  const r = f.rcs; if (!r || !r.on || !(r.prop > 0)) return 0;
  const used = 0.5 * r.F * Math.min(1, steerLen), dm = used / (rcsIsp(0) * G0) * dt, k = dm > r.prop ? r.prop / dm : 1;
  r.prop = Math.max(0, r.prop - dm * k); r.active = true;
  return FINE_RATE * k;
}
