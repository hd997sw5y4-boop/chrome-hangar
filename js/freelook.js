// 360° free look for a coasting orbit, and a lookAt up-vector that stays stable when the rocket
// is going straight up (the world-Y singularity). Pure JS so the tests run headless.
//
// An orientation is a unit quaternion that takes the default camera frame (offset = +Z, up = +Y)
// to the current one — the same frame as flight.js orbitPos(yaw, pitch). Look is a trackball:
// yaw around the current up, pitch around the current right, with no Euler clamps, so the view
// can go over the top without a flip. When |viewDir · worldUp| is large, aimUp / chaseFrame
// fall back to a parallel-transported up (or the rocket's side) instead of world Y.

export const ORBIT_PITCH_MIN = -0.45, ORBIT_PITCH_MAX = 1.5;
const WUP = { x: 0, y: 1, z: 0 };

const hypot3 = (x, y, z) => Math.hypot(x, y, z);
export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = a => hypot3(a.x, a.y, a.z);
export const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };

export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
export function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function qnorm(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}
export function qaxis(ax, ay, az, ang) {
  const l = hypot3(ax, ay, az) || 1, s = Math.sin(ang / 2);
  return { x: ax / l * s, y: ay / l * s, z: az / l * s, w: Math.cos(ang / 2) };
}
export function qrot(q, v) {
  const t = cross(q, v); t.x *= 2; t.y *= 2; t.z *= 2;
  return add(add(v, t, q.w), cross(q, t));
}
export function qslerp(a, b, t) {
  let ax = a.x, ay = a.y, az = a.z, aw = a.w, dot0 = ax * b.x + ay * b.y + az * b.z + aw * b.w;
  if (dot0 < 0) { ax = -ax; ay = -ay; az = -az; aw = -aw; dot0 = -dot0; }
  if (dot0 > 0.9995) return qnorm({ x: ax + (b.x - ax) * t, y: ay + (b.y - ay) * t, z: az + (b.z - az) * t, w: aw + (b.w - aw) * t });
  const th = Math.acos(Math.min(1, dot0)), s = Math.sin(th), s0 = Math.sin((1 - t) * th) / s, s1 = Math.sin(t * th) / s;
  return qnorm({ x: ax * s0 + b.x * s1, y: ay * s0 + b.y * s1, z: az * s0 + b.z * s1, w: aw * s0 + b.w * s1 });
}

// Matches flight.js orbitPos: offset = (sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch)).
export function fromYawPitch(yaw, pitch) {
  return qmul(qaxis(0, 1, 0, yaw), qaxis(1, 0, 0, -pitch));
}
export const offsetOf = q => qrot(q, { x: 0, y: 0, z: 1 });
export const upOf = q => qrot(q, { x: 0, y: 1, z: 0 });
export function toYawPitch(q) {
  const o = offsetOf(q);
  return { yaw: Math.atan2(o.x, o.z), pitch: Math.atan2(o.y, Math.hypot(o.x, o.z)) };
}
export function orbitOffset(q, R) { const o = offsetOf(q); return { x: o.x * R, y: o.y * R, z: o.z * R }; }
export const qconj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
// Cockpit head-look (three.js Euler YXZ(pitch, yaw, 0) = Ry(yaw) Rx(pitch)): +pitch looks up the window,
// and applyHeadLook uses the same input sign as cockpit.look (pitch -= dy, yaw -= dx).
export function fromHeadYawPitch(yaw, pitch) { return qmul(qaxis(0, 1, 0, yaw), qaxis(1, 0, 0, pitch)); }
export function toHeadYawPitch(q) {
  const f = qrot(q, { x: 0, y: 0, z: -1 });
  return { yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(Math.max(-1, Math.min(1, f.y))) };
}
export const applyHeadLook = (q, dx, dy) => applyLook(q, dx, -dy);
// Map a trackball orientation into a chase frame. The rest pose (default yaw/pitch) sits directly
// behind, looking along +fwd; user look then moves around that without Euler clamps.
export function framedOffset(fr, q, R, restQ) {
  const o = qrot(qconj(restQ || quat()), offsetOf(q)), { f, r, u } = fr;
  return { x: (r.x * o.x + u.x * o.y - f.x * o.z) * R, y: (r.y * o.x + u.y * o.y - f.y * o.z) * R, z: (r.z * o.x + u.z * o.y - f.z * o.z) * R };
}

