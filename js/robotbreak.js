// Robot crew extras: break-apart, repair by the other robot, stumble on light bumps, and walking
// outside the hangar (door routing + full outdoor collisions). Uses robots.js's public hooks only: while a robot
// is busy here (broken, riding, walking a task, kneeling, celebrating) it is set robot.enabled = false and driven
// from this file with a 'custom' job; it is handed back to its own rounds afterwards. The cart seats its passenger
// through cart.seatPassenger().
// Break: the robot's own skinned shell is baked per limb (head, torso, pelvis, upper/lower arms, thighs,
// shins) into rigid pieces that tumble with sparks and a metallic clatter. The other robot walks over,
// crouches with a welding torch and puts him back together piece by piece; he stands, shakes it off and
// gives a thumbs-up. If nobody can help (both broken, or the helper is riding in the cart) the pieces pull
// themselves back together magnetically after about 15 seconds.
import * as THREE from 'three';
import { insideHangar, playerFrame, resolve, overlaps, lineBlocked, C, R_ROBOT } from './collide.js';
import { rampEdges } from './ground.js';
import { Body } from './bodies.js';
import { JOBS, aimActuators } from './robots.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, k) => a + (b - a) * k;

// limb pieces: name, primary bone (piece frame), bones baked into it, mass (kg)
const PIECES = [['pelvis', 'pelvis', ['pelvis'], 8], ['torso', 'chest', ['spine', 'chest'], 14], ['head', 'head', ['neck', 'head'], 5]];
for (const S of ['L', 'R']) {
  const fing = []; for (let i = 0; i < 4; i++) fing.push(`f${i}a` + S, `f${i}b` + S);
  PIECES.push(['thigh' + S, 'hip' + S, ['hip' + S, 'kaB' + S, 'kaR' + S], 6], ['shin' + S, 'kn' + S, ['kn' + S, 'an' + S, 'toe' + S], 5],
    ['uarm' + S, 'sh' + S, ['sh' + S, 'eaB' + S, 'eaR' + S], 3.5], ['farm' + S, 'el' + S, ['el' + S, 'wr' + S, 'thA' + S, 'thB' + S, ...fing], 3]);
}
// repair order: bottom up, so he is rebuilt standing
const ORDER = ['shinL', 'shinR', 'thighL', 'thighR', 'pelvis', 'torso', 'uarmL', 'uarmR', 'farmL', 'farmR', 'head'];
const stay = (x, z, face) => ({ type: 'custom', mine: true, tick: () => ({ goal: { x, z, face } }) });
// walk a list of points (door waypoints first), then face `face` at the last one
const walkJob = T => ({ type: 'custom', mine: true, tick: r => {
  let p = T.pts[T.i];
  if (T.i < T.pts.length - 1 && Math.hypot(p.x - r.pos.x, p.z - r.pos.z) < 0.5) p = T.pts[++T.i];
  const last = T.i === T.pts.length - 1;
  return { goal: { x: p.x, z: p.z, face: last ? T.face ?? null : null, stop: last ? 0.06 : 0.3 }, speed: T.speed };
} });

