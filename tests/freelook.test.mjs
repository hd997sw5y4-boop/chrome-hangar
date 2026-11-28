// Orientation math for the 360° coasting look and the vertical-ascent lookAt fix.
// Run: node tests/freelook.test.mjs
import assert from 'assert/strict';
import * as F from '../js/freelook.js';

let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const almost = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const vclose = (a, b, eps = 1e-6) => almost(a.x, b.x, eps) && almost(a.y, b.y, eps) && almost(a.z, b.z, eps);
const finite = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const unit = v => almost(F.len(v), 1, 1e-9);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, F.dot(F.norm(a), F.norm(b)))));

t('fromYawPitch matches the flight.js orbit-camera offset', () => {
  for (const [yaw, pitch] of [[0, 0], [0.6, 0.15], [1.2, -0.4], [-2, 1.2], [Math.PI, 0], [0.3, 1.5]]) {
    const o = F.offsetOf(F.fromYawPitch(yaw, pitch));
    const want = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    assert.ok(vclose(o, want, 1e-9), JSON.stringify({ yaw, pitch, o, want }));
    assert.ok(unit(o) && unit(F.upOf(F.fromYawPitch(yaw, pitch))));
    assert.ok(almost(F.dot(o, F.upOf(F.fromYawPitch(yaw, pitch))), 0, 1e-9));
  }
});

t('input mapping: +dx yaws like yaw -= dx; +dy pitches like pitch -= dy', () => {
  const step = 0.07;
  // at the horizon, a trackball step matches the Euler orbit exactly
  const q0 = F.fromYawPitch(0.6, 0);
  assert.ok(vclose(F.offsetOf(F.applyLook(q0, step, 0)), F.offsetOf(F.fromYawPitch(0.6 - step, 0)), 1e-9));
  assert.ok(vclose(F.offsetOf(F.applyLook(q0, 0, step)), F.offsetOf(F.fromYawPitch(0.6, 0 - step)), 1e-9));
  // off the horizon, the trackball yaws around camera up (not world Y) — same sign as yaw -= dx
  const q1 = F.fromYawPitch(0.6, 0.15);
  const dTrack = F.add(F.offsetOf(F.applyLook(q1, step, 0)), F.offsetOf(q1), -1);
  const dEuler = F.add(F.offsetOf(F.fromYawPitch(0.6 - step, 0.15)), F.offsetOf(q1), -1);
  assert.ok(F.dot(dTrack, dEuler) > 0, 'yaw sign flipped off the horizon');
});

t('360° yaw wraps: a full turn returns to the same offset, quaternion stays unit, no NaN', () => {
  let q = F.fromYawPitch(0.6, 0.15); const o0 = F.offsetOf(q);
  for (let i = 0; i < 360; i++) {
    q = F.applyLook(q, Math.PI / 180, 0);
    assert.ok(finite(F.offsetOf(q)) && finite(F.upOf(q)) && almost(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9), 'at deg ' + i);
  }
  assert.ok(vclose(F.offsetOf(q), o0, 1e-6));
  assert.ok(almost(angle(F.upOf(q), F.upOf(F.fromYawPitch(0.6, 0.15))), 0, 1e-5));
});

t('pitch past ±90° continues smoothly: no NaN, no flip, up stays unit and perpendicular to the offset', () => {
  let q = F.fromYawPitch(0.4, 0);
  let prev = F.offsetOf(q), prevU = F.upOf(q);
  for (let i = 0; i < 400; i++) {   // 400 * 0.02 rad ≈ 8 rad, well past a full over-the-top and back
    q = F.applyLook(q, 0, 0.02);
    const o = F.offsetOf(q), u = F.upOf(q);
    assert.ok(finite(o) && finite(u) && unit(o) && unit(u), 'NaN/unit at step ' + i);
    assert.ok(almost(F.dot(o, u), 0, 1e-8), 'not orthonormal at step ' + i);
    assert.ok(angle(o, prev) < 0.05, 'offset jumped at step ' + i + ' by ' + angle(o, prev));
    assert.ok(angle(u, prevU) < 0.05, 'up flipped at step ' + i + ' by ' + angle(u, prevU));
    prev = o; prevU = u;
  }
  // a downward sweep too
  q = F.fromYawPitch(0, 0); prev = F.offsetOf(q); prevU = F.upOf(q);
  for (let i = 0; i < 200; i++) {
    q = F.applyLook(q, 0, -0.02);
    const o = F.offsetOf(q), u = F.upOf(q);
    assert.ok(finite(o) && finite(u) && unit(o) && unit(u) && almost(F.dot(o, u), 0, 1e-8));
    assert.ok(angle(o, prev) < 0.05 && angle(u, prevU) < 0.05, 'down-sweep jump at ' + i);
    prev = o; prevU = u;
  }
});

