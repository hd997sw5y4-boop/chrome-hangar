// Earth / Moon orbital mechanics for the Moon flight. Pure JS (no three.js) so it runs headless in node tests.
// - Patched conics: one body pulls at a time. Inside the Moon's sphere of influence (a * (muM / muE)^(2/5) ~ 66,000 km)
//   it is the Moon, outside it is the Earth; the state is re-expressed relative to the new body at the boundary.
// - Coasting is propagated analytically (universal-variable Kepler), so any time warp is exact and conserves energy.
//   Thrust / drag arcs are integrated with RK4 at the sim's 120 Hz step.
// - Earth uses the game's own numbers: g0 = 9.80665 m/s^2 at R = 6371 km (rocket.js / earth.js), so muE = g0 * R^2.
// - The Moon: radius 1737.4 km, surface gravity 1.62 m/s^2 (muM = g * R^2), on a FIXED circular orbit of 384,400 km with
//   the sidereal period 27.32166 d. The orbit plane and the Moon's place on it come from the real date at launch
//   (low-precision mean elements: node, 5.145 deg inclination to the ecliptic, mean argument of latitude), the node is held
//   still during the flight (it only regresses ~0.05 deg/day). Earth spins at its sidereal rate; the pad sits at its real
//   latitude / longitude, so "where the Moon is" in the sky matches the real Moon to within a few degrees.
export const G0 = 9.80665;
export const R_E = 6371e3, MU_E = G0 * R_E * R_E;
export const R_M = 1737.4e3, G_M = 1.62, MU_M = G_M * R_M * R_M;
export const A_M = 384400e3, T_M = 27.321661 * 86400, N_M = 2 * Math.PI / T_M;
export const R_SOI = A_M * Math.pow(MU_M / MU_E, 0.4);            // ~66,100 km
export const W_E = 7.2921159e-5;                                     // Earth sidereal spin, rad/s
export const PAD = { lat: 34.969, lon: -120.616 };                   // the range's real site (earth.js / CREDITS.md)
const D2R = Math.PI / 180;

