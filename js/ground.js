// One ground-height query for everything that stands or drives on the site: the terrain plus the walkable steel
// cart ramps (analytic height profiles, so a lookup is a couple of multiplies, cheap enough to call per foot per frame).
// The golf cart's wheels, the player's eye, the robots' feet and bodies and the loose props all read groundAt().
// Steep faces (a ramp's sides, the kicker's back) are too tall to step up, so walkers get thin wall obstacles there
// (rampEdges); the cart and loose props never see those, they drive up and fall off the ramps as before.
import { height } from './terrain.js';
import { B } from './collide.js';

// ramps: centre, forward heading (radians, 0 = +z), half width, profile u -> h over [u0, u1]
export const RAMPS = [
  { name: 'tabletop', x: -46, z: -50, yaw: Math.PI, hw: 2.1, u0: -6.2, u1: 6.2, prof: u => { const a = Math.abs(u); return a < 2.2 ? 1.05 : 1.05 * Math.max(0, (6.2 - a) / 4.0); } },
  { name: 'kicker', x: -46, z: -94, yaw: Math.PI, hw: 1.8, u0: -4.6, u1: 0.45, prof: u => u <= 0 ? 1.3 * Math.pow((u + 4.6) / 4.6, 1.55) : 1.3 * Math.max(0, 1 - u / 0.45) },
];
for (const r of RAMPS) { r.fx = Math.sin(r.yaw); r.fz = Math.cos(r.yaw); }

// height of the walkable props alone at (x, z), or -Infinity off them
export function propH(x, z) {
  let g = -Infinity;
  for (const r of RAMPS) {
    const dx = x - r.x, dz = z - r.z, u = dx * r.fx + dz * r.fz, v = dx * r.fz - dz * r.fx;
    if (u > r.u0 && u < r.u1 && Math.abs(v) < r.hw) g = Math.max(g, r.prof(u));
  }
  return g;
}
export function groundAt(x, z) { return Math.max(height(x, z), propH(x, z)); }
export function onRamp(x, z) { for (const r of RAMPS) { const dx = x - r.x, dz = z - r.z, u = dx * r.fx + dz * r.fz, v = dx * r.fz - dz * r.fx; if (u > r.u0 - 0.2 && u < r.u1 + 0.2 && Math.abs(v) < r.hw + 0.2) return true; } return false; }

// walls where a ramp face is taller than a step: both sides along the raised part, and any steep back face.
// Built once (the ramps don't move). Boxes are axis-aligned, which matches ramps turned by multiples of 90 degrees.
export const STEP = 0.35;
let _edges = null;
export function rampEdges() {
  if (_edges) return _edges;
  const out = [];
  const rect = (r, ua, ub, va, vb) => {   // (u, v) rectangle -> world AABB
    const xs = [], zs = [];
    for (const u of [ua, ub]) for (const v of [va, vb]) { xs.push(r.x + u * r.fx + v * r.fz); zs.push(r.z + u * r.fz - v * r.fx); }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    out.push(B((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2));
  };
  for (const r of RAMPS) {
    // the stretch of u where the deck stands taller than a step (sampled; the profiles are simple)
    let ua = null, ub = null; const n = 200;
    for (let i = 0; i <= n; i++) { const u = r.u0 + (r.u1 - r.u0) * i / n; if (r.prof(u) > STEP) { if (ua === null) ua = u; ub = u; } }
    if (ua === null) continue;
    rect(r, ua, ub, r.hw - 0.04, r.hw + 0.12); rect(r, ua, ub, -r.hw - 0.12, -r.hw + 0.04);
    // a face that drops faster than a walkable slope at the far end (the kicker's lip)
    const e = 0.02, slope = (r.prof(ub - e) - r.prof(ub)) / e;
    if (slope > 1.2) { let uf = ub; while (uf > ua && (r.prof(uf - e) - r.prof(uf)) / e > 1.2) uf -= e; rect(r, uf, ub + 0.04, -r.hw - 0.12, r.hw + 0.12); }
  }
  return _edges = out;
}
