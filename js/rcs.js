// GB5-RCS: monopropellant reaction control thrusters (attitude couples + translation), independent of the main engine,
// its throttle and its engine-off rules. Same thrust in air and vacuum; Isp 220 s in vacuum, 190 s at sea level.
// Also extraForces(): the one call sim.js flightStep makes after its engine / gravity / drag / chute sum (GB5-RCS hook),
// adding RCS + fin aero (aero.js) forces and running hull heating (heat.js). Pure logic, no three.js / DOM.
import { G0 } from './rocket.js';
import { finAero, dragArea, terminalVelocity } from './aero.js';
import { heatStep } from './heat.js';

export const RCS = { ISP_VAC: 220, ISP_SL: 190, R: 0.9 };
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Sized to the craft: propellant ~1.2% of the wet mass (20..400 kg), thruster force 0.15 N per kg (250 N .. 4 kN).
export function newRcs(st) {
  const m = st?.mass || 5000, cap = clamp(0.012 * m, 20, 400);
  return { on: false, hold: true, cap, prop: cap, dry: 8 + 0.3 * cap, F: clamp(0.15 * m, 250, 4000), roll: 0, wr: 0,
    cmd: { roll: 0, tx: 0, ty: 0, tz: 0 }, active: false, thrust: 0 };
}
export const rcsMass = r => (r ? r.dry + r.prop : 0);
export const rcsIsp = rho => RCS.ISP_VAC - (RCS.ISP_VAC - RCS.ISP_SL) * clamp((rho || 0) / 1.225, 0, 1);

// One step. Attitude follows f.steer (Hold upright on: the same hold-upright law as the gimbal; off: direct
// rotation, with a rate hold when the stick is centred). Roll is tracked separately (r.roll / r.wr) because the
// rigid-body sim has no roll axis. Returns world force F (translation) and torque T (pure couple).
export function rcsStep(r, f, st, rho, dt) {
  r.roll += r.wr * dt;
  r.active = false; r.thrust = 0;
  if (!r.on || !(r.prop > 0) || f.phase !== 'flying') return { F: v3(), T: v3() };
  const up = f.up, m = st.mass + r.prop - r.cap, I = st.I;
  const lever = Math.max(1, st.length * 0.4), Tmax = 2 * r.F * lever;
  const S = v3(f.steer?.x || 0, 0, f.steer?.z || 0);
  let tau;
  if (f.assist) {
    const target = norm(add(v3(0, 1, 0), S, Math.tan(22 * Math.PI / 180)));
    tau = mul(add(mul(cross(up, target), 1.6), f.w, -1), 3.2 * I);
  } else {
    const Sp = add(S, up, -dot(S, up));
    tau = len(Sp) > 0.02 ? mul(cross(up, Sp), Tmax) : (r.hold ? mul(f.w, -4 * I) : v3());
  }
  tau = add(tau, up, -dot(tau, up));
  let tl = len(tau);
  if (tl > Tmax) { tau = mul(tau, Tmax / tl); tl = Tmax; }
  if (tl < 0.01 * Tmax) { tau = v3(); tl = 0; }
  let used = 2 * r.F * (tl / Tmax);
  // roll (about the long axis)
  const Ir = 0.5 * m * RCS.R * RCS.R, Trm = 2 * r.F * RCS.R, c = r.cmd || {};
  let tr = Math.abs(c.roll || 0) > 0.02 ? clamp(c.roll, -1, 1) * Trm : (r.hold ? clamp(-r.wr * Ir * 4, -Trm, Trm) : 0);
  if (Math.abs(tr) < 0.01 * Trm) tr = 0;
  used += Math.abs(tr) / RCS.R;
  // translation: tx / tz world horizontal (projected off the long axis), ty along the long axis (+ toward the nose)
  const h = v3(clamp(c.tx || 0, -1, 1), 0, clamp(c.tz || 0, -1, 1)), hp = add(h, up, -dot(h, up));
  let Ft = add(mul(hp, r.F), up, clamp(c.ty || 0, -1, 1) * r.F);
  used += len(hp) * r.F + Math.abs(clamp(c.ty || 0, -1, 1)) * r.F;
  if (!(used > 0)) return { F: v3(), T: v3() };
  const dm = used / (rcsIsp(rho) * G0) * dt, k = dm > r.prop ? r.prop / dm : 1;
  r.prop = Math.max(0, r.prop - dm * k);
  r.wr += tr * k / Ir * dt;
  r.active = true; r.thrust = used * k;
  return { F: mul(Ft, k), T: mul(tau, k) };
}

// GB5-RCS / GB5-AERO / GB5-HEAT: called once per flightStep after the engine / gravity / drag / chute forces.
// Returns { F, T, mr }: extra world force and torque, and the RCS mass change mr (prop - cap, <= 0; sim.js adds its
// weight and spreads the sum over m + mr). Fin aero and heating are exactly 0 when rho is 0.
export function extraForces(f, st, rho, va, V, dt, gee, fail) {
  f.rcs ??= newRcs(st);
  const r = rcsStep(f.rcs, f, st, rho, dt);
  const a = finAero(f, st, rho, va, V);
  heatStep(f, rho, V, dt, fail);
  // the full RCS tank (dry + monoprop) is carried inside the stack's mass budget, so a full tank adds nothing on the pad
  // (liftoff margins unchanged); burning monoprop lightens the rocket: mr = prop - cap (<= 0)
  const mr = f.rcs.prop - f.rcs.cap;
  f.vterm = terminalVelocity(st.mass + mr, gee, rho, dragArea(st, f.rocket));
  return { F: add(r.F, a.F), T: add(r.T, a.T), mr };
}