// grid A* around obstacles (walls, door, props, fence, the cart), then pulled tight with line-of-sight checks
function plan(a, b, obs) {
  const pad = 6, x0 = Math.min(a.x, b.x) - pad, x1 = Math.max(a.x, b.x) + pad, z0 = Math.min(a.z, b.z) - pad, z1 = Math.max(a.z, b.z) + pad;
  const cs = Math.max(0.4, Math.max(x1 - x0, z1 - z0) / 170), nx = Math.ceil((x1 - x0) / cs) + 1, nz = Math.ceil((z1 - z0) / cs) + 1, R = R_ROBOT + 0.06;
  const near = obs.filter(o => o.t === 'c' ? o.x + o.r > x0 && o.x - o.r < x1 && o.z + o.r > z0 && o.z - o.r < z1 : o.x + o.hx > x0 && o.x - o.hx < x1 && o.z + o.hz > z0 && o.z - o.hz < z1);
  const X = i => x0 + i * cs, Z = j => z0 + j * cs, N = nx * nz, blocked = new Uint8Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = X(i), z = Z(j); for (const o of near) if (overlaps(x, z, R, o)) { blocked[j * nx + i] = 1; break; } }
  const cell = p => { let i = Math.round((p.x - x0) / cs), j = Math.round((p.z - z0) / cs), best = -1, bd = 1e9;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || blocked[jj * nx + ii]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = jj * nx + ii; } }
    return best; };
  const s0 = cell(a), g0 = cell(b); if (s0 < 0 || g0 < 0) return null;
  const gx = g0 % nx, gz = (g0 / nx) | 0, h = k => Math.hypot(k % nx - gx, ((k / nx) | 0) - gz);
  const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), shut = new Uint8Array(N), heap = [];
  const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const pi = (i - 1) >> 1; if (heap[pi][0] <= heap[i][0]) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
  gs[s0] = 0; push(s0, h(s0)); let found = false, iter = 0;
  while (heap.length && iter++ < 60000) {
    const k = pop(); if (shut[k]) continue; shut[k] = 1; if (k === g0) { found = true; break; }
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const n = jj * nx + ii; if (blocked[n] || shut[n] || (di && dj && (blocked[j * nx + ii] || blocked[jj * nx + i]))) continue;
      const g = gs[k] + (di && dj ? 1.4142 : 1); if (g < gs[n]) { gs[n] = g; from[n] = k; push(n, g + h(n)); }
    }
  }
  if (!found) return null;
  const raw = []; for (let k = g0; k >= 0; k = from[k]) raw.push({ x: X(k % nx), z: Z((k / nx) | 0) });
  raw.reverse(); raw[raw.length - 1] = { x: b.x, z: b.z };
  const out = []; let cur = { x: a.x, z: a.z };
  for (let i = 1; i < raw.length; i++) if (i === raw.length - 1 || lineBlocked(cur.x, cur.z, raw[i + 1].x, raw[i + 1].z, R_ROBOT, near)) { out.push(raw[i]); cur = raw[i]; }
  return out;
}

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(190,225,255,.85)'); r.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Crew {
  constructor(game, course) {
    this.g = game; this.w = game.world; this.course = course; this.sounds = course.sounds;
    this.out = new THREE.Group(); this.out.name = 'robotsOut'; this.w.scene.add(this.out);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xcfe8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flash.scale.setScalar(0.45); this.flash.visible = false; this.out.add(this.flash);
    this.timers = []; this.attached = false;
  }
  get list() { return (this.g.robots?.list || []).filter(r => r.where === 'hangar'); }
  attach() {
    if (this.attached || !this.g.robots) return; this.attached = true;
    for (const r of this.list) { r.homeParent = r.group.parent; r.fx = { kneel: 0, kneelOn: false, cel: -1 }; }
  }
  later(t, fn) { this.timers.push({ t, fn }); }
  cart() { return this.g.cart; }
  // busy with something from this file: robots.js leaves him alone (enabled = false) and Crew.update drives him
  busy(r) { return !!(r.broken || r.seat || r.task || r.outIdle || r.knock || r.helping || r.boarding || r.fx.kneel > 0.01 || r.fx.cel >= 0 || r.job?.mine); }

  // one frame for a robot we drive: his own walk/animation (robots.js), then our overlays, then feet + actuators again
  drive(r, dt) {
    if (r.knock) {
      const k = r.knock; r.pos.x += k.x * dt; r.pos.z += k.z * dt; const d = Math.exp(-4.5 * dt); k.x *= d; k.z *= d;
      if (Math.hypot(k.x, k.z) < 0.05) r.knock = null;
    }
    r.update(dt, { cam: this.w.camera.position, obs: this.obsFor(r), player: null });
    this.overlay(r, dt);
  }
  overlay(r, dt) {
    const f = r.fx, b = r.b; let touched = false;
    f.kneel += ((f.kneelOn ? 1 : 0) - f.kneel) * (1 - Math.exp(-3.5 * dt));
    if (f.kneel > 0.005) {
      const k = smooth(clamp(f.kneel, 0, 1));
      b.pelvis.position.y -= 0.36 * k; b.pelvis.rotation.x += 0.1 * k;
      b.spine.rotation.x += 0.34 * k; b.chest.rotation.x += 0.24 * k; b.neck.rotation.x += 0.32 * k;
      b.shR.rotation.x -= 0.25 * k; b.shL.rotation.x -= 0.2 * k;
      touched = true;
    }
    if (f.cel >= 0) {
      f.cel += dt; const t = f.cel;
      if (t < 0.95) { const e = Math.sin(Math.PI * t / 0.95); b.chest.rotation.z += Math.sin(t * 34) * 0.09 * e; b.head.rotation.y += Math.sin(t * 27) * 0.32 * e; b.spine.rotation.z += Math.sin(t * 34 + 1) * 0.05 * e; }
      const w = smooth(clamp((t - 0.85) / 0.35, 0, 1)) * smooth(clamp((2.9 - t) / 0.45, 0, 1));
      if (w > 0) {
        const sh = b.shR.rotation, el = b.elR.rotation, wr = b.wrR.rotation;
        sh.x = lerp(sh.x, -0.55, w); sh.y = lerp(sh.y, 0, w); sh.z = lerp(sh.z, -0.16, w); el.x = lerp(el.x, -1.75, w); wr.x = lerp(wr.x, 0.1, w); wr.z = lerp(wr.z, 0, w);
        for (let i = 0; i < 4; i++) { const fa = b[`f${i}aR`].rotation, fb = b[`f${i}bR`].rotation; fa.z = lerp(fa.z, 1.5 * (0.8 + i * 0.1), w); fb.z = lerp(fb.z, 1.7, w); }
        b.thAR.rotation.x = lerp(b.thAR.rotation.x, 0.25, w); b.thBR.rotation.x = lerp(b.thBR.rotation.x, 0, w);
        b.head.rotation.z += 0.12 * w; b.neck.rotation.y += 0.15 * w;
      }
      if (t > 3) f.cel = -1;
      touched = true;
    }
    if (!touched) return;
    r.group.updateMatrixWorld(true);
    for (const ft of r.feet) r.legIK(ft);   // keep the feet planted under the lowered pelvis
    aimActuators(b, 'L'); aimActuators(b, 'R');
  }
  obsFor(r) {
    const solid = r.solid; r.solid = false;   // leave his own circle out of robots.obstacles()
    const list = playerFrame(this.g).concat(rampEdges()); r.solid = solid;   // ramp sides are too tall for him to step up
    for (const o of this.list) if (o !== r && !o.broken && !o.seat) list.push(C(o.pos.x, o.pos.z, R_ROBOT));
    return list;
  }

  // ---------- walking jobs ----------
  sendTo(r, x, z, face, speed = 1.4, onArrive = null) {
    const pts = plan(r.pos, { x, z }, this.obsFor(r)) || [{ x, z }];
    r.task = { pts, x, z, face, onArrive, t: 0, i: 0, speed, px: x, pz: z, prog: 0, best: 1e9 }; r.greet = null; r.outIdle = null;
    r.setJob(walkJob(r.task), 'custom');
  }
  retarget(r, x, z, face) {
    const t = r.task; if (!t) return;
    t.x = x; t.z = z; t.face = face;
    if (Math.hypot(x - t.px, z - t.pz) > 1.2) this.replan(r);   // the cart moved: plan again
    else { const last = t.pts[t.pts.length - 1]; last.x = x; last.z = z; }
  }
  replan(r) {
    const t = r.task; t.px = t.x; t.pz = t.z; t.i = 0; t.best = 1e9; t.prog = 0;
    t.pts = plan(r.pos, { x: t.x, z: t.z }, this.obsFor(r)) || [{ x: t.x, z: t.z }];
  }
  goHome(r) {
    r.task = null; r.outIdle = null; r.fx.kneelOn = false; this.tool(r, false); r.helping = null;
    const back = () => r.setJob(JOBS[r.rounds](), r.rounds);   // his own rounds again (robots.js takes over)
    if (insideHangar(r.pos.x, r.pos.z, 0.5)) { back(); return; }
    const p = JOBS[r.rounds]().path?.[0] || { x: 0, z: -8 };
    this.sendTo(r, p.x, p.z, null, 1.15, back);
  }
  standPose(r, x, z, yaw) {
    r.pos.set(x, r.ground, z); r.yaw = yaw; r.v = 0; r.yawRate = 0; r.greet = null; r.knock = null;
    for (const f of r.feet) { f.pos = r.footIdeal(f.s, r.pos, yaw); f.swinging = false; f.yaw = yaw; f.lift = 0; f.pitch = 0; }
    r.ph = 0.42; r.walkK = 0; r.setJob(stay(x, z, yaw), 'custom');
    r.group.rotation.set(0, yaw, 0);
    const cam = this.w.camera.position; for (let i = 0; i < 3; i++) r.update(1 / 60, { cam, obs: [] });
    r.group.updateMatrixWorld(true);
  }
  // he waits by the cart for a bit after hopping out, then walks home
  idleOut(r) { r.outIdle = { t: 0 }; r.setJob(stay(r.pos.x, r.pos.z, r.yaw), 'custom'); }
  knock(r, vx, vz) {
    if (r.broken || r.seat) return;
    r.knock = { x: vx, z: vz };
    if (!r.task) r.greet = { t: -0.6 };
    this.g.robots?.whir(0.35, 0.8);
    this.sounds.play(['plate_h_0', 'plate_h_1'], 0.3, 1.2, 0.1);
  }

  // ---------- break apart ----------
  pieceGeos(r) {
    if (this._geos) return this._geos;
    const meshes = r.group.children.filter(o => o.isSkinnedMesh), sk = meshes[0].skeleton, names = sk.bones.map(b => b.name);
    const groupOf = {}; PIECES.forEach(([n, , bones], i) => bones.forEach(bn => { groupOf[bn] = i; }));
    const boneGroup = names.map(n => groupOf[n] ?? 1);
    const inv = PIECES.map(([, prim]) => sk.boneInverses[names.indexOf(prim)]);
    const nm = PIECES.map((_, i) => new THREE.Matrix3().getNormalMatrix(inv[i]));
    const out = PIECES.map(([name, prim, , m]) => ({ name, prim, m, geos: [], box: new THREE.Box3() }));
    const v = V3(), n = V3();
    for (const mesh of meshes) {
      const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, SI = g.attributes.skinIndex;
      const acc = PIECES.map(() => ({ p: [], n: [], u: [] }));
      for (let i = 0; i < P.count; i += 3) {
        const gi = boneGroup[SI.getX(i)], a = acc[gi];
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(P, i + k).applyMatrix4(inv[gi]); n.fromBufferAttribute(N, i + k).applyMatrix3(nm[gi]).normalize();
          a.p.push(v.x, v.y, v.z); a.n.push(n.x, n.y, n.z); if (U) a.u.push(U.getX(i + k), U.getY(i + k));
        }
      }
      acc.forEach((a, gi) => {
        if (!a.p.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
        if (a.u.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
        geo.computeBoundingBox(); out[gi].box.union(geo.boundingBox);
        out[gi].geos.push({ src: g.uuid, geo });
      });
    }
    for (const o of out) { o.center = o.box.getCenter(V3()); o.half = o.box.getSize(V3()).multiplyScalar(0.5); for (const { geo } of o.geos) { geo.translate(-o.center.x, -o.center.y, -o.center.z); geo.computeBoundingSphere(); } }
    return this._geos = out;
  }
  pieces(r) {
    if (r.parts) return r.parts;
    const defs = this.pieceGeos(r), mats = {};
    for (const m of r.group.children) if (m.isSkinnedMesh) mats[m.geometry.uuid] = m.material;
    r.parts = defs.map(d => {
      const pivot = new THREE.Group(); pivot.name = 'robotPiece_' + d.name;
      for (const { src, geo } of d.geos) { const m = new THREE.Mesh(geo, mats[src]); m.castShadow = !this.g.robots.lite; m.receiveShadow = true; pivot.add(m); }
      pivot.visible = false; this.out.add(pivot);
      const body = new Body(pivot, { half: d.half.clone().max(V3(0.05, 0.05, 0.05)), m: d.m, kind: 'piece', e: 0.3, mu: 0.55 });
      return { d, pivot, body, to: { p: V3(), q: new THREE.Quaternion() }, from: { p: V3(), q: new THREE.Quaternion() } };
    });
    return r.parts;
  }
  boneTarget(r, part, outP, outQ) {
    const m = r.b[part.d.prim].matrixWorld, s = V3();
    m.decompose(outP, outQ, s); outP.copy(part.d.center).applyMatrix4(m);
  }
  break(r, vel) {
    if (r.broken || !r.fx) return;
    const cart = this.cart();
    if (r.seat) cart?.dropPassenger(r, true);
    for (const o of this.list) if (o.broken?.helper === r) { this.toSelf(o); }
    r.task = null; r.knock = null; r.outIdle = null; r.helping = null; r.fx.kneelOn = false; r.fx.kneel = 0; r.fx.cel = -1; this.tool(r, false);
    if (r.group.parent !== this.out) this.out.attach(r.group);
    r.group.updateMatrixWorld(true);
    const parts = this.pieces(r), chest = r.b.chest.getWorldPosition(V3());
    for (const p of parts) {
      this.boneTarget(r, p, p.pivot.position, p.pivot.quaternion);
      const b = p.body, out = V3().subVectors(p.pivot.position, chest);
      b.v.copy(vel).multiplyScalar(0.8).addScaledVector(out, 3.2).add(V3((Math.random() - 0.5) * 2.4, 1.6 + Math.random() * 2.6, (Math.random() - 0.5) * 2.4));
      b.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
      b.frozen = false; b.wake(); p.pivot.visible = true;
      if (!this.course.bodies.includes(b)) this.course.bodies.push(b);
    }
    r.group.visible = false;
    r.broken = { t: 0, state: 'down', selfAt: 15 };
    const S = this.g.sparks;
    if (S) for (let i = 0; i < 70; i++) S.emit(chest.x, chest.y, chest.z, vel.x * 0.4 + (Math.random() - 0.5) * 7, Math.random() * 6, vel.z * 0.4 + (Math.random() - 0.5) * 7, 0.4 + Math.random() * 0.7);
    this.sounds.play(['clank_h_0', 'clank_h_1', 'clank_h_2'], 1.0, 0.9, 0.3);
    setTimeout(() => this.sounds.play(['metal_h_0', 'metal_h_1', 'plate_h_0'], 0.7, 1.05, 0.25), 110);
    setTimeout(() => this.sounds.play(['rattle_0', 'rattle_1'], 0.6, 1, 0.2), 260);
    const A = this.g.audio; A.tone(420, 0.55, 'sawtooth', 0.025, 0.2, 0.05, -0.75); A.noise(0.25, 2600, 0.8, 0.12, 0, 'bandpass', 0.1);
  }
  canHelp(h) { const c = this.cart(); return h && !h.broken && !h.seat && !h.boarding && !h.helping && c?.passenger !== h && c?.boarder !== h; }
  centroid(r) {
    const c = V3(); let n = 0; for (const p of r.parts) if (p.pivot.position.distanceTo(r.parts[1].pivot.position) < 9) { c.add(p.pivot.position); n++; }
    c.divideScalar(Math.max(1, n));
    const q = resolve(c.x, c.z, 0.55, playerFrame(this.g)); return V3(q.x, 0, q.z);
  }
  planRepair(r) {
    const B = r.broken, spot = B.spot = this.centroid(r);
    const helpers = this.list.filter(h => h !== r && this.canHelp(h)).sort((a, b) => a.pos.distanceTo(spot) - b.pos.distanceTo(spot));
    const h = helpers[0];
    if (!h || h.pos.distanceTo(spot) > 160) { this.toSelf(r); return; }
    const d = V3(h.pos.x - spot.x, 0, h.pos.z - spot.z); if (d.lengthSq() < 1e-4) d.set(1, 0, 0); d.normalize();
    let hp = { x: spot.x + d.x * 0.9, z: spot.z + d.z * 0.9 }; hp = resolve(hp.x, hp.z, R_ROBOT, playerFrame(this.g));
    B.hp = hp; B.helper = h; B.state = 'wait'; B.timeout = B.t + 70; h.helping = r;
    const face = Math.atan2(spot.x - hp.x, spot.z - hp.z);
    this.sendTo(h, hp.x, hp.z, face, 1.55, () => { if (r.broken?.helper === h && r.broken.state === 'wait') this.startRepair(r); });
    this.g.toast?.('His buddy is on the way with a welder.', 2600);
  }
  toSelf(r) {
    const B = r.broken; if (!B) return;
    const h = B.helper; B.helper = null;
    if (h) { h.helping = null; h.fx.kneelOn = false; this.tool(h, false); if (!h.broken && !h.seat) this.goHome(h); }
    if (B.state === 'repair') { for (const p of r.parts) if (!p.done) { p.body.frozen = false; p.body.wake(); } }
    B.state = 'self'; B.selfAt = Math.max(B.t + 2.5, 15);
  }
  targets(r, spot, yaw) {
    this.standPose(r, spot.x, spot.z, yaw);
    for (const p of r.parts) { this.boneTarget(r, p, p.to.p, p.to.q); p.done = false; p.from.p.copy(p.pivot.position); p.from.q.copy(p.pivot.quaternion); }
  }
  startRepair(r) {
    const B = r.broken, h = B.helper; B.state = 'repair'; B.i = 0; B.pt = -0.6;
    const yaw = Math.atan2(B.hp.x - B.spot.x, B.hp.z - B.spot.z);
    this.targets(r, B.spot, yaw);
    h.fx.kneelOn = true; this.tool(h, true);
    this.g.robots?.whir(0.5, 1.1);
  }
  stepRepair(r, dt) {
    const B = r.broken, h = B.helper;
    if (!h || h.broken || h.seat) { this.toSelf(r); return; }
    B.pt += dt; if (B.pt < 0) return;
    const part = r.parts.find(p => p.d.name === ORDER[B.i]);
    if (!part.body.frozen) { part.body.frozen = true; part.from.p.copy(part.pivot.position); part.from.q.copy(part.pivot.quaternion); this.sounds.play(['plate_m_0', 'plate_m_1'], 0.25, 1.4, 0.1); }
    const LIFT = 0.75, WELD = 0.5, k = smooth(clamp(B.pt / LIFT, 0, 1));
    part.pivot.position.lerpVectors(part.from.p, part.to.p, k).y += Math.sin(Math.PI * k) * 0.35;
    part.pivot.quaternion.slerpQuaternions(part.from.q, part.to.q, k);
    if (B.pt >= LIFT && !part.snapped) { part.snapped = true; this.g.audio.snap(); }
    if (B.pt >= LIFT) this.weld(h, part.to.p, dt, B.pt - LIFT);
    if (B.pt >= LIFT + WELD) {
      part.done = true; part.snapped = false; B.i++; B.pt = 0; this.flash.visible = false;
      if (B.i >= ORDER.length) this.finish(r);
    }
  }
  weld(h, at, dt, t) {
    const S = this.g.sparks, tip = h.torch ? h.torch.tip.getWorldPosition(V3()) : at;
    const p = V3().lerpVectors(tip, at, 0.6);
    if (S) for (let i = 0; i < 3; i++) S.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.25 + Math.random() * 0.35);
    this.flash.visible = true; this.flash.position.copy(p); this.flash.material.opacity = 0.55 + Math.random() * 0.45; this.flash.scale.setScalar(0.3 + Math.random() * 0.25);
    this._crackle = (this._crackle || 0) - dt;
    if (this._crackle <= 0) {
      this._crackle = 0.05 + Math.random() * 0.06; const A = this.g.audio;
      A.noise(0.04, 3800 + Math.random() * 2500, 2.5, 0.035, 0, 'bandpass', 0.05);
      if (Math.random() < 0.25) A.tone(2600, 0.02, 'square', 0.012, 0.05);   // ratchet tick
    }
  }
  startSelf(r) {
    const B = r.broken; B.state = 'pull'; B.pt = 0;
    const spot = this.centroid(r), cam = this.w.camera.position;
    this.targets(r, spot, Math.atan2(cam.x - spot.x, cam.z - spot.z));
    for (const p of r.parts) p.body.frozen = true;
    const A = this.g.audio; A.tone(110, 1.5, 'sine', 0.08, 0.3, 0, 2.2); A.tone(660, 1.4, 'sine', 0.02, 0.4, 0.05, 1.4);
  }
  stepPull(r, dt) {
    const B = r.broken; B.pt += dt; const n = r.parts.length, D = 1.25;
    r.parts.forEach((p, i) => {
      const raw = clamp((B.pt - i * 0.06) / D, 0, 1), k = raw * raw;   // eases in, like a magnet grabbing
      p.pivot.position.lerpVectors(p.from.p, p.to.p, k).y += Math.sin(Math.PI * raw) * 0.25;
      p.pivot.quaternion.slerpQuaternions(p.from.q, p.to.q, smooth(raw));
    });
    if (B.pt > D + n * 0.06) { this.g.audio.snap(); this.finish(r); }
  }
  finish(r) {
    const B = r.broken, h = B.helper;
    for (const p of r.parts) { p.pivot.visible = false; p.body.frozen = true; p.body.sleep = true; }
    this.course.bodies = this.course.bodies.filter(b => !r.parts.some(p => p.body === b));
    r.broken = null; r.group.visible = true; r.fx.cel = 0; this.flash.visible = false;
    this.g.robots?.whir(0.9, 1.25);
    const A = this.g.audio; A.tone(880, 0.25, 'sine', 0.05, 0.3, 0.1); A.tone(1320, 0.35, 'sine', 0.05, 0.35, 0.28);
    if (h) { h.fx.kneelOn = false; this.tool(h, false); h.helping = null; this.later(1.2, () => { if (!h.broken && !h.seat && !h.task) this.goHome(h); }); }
    this.later(3.2, () => { if (!r.broken && !r.seat && !r.task) this.goHome(r); });
    this.g.toast?.('Good as new!', 1800);
  }

  // welding torch in the right hand (built on first use)
  tool(r, on) {
    if (!r.torch && !on) return;
    if (!r.torch) {
      const g = new THREE.Group(), M = this.g.robots.M;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.13, 12), M.dark); g.add(grip);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.1, 8), M.metal); neck.position.set(0, -0.1, 0.03); neck.rotation.x = 0.6; g.add(neck);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.011, 0.035, 10), M.metal); nozzle.position.set(0, -0.15, 0.06); nozzle.rotation.x = 0.6; g.add(nozzle);
      const tip = new THREE.Object3D(); tip.position.set(0, -0.17, 0.075); g.add(tip); g.tip = tip;
      g.position.set(0, -0.075, 0.01); g.rotation.x = -1.2; r.b.wrR.add(g); r.torch = g;
    }
    r.torch.visible = on;
  }

  // ---------- per frame (after Robots.update) ----------
  update(dt) {
    this.attach(); if (!this.attached) return;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; if ((t.t -= dt) <= 0) { this.timers.splice(i, 1); t.fn(); } }
    for (const r of this.list) {
      if (r.seat) continue;
      const mine = this.busy(r);
      if (mine) { r.enabled = false; r.solid = !r.broken; } else if (!r.enabled) { r.enabled = true; r.solid = false; }
      // outside the hangar he lives in a scene-level group, so he stays visible when the hangar is culled
      const want = mine || !insideHangar(r.pos.x, r.pos.z, 0.3) ? this.out : r.homeParent;
      if (r.group.parent !== want) want.attach(r.group);
      if (mine && !r.broken) this.drive(r, dt);
      // walking jobs
      const T = r.task;
      if (T) {
        T.t += dt; const last = T.pts[T.pts.length - 1];
        if (Math.hypot(last.x - r.pos.x, last.z - r.pos.z) < 0.3 && T.i >= T.pts.length - 1) {
          r.task = null; r.setJob(stay(last.x, last.z, T.face ?? r.yaw), 'custom');
          T.onArrive?.();
        } else if (T.t > 90) { r.task = null; this.goHome(r); }
        else {   // no progress for 2.5 s (something moved into the way): plan again
          const d = Math.hypot(T.x - r.pos.x, T.z - r.pos.z);
          if (d < T.best - 0.25) { T.best = d; T.prog = 0; } else if ((T.prog += dt) > 2.5) this.replan(r);
        }
      }
      if (r.outIdle) {
        r.outIdle.t += dt; const P = this.g.build?.player, far = P ? Math.hypot(P.x - r.pos.x, P.z - r.pos.z) > 16 : true;
        if (r.outIdle.t > 25 || (far && r.outIdle.t > 3)) { r.outIdle = null; this.goHome(r); }
      }
      const B = r.broken; if (!B) continue;
      B.t += dt;
      if (B.state === 'down' && B.t > 1.4) this.planRepair(r);
      else if (B.state === 'wait') { if (!B.helper || B.helper.broken || B.helper.seat || B.t > B.timeout) this.toSelf(r); }
      else if (B.state === 'repair') this.stepRepair(r, dt);
      else if (B.state === 'self' && B.t >= B.selfAt) this.startSelf(r);
      else if (B.state === 'pull') this.stepPull(r, dt);
    }
  }
}
