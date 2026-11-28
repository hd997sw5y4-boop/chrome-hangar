// GB5-AERO: working fin control surfaces, fin weathervaning and extra fin drag, plus terminal velocity.
// Pure logic (no three.js / DOM). Every force and torque scales with q = 0.5 * rho * v^2, with rho from sim.js
// airDensity(h): exactly 0 at ATMO_TOP and above, in vacuum (f.vacuum) and on the Moon, so orbits never decay.
// Fin control and weathervaning are applied as pure torques (a couple), so they can never push a coasting rocket upward.
import { PARTS, layout } from './rocket.js';

export const AREF = Math.PI * 0.9 * 0.9;   // body frontal area, same reference as sim.js drag
export const FIN = { CL_ALPHA: 2.0, DMAX: 15 * Math.PI / 180, CN_PASS: 1.0, CD0: 0.01, K_IND: 1.0 };
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };

// Fin planform area (m^2, both fins of every pair) and its height, from the same layout / parts list stats() uses.
// Computed from f.rocket each step, so a 'stage' event that drops a finned stage changes it on the next step.
// lost: optional Set of stack indices whose fins have snapped off (health.js 'FINS LOST'), they stop counting.
export function finInfo(rocket, parts, lost) {
  const fd = PARTS.fins; let A = 0, yA = 0;
  if (!fd || !rocket) return { A: 0, y: 0 };
  const items = parts || layout(rocket).items;
  const one = 0.5 * (fd.root + fd.tip) * fd.span;
  for (const it of items) { const n = it.s?.fins || 0; if (n > 0 && !lost?.has(it.i)) { const a = n * 2 * one; A += a; yA += a * (it.y0 + 0.35); } }
  return { A, y: A ? yA / A : 0 };
}

// Effective drag area Cd*A (m^2) of the stack plus the fins' parasitic drag (deflection drag comes on top in flight).
export const dragArea = (st, rocket) => st.cd * AREF + finInfo(rocket).A * FIN.CD0;
// Falling terminal velocity sqrt(2 m g / (rho Cd A)); Infinity without air.
export const terminalVelocity = (m, g, rho, cdA) => (rho > 0 && cdA > 0 ? Math.sqrt(2 * m * g / (rho * cdA)) : Infinity);

const ZERO = () => ({ F: v3(), T: v3(), q: 0, used: 0 });

// One step of fin aero. va = air-relative velocity, V = |va|. Returns world force F (drag only) and torque T.
export function finAero(f, st, rho, va, V, parts) {
  if (!(rho > 0) || !(V > 0.05) || f.phase !== 'flying') return ZERO();
  const fi = finInfo(f.rocket, parts, f.finLost);
  if (!(fi.A > 0)) return ZERO();
  const q = 0.5 * rho * V * V, up = f.up, vh = mul(va, 1 / V);
  const arm = st.com - fi.y;                                  // > 0: fins aft of the CoM
  const Tmax = q * fi.A * FIN.CL_ALPHA * FIN.DMAX * Math.abs(arm);
  // control: player steering (same world-horizontal vector as the gimbal); with Hold upright on and the engine
  // off, the fins fly the same hold-upright law the gimbal uses (with the engine on the gimbal does it)
  const S = v3(f.steer?.x || 0, 0, f.steer?.z || 0);
  let want = v3();
  if (f.assist && !(f.e?.on)) {
    const target = norm(add(v3(0, 1, 0), S, Math.tan(22 * Math.PI / 180)));
    want = mul(add(mul(cross(up, target), 1.6), f.w, -1), 3.2 * st.I);
  } else {
    const Sp = add(S, up, -dot(S, up));
    if (len(Sp) > 0.02) want = mul(cross(up, Sp), Tmax);
  }
  want = add(want, up, -dot(want, up));
  const wl = len(want); if (wl > Tmax) want = mul(want, Tmax / (wl || 1));
  const used = Tmax > 0 ? Math.min(1, wl / Tmax) : 0;
  // passive weathervaning toward the airflow while flying nose-first (restoring with fins aft, destabilising if forward)
  const cosA = dot(up, vh);
  const Tp = cosA > 0 ? mul(cross(up, vh), q * fi.A * FIN.CN_PASS * arm) : v3();
  // fin drag: parasitic plus deflection (induced) drag
  const dl = used * FIN.DMAX;
  const F = mul(vh, -q * fi.A * (FIN.CD0 + FIN.K_IND * dl * dl));
  return { F, T: add(want, Tp), q, used };
}
