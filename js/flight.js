// Launch: countdown, liftoff, ascent and landing with real-ish physics; chase / pad / onboard cameras;
// hold-upright assist and landing guide; break-apart failures with a "Try this" tip; post-flight stats.
import * as THREE from 'three';
import { PARTS, stats } from './rocket.js';
import { rocketMesh, disposeTree } from './parts3d.js';
import { newFlight, flightStep, airDensity, DT } from './sim.js';
import { SPOTS, IS_TOUCH } from './env.js';
import { Flame } from './fx.js';
import { overheatHint } from './testfire.js';

const $ = id => document.getElementById(id);
const CAMS = ['Chase', 'Pad', 'Onboard'];
const RANGE_TOP = 30000;

export class FlightMode {
  constructor(game) {
    this.g = game; this.w = game.world; this.cam = 0; this.orbit = { yaw: 0.6, pitch: 0.15 };
    $('btnLaunch').onclick = () => this.launch();
    $('btnCam').onclick = () => this.nextCam();
    $('btnAssist').onclick = () => { this.g.settings.assist = !this.g.settings.assist; this.g.applySettingsLight(); };
    $('btnGuide').onclick = () => { this.g.settings.guide = !this.g.settings.guide; this.g.applySettingsLight(); };
    $('btnFlightBack').onclick = () => this.back();
    // touch throttle: absolute slider
    const tt = $('thrTouch'), track = tt.querySelector('.track');
    const setT = e => { const r = track.getBoundingClientRect(); for (const t of e.changedTouches) { this.touchThr = THREE.MathUtils.clamp(1 - (t.clientY - r.top) / r.height, 0, 1); } e.preventDefault(); };
    tt.addEventListener('touchstart', setT, { passive: false }); tt.addEventListener('touchmove', setT, { passive: false });
    const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.guideLine = new THREE.Line(line, new THREE.LineDashedMaterial({ color: 0x7fe7ff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8 }));
    this.guideLine.frustumCulled = false; this.guideLine.visible = false; this.w.scene.add(this.guideLine);
    this.syncButtons();
  }
  syncButtons() {
    const s = this.g.settings;
    $('btnAssist').textContent = 'Hold upright: ' + (s.assist ? 'On' : 'Off'); $('btnAssist').classList.toggle('on', s.assist);
    $('btnGuide').textContent = 'Landing guide: ' + (s.guide ? 'On' : 'Off'); $('btnGuide').classList.toggle('on', s.guide);
    if (this.f) this.f.assist = s.assist;
  }
  nextCam() { this.cam = (this.cam + 1) % 3; $('btnCam').textContent = 'Camera: ' + CAMS[this.cam]; this.g.audio.tap(); }
  enter() {
    this.w.setIndoor(false); this.w.camera.fov = 60; this.w.camera.updateProjectionMatrix();
    const m = this.g.mission;
    this.f = newFlight(this.g.rocket, { fill: this.g.fill, padPos: { x: SPOTS.pad.x, y: 0, z: SPOTS.pad.z }, assist: this.g.settings.assist, wind: m?.wind ?? 2, windDir: 0.6 });
    this.clear();
    this.group = rocketMesh(this.g.rocket); this.w.scene.add(this.group);
    const eng = PARTS[this.g.rocket.engine];
    this.flame = new Flame(eng.color); this.group.userData.engine.add(this.flame.group);
    this.thr = Math.min(1, eng.heat.safeThrottle); this.touchThr = null; this.hotWarned = false; this.countdown = null; this.acc = 0; this.ended = false; this.endT = 0; this.reached = null; this.shake = 0; this.camInit = false; this.armed = false;
    $('btnLaunch').classList.remove('hidden'); $('countdown').classList.add('hidden');
    this.st0 = stats(this.g.rocket, this.g.fill);
    $('mThr').querySelector('em').style.bottom = (eng.minThrottle * 100) + '%';
    $('thrTouch').querySelector('em').style.bottom = (eng.minThrottle * 100) + '%';
    this.syncPose(); this.syncButtons();
    this.g.prompt(IS_TOUCH ? 'Tap <b>Launch</b>. Throttle on the right, steer with the left stick.' : 'Press <b>Space</b> to launch. Shift / R throttle up, F down, WASD steer, C camera.');
  }
  exit() { this.clear(); this.guideLine.visible = false; this.g.prompt(null); $('landGuide').classList.add('hidden'); this.g.audio.setEngine(0); }
  clear() { if (this.group) { this.group.removeFromParent(); disposeTree(this.group); this.group = null; } }
  back() { this.g.audio.tap(); if (this.f.phase === 'flying' && !this.ended) this.endFlight('abort'); else this.g.setMode('build'); }
  launch() {
    if (this.countdown != null || this.f.phase !== 'pad' || this.f.e.on) return;
    this.countdown = 3.999; $('btnLaunch').classList.add('hidden'); this.g.prompt(null); this.g.audio.beep(false); this.lastBeep = 3;
  }

