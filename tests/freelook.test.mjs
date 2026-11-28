// Vertical chase-cam aiming: sit behind and below a rocket going straight up, look along the
// heading, and sweep through that pose with no NaN, no flip, and no roll jump.
// Run: node tests/freelook.test.mjs
import assert from 'assert/strict';
import * as F from '../js/freelook.js';

let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const almost = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const vclose = (a, b, eps = 1e-6) => almost(a.x, b.x, eps) && almost(a.y, b.y, eps) && almost(a.z, b.z, eps);
const finite = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const unit = v => almost(F.len(v), 1, 1e-9);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, F.dot(F.norm(a), F.norm(b)))));

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
  const tgt = F.vec(), R = 20, worldUp = F.vec(0, 1, 0), side = F.vec(1, 0, 0);
  // Meridian in the YZ plane: from behind-horizontal (0,0,R) through exact-below (0,-R,0) to in-front (0,0,-R).
  let prevUp = null, prevRight = null, maxRoll = 0, maxStep = 0;
  const deg = 0.25;
  for (let a = 0; a <= 180; a += deg) {
    const th = -a * Math.PI / 180;
    const eye = F.vec(0, R * Math.sin(th), R * Math.cos(th));
    const fr = F.chaseFrame(F.vec(0, 1, 0), worldUp, prevRight, side);
    const up = F.aimUp(eye, tgt, worldUp, fr.u, prevUp);
    const dir = F.norm(F.add(tgt, eye, -1));
    const right = F.norm(F.cross(dir, up));
    assert.ok(finite(up) && finite(right) && unit(up) && unit(right), 'NaN at ' + a);
    assert.ok(Math.abs(F.dot(up, dir)) < 1e-6, 'up || view at ' + a);
    if (prevUp) {
      const jump = angle(up, prevUp);
      maxRoll = Math.max(maxRoll, jump);
      if (jump >= maxRoll) maxStep = a;
      assert.ok(jump < 0.05, 'roll jumped ' + (jump * 180 / Math.PI).toFixed(2) + '° at ' + a + '°');
    }
    prevUp = up; prevRight = right;
  }
  console.log(`   max roll step ${(maxRoll * 180 / Math.PI).toFixed(3)}° (at sweep ${maxStep}°)`);
});

t('chaseFrame parallel-transports the right axis through straight-up (no 180° flip)', () => {
  let prev = F.vec(1, 0, 0);
  for (let a = 0; a <= 180; a += 1) {
    const th = a * Math.PI / 180;
    const fwd = F.vec(0, Math.sin(th), Math.cos(th));
    const fr = F.chaseFrame(fwd, F.vec(0, 1, 0), prev, F.vec(1, 0, 0));
    assert.ok(finite(fr.r) && unit(fr.r) && almost(F.dot(fr.r, fr.f), 0, 1e-8));
    assert.ok(angle(fr.r, prev) < 0.05, 'right flipped at ' + a + ' by ' + (angle(fr.r, prev) * 180 / Math.PI).toFixed(2) + '°');
    prev = fr.r;
  }
});

console.log(pass + ' checks passed');