// ---------- small double-precision vector helpers (arrays [x, y, z]) ----------
export const V = {
  add: (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const { add, sub, mul, dot, cross, len, norm } = V;

// ---------- time / ephemeris ----------
export const julian = ms => ms / 86400000 + 2440587.5;
// Earth's rotation angle (GMST, radians) at a Julian date
export const gmst = jd => ((280.46061837 + 360.98564736629 * (jd - 2451545)) % 360) * D2R;
const EPS = 23.4393 * D2R;
const ecl2eq = p => [p[0], p[1] * Math.cos(EPS) - p[2] * Math.sin(EPS), p[1] * Math.sin(EPS) + p[2] * Math.cos(EPS)];

// The scene for one flight: epoch (ms since 1970, the launch moment) fixes the Moon's orbit, the pad's spin angle and the Sun.
export function makeSky(epochMs = Date.now()) {
  const jd = julian(epochMs), d = jd - 2451545;
  const node = (125.044 - 0.0529539 * d) * D2R, inc = 5.145 * D2R, u0 = (93.272 + 13.2293505 * d) * D2R;   // mean elements
  // orbit plane basis in equatorial coordinates: P = ascending node direction, Q = 90 deg ahead in the plane, H = normal
  const P = ecl2eq([Math.cos(node), Math.sin(node), 0]);
  const Q = ecl2eq([-Math.sin(node) * Math.cos(inc), Math.cos(node) * Math.cos(inc), Math.sin(inc)]);
  const H = norm(cross(P, Q));
  const Ls = (280.460 + 0.9856474 * d) * D2R, Ms = (357.528 + 0.9856003 * d) * D2R, lam = Ls + (1.915 * Math.sin(Ms) + 0.02 * Math.sin(2 * Ms)) * D2R;
  return { epochMs, jd, theta0: gmst(jd), P, Q, H, u0, sun: norm(ecl2eq([Math.cos(lam), Math.sin(lam), 0])) };
}
export function moonPos(sky, t) { const u = sky.u0 + N_M * t; return add(mul(sky.P, A_M * Math.cos(u)), sky.Q, A_M * Math.sin(u)); }
export function moonVel(sky, t) { const u = sky.u0 + N_M * t, s = A_M * N_M; return add(mul(sky.P, -s * Math.sin(u)), sky.Q, s * Math.cos(u)); }
// Moon body axes (tidally locked): x toward the Earth, z = orbit normal. Texture longitude 0 faces the Earth.
export function moonAxes(sky, t) { const x = mul(norm(moonPos(sky, t)), -1), z = sky.H; return { x, y: cross(z, x), z }; }
export function moonLatLon(sky, t, rRel) {
  const A = moonAxes(sky, t), n = norm(rRel);
  return { lat: Math.asin(Math.max(-1, Math.min(1, dot(n, A.z)))) / D2R, lon: Math.atan2(dot(n, A.y), dot(n, A.x)) / D2R };
}

// ---------- local surface frames (game convention: +x = west, +y = up, +z = north) ----------
// Earth pad frame: origin on the ground at the site, rotating with the Earth; Earth's centre is at local (0, -R_E, 0).
export function padBasis(sky, t, site = PAD) {
  const th = sky.theta0 + W_E * t + site.lon * D2R, f = site.lat * D2R;
  const up = [Math.cos(f) * Math.cos(th), Math.cos(f) * Math.sin(th), Math.sin(f)];
  const east = [-Math.sin(th), Math.cos(th), 0], north = cross(up, east);
  return { up, east, north };
}
// Moon surface frame: up = a fixed direction in the Moon's body axes (so it turns with the Moon), local origin at `at`
export function moonBasis(sky, t, bodyUp) {
  const A = moonAxes(sky, t), up = norm(add(add(mul(A.x, bodyUp[0]), A.y, bodyUp[1]), A.z, bodyUp[2]));
  let east = cross(A.z, up); if (len(east) < 1e-6) east = A.y; east = norm(east);
  return { up, east, north: cross(up, east) };
}
// local (x west, y up, z north) metres <-> body-centred inertial-axis vectors, for a frame spinning at `w` (rad/s) about `axis`
export function localToBody(B, R, o, p, v, spin) {
  const dx = p.x - o.x, dz = p.z - o.z;
  const r = add(add(mul(B.up, R + p.y), B.east, -dx), B.north, dz);
  let vv = add(add(mul(B.up, v.y), B.east, -v.x), B.north, v.z);
  if (spin) vv = add(vv, cross(spin, r));
  return { r, v: vv };
}
export function bodyToLocal(B, R, o, r, v, spin) {
  const vr = spin ? sub(v, cross(spin, r)) : v;
  return { p: { x: o.x - dot(r, B.east), y: dot(r, B.up) - R, z: o.z + dot(r, B.north) }, v: { x: -dot(vr, B.east), y: dot(vr, B.up), z: dot(vr, B.north) } };
}
export const vecToLocal = (B, d) => ({ x: -dot(d, B.east), y: dot(d, B.up), z: dot(d, B.north) });
export const localToVec = (B, d) => add(add(mul(B.up, d.y), B.east, -d.x), B.north, d.z);

// ---------- universal-variable Kepler propagation (Vallado, Algorithm 8) ----------
function stumpff(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * z)]; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * -z)]; }
  return [1 / 2 - z / 24, 1 / 6 - z / 120];
}
export function kepler(r0, v0, dt, mu) {
  if (dt === 0) return { r: r0.slice(), v: v0.slice() };
  const R0 = len(r0), V0 = len(v0), sq = Math.sqrt(mu), rv = dot(r0, v0) / sq;
  const alpha = 2 / R0 - V0 * V0 / mu;
  // initial guess: elliptic -> mean-motion estimate; otherwise the small-step estimate. Laguerre-Conway iteration (n = 5)
  // converges from either, including fast hyperbolic and near-radial arcs where plain Newton can run away.
  let dtW = dt;   // ellipses: whole periods dropped first (exactly periodic), keeps x small for 100,000x warp chunks
  if (alpha > 1e-12) { const P = 2 * Math.PI / (sq * Math.pow(alpha, 1.5)); if (Math.abs(dt) > P) dtW = dt % P; }
  let x = alpha > 1e-12 ? sq * dtW * alpha : sq * dtW / R0;
  let c2, c3, z;
  for (let i = 0; i < 80; i++) {
    z = x * x * alpha; [c2, c3] = stumpff(z);
    const F = x * x * x * c3 + rv * x * x * c2 + R0 * x * (1 - z * c3) - sq * dtW;
    const F1 = x * x * c2 + rv * x * (1 - z * c3) + R0 * (1 - z * c2);
    const F2 = rv * (1 - z * c2) + (1 - alpha * R0) * x * (1 - z * c3);
    const n = 5, D = Math.sqrt(Math.abs((n - 1) * (n - 1) * F1 * F1 - n * (n - 1) * F * F2));
    const dx = n * F / (F1 + Math.sign(F1 || 1) * D);
    x -= dx; if (Math.abs(dx) < 1e-10 * (1 + Math.abs(x))) break;
  }
  z = x * x * alpha; [c2, c3] = stumpff(z);
  const r = x * x * c2 + rv * x * (1 - z * c3) + R0 * (1 - z * c2);
  const f = 1 - x * x / R0 * c2, g = dtW - x * x * x / sq * c3, gd = 1 - x * x / r * c2, fd = sq / (r * R0) * x * (z * c3 - 1);
  return { r: add(mul(r0, f), v0, g), v: add(mul(r0, fd), v0, gd) };
}
export const energy = (r, v, mu) => dot(v, v) / 2 - mu / len(r);
export function elements(r, v, mu) {
  const E = energy(r, v, mu), h = cross(r, v), hl = len(h);
  const e = Math.sqrt(Math.max(0, 1 + 2 * E * hl * hl / (mu * mu)));
  const p = hl * hl / mu, rp = p / (1 + e), ra = e < 1 ? p / (1 - e) : Infinity;
  return { E, e, rp, ra, a: E < 0 ? -mu / (2 * E) : Infinity, period: E < 0 ? 2 * Math.PI * Math.sqrt((-mu / (2 * E)) ** 3 / mu) : Infinity };
}
// seconds until the conic first comes within radius `rad` of its body (Infinity if it never does)
export function timeToRadius(r, v, mu, rad) {
  const R0 = len(r); if (R0 <= rad) return 0;
  const el = elements(r, v, mu); if (el.rp > rad) return Infinity;
  // march then bisect (robust for any conic)
  let t = 0, step = Math.max(5, 0.02 * R0 / Math.max(1, len(v))), s = kepler(r, v, 0, mu), horizon = el.period < Infinity ? el.period : 40 * 86400;
  while (t < horizon) {
    const t2 = t + step, s2 = kepler(r, v, t2, mu);
    if (len(s2.r) <= rad) { let a = t, b = t2; for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (len(kepler(r, v, m, mu).r) <= rad) b = m; else a = m; } return b; }
    t = t2; s = s2; step = Math.max(5, 0.02 * (len(s.r) - rad) / Math.max(1, len(s.v)) + 0.01 * len(s.r) / Math.max(1, len(s.v)));
  }
  return Infinity;
}