// Trackball: +dx yaws the same way as `yaw -= dx`; +dy pitches the same way as `pitch -= dy`. No clamps.
export function applyLook(q, dx, dy) {
  let out = q;
  if (dy) {
    const o = offsetOf(out), u = upOf(out), r = cross(u, o);
    if (len(r) > 1e-10) out = qmul(qaxis(r.x, r.y, r.z, dy), out);
  }
  if (dx) {
    const u = upOf(out);
    out = qmul(qaxis(u.x, u.y, u.z, -dx), out);
  }
  return qnorm(out);
}

// True in Free Mode on the space leg with the engine off (coasting). Under thrust, on the pad, or in the air: false.
export function isCoast(moon, f) {
  return !!(f && f.phase === 'flying' && moon && moon.on && moon.mode === 'space' && !(f.e && f.e.on));
}

// Clamp the exterior-orbit Euler pitch; used when leaving a coast so the old limits come back.
export const clampOrbitPitch = p => Math.max(ORBIT_PITCH_MIN, Math.min(ORBIT_PITCH_MAX, p));

// A unit up for lookAt that never sits parallel to the view direction. Near the world-Y poles
// (|dot(view, worldUp)| > 0.98) it uses the previous up (parallel-transported) or `fallback`
// (rocket side / trackball up) so looking straight up or down does not flip or go NaN.
export function aimUp(eye, target, worldUp = WUP, fallback = null, prev = null) {
  const d0 = add(target, eye, -1), L = len(d0);
  if (L < 1e-12) return qfinite(prev) ? norm(prev) : (qfinite(fallback) ? norm(fallback) : { ...WUP });
  const f = mul(d0, 1 / L);
  const project = u => { const p = add(u, f, -dot(u, f)), s = len(p); return s > 1e-8 ? mul(p, 1 / s) : null; };
  const w = project(worldUp), p = qfinite(prev) ? project(prev) : null, fb = qfinite(fallback) ? project(fallback) : null;
  const align = (a, b) => (b && dot(a, b) < 0 ? mul(a, -1) : a);
  const pole = Math.abs(dot(f, worldUp));
  let up;
  if (pole > 0.98) up = p || fb || perp(f, worldUp);
  else if (w) {
    up = align(w, p);
    if (pole > 0.92 && p) { const t = (pole - 0.92) / 0.06; up = norm(add(mul(up, 1 - t), align(p, up), t)); }
  } else up = p || fb || perp(f, worldUp);
  return qfinite(up) ? norm(up) : perp(f, worldUp);
}

// Orthonormal chase frame for a heading `fwd`. `prevRight` is parallel-transported so a sweep
// through straight-up does not flip the camera roll. When fwd lines up with world Y, `fallback`
// (the rocket's local side / forward) is the right-axis seed if no previous right exists.
export function chaseFrame(fwd, worldUp = WUP, prevRight = null, fallback = null) {
  const f = norm(len(fwd) > 1e-8 ? fwd : (worldUp || WUP));
  const project = u => { const p = add(u, f, -dot(u, f)), s = len(p); return s > 1e-8 ? mul(p, 1 / s) : null; };
  let r = qfinite(prevRight) ? project(prevRight) : null;
  if (!r) r = qfinite(fallback) ? project(fallback) : null;
  if (!r) r = project(cross(worldUp, f));
  if (!r) r = perp(f, worldUp);
  r = norm(r);
  return { f, r, u: cross(f, r) };
}

// Offset from the target for a behind-and-look-forward chase: yaw = pitch = 0 sits directly
// behind looking along +fwd (below the rocket when it is going straight up).
export function chaseOffset(frame, yaw, pitch, R) {
  const { f, r, u } = frame, cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return { x: (r.x * sy * cp + u.x * sp - f.x * cy * cp) * R, y: (r.y * sy * cp + u.y * sp - f.y * cy * cp) * R, z: (r.z * sy * cp + u.z * sp - f.z * cy * cp) * R };
}

function perp(f, hint) {
  const a = Math.abs(f.y) < 0.9 ? (hint || WUP) : { x: 1, y: 0, z: 0 };
  const p = cross(a, f); return len(p) > 1e-8 ? norm(p) : norm(cross({ x: 0, y: 0, z: 1 }, f));
}
function qfinite(v) { return !!(v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) && (v.x !== 0 || v.y !== 0 || v.z !== 0)); }
