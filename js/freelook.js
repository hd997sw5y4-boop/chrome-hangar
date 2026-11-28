// Stable chase-cam aiming when the rocket is going straight up. Pure JS so the tests run headless.
// lookAt(worldY) flips when the view lines up with +Y; chaseFrame / aimUp keep a parallel-transported
// up (or the rocket's side) so the camera can sit directly behind and below and look along the heading.

const WUP = { x: 0, y: 1, z: 0 };
export const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = a => Math.hypot(a.x, a.y, a.z);
export const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });

function finite(v) { return !!(v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) && (v.x || v.y || v.z)); }
function perp(f, hint) {
  const a = Math.abs(f.y) < 0.9 ? (hint || WUP) : { x: 1, y: 0, z: 0 };
  const p = cross(a, f); return len(p) > 1e-8 ? norm(p) : norm(cross({ x: 0, y: 0, z: 1 }, f));
}
function project(u, f) { const p = add(u, f, -dot(u, f)), s = len(p); return s > 1e-8 ? mul(p, 1 / s) : null; }

// A unit up for lookAt that never sits parallel to the view. Near the world-Y poles
// (|dot(view, worldUp)| > 0.98) it uses the previous up (parallel-transported) or `fallback`.
export function aimUp(eye, target, worldUp = WUP, fallback = null, prev = null) {
  const d0 = add(target, eye, -1), L = len(d0);
  if (L < 1e-12) return finite(prev) ? norm(prev) : (finite(fallback) ? norm(fallback) : { ...WUP });
  const f = mul(d0, 1 / L), w = project(worldUp, f), p = finite(prev) ? project(prev, f) : null, fb = finite(fallback) ? project(fallback, f) : null;
  const align = (a, b) => (b && dot(a, b) < 0 ? mul(a, -1) : a);
  const pole = Math.abs(dot(f, worldUp));
  let up;
  if (pole > 0.98) up = p || fb || perp(f, worldUp);
  else if (w) {
    up = align(w, p);
    if (pole > 0.92 && p) { const t = (pole - 0.92) / 0.06; up = norm(add(mul(up, 1 - t), align(p, up), t)); }
  } else up = p || fb || perp(f, worldUp);
  return finite(up) ? norm(up) : perp(f, worldUp);
}

// Orthonormal chase frame for a heading `fwd`. `prevRight` is parallel-transported so a sweep
// through straight-up does not flip the camera roll.
export function chaseFrame(fwd, worldUp = WUP, prevRight = null, fallback = null) {
  const f = norm(len(fwd) > 1e-8 ? fwd : (worldUp || WUP));
  let r = finite(prevRight) ? project(prevRight, f) : null;
  if (!r) r = finite(fallback) ? project(fallback, f) : null;
  if (!r) r = project(cross(worldUp, f), f);
  if (!r) r = perp(f, worldUp);
  r = norm(r);
  return { f, r, u: cross(f, r) };
}

// Offset from the target: yaw = pitch = 0 sits directly behind, looking along +fwd
// (below the rocket when it is going straight up).
export function chaseOffset(frame, yaw, pitch, R) {
  const { f, r, u } = frame, cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return { x: (r.x * sy * cp + u.x * sp - f.x * cy * cp) * R, y: (r.y * sy * cp + u.y * sp - f.y * cy * cp) * R, z: (r.z * sy * cp + u.z * sp - f.z * cy * cp) * R };
}
