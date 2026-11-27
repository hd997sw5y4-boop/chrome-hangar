// Cheap 2D (x,z) collisions for walking: circles and axis-aligned boxes. Resolve by sliding
// along the contact normal so corners don't feel sticky. Used by the player and the robots.
import { HANGAR, SPOTS } from './env.js';
import { HALF } from './stand.js';
import { FENCE, VIEW_STAND } from './outdoor.js';

export const R_PLAYER = 0.36, R_ROBOT = 0.3;

export const C = (x, z, r) => ({ t: 'c', x, z, r });
export const B = (x, z, hx, hz) => ({ t: 'b', x, z, hx, hz });

// Push a point of radius r out of one obstacle. Returns true if it moved.
function push(p, o, r) {
  if (o.t === 'c') {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), need = o.r + r;
    if (d >= need) return false;
    const k = need / Math.max(d, 1e-6);
    p.x = o.x + dx * k; p.z = o.z + dz * k; return true;
  }
  const cx = Math.max(o.x - o.hx, Math.min(o.x + o.hx, p.x));
  const cz = Math.max(o.z - o.hz, Math.min(o.z + o.hz, p.z));
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 > r * r && d2 > 1e-12) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2), k = r / d;
    p.x = cx + dx * k; p.z = cz + dz * k; return true;
  }
  const px = p.x - o.x, pz = p.z - o.z;
  const ox = o.hx + r - Math.abs(px), oz = o.hz + r - Math.abs(pz);
  if (ox < oz) p.x = o.x + Math.sign(px || 1) * (o.hx + r);
  else p.z = o.z + Math.sign(pz || 1) * (o.hz + r);
  return true;
}

export function resolve(x, z, r, obs) {
  const p = { x, z };
  for (let i = 0; i < 3; i++) { let moved = false; for (const o of obs) if (push(p, o, r)) moved = true; if (!moved) break; }
  return p;
}

export function overlaps(x, z, r, o) {
  if (o.t === 'c') return Math.hypot(x - o.x, z - o.z) < o.r + r - 1e-4;
  const dx = Math.abs(x - o.x) - o.hx, dz = Math.abs(z - o.z) - o.hz;
  if (dx <= 0 && dz <= 0) return true;
  const ex = Math.max(dx, 0), ez = Math.max(dz, 0);
  return ex * ex + ez * ez < r * r - 1e-6;
}

export function lineBlocked(ax, az, bx, bz, r, obs) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1e-4) return false;
  const steps = Math.max(2, Math.ceil(len / 0.45));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = ax + dx * t, z = az + dz * t;
    for (const o of obs) if (overlaps(x, z, r, o)) return true;
  }
  return false;
}

