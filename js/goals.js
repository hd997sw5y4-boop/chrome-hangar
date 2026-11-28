// Per-launch goals for Free Mode flights: one goal at a time, shown on a small card before launch (N / D-pad down / tap to switch),
// tracked in a compact HUD pill during flight, and scored at the end so the results screen can turn them into stars.
// All checks are plain numbers from the sim (apex, downrange, landing distance) plus one cheap ring: a single torus mesh that is
// built once, added to the scene at enter() and only toggled visible, so it never triggers a shader compile in flight.
import * as THREE from 'three';
import { SPOTS } from './env.js';

const KEY = 'ch_goal_idx';
const RING = { h: 120, dx: 14, dz: -11, r: 9 };   // a hoop 120 m up, ~18 m off the pad centre, 9 m radius: needs a little steering
export const GOALS = [
  { id: 'alt150', kind: 'alt', target: 150, text: 'Climb to 150 m', bonus: 'Reach 250 m', bonusTarget: 250 },
  { id: 'ring', kind: 'ring', text: 'Fly up through the cyan ring', bonus: 'Pass through its centre' },
  { id: 'land', kind: 'land', minApex: 60, text: 'Climb above 60 m, then land on the pad', bonus: 'Land within 6 m of the pad centre' },
  { id: 'down120', kind: 'down', target: 120, text: 'Fly 120 m downrange', bonus: 'Reach 200 m downrange', bonusTarget: 200 },
  { id: 'alt500', kind: 'alt', target: 500, text: 'Climb to 500 m', bonus: 'Reach 800 m', bonusTarget: 800 },
];
const num = v => Math.round(v).toLocaleString();

