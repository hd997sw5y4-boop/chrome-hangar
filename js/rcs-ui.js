// GB5-RCS / GB5-AERO / GB5-HEAT: flight-side UI for the RCS thrusters and re-entry heating.
// HUD rows (RCS on/off + monoprop %, hull °C, terminal velocity), keyboard / DualSense / touch controls, a heat glow on the
// rocket's leading end, the visual roll angle, heat damage on the parts, and heating during the Moon space leg.
// Publishes window.CH.rcs / CH.hull (game.rcs / game.hull) for the cockpit, the same way CH.engine works.
import * as THREE from 'three';
import { airDensity, failFlight } from './sim.js';
import { heatStep, heatDamage } from './heat.js';

const $ = id => document.getElementById(id);
const CSS = `
#fStats .gb5row i{font-size:11px}
#rcsPad{position:fixed;right:calc(14px + var(--sr, 0px));bottom:292px;display:none;flex-direction:column;gap:6px;z-index:6}
body.touch #rcsPad{display:flex}
#rcsPad button{min-width:64px;height:40px;border-radius:12px;border:1px solid var(--line);background:var(--glass);color:#fff;font:600 13px system-ui;touch-action:none}
#rcsPad button.on{background:#1f6b3f}
#rcsPad .rcsSub{display:none;gap:6px;flex-wrap:wrap;width:136px}
#rcsPad.live .rcsSub{display:flex}
#rcsPad .rcsSub button{min-width:64px}
`;

