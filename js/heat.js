// GB5-HEAT: re-entry heating of the leading end (hull skin). Pure logic, no three.js / DOM.
// Stagnation heat flux (Sutton-Graves): qdot = K * sqrt(rho / Rn) * v^3 (W/m^2), rho from airDensity(h) so it is exactly 0
// in vacuum. Lumped skin: C dT/dt = qdot - eps*sigma*(T^4 - Ta^4) - h_conv*(T - Ta). Above T_DMG the parts take damage,
// at T_BURN (or when the damage fills up) the rocket breaks up through the existing 'burnup' crash flow.
import { PARTS } from './rocket.js';

export const HEAT = { K: 1.7415e-4, SIGMA: 5.670e-8, EPS: 0.8, CA: 11700, T_DMG: 1100, T_BURN: 1650, DMG_RATE: 0.25 };
const NOSE_R = { nose: 0.6, nose_needle: 0.35, nose_dome: 1.2 };
const NOSE_TOL = { nose_dome: 1.25, nose_needle: 0.95 };

export const ambientT = h => Math.max(216.65, 288.15 - 0.0065 * Math.max(0, h));
export const heatFlux = (rho, v, Rn = 0.6) => (rho > 0 && v > 0 ? HEAT.K * Math.sqrt(rho / Rn) * v * v * v : 0);

export function hullSpec(rocket) {
  const top = rocket?.stack?.length ? rocket.stack[rocket.stack.length - 1].p : null;
  const d = top ? PARTS[top] : null, isNose = d?.kind === 'nose';
  return { Rn: isNose ? (NOSE_R[top] ?? 0.6) : 0.9, tol: isNose ? (NOSE_TOL[top] ?? 1) : 0.9, lead: d?.name || 'nose' };
}
export const newHull = (T = 288.15) => ({ T, flux: 0, dmg: 0, peak: T, burnt: false });

// fail(f, kind, extra): sim.js failFlight, passed in by the caller (no import cycle with sim.js)
export function heatStep(f, rho, V, dt, fail) {
  const hl = f.hull ??= newHull(ambientT(f.alt || 0));
  const sp = hl.spec ??= hullSpec(f.rocket);
  const Ta = ambientT(f.alt || 0);
  const noseFirst = !f.vel || (f.vel.x * f.up.x + f.vel.y * f.up.y + f.vel.z * f.up.z) >= 0;
  const q = heatFlux(rho, V, noseFirst ? sp.Rn : 0.9);
  const hc = rho > 0 ? 12 * Math.sqrt(rho / 1.225) * (1 + V / 50) : 0;
  const n = Math.max(1, Math.ceil(dt / 0.05)), h = dt / n, E = HEAT.EPS * HEAT.SIGMA;
  for (let i = 0; i < n; i++) {
    const T = hl.T, net = q - E * (T * T * T * T - Ta * Ta * Ta * Ta) - hc * (T - Ta);
    let Tn = T + net * h / HEAT.CA;
    if (q === 0 && T > Ta && Tn < Ta) Tn = Ta;               // cooling never undershoots ambient
    hl.T = Math.max(Tn, 3);
  }
  hl.flux = q; hl.peak = Math.max(hl.peak, hl.T);
  const td = HEAT.T_DMG * sp.tol, tb = HEAT.T_BURN * sp.tol;
  hl.level = Math.max(0, (hl.T - td) / (tb - td));           // 0 below the damage line, 1 at burn-up
  if (f.phase === 'flying' && hl.T > td) hl.dmg = Math.min(1, hl.dmg + hl.level * HEAT.DMG_RATE * dt);
  if (f.phase === 'flying' && !hl.burnt && (hl.T >= tb || hl.dmg >= 1)) {
    hl.burnt = true;
    if (fail) fail(f, 'burnup', { part: noseFirst ? sp.lead : (f.eng?.name || 'engine'), heat: true });
  }
  return hl;
}

// Parts take damage past the damage line: the leading part wears through the existing health model (fins / legs
// snap off, a tank or nose burning through ends the flight through its normal failFlight('burnup') path).
export function heatDamage(health, f, dt) {
  const hl = f.hull; if (!health || !hl || !(hl.level > 0) || health.failed || f.phase !== 'flying') return;
  const noseFirst = (f.vel.x * f.up.x + f.vel.y * f.up.y + f.vel.z * f.up.z) >= 0;
  const P = health.stack || [];
  const p = noseFirst ? P[P.length - 1] : (health.engines?.find(e => !e.lost) || P[0]);
  if (p && !p.lost) health.wear(f, p, 1 + 0.6 * hl.level, true, dt);
}