export class Goals {
  constructor(game) {
    this.g = game; this.on = false; this.idx = 0; this.hudT = 0; this.hudTxt = ''; this.state = {};
    const ui = document.getElementById('flightUI');
    this.card = document.createElement('div'); this.card.id = 'goalCard'; this.card.className = 'hidden';
    this.card.innerHTML = '<label>Goal for this launch</label><b></b><small></small><button type="button">Next goal <kbd>N</kbd></button>';
    this.hud = document.createElement('div'); this.hud.id = 'goalHud'; this.hud.className = 'hidden';
    ui.append(this.card, this.hud);
    this.cText = this.card.querySelector('b'); this.cBonus = this.card.querySelector('small');
    this.card.querySelector('button').onclick = () => { this.g.audio.tap(); this.cycle(); };
    // the ring: one mesh, unlit, hidden unless the goal needs it
    const geo = new THREE.TorusGeometry(RING.r, 0.4, 8, 40); geo.rotateX(Math.PI / 2);
    this.ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3.0) }));
    this.ring.position.set(SPOTS.pad.x + RING.dx, RING.h, SPOTS.pad.z + RING.dz); this.ring.visible = false; this.ring.frustumCulled = false; this.ring.userData.noAO = true;
    game.world.scene.add(this.ring);
  }
  get goal() { return GOALS[this.idx]; }
  enter(f, active) {
    this.on = !!active; this.f = f; this.state = { done: false, ringHit: 0, prevY: f.pos.y, announced: false };
    if (!this.on) { this.exit(); return; }
    let i = 0; try { i = parseInt(localStorage.getItem(KEY), 10) || 0; } catch (_) {}
    this.idx = ((i % GOALS.length) + GOALS.length) % GOALS.length;
    this.hud.classList.add('hidden'); this.hudTxt = ''; this.showGoal(); this.card.classList.remove('hidden');
  }
  exit() { this.on = false; this.card.classList.add('hidden'); this.hud.classList.add('hidden'); this.ring.visible = false; }
  showGoal() {
    const G = this.goal; this.cText.textContent = G.text; this.cBonus.textContent = '★ Bonus: ' + G.bonus;
    this.ring.visible = G.kind === 'ring'; this.state.done = false; this.state.ringHit = 0;
  }
  cycle() { if (!this.on) return; this.idx = (this.idx + 1) % GOALS.length; this.save(); this.showGoal(); }
  save() { try { localStorage.setItem(KEY, String(this.idx)); } catch (_) {} }
  onLaunch() { if (!this.on) return; this.card.classList.add('hidden'); this.hud.classList.remove('hidden'); this.hudTxt = ''; this.hudT = 1; }
  // once per sim step while flying: ring crossings need the step-by-step path (a fast rocket crosses 120 m between two frames)
  step(f) {
    if (!this.on) return; const S = this.state, y = f.pos.y;
    if (this.goal.kind === 'ring' && !S.ringHit && S.prevY < RING.h && y >= RING.h && f.phase === 'flying') {
      const k = (RING.h - S.prevY) / Math.max(1e-6, y - S.prevY), prev = S.px ?? f.pos.x, prevZ = S.pz ?? f.pos.z;
      const x = prev + (f.pos.x - prev) * k - (SPOTS.pad.x + RING.dx), z = prevZ + (f.pos.z - prevZ) * k - (SPOTS.pad.z + RING.dz), d = Math.hypot(x, z);
      S.ringHit = d <= RING.r ? (d <= RING.r * 0.45 ? 2 : 1) : -1; S.ringD = d;
    }
    S.prevY = y; S.px = f.pos.x; S.pz = f.pos.z;
  }
  progress(f) {
    const G = this.goal, S = this.state;
    switch (G.kind) {
      case 'alt': return { done: f.apex >= G.target, bonus: f.apex >= G.bonusTarget, txt: `${num(Math.min(f.apex, G.target))} / ${G.target} m` };
      case 'down': return { done: f.downrange >= G.target, bonus: f.downrange >= G.bonusTarget, txt: `${num(Math.min(f.downrange, G.target))} / ${G.target} m` };
      case 'ring': return { done: S.ringHit > 0, bonus: S.ringHit === 2, txt: S.ringHit > 0 ? 'through!' : S.ringHit < 0 ? `missed by ${num(S.ringD - RING.r)} m` : `${num(Math.max(0, RING.h - f.alt))} m to go` };
      default: {   // land
        const near = Math.hypot(f.origin.x - f.padPos.x, f.origin.z - f.padPos.z);
        return { done: false, bonus: false, txt: f.apex < G.minApex ? `climb ${num(f.apex)} / ${G.minApex} m` : `now land (${num(near)} m from the pad)` };
      }
    }
  }
  // per frame: refresh the pill a few times a second and only when its text changed; true once when the goal first completes
  frame(f, dt) {
    if (!this.on || f.phase === 'pad') return false;
    const P = this.progress(f), S = this.state; let fresh = false;
    if (P.done && !S.done) { S.done = true; fresh = true; }
    this.hudT += dt;
    if (this.hudT >= 0.12 || fresh) {
      this.hudT = 0;
      const t = (S.done ? '✓ ' : '◎ ') + this.goal.text + ' · ' + (S.done ? 'done' : P.txt);
      if (t !== this.hudTxt) { this.hudTxt = t; this.hud.textContent = t; this.hud.classList.toggle('done', S.done); }
    }
    return fresh;
  }
  // at the end of the flight: the numbers the results screen scores (done = star 1, bonus = star 3). A finished goal advances the rotation.
  finish(f, how) {
    if (!this.on) return null;
    const G = this.goal; let done, bonusDone;
    if (G.kind === 'land') { const d = f.landDist ?? 999; done = how === 'landed' && f.apex >= G.minApex && d <= 25; bonusDone = done && d <= 6; }
    else { const P = this.progress(f); done = P.done; bonusDone = P.bonus; }
    this.hud.classList.add('hidden');
    if (done) { this.idx = (this.idx + 1) % GOALS.length; this.save(); }
    return { text: G.text, done: !!done, bonusText: G.bonus, bonusDone: !!bonusDone };
  }
}