t('isCoast: only a flying Free Mode space-leg with the engine off', () => {
  const moon = { on: true, mode: 'space' }, f = { phase: 'flying', e: { on: false } };
  assert.equal(F.isCoast(moon, f), true);
  assert.equal(F.isCoast(moon, { phase: 'flying', e: { on: true } }), false);
  assert.equal(F.isCoast(moon, { phase: 'pad', e: { on: false } }), false);
  assert.equal(F.isCoast({ on: true, mode: 'flatE' }, f), false);
  assert.equal(F.isCoast({ on: false, mode: 'space' }, f), false);
  assert.equal(F.isCoast(null, f), false);
});

t('aimUp at the exact-below / exact-above poles is finite, unit, and not parallel to the view', () => {
  const tgt = F.vec(0, 100, 0);
  for (const eye of [F.vec(0, 0, 0), F.vec(0, 200, 0), F.vec(0, 100, 1e-9), F.vec(0, 99.999, 0)]) {
    const up = F.aimUp(eye, tgt, F.vec(0, 1, 0), F.vec(1, 0, 0), F.vec(1, 0, 0));
    const dir = F.norm(F.add(tgt, eye, -1));
    assert.ok(finite(up) && unit(up), JSON.stringify({ eye, up }));
    assert.ok(Math.abs(F.dot(up, dir)) < 1e-6, 'up parallel to view');
  }
});

t('vertical rocket: camera sits directly below, looks straight up along the heading, no NaN', () => {
  const fwd = F.vec(0, 1, 0), side = F.vec(1, 0, 0);
  const fr = F.chaseFrame(fwd, F.vec(0, 1, 0), null, side);
  const off = F.chaseOffset(fr, 0, 0, 20);
  assert.ok(vclose(F.norm(off), { x: 0, y: -1, z: 0 }, 1e-9), 'not directly below: ' + JSON.stringify(off));
  const eye = off, tgt = F.vec();
  const dir = F.norm(F.add(tgt, eye, -1));
  assert.ok(vclose(dir, { x: 0, y: 1, z: 0 }, 1e-9), 'not looking up');
  const up = F.aimUp(eye, tgt, F.vec(0, 1, 0), side, fr.u);
  assert.ok(finite(up) && unit(up) && Math.abs(F.dot(up, dir)) < 1e-6);
});

t('camera swept through the exact-below position on a vertical rocket: no NaN and no sudden roll jump', () => {
  const tgt = F.vec(0, 0, 0), R = 20, worldUp = F.vec(0, 1, 0), side = F.vec(1, 0, 0);
  // Meridian in the YZ plane: from behind-horizontal (0,0,R) through exact-below (0,-R,0) to in-front (0,0,-R).
  let prevUp = null, prevRight = null, maxRoll = 0, maxStep = 0;
  const deg = 0.25;   // quarter-degree steps, including a sample at exactly -90°
  for (let a = 0; a <= 180; a += deg) {
    const th = -a * Math.PI / 180;          // 0 -> 0, 90 -> -π/2 (exact below)
    const eye = F.vec(0, R * Math.sin(th), R * Math.cos(th));
    const fwd = F.vec(0, 1, 0);             // rocket going straight up
    const fr = F.chaseFrame(fwd, worldUp, prevRight, side);
    const up = F.aimUp(eye, tgt, worldUp, fr.u, prevUp);
    const dir = F.norm(F.add(tgt, eye, -1));
    const right = F.norm(F.cross(dir, up));
    assert.ok(finite(up) && finite(right) && unit(up) && unit(right), 'NaN at ' + a);
    assert.ok(Math.abs(F.dot(up, dir)) < 1e-6, 'up || view at ' + a);
    if (prevUp) {
      const jump = angle(up, prevUp);
      maxRoll = Math.max(maxRoll, jump);
      maxStep = jump > maxStep ? a : maxStep;
      assert.ok(jump < 0.05, 'roll jumped ' + (jump * 180 / Math.PI).toFixed(2) + '° at ' + a + '° (prev step ' + (a - deg) + '°)');
    }
    prevUp = up; prevRight = right;
  }
  console.log(`   max roll step ${(maxRoll * 180 / Math.PI).toFixed(3)}° (at sweep ${maxStep}°)`);
});

