// gb3-moon-rocket: the in-flight side of staging and the Moon autopilot, kept out of flight.js (which only calls in from a few
// marked "gb3-moon-rocket" lines). Owns: the STAGE and AUTOPILOT buttons, their keys, the HUD stage / autopilot lines, the
// takeover rule (any player control turns the autopilot off), the mesh / flame / health rebuild after a separation and the
// spent stages falling away (render-only debris: they never touch the sim).
//
// Controls (flight only; nothing here is bound elsewhere in flight):
//   STAGE      Space or DualSense ✕ (Pad0) once off the pad (on the pad they still launch) · STAGE button
//   AUTOPILOT  J · DualSense R3 (Pad11; in the cockpit view R3 recenters the view, use J) · AUTOPILOT button
//   (G is the landing guide, P the health panel, O / U roll and N / Create / touchpad belong to GB5's RCS)
import * as THREE from 'three';
import { Autopilot } from './autopilot.js';
import * as ST from './staging.js';
import { PARTS, stats } from './rocket.js';
import { rocketMesh, disposeTree, setLegFold } from './parts3d.js';
import { attachFlames } from './fx.js';

const $ = id => document.getElementById(id);
export const KEYS = { stage: ['Space', 'Pad0'], autopilot: ['KeyJ', 'Pad11'] };
// player inputs that count as "taking over" (steering and throttle are checked separately)
// (GB5's RCS: N / Create toggle it, I / M / U / O and the touch pad buttons fire it; checked through f.rcs below as well)
const TAKEOVER = ['KeyX', 'Pad10', 'KeyZ', 'KeyH', 'Pad2', 'Period', 'Comma', 'NumpadAdd', 'NumpadSubtract', 'KeyL', 'Pad13', 'KeyK', 'Pad5', 'KeyN', 'Pad8'];
const HELD = ['KeyI', 'KeyM', 'KeyU', 'KeyO'];
const CSS = `#mrBox{position:absolute;left:50%;top:64px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;z-index:6;font:600 13px/1.25 system-ui,sans-serif}
#mrBox .mrLine{background:rgba(8,14,22,.66);color:#dfe9f3;padding:3px 10px;border-radius:8px;letter-spacing:.02em;white-space:nowrap}
#mrBox .mrAp{color:#7fe7ff}#mrBox .mrAp.off{color:#9aa7b4;font-weight:500}
#mrBtns{position:absolute;right:14px;bottom:200px;display:flex;flex-direction:column;gap:8px;z-index:7}
#mrBtns button{min-width:118px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(10,18,28,.78);color:#fff;font:700 13px system-ui,sans-serif;letter-spacing:.06em;cursor:pointer}
#mrBtns button.on{background:#0b6e8a;border-color:#7fe7ff}#mrBtns button.hidden{display:none}`;