  syncPose() {
    const f = this.f, g = this.group; if (!g) return;
    g.position.set(f.origin.x, f.origin.y, f.origin.z);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.up.x, f.up.y, f.up.z));
    // engine bell swivels with the gimbal (in rocket-local space)
    const piv = g.userData.gimbal;
    if (piv) {
      const td = new THREE.Vector3(f.up.x + f.gimbal.x, f.up.y + f.gimbal.y, f.up.z + f.gimbal.z).normalize().applyQuaternion(g.quaternion.clone().invert());
      piv.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), td), 0.3);
    }
  }

  update(dt, blocked) {
    const inp = this.g.input, f = this.f, eng = f.eng;
    if (!blocked) {
      if (inp.hit('Space') || inp.hit('Pad0')) this.launch();
      if (inp.hit('KeyC') || inp.hit('Pad3')) this.nextCam();
      if (inp.hit('KeyH') || inp.hit('Pad2')) { this.g.settings.assist = !this.g.settings.assist; this.g.applySettingsLight(); this.g.toast('Hold upright ' + (this.g.settings.assist ? 'on' : 'off')); }
      if (inp.hit('KeyG')) { this.g.settings.guide = !this.g.settings.guide; this.g.applySettingsLight(); }
      if (inp.hit('KeyB') || inp.hit('Pad1')) { this.back(); return; }
      // throttle: keys are incremental, R2 / touch slider are absolute
      const k = c => inp.down(c) ? 1 : 0;
      const d = k('ShiftLeft') + k('ShiftRight') + k('KeyR') - k('KeyF');
      if (d) { this.thr = THREE.MathUtils.clamp(this.thr + d * 0.7 * dt, 0, 1); this.touchThr = null; }
      if (inp.hit('KeyZ')) this.thr = 1; if (inp.hit('KeyX')) this.thr = 0;
      if (inp.pad && (inp.pad.b[7] > 0.04 || this.padThrHeld)) { this.thr = inp.pad.b[7]; this.padThrHeld = inp.pad.b[7] > 0.04; }
      if (this.touchThr != null) this.thr = this.touchThr;
      // steering in the camera's frame
      const cam = this.w.camera, fw = new THREE.Vector3(); cam.getWorldDirection(fw); fw.y = 0; fw.normalize();
      const rt = new THREE.Vector3(-fw.z, 0, fw.x);
      f.steer = { x: rt.x * inp.steer.x - fw.x * inp.steer.y, z: rt.z * inp.steer.x - fw.z * inp.steer.y };
      this.orbit.yaw -= inp.look.x; this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch - inp.look.y, -0.3, 1.2);
    }
    // countdown
    if (this.countdown != null) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      $('countdown').classList.remove('hidden'); $('countdown').textContent = n > 0 ? n : 'Ignition';
      if (n < this.lastBeep && n > 0) { this.g.audio.beep(false); this.lastBeep = n; }
      if (this.countdown <= 0) { this.countdown = null; this.g.audio.beep(true); setTimeout(() => $('countdown').classList.add('hidden'), 700); f.e.cmd = Math.max(this.thr, eng.minThrottle); this.armed = true; }
    }
    if (this.armed && !this.ended) f.e.cmd = this.thr;
    // fixed-rate physics
    this.acc += dt;
    while (this.acc >= DT) { flightStep(f, DT); this.acc -= DT; }
    for (const ev of f.events.splice(0)) this.onEvent(ev);
    // mission 2 checkpoint
    const m = this.g.mission;
    if (m?.type === 'altitude' && !this.reached && f.alt >= m.goalAltitude) { this.reached = { fuel: f.fuelFrac }; this.g.toast('Tower cleared: 1,000 m!'); this.g.audio.star(0); this.g.audio.star(1); }
    if (f.alt > RANGE_TOP && !this.ended) this.endFlight('range');
    this.syncPose();
    this.visuals(dt);
    this.hud();
    this.camera(dt);
    if (this.ended) { this.endT += dt; if (this.endT > 2.6 && !this.g.resultsOpen && !this.resultsShown) { this.resultsShown = true; this.g.showResults(this.result); } }
  }
  onEvent(ev) {
    const a = this.g.audio;
    if (ev.type === 'liftoff') a.noise(1.2, 200, 0.5, 0.5, 0, 'lowpass', 0.4);
    if (ev.type === 'ignite') a.noise(0.5, 500, 0.6, 0.5, 0, 'lowpass', 0.3);
    if (ev.type === 'cutoff') a.coolTicks();
    if (ev.type === 'landed') { a.clamp(); a.coolTicks(); this.endFlight('landed'); }
    if (ev.type === 'crash') this.crash(ev.kind);
  }
  crash(kind) {
    const f = this.f;
    if (this.group) {
      const o = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z);
      this.flame.group.visible = false;
      this.g.debris.explode(this.group, new THREE.Vector3(f.vel.x, f.vel.y, f.vel.z), o);
      this.group.removeFromParent(); this.group = null;
      for (let i = 0; i < 120 * (this.g.smoke.max / 1000 + 0.3); i++) { const a = i * 2.399, r = (i % 7) / 7; this.g.smoke.emit(o.x + Math.cos(a) * r, Math.max(1, o.y + (i % 5) - 2), o.z + Math.sin(a) * r, Math.cos(a) * (6 + i % 9), 3 + (i % 6), Math.sin(a) * (6 + i % 9), 4 + (i % 4), 4 + (i % 3), i < 50 ? 1 : 0.2, 1.6); }
      const flash = new THREE.PointLight(0xffa04a, 40000, 400, 1.5); flash.position.copy(o); this.w.scene.add(flash);
      let t = 0; const fade = () => { t += 0.05; flash.intensity = 40000 * Math.max(0, 1 - t); if (t < 1) requestAnimationFrame(fade); else flash.removeFromParent(); }; fade();
      this.shake = 1.5;
    }
    this.g.audio.boom(1); this.g.audio.setEngine(0);
    this.endFlight('crash', kind);
  }
  endFlight(how, kind) {
    if (this.ended) return; this.ended = true; this.endT = 0; this.resultsShown = false;
    const f = this.f, m = this.g.mission, st0 = this.st0;
    f.e.cmd = 0; this.armed = false;
    const fmt = (v, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
    const rows = [['Max altitude', fmt(f.apex) + ' m'], ['Top speed', fmt(f.topSpeed) + ' m/s'], ['Fuel left', Math.round(f.fuelFrac * 100) + '%'],
      ['Landing speed', how === 'landed' || how === 'crash' ? fmt(f.landSpeed, 1) + ' m/s' : '—'], ['Flight time', fmt(f.t, 1) + ' s'], ['Max dynamic pressure', fmt(f.maxQ / 1000, 1) + ' kPa']];
    let ok = false, title = '', reason = '', hint = '', stars = null;
    const fail = failureText(kind, f, st0);
    if (how === 'landed') { title = 'Landed'; reason = `Touched down at ${fmt(f.landSpeed, 1)} m/s, ${fmt(f.landDist || 0, 0)} m from the pad centre.`; ok = true; }
    else if (how === 'crash') { title = fail.title; reason = fail.reason; hint = fail.hint; }
    else if (how === 'range') { title = 'Left the test range'; reason = `Past ${RANGE_TOP / 1000} km. Orbit comes in a later update; this flight counts as a clean climb.`; ok = true; }
    else { title = 'Flight ended'; reason = 'You called it early. Your rocket is still on the stand.'; }
    if (m?.type === 'altitude') {
      const done = !!this.reached;
      stars = [done, done && this.reached.fuel >= 0.4, done && st0.parts <= m.maxParts];
      ok = done; if (done) { title = 'Clear the tower: passed' + (how === 'crash' ? ' (then it crashed)' : ''); if (!hint) hint = !stars[1] ? 'Throttle back once you are moving fast; drag wastes fuel. Aim for 40% left at 1 km.' : !stars[2] ? `Try it with ${m.maxParts} parts or fewer (each fin pair and the legs count). You don't need legs to climb.` : ''; }
      else if (!hint) hint = 'Climb straight up at full throttle; keep Hold upright on.';
      if (done) this.g.award(m.id, stars);
    }
    if (m?.type === 'landing') {
      const landed = how === 'landed' && f.apex >= m.minApex;
      const good = landed && f.landSpeed < m.maxLandingSpeed;
      stars = [good, good && f.landSpeed < 1.5, good && (f.landDist || 99) < 10];
      ok = good;
      if (how === 'landed' && f.apex < m.minApex) { title = 'Too low'; reason = `Climb above ${m.minApex} m before landing (you reached ${fmt(f.apex)} m).`; hint = 'Hold full throttle a few seconds longer before coming back down.'; }
      else if (how === 'landed' && !good) { title = 'Too hard'; reason = `Landed at ${fmt(f.landSpeed, 1)} m/s; it needs to be under ${m.maxLandingSpeed}.`; hint = 'Follow the green descent number and ease the throttle up early. Spark throttles down to 20%, so it can hover.'; }
      else if (good) { title = 'Bring it back: passed'; hint = !stars[1] ? 'Slow to a hover just above the pad, then let it settle under 1.5 m/s.' : !stars[2] ? 'Steer toward the cyan ring on the pad while you descend.' : ''; }
      if (good) this.g.award(m.id, stars);
    }
    this.result = { ok, title, reason, hint, stars, stats: rows, samples: f.samples.length > 2 ? f.samples.slice() : null };
    if (how === 'abort' || how === 'range') this.endT = 2.6;
  }

  visuals(dt) {
    const f = this.f; if (!this.group) { this.g.audio.setEngine(0); return; }
    const eng = f.eng, t = performance.now() / 1000;
    const p = f.e.on ? f.e.thr * f.e.spool : 0, rho = airDensity(f.origin.y);
    this.flame.update(t, p, eng.radius * 0.95, 3 + 10 * p * eng.thrust / 115000, rho);
    this.group.userData.engine.userData.nozMat.emissiveIntensity = Math.max(0, (f.e.temp - 400) / 900);
    const cam = this.w.camera, dist = cam.position.distanceTo(this.group.position);
    const near = THREE.MathUtils.clamp(1 - dist / 2500, 0.05, 1);
    this.g.audio.setEngine(p * Math.min(1, eng.thrust / 120000 + 0.4), near);
    // smoke: billowing at the pad, a thin trail higher up
    this.g.windNow = f.windNow;
    if (p > 0) {
      const n = this.g.smoke.max / 1000;
      const up = new THREE.Vector3(f.up.x, f.up.y, f.up.z), noz = new THREE.Vector3(f.origin.x, f.origin.y, f.origin.z);
      const h = noz.y;
      if (h < 45) {
        const k = (1 - h / 45) * p;
        for (let i = 0; i < 8 * n * k + 0.5; i++) { const a = Math.random() * 6.283, s = 14 + Math.random() * 18; this.g.smoke.emit(noz.x + Math.cos(a) * 2, 0.8, noz.z + Math.sin(a) * 2, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 3 + Math.random() * 3, 5 + Math.random() * 4, 0.7, 1.6); }
      }
      if (h < 6000) for (let i = 0; i < 2 * n * p + 0.3; i++) { const j = () => (Math.random() - 0.5) * 1.5; this.g.smoke.emit(noz.x - up.x * 3 + j(), noz.y - up.y * 3 + j(), noz.z - up.z * 3 + j(), f.vel.x * 0.2 - up.x * 25, f.vel.y * 0.2 - up.y * 25, f.vel.z * 0.2 - up.z * 25, 1.4 + Math.random(), 2.5 + Math.random() * 2, 0.5, 1.2); }
    }
    this.shake = Math.max(this.shake * Math.exp(-dt * 2), p * near * Math.min(1.4, eng.thrust / 100000) * (f.alt < 80 ? 1 : 0.35) * 0.25);
  }
  hud() {
    const f = this.f, fmt = v => Math.round(v).toLocaleString();
    $('fAlt').textContent = fmt(f.alt); $('fVs').textContent = f.vs.toFixed(1); $('fSpd').textContent = fmt(f.speed);
    $('fTilt').textContent = fmt(f.tilt); $('fWind').textContent = Math.hypot(f.windNow.x, f.windNow.z).toFixed(1);
    $('mThr').querySelector('i').style.height = (this.thr * 100) + '%';
    $('thrTouch').querySelector('i').style.height = (this.thr * 100) + '%';
    $('mFuel').querySelector('i').style.height = (f.fuelFrac * 100) + '%';
    $('mHeat').querySelector('i').style.height = Math.min(100, f.e.heat) + '%';
    if (f.e.heat > 55 && !this.hotWarned) { this.hotWarned = true; this.g.toast(`Engine hot: ease ${f.eng.name} below ${Math.round(f.eng.heat.safeThrottle * 100)}%`, 3000); this.g.audio.bad(); }
    // landing guide: line to the pad, a target descent speed, and a coloured number with a word
    const show = this.g.settings.guide && f.phase === 'flying' && f.vs < -0.5 && f.alt < 3000;
    $('landGuide').classList.toggle('hidden', !show);
    this.guideLine.visible = show;
    if (show) {
      const target = Math.max(1.5, Math.min(60, 1.5 + f.alt * 0.12));
      const v = -f.vs, el = $('lgSpeed'), r = v / target;
      el.textContent = v.toFixed(1); $('lgTarget').textContent = target.toFixed(1);
      const [cls, word] = r < 1.15 ? ['good', 'Good'] : r < 1.6 ? ['warn', 'Fast'] : ['badc', 'Too fast'];
      el.className = cls; $('lgWord').textContent = word; $('lgWord').className = cls;
      const pos = this.guideLine.geometry.attributes.position;
      pos.setXYZ(0, f.origin.x, f.origin.y, f.origin.z); pos.setXYZ(1, SPOTS.pad.x, 0.2, SPOTS.pad.z); pos.needsUpdate = true;
      this.guideLine.computeLineDistances();
    }
  }
  camera(dt) {
    const f = this.f, c = this.w.camera;
    const tgt = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z), L = this.st0.length;
    if (this.cam === 0) {
      const R = 14 + L * 1.7;
      const want = tgt.clone().add(new THREE.Vector3(Math.sin(this.orbit.yaw) * Math.cos(this.orbit.pitch) * R, Math.sin(this.orbit.pitch) * R, Math.cos(this.orbit.yaw) * Math.cos(this.orbit.pitch) * R));
      want.y = Math.max(1.5, want.y);
      if (!this.camInit) { c.position.copy(want); this.camInit = true; }
      c.position.lerp(want, 1 - Math.exp(-dt * 6));
      c.position.add(new THREE.Vector3(f.vel.x, f.vel.y, f.vel.z).multiplyScalar(dt * Math.exp(-dt * 6)));
      c.fov = 60; c.lookAt(tgt);
    } else if (this.cam === 1) {
      c.position.set(SPOTS.pad.x + 70, 1.8, SPOTS.pad.z + 55);
      const d = c.position.distanceTo(tgt); c.fov = THREE.MathUtils.clamp(2 * Math.atan((L * 2.5) / d) * 180 / Math.PI, 2, 55);
      c.lookAt(tgt);
    } else {
      const up = new THREE.Vector3(f.up.x, f.up.y, f.up.z), side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize();
      c.position.set(f.origin.x, f.origin.y, f.origin.z).addScaledVector(up, this.st0.top - 0.6).addScaledVector(side, 1.05);
      c.fov = 75; c.lookAt(c.position.clone().addScaledVector(up, -10).addScaledVector(side, 1.5));
    }
    c.near = Math.max(0.1, Math.min(5, f.alt / 400)); c.updateProjectionMatrix();
    if (this.shake > 0.001) { const s = this.shake; c.position.x += (Math.random() - 0.5) * s; c.position.y += (Math.random() - 0.5) * s; c.rotation.z += (Math.random() - 0.5) * s * 0.01; }
    this.w.followSun(new THREE.Vector3(f.pos.x, Math.min(f.pos.y, 2000), f.pos.z));
  }
}