t('chaseFrame parallel-transports the right axis through straight-up (no 180° flip)', () => {
  let prev = F.vec(1, 0, 0), prevF = F.vec(0, 0, 1);
  for (let a = 0; a <= 180; a += 1) {
    const th = a * Math.PI / 180;   // heading sweeps from +Z through +Y to -Z
    const fwd = F.vec(0, Math.sin(th), Math.cos(th));
    const fr = F.chaseFrame(fwd, F.vec(0, 1, 0), prev, F.vec(1, 0, 0));
    assert.ok(finite(fr.r) && unit(fr.r) && almost(F.dot(fr.r, fr.f), 0, 1e-8));
    assert.ok(angle(fr.r, prev) < 0.05, 'right flipped at ' + a + ' by ' + (angle(fr.r, prev) * 180 / Math.PI).toFixed(2) + '°');
    prev = fr.r; prevF = fr.f;
  }
});


t('framedOffset: rest pose is directly behind; a vertical sweep over the top has no roll jump', () => {
  const fr = F.chaseFrame(F.vec(0, 1, 0), F.vec(0, 1, 0), null, F.vec(1, 0, 0));
  const rest = F.fromYawPitch(0.6, 0.15);
  const behind = F.framedOffset(fr, rest, 20, rest);
  assert.ok(vclose(F.norm(behind), { x: 0, y: -1, z: 0 }, 1e-9), JSON.stringify(behind));
  let q = rest, prev = F.norm(behind);
  for (let i = 0; i < 200; i++) {
    q = F.applyLook(q, 0, 0.02);
    const o = F.framedOffset(fr, q, 20, rest);
    assert.ok(finite(o) && almost(F.len(o), 20, 1e-6));
    assert.ok(angle(F.norm(o), prev) < 0.05, 'chase offset jumped at step ' + i);
    prev = F.norm(o);
  }
});


t('cockpit head-look: +pitch looks up, +dy lowers the pitch, 360° yaw and over-the-top stay smooth', () => {
  const lookDir = q => F.qrot(q, { x: 0, y: 0, z: -1 });
  const q0 = F.fromHeadYawPitch(0, 0.3);
  assert.ok(lookDir(q0).y > 0.29, 'positive pitch should look up');
  const q1 = F.applyHeadLook(F.fromHeadYawPitch(0, 0.3), 0, 0.1);
  assert.ok(F.toHeadYawPitch(q1).pitch < 0.3 - 0.09, ' +dy should lower pitch, got ' + F.toHeadYawPitch(q1).pitch);
  const q2 = F.applyHeadLook(F.fromHeadYawPitch(0.5, 0), 0.1, 0);
  assert.ok(almost(F.toHeadYawPitch(q2).yaw, 0.4, 1e-6), ' +dx should lower yaw');
  // wrap yaw and go over the top
  let q = F.fromHeadYawPitch(0, -0.14);
  for (let i = 0; i < 360; i++) { q = F.applyHeadLook(q, Math.PI / 180, 0); assert.ok(finite(lookDir(q)) && almost(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9)); }
  assert.ok(vclose(lookDir(q), lookDir(F.fromHeadYawPitch(0, -0.14)), 1e-6));
  let prev = lookDir(F.fromHeadYawPitch(0, 0)); q = F.fromHeadYawPitch(0, 0);
  for (let i = 0; i < 200; i++) {
    q = F.applyHeadLook(q, 0, -0.02);   // look up, over the top
    const d = lookDir(q);
    assert.ok(finite(d) && unit(d) && angle(d, prev) < 0.05, 'head look jumped at ' + i);
    prev = d;
  }
});

console.log(pass + ' checks passed');