export class MoonRocketFlight {
  constructor(fm) {
    this.fm = fm; this.debris = []; this.tmp = new THREE.Vector3();
    this.ap = new Autopilot(this.makeIO());
    if (typeof document === 'undefined' || !$('hud')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const box = document.createElement('div'); box.id = 'mrBox'; box.innerHTML = '<div class="mrLine" id="mrStage"></div><div class="mrLine mrAp off" id="mrAp"></div>';
    const btns = document.createElement('div'); btns.id = 'mrBtns';
    btns.innerHTML = '<button id="btnStage" type="button" title="Drop the spent stage (Space)">STAGE</button><button id="btnAutopilot" type="button" title="Fly to the Moon by itself (J)">AUTOPILOT</button>';
    $('hud').append(box, btns);
    $('btnStage').onclick = () => { this.fm.g.audio.tap(); this.playerStage(); };
    $('btnAutopilot').onclick = () => { this.fm.g.audio.tap(); this.toggle(); };
    // the touch ENGINE ON/OFF and Launch buttons are player controls too
    $('btnEngCut')?.addEventListener('click', () => this.takeover());
  }
  makeIO() {
    const fm = this;
    return {
      get f() { return fm.fm.f; }, get moon() { return fm.fm.moon; },
      throttle: x => { const F = fm.fm; F.thr = x; F.touchThr = null; if (x > 0) F.lastThr = x; },
      steer: (x, z) => { const s = fm.fm.f.steer; s.x = x; s.z = z; },
      assist: on => { const F = fm.fm; F.f.assist = on == null ? F.g.settings.assist : on; },
      point: d => { const m = fm.fm.moon; if (!m) return; if (d) { m.apDir = d; m.point = 'ap'; } else if (m.point === 'ap') { m.point = 'hold'; m.apDir = null; } },
      stage: () => fm.stage(),
      warp: k => { const m = fm.fm.moon; if (!m?.on || m.mode !== 'space') return; let n = 0; while (m.warp.k < k && n++ < 8 && m.warp.up(m.capNow())); while (m.warp.k > k && m.warp.down()); m.uiT = 1; },
      launch: () => fm.fm.launch(),
      note: t => fm.fm.g.toast(t, 2600),
    };
  }
  // flight.js enter(): a fresh flight
  reset() {
    if (this.ap.on) this.ap.disengage('off');
    this.ap = new Autopilot(this.makeIO()); this.clearDebris(); this.cache = {};
    const f = this.fm.f, g = this.fm.group;
    if (g && f && !f.legs) setLegFold(g, 1);   // a lander's legs ride folded on the stack until it is the bottom stage
  }
  clear() { if (this.ap.on) this.ap.disengage('off'); this.clearDebris(); }
  clearDebris() { for (const d of this.debris) { d.m.removeFromParent(); disposeTree(d.m); } this.debris.length = 0; }
  toggle() {
    if (this.ap.on) { this.ap.disengage('off'); return; }
    if (this.fm.ended) return;
    const f = this.fm.f;   // GB5 RCS stays off while the autopilot flies (it steers with the gimbal / pointing); switching it on takes over
    if (f.rcs?.on || f.rcsWant) { f.rcsWant = false; if (f.rcs) f.rcs.on = false; this.fm.g.toast('RCS off for the autopilot', 1600); }
    this.ap.engage();
  }
  takeover() { if (this.ap.on) this.ap.disengage('input'); }
  playerStage() { this.takeover(); if (!this.stage()) this.fm.g.toast(ST.stageCount(this.fm.f.rocket) > 1 ? 'Stage once you are off the pad' : 'No stage left to drop', 1800); }
  stage() { const f = this.fm.f; if (this.fm.ended || !ST.canStage(f)) return false; return !!ST.separate(f); }
  // flight.js update(), inside the input block: keys / buttons. thrBefore = this.thr before the player's throttle input ran.
  input(inp) {
    const f = this.fm.f;
    if (inp.hit('KeyJ') || (inp.hit('Pad11') && !this.fm.cockpit?.on)) { this.toggle(); this.fm.g.audio.tap(); }
    if (f.phase === 'flying' && KEYS.stage.some(k => inp.hit(k))) this.playerStage();
  }
  // flight.js update(), after the player's throttle / steering ran (the autopilot itself runs later in the frame, in update(),
  // and writes fm.thr / f.steer directly, never through inp, so its own commands can never look like player input here)
  checkTakeover(inp, thrBefore) {
    if (!this.ap.on) return;
    const s = inp.steer, moved = Math.hypot(s.x, s.y) > 0.15;
    const q = this.fm.moon?.mode === 'space' && inp.hit('KeyQ');   // Q points the rocket in space (in the cockpit it only recentres the view)
    const r = this.fm.f.rcs, c = r?.cmd || this.fm.f.rcsCmd;   // GB5 RCS from the player: switched on, or any translate / roll command
    const rcs = !!(r?.on || this.fm.f.rcsWant) || !!(c && (c.tx || c.ty || c.tz || c.roll)) || HELD.some(k => inp.down?.(k)) || !!(inp.down?.('Tab') && (inp.steer.x || inp.steer.y)) || !!(inp.pad && inp.pad.b[17] > 0.5);
    if (moved || q || rcs || this.fm.thr !== thrBefore || TAKEOVER.some(k => inp.hit(k))) this.takeover();
  }
  update(dt) { this.fm.mrDt = dt; this.ap.update(dt); }
  // flight.js onEvent: a separation happened (staging.js already swapped f.rocket / mass / engine)
  onStage(ev) {
    const fm = this.fm, f = fm.f, w = fm.w, old = fm.group;
    fm.g.audio.noise(0.35, 500, 0.8, 0.35, 0, 'lowpass', 0.4); fm.g.audio.noise(0.12, 2600, 1.2, 0.12, 0, 'bandpass', 0.2);
    if (!this.ap.on) fm.g.toast(`Stage ${ev.index + 1}: ${f.eng?.name || 'no engine'}`, 1800);
    if (!old) return;
    const lite = w.quality === 'phone' || w.quality === 'low';
    // spent stage: a mesh of the dropped part, starting exactly where it was, falling / drifting away (render only)
    const dm = rocketMesh(ev.dropped.rocket); dm.position.copy(old.position); dm.quaternion.copy(old.quaternion); w.scene.add(dm);
    setLegFold(dm, 1);
    const space = fm.moon?.on && fm.moon.mode === 'space';
    const up = new THREE.Vector3(ev.dropped.up.x, ev.dropped.up.y, ev.dropped.up.z);
    this.debris.push({ m: dm, t: 0, space, off: new THREE.Vector3(), up, vel: new THREE.Vector3(ev.dropped.vel.x, ev.dropped.vel.y, ev.dropped.vel.z), spin: new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3) });
    // the rocket that keeps flying: new mesh at the new origin, new flames, fresh part health for the parts that are left
    const g = rocketMesh(f.rocket); g.position.copy(old.position).addScaledVector(up, ev.cutY ?? 0); g.quaternion.copy(old.quaternion); w.scene.add(g);
    old.removeFromParent(); disposeTree(old);
    fm.group = g; fm.flame = attachFlames(g.userData.engine, f.eng?.color || '#ffb347', lite);
    setLegFold(g, f.legs ? 1 - f.legOut : 1);
    if (fm.padRel) { fm.padRel.rocket = g; fm.padRel.fold = null; }
    fm.st0 = stats(f.rocket, fm.g.fill);
    fm.health.reset(f.rocket, 1); fm.lostSeen = 0; fm.hpUI?.attach?.(fm.health);
    fm.capture(fm.cur); fm.copyPose(fm.prev, fm.cur); fm.copyPose(fm.rs, fm.cur);
    $('mThr')?.querySelector('em')?.style.setProperty('bottom', ((f.eng?.minThrottle || 0) * 100) + '%');
    $('thrTouch')?.querySelector('em')?.style.setProperty('bottom', ((f.eng?.minThrottle || 0) * 100) + '%');
  }
  // every frame from flight.js hud(): readouts, buttons, spent stages
  hud(dt = 1 / 60) {
    const fm = this.fm, f = fm.f; if (!f || typeof document === 'undefined') return;
    const C = this.cache ??= {}, set = (id, v) => { if (C[id] !== v) { C[id] = v; const el = $(id); if (el) el.textContent = v; } };
    const left = ST.stageCount(f.rocket), total = (f.stage || 0) + left;
    if (total > 1) {
      const st = stats(f.rocket, f.fill, f.fuelFrac), ve = (f.eng?.isp || 0) * 9.80665 * 1.1, dv = st.dry > 0 && st.fuel > 0 ? ve * Math.log(st.mass / st.dry) : 0;
      set('mrStage', `Stage ${(f.stage || 0) + 1}/${total} · ${f.eng?.name || '—'} · ${(dv / 1000).toFixed(2)} km/s left in it` + (left > 1 ? ' · Space to stage' : ''));
    } else set('mrStage', '');
    const apTxt = this.ap.on ? `AUTOPILOT · ${this.ap.phase}` : (fm.moon?.on && !fm.ended ? 'Autopilot off · J to fly to the Moon' : '');
    set('mrAp', apTxt);
    const ap = $('mrAp'); if (ap && C.apOn !== this.ap.on) { C.apOn = this.ap.on; ap.classList.toggle('off', !this.ap.on); }
    const sEl = $('mrStage'); if (sEl && C.sv !== (total > 1)) { C.sv = total > 1; sEl.style.display = total > 1 ? '' : 'none'; }
    if (ap && C.av !== !!apTxt) { C.av = !!apTxt; ap.style.display = apTxt ? '' : 'none'; }
    const bs = $('btnStage'), ba = $('btnAutopilot');
    if (bs) { const v = left > 1 && !fm.ended; if (C.bs !== v) { C.bs = v; bs.classList.toggle('hidden', !v); } }
    if (ba) { const v = !!fm.moon?.on && !fm.ended; if (C.ba !== v) { C.ba = v; ba.classList.toggle('hidden', !v); } if (C.bon !== this.ap.on) { C.bon = this.ap.on; ba.classList.toggle('on', this.ap.on); ba.textContent = this.ap.on ? 'AUTOPILOT ON' : 'AUTOPILOT'; } }
    this.stepDebris(dt);
  }
  stepDebris(dt) {
    const g = this.fm.group, space = this.fm.moon?.on && this.fm.moon.mode === 'space';
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      if (d.space || space) {
        // in space the view follows the craft: the spent stage just drifts back from it
        if (g) { d.off.addScaledVector(d.up, -2.5 * dt); d.m.position.copy(g.position).add(d.off); }
      } else { d.vel.y -= 9.81 * dt; d.m.position.addScaledVector(d.vel, dt); }
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.z += d.spin.z * dt;
      if (d.t > 40 || d.m.position.y < -50 || d.space !== space) { d.m.removeFromParent(); disposeTree(d.m); this.debris.splice(i, 1); }
    }
  }
}