function failureText(kind, f, st) {
  const eng = f.eng, fmt = v => Math.round(v).toLocaleString();
  switch (kind) {
    case 'tooHeavy': return { title: 'Too heavy', reason: `Thrust-to-weight is ${(st.twr).toFixed(2)}; it has to be above 1.0 to leave the pad.`, hint: 'swap to a stronger engine, use a shorter tank, or lower the fuel fill.' };
    case 'overheat': return { title: 'Engine overheated', reason: `${eng.name} ran above ${Math.round(eng.heat.safeThrottle * 100)}% too long and failed at ${fmt(f.alt)} m.`, hint: overheatHint(eng) };
    case 'flipped': return { title: 'Center of mass too low', reason: 'The drag ring sat above the mass gem, so the rocket flipped.', hint: 'add a fin pair to the lowest tank (or two) and keep Hold upright on.' };
    case 'breakup': return { title: 'Tipped at speed', reason: `It turned sideways at ${fmt(f.speed)} m/s and the air tore it apart.`, hint: 'steer gently while you are fast, and keep Hold upright on.' };
    case 'wind': return { title: 'Tipped in the wind', reason: 'The wind pushed it over while it was still slow.', hint: 'turn Hold upright on, or add fins so it points into the wind.' };
    case 'noLegs': return { title: 'No legs', reason: 'It touched down gently, but with nothing to stand on it toppled.', hint: 'add Landing Legs to the lowest tank.' };
    case 'tippedLanding': return { title: 'Landed leaning', reason: `Touched down tilted ${fmt(f.tilt)}° and fell over.`, hint: 'level out before touchdown; let Hold upright straighten it in the last 50 m.' };
    case 'outOfFuel': return { title: 'Out of fuel', reason: `The tanks ran dry and it fell from ${fmt(f.apex)} m.`, hint: 'start back down sooner, lower the throttle, or add a tank.' };
    case 'cantThrottle': return { title: 'Hard landing', reason: `Hit at ${f.landSpeed.toFixed(1)} m/s. ${eng.name} can't throttle below ${Math.round(eng.minThrottle * 100)}%, so it can't hover.`, hint: 'swap to Spark for landing missions; it throttles down to 20%.' };
    default: return { title: 'Hard landing', reason: `Hit the ground at ${f.landSpeed.toFixed(1)} m/s.`, hint: 'start the landing burn higher and follow the green descent number.' };
  }
}
