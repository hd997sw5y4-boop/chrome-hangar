// Test stand: clamp the rocket over the flame trench, swap engines, set fuel, static-fire with live numbers.
import * as THREE from 'three';
import { PARTS, PART_IDS, stats, cloneRocket } from './rocket.js';
import { rocketMesh, disposeTree } from './parts3d.js';
import { newStatic, staticStep, DT } from './sim.js';
import { SPOTS } from './env.js';
import { attachFlames, flameSize } from './fx.js';

const $ = id => document.getElementById(id);

export class TestMode {
  constructor(game) {
    this.g = game; this.w = game.world; this.orbit = { yaw: 0.9, pitch: 0.12 }; this.thr = 1;
    $('btnFire').onclick = () => this.toggleFire();
    $('btnTestBack').onclick = () => this.g.travel('build');
    $('btnTestPad').onclick = () => this.g.travel('flight');
    $('tThr').oninput = e => { this.thr = +e.target.value / 100; };
    $('tFill').onclick = e => { const f = +e.target.dataset.f; if (f && !this.s.e.on) { this.g.fill = f; this.g.saveState(); this.reset(); this.g.audio.tap(); } };
    $('engBtns').onclick = e => { const id = e.target.dataset.e; if (id && !this.s.e.on) this.swap(id); };
  }
  enter() {
    this.w.setIndoor(false); this.w.followSun(SPOTS.test);
    this.w.camera.fov = 55; this.w.camera.updateProjectionMatrix();
    this.thr = 1; $('tThr').value = 100;
    this.reset();
    this.g.audio.clamp();
  }
  exit() { this.clear(); this.g.audio.setEngine(0); }
  clear() { if (this.group) { this.group.removeFromParent(); disposeTree(this.group); this.group = null; } }
  reset() {
    this.clear();
    const r = this.g.rocket;
    this.group = rocketMesh(r); this.group.position.copy(SPOTS.test).add(new THREE.Vector3(0, this.w.testTop, 0));
    this.w.scene.add(this.group);
    const eng = PARTS[r.engine];
    const lite = this.w.quality === 'phone' || this.w.quality === 'low';
    this.flame = attachFlames(this.group.userData.engine, eng.color, lite);
    this.s = newStatic(r, this.g.fill); this.acc = 0; this.done = false;
    this.st0 = stats(r, this.g.fill);
    // clamp rings sit at the rocket's tank levels
    this.w.clamps.forEach((c, i) => { c.visible = (i * 5.5 + 1.5) < this.st0.top; });
    $('engBtns').innerHTML = PART_IDS.filter(id => PARTS[id].kind === 'engine').map(id => `<button data-e="${id}" class="${id === r.engine ? 'on' : ''}" ${this.g.partUnlocked(id) ? '' : 'disabled'}>${PARTS[id].name}</button>`).join('');
    $('tFill').innerHTML = [0.25, 0.5, 0.75, 1].map(f => `<button data-f="${f}" class="${f === this.g.fill ? 'on' : ''}">${f * 100}%</button>`).join('');
    this.updateFireBtn();
  }
  swap(id) {
    const r = cloneRocket(this.g.rocket); r.engine = id;
    this.g.build.setRocket(r); this.g.audio.snap(); this.reset();
    this.g.toast(`${PARTS[id].name}: ${PARTS[id].blurb}`, 3000);
  }
  toggleFire() {
    const e = this.s.e;
    if (e.failed) { this.reset(); return; }
    if (this.s.e.cmd > 0) { this.s.e.cmd = 0; } else { this.s.e.cmd = Math.max(this.thr, PARTS[this.g.rocket.engine].minThrottle); this.s.fireT = 0; this.s.thrSum = 0; this.done = false; }
    this.g.audio.tap(); this.updateFireBtn();
  }
  updateFireBtn() {
    const b = $('btnFire'), e = this.s.e;
    b.textContent = e.failed ? 'Reset engine' : e.cmd > 0 ? 'Shut down' : 'Fire';
    b.classList.toggle('go', !(e.cmd > 0));
  }
  update(dt, blocked) {
    const inp = this.g.input, s = this.s, eng = PARTS[this.g.rocket.engine];
    if (!blocked) {
      if (inp.hit('Space') || inp.hit('Pad0')) this.toggleFire();
      if (inp.hit('KeyB') || inp.hit('Pad1')) { this.g.travel('build'); return; }
      const k = c => inp.down(c) ? 1 : 0;
      const d = k('ShiftLeft') + k('ShiftRight') + k('KeyR') - k('KeyF') - k('ControlLeft') - k('ControlRight');
      if (d) { this.thr = THREE.MathUtils.clamp(this.thr + d * 0.6 * dt, 0, 1); $('tThr').value = Math.round(this.thr * 100); }
      if (inp.hit('KeyZ')) { this.thr = 1; $('tThr').value = 100; } if (inp.hit('KeyX')) { s.e.cmd = 0; this.updateFireBtn(); }
      if (inp.padThrottle != null && inp.pad && inp.pad.b[7] > 0.04) { this.thr = inp.pad.b[7]; $('tThr').value = Math.round(this.thr * 100); }
      this.orbit.yaw -= inp.look.x; this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch - inp.look.y, -0.1, 1.2);
    }
    if (s.e.cmd > 0) s.e.cmd = Math.max(this.thr, 0.0001);
    this.acc += dt;
    while (this.acc >= DT) { staticStep(s, DT); this.acc -= DT; }
    for (const ev of s.events.splice(0)) {
      if (ev.type === 'overheat') this.onOverheat();
      if (ev.type === 'dry') { this.g.toast('Out of fuel. Clean shutdown.'); this.g.audio.coolTicks(); this.finish(); }
      if (ev.type === 'cutoff') { this.g.audio.coolTicks(); this.finish(); }
      if (ev.type === 'ignite') this.g.audio.noise(0.4, 600, 0.6, 0.4, 0, 'lowpass', 0.3);
      this.updateFireBtn();
    }
    // readouts
    const thrDisp = s.e.on ? s.e.thr : 0;
    $('tThrust').textContent = (s.thrust / 1000).toFixed(1);
    $('tTemp').textContent = Math.round(s.e.temp).toLocaleString();
    $('tFlow').textContent = s.mdot.toFixed(1);
    $('tBurn').textContent = Math.round(s.burnLeft || 0);
    $('tTime').textContent = s.fireT.toFixed(1);
    $('tThrVal').textContent = Math.round(this.thr * 100) + '%' + (this.thr < eng.minThrottle ? ' (below min, engine off)' : '');
    const hb = $('heatBar'); hb.querySelector('i').style.width = Math.min(100, s.e.heat) + '%';
    hb.querySelector('span').textContent = `Heat ${Math.round(s.e.heat)}%` + (s.e.heat > 60 ? ' · HOT, ease off' : '') + (eng.heat.safeThrottle < 1 ? ` · safe below ${Math.round(eng.heat.safeThrottle * 100)}%` : ' · never overheats');
    // mission 1: five clean seconds
    if (this.g.mission?.type === 'static' && s.e.on && s.fireT >= this.g.mission.goalSeconds && !this.done) { this.done = true; this.g.toast('5 seconds! Shut down when ready.'); this.g.audio.star(0); }
    // visuals
    const t = performance.now() / 1000;
    { const pw = thrDisp * (s.e.spool || 0), fs = flameSize(eng, pw); this.flame.update(t, pw, fs.radius, 3 + 0.75 * (fs.len - 4), 1.225, eng.thrust); }
    const noz = this.group.userData.engine.userData.nozMat; noz.emissiveIntensity = Math.max(0, (s.e.temp - 400) / 900);
    this.g.audio.setEngine(thrDisp * Math.min(1, eng.thrust / 120000 + 0.4), 0.55);
    if (s.e.on) {
      const base = this.group.position, n = this.g.smoke.max / 600;
      for (let i = 0; i < 3 * n * thrDisp; i++) { const a = Math.random() * 2 - 1; this.g.smoke.emit(base.x + a * 2, 1.0, base.z + 3 + Math.random() * 3, a * 6, 2 + Math.random() * 3, 12 + Math.random() * 10, 2 + Math.random() * 2, 3 + Math.random() * 2, 0.6, 1.4); }
    }
    this.g.windNow = { x: 1.5, z: 0.5 };
    // orbit camera with a little rumble
    const c = this.w.camera, tgt = new THREE.Vector3(SPOTS.test.x, this.w.testTop + this.st0.top * 0.5, SPOTS.test.z);
    const R = 16 + this.st0.top * 1.3;
    c.position.set(tgt.x + Math.sin(this.orbit.yaw) * Math.cos(this.orbit.pitch) * R, tgt.y + Math.sin(this.orbit.pitch) * R + 1, tgt.z + Math.cos(this.orbit.yaw) * Math.cos(this.orbit.pitch) * R);
    c.position.y = Math.max(1.6, c.position.y);
    const sh = thrDisp * 0.06 * Math.min(1.5, eng.thrust / 115000);
    c.lookAt(tgt); c.position.x += (Math.random() - 0.5) * sh; c.position.y += (Math.random() - 0.5) * sh;
  }
  onOverheat() {
    const eng = PARTS[this.g.rocket.engine];
    this.g.audio.boom(0.6);
    const p = this.group.position;
    for (let i = 0; i < 60; i++) { const a = i * 2.399; this.g.smoke.emit(p.x + Math.cos(a), p.y + 0.5, p.z + Math.sin(a), Math.cos(a) * 8, 4 + (i % 5), Math.sin(a) * 8, 3, 4, 1, 1.5); }
    this.finish('overheat', eng);
  }
  finish(kind, eng) {
    const s = this.s, m = this.g.mission;
    const avg = s.fireT ? s.thrSum / s.fireT : 0, peak = s.e.peakHeat;
    if (m?.type !== 'static') {
      if (kind === 'overheat') {
        if (m) this.g.showResults({ ok: false, title: 'Engine overheated', reason: `${eng.name} ran above ${Math.round(eng.heat.safeThrottle * 100)}% for too long. The test stand caught it safely.`, hint: overheatHint(eng), stats: this.statRows(avg, peak) });
        else this.g.toast(`${eng.name} overheated. The test stand caught it safely.`);
      }
      return;
    }
    const ok = s.fireT >= m.goalSeconds && kind !== 'overheat';
    if (!ok && kind !== 'overheat' && s.fireT < m.goalSeconds) { this.g.toast(`Only ${s.fireT.toFixed(1)} s. Hold it for ${m.goalSeconds}.`); return; }
    const stars = ok ? [true, avg >= 0.8, peak < 75] : [false, false, false];
    if (ok) this.g.award(m.id, stars);
    this.g.showResults(ok
      ? { ok: true, title: 'Hold the fire: passed', reason: `A clean ${s.fireT.toFixed(1)} s burn.`, hint: !stars[1] ? 'Run the throttle at 80% or more for the whole burn.' : !stars[2] ? 'Keep the heat under 75%: stay below the safe throttle mark.' : '', stars, stats: this.statRows(avg, peak) }
      : { ok: false, title: 'Engine overheated', reason: `${eng.name} got too hot after ${s.fireT.toFixed(1)} s.`, hint: overheatHint(eng), stars, stats: this.statRows(avg, peak) });
  }
  statRows(avg, peak) { const s = this.s; return [['Fire time', s.fireT.toFixed(1) + ' s'], ['Avg throttle', Math.round(avg * 100) + '%'], ['Peak heat', Math.round(peak) + '%'], ['Peak thrust', (PARTS[this.g.rocket.engine].thrust / 1000).toFixed(0) + ' kN'], ['Fuel left', Math.round(s.fuelFrac * 100) + '%'], ['Engine', PARTS[this.g.rocket.engine].name]]; }
}
export function overheatHint(eng) {
  return eng.id === 'thunder' ? 'keep Thunder under 85% throttle, or swap to Ember for a cooler burn.' : `keep ${eng.name} under ${Math.round(eng.heat.safeThrottle * 100)}% throttle, or swap to Spark, which never overheats.`;
}