// ---------- the craft state ----------
// s = { body: 'E' | 'M', r, v (relative to the body, inertial axes, m and m/s), t (s since the epoch) }
export const muOf = b => b === 'E' ? MU_E : MU_M;
export const radiusOf = b => b === 'E' ? R_E : R_M;
export function toEarth(sky, s) { return s.body === 'E' ? { r: s.r, v: s.v } : { r: add(s.r, moonPos(sky, s.t)), v: add(s.v, moonVel(sky, s.t)) }; }
// re-base on whichever body owns this point; returns true if the body changed
export function rebase(sky, s) {
  if (s.body === 'E') {
    const rm = sub(s.r, moonPos(sky, s.t));
    if (len(rm) < R_SOI) { s.v = sub(s.v, moonVel(sky, s.t)); s.r = rm; s.body = 'M'; return true; }
  } else if (len(s.r) > R_SOI) {
    s.r = add(s.r, moonPos(sky, s.t)); s.v = add(s.v, moonVel(sky, s.t)); s.body = 'E'; return true;
  }
  return false;
}
// distance (m) to the nearer of: the SOI boundary, the surface; and the max closing speed, for a safe coast chunk
function chunkLimit(sky, s) {
  const R = len(s.r), sp = len(s.v), alt = R - radiusOf(s.body);
  let d = alt, vc = sp;
  if (s.body === 'E') { d = Math.min(d, len(sub(s.r, moonPos(sky, s.t))) - R_SOI); vc += 1100; }
  else d = Math.min(d, R_SOI - R);
  return Math.max(2, 0.25 * Math.max(0, d) / Math.max(1, vc));
}
// Coast for dt seconds with patched conics. Stops early at a surface (returns 'surface') or after maxChunks (returns
// the time it did manage). Each chunk is exact; SOI crossings are bisected to ~1 s.
export function coast(sky, s, dt, opts = {}) {
  const maxChunks = opts.maxChunks ?? 400, stopAlt = opts.stopAlt ?? { E: 0, M: 0 };
  let done = 0, n = 0, crossed = 0;
  while (done < dt - 1e-9) {
    if (++n > maxChunks) return { done, limited: true, crossed };
    const mu = muOf(s.body), h = Math.min(dt - done, chunkLimit(sky, s));
    const k = kepler(s.r, s.v, h, mu), test = { body: s.body, r: k.r, v: k.v, t: s.t + h };
    const floor = radiusOf(s.body) + (stopAlt[s.body] || 0);
    const soiHit = s.body === 'E' ? len(sub(k.r, moonPos(sky, s.t + h))) < R_SOI : len(k.r) > R_SOI;
    if (len(k.r) <= floor || soiHit) {
      // bisect the moment of the event inside this chunk
      let a = 0, b = h;
      for (let i = 0; i < 40 && b - a > 0.01; i++) {
        const m = (a + b) / 2, km = kepler(s.r, s.v, m, mu);
        const hit = len(km.r) <= floor || (s.body === 'E' ? len(sub(km.r, moonPos(sky, s.t + m))) < R_SOI : len(km.r) > R_SOI);
        if (hit) b = m; else a = m;
      }
      const kb = kepler(s.r, s.v, b, mu); s.r = kb.r; s.v = kb.v; s.t += b; done += b;
      if (len(s.r) <= floor) return { done, surface: true, crossed };
      rebase(sky, s); crossed++;
      continue;
    }
    s.r = test.r; s.v = test.v; s.t = test.t; done += h;
  }
  return { done, crossed };
}
// one RK4 step under gravity + a constant extra acceleration (thrust) + optional drag function; then re-base at the SOI
export function thrustStep(sky, s, h, acc, dragFn) {
  const mu = muOf(s.body);
  const f = (r, v) => { const R = len(r), g = mul(r, -mu / (R * R * R)); let a = add(g, acc); if (dragFn) a = add(a, dragFn(r, v)); return a; };
  const r0 = s.r, v0 = s.v;
  const a1 = f(r0, v0), r1 = add(r0, v0, h / 2), v1 = add(v0, a1, h / 2);
  const a2 = f(r1, v1), r2 = add(r0, v1, h / 2), v2 = add(v0, a2, h / 2);
  const a3 = f(r2, v2), r3 = add(r0, v2, h), v3 = add(v0, a3, h);
  const a4 = f(r3, v3);
  s.r = add(r0, add(add(v0, add(v1, v2), 2), v3), h / 6);
  s.v = add(v0, add(add(a1, add(a2, a3), 2), a4), h / 6);
  s.t += h;
  return rebase(sky, s);
}
// Predicted path: up to n points in Earth-centred coordinates (and where it ends), patched conics, no thrust.
export function predict(sky, s0, opts = {}) {
  const n = opts.n ?? 240, horizon = opts.horizon ?? 12 * 86400;
  const s = { body: s0.body, r: s0.r.slice(), v: s0.v.slice(), t: s0.t };
  const el = elements(s.r, s.v, muOf(s.body));
  // time per point: an orbit's worth when bound and small, else spread over the horizon
  const span = s.body === 'E' && el.ra < 0.6 * A_M && el.period < horizon ? Math.min(horizon, el.period * 1.02) : horizon;
  const pts = [], out = { pts, enterSOI: null, closest: Infinity, closestT: null, impact: null, body: [] };
  let dtp = span / n;
  for (let i = 0; i <= n; i++) {
    const e = toEarth(sky, s); pts.push(s.body === 'M' ? { r: s.r.slice(), m: true, t: s.t } : { r: e.r, m: false, t: s.t });
    const dm = s.body === 'M' ? len(s.r) : len(sub(s.r, moonPos(sky, s.t)));
    if (dm < out.closest) { out.closest = dm; out.closestT = s.t; }
    if (i === n) break;
    const was = s.body, c = coast(sky, s, dtp, { maxChunks: 200 });
    if (c.surface) { out.impact = { body: s.body, t: s.t }; const e2 = toEarth(sky, s); pts.push(s.body === 'M' ? { r: s.r.slice(), m: true, t: s.t } : { r: e2.r, m: false, t: s.t }); break; }
    if (s.body !== was) {
      if (s.body === 'M' && out.enterSOI == null) out.enterSOI = s.t;
      if (s.body === 'M') { const em = elements(s.r, s.v, MU_M); dtp = Math.min(dtp, (em.period < Infinity ? em.period : 2 * R_SOI / Math.max(1, len(s.v))) / 120); }
    }
  }
  return out;
}
