// Indoor assembly stand: a low square steel frame bolted to the hangar floor, diamond-plate deck,
// hydraulic hold-down clamps, painted floor markings, uplights, and a side tower with fold-out
// work platforms. Platforms stay folded back while building so they never steal part clicks.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { applyPBR } from './tex.js';

export const DECK = 0.42, HALF = 2.5;
const TAU = Math.PI * 2, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
const _o = new THREE.Object3D();
function xf(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) { _o.position.set(...p); _o.rotation.set(...r); _o.scale.set(...s); _o.updateMatrix(); return _o.matrix.clone(); }

class Kit {
  constructor() { this.by = new Map(); }
  add(geo, mat, m4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m4) g.applyMatrix4(m4);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.by.has(mat)) this.by.set(mat, []); this.by.get(mat).push(g); geo.dispose?.(); return this;
  }
  rod(a, b, r, mat, seg = 8) {
    const d = b.clone().sub(a), L = d.length(), g = new THREE.CylinderGeometry(r, r, L, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
    return this.add(g, mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
  }
  box(w, h, d, mat, p, r = [0, 0, 0]) { return this.add(new THREE.BoxGeometry(w, h, d), mat, xf(p, r)); }
  build(group, cast = true) {
    for (const [mat, list] of this.by) {
      const m = new THREE.Mesh(mergeGeometries(list, false), mat);
      m.castShadow = cast; m.receiveShadow = true; if (mat.aoMap && m.geometry.attributes.uv) m.geometry.setAttribute('uv2', m.geometry.attributes.uv);
      group.add(m); list.forEach(g => g.dispose());
    }
    this.by.clear(); return group;
  }
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t;
}

function chevronTex() {
  return canvasTex(256, 32, (c, w, h) => {
    c.fillStyle = '#e8b21c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#16171a';
    for (let x = -h; x < w; x += 28) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 14, h); c.lineTo(x + 14 + h, 0); c.lineTo(x + h, 0); c.fill(); }
  });
}

function floorMarkTex() {
  // 14 m square of painted yellow / black safety lines around the stand, transparent elsewhere
  const M = 14, stand = HALF * 2, dash = 6.6;
  return canvasTex(2048, 2048, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const s = w / M, cx = w / 2, cy = h / 2, px = v => cx + v * s, py = v => cy + v * s;
    const rect = (half, lw, color, dashed = false) => {
      c.save(); c.strokeStyle = color; c.lineWidth = lw * s; c.setLineDash(dashed ? [0.45 * s, 0.32 * s] : []);
      c.strokeRect(px(-half), py(-half), half * 2 * s, half * 2 * s); c.restore();
    };
    // hazard chevron band just outside the steel frame
    const inner = stand / 2 + 0.02, outer = inner + 0.28;
    c.fillStyle = '#e8b21c';
    c.fillRect(px(-outer), py(-outer), (outer * 2) * s, (outer - inner) * s);
    c.fillRect(px(-outer), py(inner), (outer * 2) * s, (outer - inner) * s);
    c.fillRect(px(-outer), py(-inner), (outer - inner) * s, (inner * 2) * s);
    c.fillRect(px(inner), py(-inner), (outer - inner) * s, (inner * 2) * s);
    c.fillStyle = '#16171a';
    const step = 0.28, band = outer - inner;
    for (let x = -outer; x < outer; x += step) {
      for (const z0 of (-outer, inner)) {
        c.beginPath(); c.moveTo(px(x), py(z0 + band)); c.lineTo(px(x + step * 0.5), py(z0 + band)); c.lineTo(px(x + step * 0.5 + band), py(z0)); c.lineTo(px(x + band), py(z0)); c.fill();
      }
    }
    for (let z = -inner; z < inner; z += step) {
      for (const x0 of (-outer, inner)) {
        c.beginPath(); c.moveTo(px(x0), py(z)); c.lineTo(px(x0 + band), py(z + band)); c.lineTo(px(x0 + band), py(z + step * 0.5 + band)); c.lineTo(px(x0), py(z + step * 0.5)); c.fill();
      }
    }
    // dashed yellow work box
    rect(dash / 2, 0.08, '#d8a40e', true);
    // corner L-marks
    c.strokeStyle = '#e8b21c'; c.lineWidth = 0.07 * s; c.setLineDash([]);
    const L = 0.7, box = dash / 2 + 0.15;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      c.beginPath();
      c.moveTo(px(sx * (box - L)), py(sz * box)); c.lineTo(px(sx * box), py(sz * box)); c.lineTo(px(sx * box), py(sz * (box - L)));
      c.stroke();
    }
  }, true);
}