export class Gb5Flight {
  constructor(game, fm) {
    this.g = game; this.fm = fm; this.H = {}; this.touch = { ty: 0, roll: 0, move: false };
    this.rollQ = new THREE.Quaternion(); this.yAxis = new THREE.Vector3(0, 1, 0);
    this.fw = new THREE.Vector3(); this.rt = new THREE.Vector3();
    if (typeof document === 'undefined') return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const fs = $('fStats');
    if (fs) fs.insertAdjacentHTML('beforeend',
      '<div class="gb5row"><label>RCS</label><b id="fRcs">OFF</b><i id="fRcsPct">100%</i></div>' +
      '<div class="gb5row"><label>Hull</label><b id="fHull">15</b><i>°C</i></div>' +
      '<div class="gb5row"><label>V term</label><b id="fVt">—</b><i>m/s</i></div>');
    const ui = $('flightUI') || document.body;
    ui.insertAdjacentHTML('beforeend', `<div id="rcsPad"><button id="rcsTgl" type="button">RCS</button><div class="rcsSub">
      <button data-h="ty:1" type="button">▲ UP</button><button data-h="ty:-1" type="button">▼ DN</button>
      <button data-h="roll:-1" type="button">⟲ ROLL</button><button data-h="roll:1" type="button">ROLL ⟳</button>
      <button id="rcsMove" type="button">STICK: TURN</button></div></div>`);
    $('rcsTgl').onclick = () => this.toggle();
    $('rcsMove').onclick = () => { this.touch.move = !this.touch.move; $('rcsMove').textContent = this.touch.move ? 'STICK: MOVE' : 'STICK: TURN'; $('rcsMove').classList.toggle('on', this.touch.move); };
    for (const b of document.querySelectorAll('#rcsPad [data-h]')) {
      const [k, v] = b.dataset.h.split(':');
      const on = e => { e.preventDefault(); this.touch[k] = +v; b.classList.add('on'); }, off = e => { e.preventDefault(); this.touch[k] = 0; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
      b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
    }
  }
  toggle() {
    const f = this.fm.f; if (!f) return;
    f.rcsWant = !(f.rcs ? f.rcs.on : f.rcsWant);
    if (f.rcs) f.rcs.on = f.rcsWant;
    this.g.toast?.(f.rcsWant ? (f.rcs && f.rcs.prop <= 0 ? 'RCS on: monoprop empty' : 'RCS on') : 'RCS off', 1400);
    this.g.audio?.tap?.();
  }
  // called first thing inside FlightMode.update's !blocked branch (before steering is shaped)
  input(inp, dt) {
    const f = this.fm.f; if (!f) return;
    if (f.rcs && f.rcsWant != null && f.rcs.on !== f.rcsWant) f.rcs.on = f.rcsWant;   // a toggle before the first sim step
    if (inp.hit('KeyN') || inp.hit('Pad8')) this.toggle();
    const on = f.rcs ? f.rcs.on : !!f.rcsWant;
    let tx = 0, tz = 0, ty = 0, roll = 0;
    if (on) {
      const k = c => (inp.down(c) ? 1 : 0), pad = inp.pad, padMode = !!(pad && pad.b[17] > 0.5);
      let mx = 0, my = 0;
      if (inp.down('Tab')) { mx += inp.steer.x; my += inp.steer.y; inp.steer.x = inp.steer.y = 0; }   // Tab held: WASD translate
      ty += k('KeyI') - k('KeyM'); roll += k('KeyO') - k('KeyU');
      if (padMode) {   // DualSense touchpad held: left stick translates, D-pad up/down = up/down, left/right = roll
        mx += pad.L.x; my += pad.L.y; inp.steer.x = inp.steer.y = 0;
        ty += (pad.b[12] > 0.5) - (pad.b[13] > 0.5); roll += (pad.b[15] > 0.5) - (pad.b[14] > 0.5);
        for (const c of ['Pad12', 'Pad13', 'Pad14', 'Pad15']) inp.pressed.delete(c);
      }
      if (this.touch.move) { mx += inp.touchMove.x; my += inp.touchMove.y; inp.steer.x = inp.steer.y = 0; }
      ty += this.touch.ty; roll += this.touch.roll;
      if (mx || my) {   // camera-relative, same frame as the steering
        const fw = this.fw, rt = this.rt;
        if (!this.fm.cockpit?.steerAxes(fw, rt)) { this.fm.w.camera.getWorldDirection(fw); fw.y = 0; fw.normalize(); rt.set(-fw.z, 0, fw.x); }
        tx = rt.x * mx - fw.x * my; tz = rt.z * mx - fw.z * my;
      }
    }
    const c = { roll: Math.max(-1, Math.min(1, roll)), tx: Math.max(-1, Math.min(1, tx)), ty: Math.max(-1, Math.min(1, ty)), tz: Math.max(-1, Math.min(1, tz)) };
    if (f.rcs) f.rcs.cmd = c; else f.rcsCmd = c;
  }
  // called after FlightMode.hud() every frame
  frame(dt) {
    const fm = this.fm, f = fm.f; if (!f) return;
    const r = f.rcs;
    if (r && f.rcsWant != null && r.on !== f.rcsWant) r.on = f.rcsWant;
    if (r && f.rcsCmd) { r.cmd = f.rcsCmd; f.rcsCmd = null; }
    // fins snapped off by the health model stop producing aero
    const H = fm.health;
    if (H && H.lost.length !== this.lostN) { this.lostN = H.lost.length; f.finLost = new Set(H.parts.filter(p => p.kind === 'fins' && p.lost).map(p => p.i)); }
    // Moon space leg (orbit.js owns the state there, so flightStep and its heat do not run): heat from the same model
    const mo = fm.moon;
    if (mo?.on && mo.mode === 'space' && f.phase === 'flying' && (!mo.s || mo.s.body === 'E')) heatStep(f, airDensity(f.alt), f.speed, Math.min(dt * (mo.warp?.k || 1), 2), failFlight);
    // parts above the damage line wear through the health model
    if (H && f.hull) heatDamage(H, f, dt);
    // publish for the cockpit (window.CH.rcs / CH.hull)
    const hl = f.hull;
    this.g.rcs = r ? { on: r.on, pct: (100 * r.prop) / r.cap, firing: r.active, prop: r.prop, cap: r.cap, roll: r.roll } : { on: !!f.rcsWant, pct: 100, firing: false };
    this.g.hull = { c: (hl ? hl.T : 288.15) - 273.15, level: hl?.level || 0, dmg: hl?.dmg || 0, flux: hl?.flux || 0 };
    // HUD (DOM only when the text changes)
    const txt = (id, v, cls) => { const C = this.H; if (C[id] !== v) { C[id] = v; const el = $(id); if (el) el.textContent = v; } if (cls !== undefined && C[id + 'c'] !== cls) { C[id + 'c'] = cls; const el = $(id); if (el) el.className = cls; } };
    const rp = this.g.rcs;
    txt('fRcs', rp.on ? (rp.pct <= 0 ? 'EMPTY' : 'ON') : 'OFF', rp.on ? (rp.pct <= 0 ? 'dry' : 'on') : 'off');
    txt('fRcsPct', Math.round(rp.pct) + '%');
    txt('fHull', String(Math.round(this.g.hull.c)), this.g.hull.level > 0.5 ? 'dry' : this.g.hull.level > 0 ? 'off' : '');
    const vt = f.vterm, inAir = f.phase === 'flying' && isFinite(vt) && vt < 1e5;
    txt('fVt', inAir ? String(Math.round(vt)) : '—');
    if (hl && hl.level > 0 && !this.hotToast) { this.hotToast = true; this.g.toast?.('Hull overheating: slow down or climb out of the thick air', 3000); }
    if (!(hl?.level > 0)) this.hotToast = false;
    if (r && r.on && r.prop <= 0 && !this.dryToast) { this.dryToast = true; this.g.toast?.('RCS monoprop empty', 2000); }
    // visual roll (the rigid-body sim has no roll axis) and the heat glow
    const g = fm.group; if (!g) return;
    if (r && r.roll) g.quaternion.multiply(this.rollQ.setFromAxisAngle(this.yAxis, r.roll));
    this.glow(g, f, hl);
  }
  glow(g, f, hl) {
    if (this.glowParent !== g) {
      this.glowParent = g;
      if (!this.glowMesh) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        this.glowMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat); this.glowMesh.renderOrder = 5; this.glowMesh.frustumCulled = false;
      }
      g.add(this.glowMesh);
    }
    const m = this.glowMesh, flux = hl?.flux || 0;
    const k = flux > 2e4 ? Math.min(1, Math.log10(flux / 2e4) / 2) : 0;   // 20 kW/m^2 faint .. 2 MW/m^2 full plasma
    const lvl = Math.max(k, Math.min(1, ((hl?.T || 0) - 900) / 900) * 0.6);
    m.visible = lvl > 0.01 && f.phase === 'flying';
    if (!m.visible) return;
    const noseFirst = (f.vel.x * f.up.x + f.vel.y * f.up.y + f.vel.z * f.up.z) >= 0, st = f.st;
    const s = 1.05 + 0.5 * lvl;
    m.scale.set(s, s * (1 + 1.8 * lvl), s);
    m.position.set(0, noseFirst ? st.top - 0.4 + 0.6 * lvl : st.bottom + 0.4 - 0.6 * lvl, 0);
    m.material.opacity = 0.15 + 0.6 * lvl;
    m.material.color.setRGB(1, 0.35 + 0.55 * lvl, 0.12 + 0.75 * lvl * lvl);
  }
}