// If the straight line is blocked, return a sidestep waypoint around the first hit; else null.
export function detour(ax, az, bx, bz, r, obs) {
  if (!lineBlocked(ax, az, bx, bz, r, obs)) return null;
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
  const steps = Math.max(2, Math.ceil(len / 0.45));
  let hit = null, hx = ax, hz = az;
  for (let i = 1; i <= steps && !hit; i++) {
    const t = i / steps; hx = ax + dx * t; hz = az + dz * t;
    for (const o of obs) if (overlaps(hx, hz, r, o)) { hit = o; break; }
  }
  if (!hit) return null;
  const clearance = r + 0.7;
  const candidates = [];
  if (hit.t === 'c') {
    const rad = hit.r + clearance;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; candidates.push({ x: hit.x + Math.cos(a) * rad, z: hit.z + Math.sin(a) * rad }); }
  } else {
    const hx2 = hit.hx + clearance, hz2 = hit.hz + clearance;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      candidates.push({ x: hit.x + sx * hx2, z: hit.z + sz * hz2 });
    }
  }
  let best = null, bd = 1e9;
  for (const c of candidates) {
    if (obs.some(o => overlaps(c.x, c.z, r, o))) continue;
    if (lineBlocked(ax, az, c.x, c.z, r, obs)) continue;
    const d = Math.hypot(c.x - ax, c.z - az) + Math.hypot(bx - c.x, bz - c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

let _hangar, _walls, _outdoor;

// Static hangar props, stand, tower, tanks, console, scaffold. Circles for round things, boxes otherwise.
export function hangarObstacles() {
  if (_hangar) return _hangar;
  const H = HANGAR, list = [];
  list.push(B(0, 0, HALF + 0.08, HALF + 0.08));
  list.push(B(0, -(HALF + 1.12), 2.2, 1.45));
  list.push(C(-12, 2.5, 1.35));
  list.push(B(15.4, -4.4, 0.7, 1.85));
  list.push(B(-12.4, -H.z + 0.32, 0.4, 0.35));
  list.push(B(-6.35, 6.0, 1.4, 1.0));
  list.push(B(-16.0, 10, 3.2, 1.15));
  list.push(B(-17.5, 6, 1.9, 1.15));
  list.push(B(15.5, 10, 1.9, 1.15));
  list.push(B(9, 5, 2.6, 0.8));
  list.push(B(8.2, 5.1, 0.55, 0.45));
  list.push(C(-19.2, -13.1, 1.15), C(18.8, -13.4, 0.45));
  list.push(B(16.5, 15.3, 2.1, 0.5));
  list.push(B(-21.4, 0, 0.7, 3.6));
  list.push(C(-12, 13.2, 0.85));
  list.push(C(-14.7, -13.1, 0.85));
  list.push(B(21.2, -7, 0.35, 0.8));
  list.push(C(11.6, 5.6, 0.35));
  list.push(C(-4.8, 3.6, 0.4), C(4.6, -4.2, 0.4));
  list.push(B(21.25, -10.7, 0.55, 1.0));
  list.push(C(19.8, -12.4, 0.7));
  list.push(C(-14.6, 4.3, 0.9));
  return _hangar = list;
}

// Interior walls: solid except the bay-door opening on -Z.
export function hangarWalls() {
  if (_walls) return _walls;
  const H = HANGAR, t = 0.45, side = H.x - H.door;
  return _walls = [
    B(0, H.z, H.x + t, t),
    B(H.x, 0, t, H.z + t),
    B(-H.x, 0, t, H.z + t),
    B(-H.door - side / 2, -H.z, side / 2, t),
    B(H.door + side / 2, -H.z, side / 2, t),
  ];
}

export function doorObstacles(game) {
  const d = game?.interact?.doors;
  if (!d?.leaves?.length) return [];
  const w = HANGAR.door + 0.25, hx = w / 2, hz = 0.22, z = d.z ?? (-HANGAR.z - 0.75), k = d.t ?? 1, list = [];
  for (const s of [-1, 1]) list.push(B(s * (w / 2 - 0.12) + s * k * (HANGAR.door + 0.6), z, hx, hz));
  return list;
}

export function padObstacles(w) {
  const P = SPOTS.pad, c = w?.pad?.center, list = [C(c?.x ?? P.x, c?.z ?? P.z, 4.6)];
  const tw = w?.pad?.tower;
  if (tw) { tw.updateWorldMatrix?.(true, false); const e = tw.matrixWorld?.elements; if (e) list.push(C(e[12], e[14], 5.2)); }
  return list;
}

export function outdoorObstacles(w) {
  if (_outdoor) return _outdoor;
  const T = SPOTS.test, F = FENCE, list = [];
  list.push(B(T.x, T.z, 7.2, 6.5));
  list.push(C(-48, -175, 7.5));
  list.push(B(48, -172, 14, 10));
  list.push(C(132, -150, 7));
  list.push(B(-118, -135, 12, 10));
  for (const [x, z] of [[-34, -150], [34, -150], [-34, -80], [34, -80], [30, -55], [66, -90]]) list.push(C(x, z, 0.9));
  list.push(B(F.x0 + 6, F.gateZ + F.gateW / 2 + 3, 1.8, 1.8));
  list.push(C(26, -30, 2.6), C(66, -186, 2.6), C(-104, -112, 2.6));
  list.push(C(32, 10, 1.6), C(32, 4.5, 1.6));
  list.push(C(22.6, -20.2, 1.2));
  list.push(C(16, 18.5, 0.45), C(-30, 18.5, 0.45), C(14, -92, 0.45));
  return _outdoor = list;
}

export function dynamicObstacles(game) {
  const list = [];
  const crane = game?.interact?.crane;
  if (crane?.liftables) for (const L of crane.liftables) {
    if (L.held) continue;
    const p = L.g.position;
    list.push(C(p.x, p.z, (L.r || 0.8) + 0.05));
  }
  if (game?.cart) list.push(...game.cart.obstacles());
  return list;
}

export function insideHangar(x, z, slop = 0.2) {
  const H = HANGAR;
  return Math.abs(x) < H.x - slop && Math.abs(z) < H.z - slop;
}

// When the west gate arm is up, allow a corridor out to the public viewing stand.
export let westYardOpen = () => false;
export function setWestYard(fn) { westYardOpen = fn || (() => false); }

export function clampSite(x, z, r) {
  const F = FENCE, m = 1.15 + r * 0.15;
  const xLo = F.x0 + m, xHi = F.x1 - m, zLo = F.z0 + m, zHi = F.z1 - m;
  if (westYardOpen()) {
    const xW = VIEW_STAND.x - 14;
    const zGA = F.gateZ - F.gateW / 2 + 1.4, zGB = F.gateZ + F.gateW / 2 - 1.4;
    const zYA = VIEW_STAND.z - 20, zYB = VIEW_STAND.z + 14;
    const atGate = z >= zGA && z <= zGB;
    const inYard = x >= xW && x <= F.x0 + 8 && z >= zYA && z <= zYB;
    const inLink = x >= xW && x <= xLo + 2 && z >= Math.min(zGA, zYA) && z <= Math.max(zGB, zYB);
    if (atGate || inYard || (x < xLo && inLink)) {
      return { x: Math.max(xW, Math.min(xHi, x)), z: Math.max(Math.min(zLo, zYA), Math.min(Math.max(zHi, zYB), z)) };
    }
  }
  return { x: Math.max(xLo, Math.min(xHi, x)), z: Math.max(zLo, Math.min(zHi, z)) };
}

export function walk(x, z, r, obs) {
  const p = resolve(x, z, r, obs);
  return clampSite(p.x, p.z, r);
}

export function hangarFrame(game) {
  return hangarObstacles().concat(hangarWalls(), doorObstacles(game), dynamicObstacles(game), game?.hands?.obstacles?.() || []);
}

export function playerFrame(game) {
  return hangarFrame(game).concat(outdoorObstacles(game?.world), padObstacles(game?.world));
}