function bolt(k, x, y, z, mat, size = 0.045) {
  k.add(new THREE.CylinderGeometry(size, size, size * 0.7, 6), mat, xf([x, y, z], [0, 0, 0]));
  k.add(new THREE.CylinderGeometry(size * 0.45, size * 0.45, size * 0.5, 8), mat, xf([x, y + size * 0.45, z]));
}

export function buildAssemblyStand(w, hangar, H, M, lite) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.85, roughness: 0.4 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x1a1d21, metalness: 0.8, roughness: 0.48 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b91c, metalness: 0.25, roughness: 0.45 });
  const yellowDark = new THREE.MeshStandardMaterial({ color: 0x8a7010, metalness: 0.3, roughness: 0.5 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 1, roughness: 0.45 });
  const grate = new THREE.MeshStandardMaterial({ color: 0x8a8074, metalness: 0.85, roughness: 0.5, side: THREE.DoubleSide });
  const hyd = M.chromeTrim, dark = M.dark || steelDark, ti = M.titanium || steel;
  applyPBR(plate, 'diamond_plate', [HALF * 2 / 0.6, HALF * 2 / 0.6], { metal: true, normalScale: 0.9 }).then(m => { m.color.set(0xc5c8cc); }).catch(() => {});
  applyPBR(grate, 'metal_grate_rusty', [2.4, 1.4], { metal: true, normalScale: 0.8 }).catch(() => {});

  // ---------- floor markings (static, in the hangar) ----------
  const markTex = floorMarkTex(); markTex.anisotropy = 8;
  const marks = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({
    map: markTex, transparent: true, depthWrite: false, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4,
  }));
  marks.rotation.x = -Math.PI / 2; marks.position.y = 0.012; marks.receiveShadow = true; marks.renderOrder = 1; marks.raycast = () => {};
  hangar.add(marks);

  // ---------- stand (rotates with the rocket): frame, deck, glow, clamps ----------
  const stand = w.stand = new THREE.Group(); stand.position.y = 0; hangar.add(stand);
  const k = new Kit(), Bh = 0.16, foot = 0.34;
  // box-section frame under the deck, cross members, corner feet with anchor bolts
  for (const [x, z, wlen, dlen] of [
    [0, -HALF + Bh / 2, HALF * 2, Bh], [0, HALF - Bh / 2, HALF * 2, Bh],
    [-HALF + Bh / 2, 0, Bh, HALF * 2 - Bh * 2], [HALF - Bh / 2, 0, Bh, HALF * 2 - Bh * 2],
  ]) k.box(wlen, DECK - 0.04, dlen, steel, [x, (DECK - 0.04) / 2, z]);
  k.box(HALF * 2 - 0.4, 0.1, Bh, steelDark, [0, 0.14, 0]);
  k.box(Bh, 0.1, HALF * 2 - 0.4, steelDark, [0, 0.14, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.box(foot, 0.08, foot, steelDark, [sx * (HALF - 0.12), 0.04, sz * (HALF - 0.12)]);
    for (const bx of [-1, 1]) for (const bz of [-1, 1]) bolt(k, sx * (HALF - 0.12) + bx * 0.1, 0.1, sz * (HALF - 0.12) + bz * 0.1, hyd, 0.03);
  }
  // diamond-plate deck + hazard edge lip
  k.box(HALF * 2 - 0.08, 0.05, HALF * 2 - 0.08, plate, [0, DECK - 0.025, 0]);
  const stripe = new THREE.MeshStandardMaterial({ map: chevronTex(), roughness: 0.45, metalness: 0.15 });
  stripe.map.wrapS = stripe.map.wrapT = THREE.RepeatWrapping; stripe.map.repeat.set(10, 1);
  const lip = 0.07;
  k.box(HALF * 2, lip, lip, stripe, [0, DECK - lip / 2, -HALF + lip / 2]);
  k.box(HALF * 2, lip, lip, stripe, [0, DECK - lip / 2, HALF - lip / 2]);
  k.box(lip, lip, HALF * 2 - lip * 2, stripe, [-HALF + lip / 2, DECK - lip / 2, 0]);
  k.box(lip, lip, HALF * 2 - lip * 2, stripe, [HALF - lip / 2, DECK - lip / 2, 0]);
  k.build(stand);

  const glow = w.standGlow = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.02, 6, 64), new THREE.MeshBasicMaterial({ color: 0x7fe7ff }));
  glow.rotation.x = Math.PI / 2; glow.position.y = DECK + 0.012; stand.add(glow);

  // four hydraulic hold-down clamps, one mid-side, sliding in to the rocket radius
  const clamps = [];
  const clawR = (r) => r + 0.14;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const g = new THREE.Group(); g.position.set(c * (HALF - 0.22), DECK, s * (HALF - 0.22)); g.rotation.y = Math.PI / 2 - a; stand.add(g);
    const kk = new Kit();
    kk.box(0.36, 0.22, 0.36, steel, [0, 0.11, 0]);
    kk.add(new THREE.CylinderGeometry(0.08, 0.1, 0.28, 12), steelDark, xf([0, 0.32, 0]));
    kk.build(g);
    const arm = new THREE.Group(); g.add(arm);
    const ak = new Kit();
    ak.add(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 12), steel, xf([0, 0.28, 0], [Math.PI / 2, 0, 0]));
    ak.add(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 10), hyd, xf([0, 0.28, -0.7], [Math.PI / 2, 0, 0]));
    ak.box(0.22, 0.16, 0.18, ti, [0, 0.3, -1.15]);
    ak.box(0.08, 0.28, 0.12, steelDark, [0, 0.22, -1.28]); // jaw
    ak.build(arm);
    arm.raycast = () => {};
    g.traverse(o => { o.castShadow = !lite; o.receiveShadow = true; o.raycast = () => {}; });
    clamps.push({ g, arm, dir: new THREE.Vector2(c, s), home: HALF - 0.22 });
  }

  // ---------- uplights on the floor at the four corners (fixed, not rotating) ----------
  const lights = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lg = new THREE.Group(); lg.position.set(sx * (HALF + 0.45), 0, sz * (HALF + 0.45)); hangar.add(lg);
    const lk = new Kit();
    lk.add(new THREE.CylinderGeometry(0.12, 0.16, 0.08, 16), steelDark, xf([0, 0.04, 0]));
    const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffe2a8, emissiveIntensity: lite ? 1.6 : 2.4, roughness: 0.3 });
    lk.add(new THREE.CylinderGeometry(0.09, 0.1, 0.05, 16), lensMat, xf([0, 0.1, 0]));
    lk.build(lg, !lite);
    lg.traverse(o => { o.raycast = () => {}; });
    if (!lite) {
      const sl = new THREE.SpotLight(0xffe4b8, 7.5, 18, 0.55, 0.45, 1.2);
      sl.position.set(0, 0.16, 0); sl.target.position.set(-sx * 1.4, 8, -sz * 1.4); lg.add(sl, sl.target);
      sl.castShadow = false; lights.push(sl);
    }
  }

  // ---------- side tower (fixed, behind the stand toward the hangar door, -Z) ----------
  const tower = w.workTower = new THREE.Group(); hangar.add(tower);
  const TW = 3.2, TD = 2.0, TZ = -(HALF + 0.12 + TD / 2); // tower centre
  const Tfront = TZ + TD / 2; // hinge line, just behind the stand
  const levels = lite ? [2.7, 6.4] : [2.5, 6.2, 9.8];
  const tk = new Kit();
  const legs = [[-TW / 2, -TD / 2], [TW / 2, -TD / 2], [-TW / 2, TD / 2], [TW / 2, TD / 2]];
  const topY = levels[levels.length - 1] + 1.3;
  for (const [lx, lz] of legs) {
    tk.rod(V(lx, 0.05, TZ + lz), V(lx, topY, TZ + lz), 0.06, yellow, 8);
    tk.add(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10), steelDark, xf([lx, 0.04, TZ + lz]));
  }
  // fixed back/side walkway decks + rails at each level (the "folded" rest)
  for (const y of levels) {
    tk.box(TW, 0.05, TD, grate, [0, y, TZ]);
    tk.box(TW, 0.04, 0.06, yellowDark, [0, y + 0.04, TZ - TD / 2 + 0.03]); // toe board at the back
    // rails on back and sides of the fixed deck
    for (const [x0, z0, x1, z1] of [
      [-TW / 2, TZ - TD / 2, TW / 2, TZ - TD / 2],
      [-TW / 2, TZ - TD / 2, -TW / 2, TZ + TD / 2],
      [TW / 2, TZ - TD / 2, TW / 2, TZ + TD / 2],
    ]) {
      tk.rod(V(x0, y + 1.1, z0), V(x1, y + 1.1, z1), 0.025, yellow, 6);
      tk.rod(V(x0, y + 0.55, z0), V(x1, y + 0.55, z1), 0.02, yellow, 6);
    }
    for (const [lx, lz] of legs) tk.rod(V(lx, y, TZ + lz), V(lx, y + 1.1, TZ + lz), 0.022, yellow, 6);
    // ladder on the back, between this level and the one below (or the floor)
    const y0 = levels[levels.indexOf(y) - 1] ?? 0, ladX = -0.45, ladZ = TZ - TD / 2 - 0.08;
    tk.rod(V(ladX - 0.18, y0 + 0.05, ladZ), V(ladX - 0.18, y + 0.05, ladZ), 0.022, yellow, 6);
    tk.rod(V(ladX + 0.18, y0 + 0.05, ladZ), V(ladX + 0.18, y + 0.05, ladZ), 0.022, yellow, 6);
    const nR = lite ? 5 : 8;
    for (let i = 1; i < nR; i++) { const yy = y0 + (y - y0) * i / nR; tk.rod(V(ladX - 0.18, yy, ladZ), V(ladX + 0.18, yy, ladZ), 0.015, yellowDark, 6); }
  }
  // diagonal braces
  if (!lite) {
    tk.rod(V(-TW / 2, 0.4, TZ - TD / 2), V(TW / 2, levels[0], TZ - TD / 2), 0.022, yellow, 6);
    tk.rod(V(TW / 2, 0.4, TZ + TD / 2), V(-TW / 2, levels[0], TZ + TD / 2), 0.022, yellow, 6);
  }
  tk.build(tower);
  tower.traverse(o => { o.raycast = () => {}; });

  // swinging wings: one left, one right, at each level. t=0 folded back along -Z; t=1 wraps in beside the rocket.
  const wings = [];
  const wingLen = 2.35, wingW = 1.25;
  for (const y of levels) {
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * (TW / 2), y, Tfront);
      tower.add(hinge);
      const wk = new Kit();
      // deck of the wing sits in local +X for side=-1? We'll build the wing in local space along +Z when rotation is 0 (folded, pointing -Z if we rotate later).
      // Local: deck from z=0.05 to z=wingLen, x from 0 to side*wingW (outward when folded? )
      // Folded (rotY=0): local +Z should go toward -world Z (back, along the tower side). Hinge is at Tfront, local +Z = world +Z would go into the stand. So folded rotation.y = PI (point -Z).
      // Deployed: rotate so the wing sweeps inward along the stand's side (world ±X, extending toward +Z around the rocket).
      // For side=+1 (right, +X hinge): folded rotY = Math.PI (wing goes -Z along the right side of the tower).
      // Deployed rotY = Math.PI/2  (wing goes along -X? Wait).
      // rotation.y on a group at (+TW/2, Tfront): local +Z after rotY=π points to world -Z. Good for folded.
      // rotY = π/2: local +Z points to world +X (away from rocket). Wrong.
      // rotY = -π/2 or 3π/2: local +Z points to world -X (toward rocket / along the stand's right side going... hmm).
      // We want the wing, when deployed, to lie along the right side of the rocket, extending in +Z (toward the player) from the tower front.
      // Hinge at (+TW/2, Tfront). A wing in the XZ plane covering x from ~1.6 to 2.8, z from Tfront to Tfront+wingLen (toward +Z / the rocket's side).
      // That's local coordinates if rotY=0 and we build the deck along +Z, x inward (-X for the right hinge).
      // Then: folded should be rotY = +π/2 for the right hinge (local +Z -> world +X, along the tower's front? No that's +X away).
      // Right hinge x=+TW/2≈1.6, z=Tfront≈-2.62.
      // Folded against tower: deck goes back along the right wall, z from Tfront toward Tfront-TD (world -Z), x ≈ +TW/2 + a bit.
      //   local +Z after rotY=π : world -Z. Build deck along local +Z, x small offset outward (+X). Yes, rotY=π folded.
      // Deployed: deck along the rocket's right, z from Tfront toward +Z, x ≈ 1.6 to 2.8 (outward of rocket).
      //   That's local +Z = world +Z, so rotY=0, and deck built along +Z with x from 0 to +wingW (outward).
      // Conflict: same local mesh, folded wants rotY=π and deployed rotY=0. That's a 180° swing through the rocket!
      // Better swing: 90° around the hinge, from -Z (folded along tower side) to +Z? That's 180°.
      // 90° swing: folded along tower SIDE (world -Z), deployed along stand SIDE (world -X for the right hinge, i.e. pointing toward/along the rocket's +X flank but the wing length goes in -X toward the nose of the wing ending near the rocket).
      // If the wing is 2.35m long and hinge is at x=1.6, deploying toward -X would put the tip at x=-0.75, crossing the rocket. Too long inward.
      // So the wing should be along +Z when deployed (beside the rocket), and along -Z when folded (beside the tower). That's 180° around Y, and the swing arc is a horizontal sweep at radius wingLen — the wing would sweep THROUGH the rocket area if it swings inward.
      // To avoid sweeping through the rocket, swing OUTWARD: folded along -Z (back), swing out through +X (away) and around to +Z (deployed beside rocket). That's a 180° outward sweep, never crossing the rocket. Good.
      // Right hinge (side=+1): folded rotY = π (local +Z = world -Z). Deployed rotY = 0 (local +Z = world +Z). The short way from π to 0 could be either direction. We must interpolate through +π/2 (local +Z = world +X, outward), NOT through -π/2 (world -X, through the rocket).
      // So fold t=0 -> rotY = π, t=1 -> rotY = 2π (or 0 via +π/2... from π to 2π goes through 3π/2 which is world -X! Wrong.)
      // From π to 0 decreasing: π -> π/2 -> 0. At π/2, local +Z = world +X. Outward. YES.
      // Left hinge (side=-1): folded rotY = π (local +Z = world -Z, along left wall). Deployed rotY = 0, interpolating through -π? 
      // From π to 0 decreasing goes through π/2 (world +X) which for the left hinge is TOWARD the rocket. Bad.
      // From π to 0 increasing: π -> 3π/2 -> 2π=0. At 3π/2, local +Z = world -X (outward for left). YES.
      // So left: lerp from π to 2π, right: lerp from π to 0 (decreasing).
      const deckZ0 = 0.04, deckZ1 = wingLen;
      const x0 = 0, x1 = side * wingW;
      const midX = (x0 + x1) / 2, midZ = (deckZ0 + deckZ1) / 2, dw = Math.abs(x1 - x0), dl = deckZ1 - deckZ0;
      wk.box(dw, 0.04, dl, grate, [midX, 0.02, midZ]);
      wk.box(dw, 0.03, 0.05, yellowDark, [midX, 0.05, deckZ1 - 0.03]); // outer toe
      wk.box(0.05, 0.03, dl, yellowDark, [x1, 0.05, midZ]);
      // rails on three open sides
      const rail = (ax, az, bx, bz, h = 1.1) => { wk.rod(V(ax, 0, az), V(ax, h, az), 0.02, yellow, 6); wk.rod(V(bx, 0, bz), V(bx, h, bz), 0.02, yellow, 6); wk.rod(V(ax, h, az), V(bx, h, bz), 0.022, yellow, 6); wk.rod(V(ax, 0.5, az), V(bx, 0.5, bz), 0.018, yellow, 6); };
      rail(x0, deckZ1, x1, deckZ1);
      rail(x1, deckZ0, x1, deckZ1);
      rail(x0, deckZ0, x0, deckZ1);
      wk.build(hinge);
      hinge.traverse(o => { o.raycast = () => {}; o.castShadow = !lite; });
      wings.push({ hinge, side, folded: Math.PI, deployed: 0, via: side === 1 ? 'down' : 'up' });
    }
  }

  const noHit = o => o.traverse(c => { c.raycast = () => {}; });
  noHit(stand); noHit(tower); noHit(marks);

  const assembly = w.assembly = {
    deck: DECK, half: HALF, fold: 0, foldTarget: 0, clampR: 1.7, clampTarget: 1.7, lights,
    setFold(t, snap = false) { this.foldTarget = t; if (snap) { this.fold = t; this.applyFold(); } },
    fitClamps(radius) { this.clampTarget = Math.max(0.55, Math.min(HALF - 0.6, radius || 1.7)); },
    openClamps() { this.clampTarget = 1.7; },
    applyFold() {
      for (const wng of wings) {
        const a0 = wng.folded, a1 = wng.via === 'up' ? Math.PI * 2 : 0;
        wng.hinge.rotation.y = a0 + (a1 - a0) * this.fold;
      }
    },
    applyClamps() {
      const reach = clawR(this.clampR); // distance from origin to jaw
      for (const c of clamps) {
        // arm is built with the jaw at local z ≈ -1.28, pedestal at the edge. Move the whole clamp group in or out.
        // g is at dir * (HALF-0.22). We want the jaw (which is ~1.28 inward from g, along -local Z, and local -Z is toward center because rotY = -a+π).
        // g.rotation.y = -a + π. Local -Z after this rotation: let's not overthink — place g so that jaw sits at reach along dir.
        // Jaw world xz ≈ g.xz + inward * 1.28. Inward is -dir. So |g| - 1.28 = reach, |g| = reach + 1.28.
        const dist = reach + 1.28;
        c.g.position.set(c.dir.x * dist, DECK, c.dir.y * dist);
      }
    },
    update(dt) {
      const kF = Math.min(1, dt * 1.8), kC = Math.min(1, dt * 3);
      const f = this.fold, c = this.clampR;
      this.fold += (this.foldTarget - this.fold) * kF;
      this.clampR += (this.clampTarget - this.clampR) * kC;
      if (Math.abs(this.fold - f) > 1e-4) this.applyFold();
      if (Math.abs(this.clampR - c) > 1e-4) this.applyClamps();
    },
  };
  assembly.applyFold(); assembly.applyClamps();
  return assembly;
}
