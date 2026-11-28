// Golden-hour title fly-in over the pad, shown once after load and before the menu.
// About 6.5 s, skippable with a tap, click or any key. Tests set window.__NOINTRO to skip it.
import * as THREE from 'three';
import { SKIES, SPOTS } from './env.js';
import { stats } from './rocket.js';
import { rocketMesh, disposeTree } from './parts3d.js';

const $ = id => document.getElementById(id);
const DUR = 6.6;

const ease = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

export class Intro {
  constructor(game) {
    this.g = game; this.w = game.world; this.t = 0; this.done = false; this.live = false;
    this.fromSky = game.settings.timeOfDay;
    this.onSkip = e => { if (e && e.type === 'keydown' && (e.key === 'F12' || e.metaKey || e.ctrlKey || e.altKey)) return; this.skip(); };
  }

  async start() {
    const g = this.g, w = this.w, el = $('intro');
    w.setIndoor(false);
    if (w.skyKey !== 'sunset') await w.setSky('sunset').catch(() => {});
    const rocket = g.rocket?.stack?.length ? g.rocket : null;
    if (rocket) {
      const st = stats(rocket, g.fill), mesh = rocketMesh(rocket);
      mesh.position.set(SPOTS.pad.x, -st.bottom, SPOTS.pad.z);
      w.scene.add(mesh); this.mesh = mesh; this.lookY = Math.max(6, st.top * 0.55);
    } else this.lookY = 8;
    // path: wide coastal approach in the golden light, then a close 3/4 on the pad
    const P = SPOTS.pad;
    // stay on the apron centre-line so the flood masts at x = ±34 never sit in the foreground
    this.pts = [
      new THREE.Vector3(P.x + 280, 120, P.z + 220),
      new THREE.Vector3(P.x + 110, 48, P.z + 140),
      new THREE.Vector3(P.x + 40, 20, P.z + 70),
      new THREE.Vector3(P.x + 18, 8.2, P.z + 38),
      new THREE.Vector3(P.x + 11, 5.6, P.z + 24),
    ];
    this.look = [
      new THREE.Vector3(P.x, 14, P.z),
      new THREE.Vector3(P.x, 12, P.z),
      new THREE.Vector3(P.x, this.lookY, P.z),
      new THREE.Vector3(P.x, this.lookY, P.z),
      new THREE.Vector3(P.x, this.lookY * 0.85, P.z),
    ];
    const c = w.camera; c.up.set(0, 1, 0); c.fov = 48; c.near = 0.4; c.far = 60000; c.updateProjectionMatrix();
    this.place(0);
    w.post.setDOF(true, c.position.distanceTo(this.look[0]), 0.00004);
    el.classList.remove('hidden');
    $('hud').classList.add('hidden');
    document.body.classList.add('intro');
    addEventListener('pointerdown', this.onSkip, { capture: true });
    addEventListener('keydown', this.onSkip, { capture: true });
  }

  place(u) {
    const pts = this.pts, look = this.look, n = pts.length - 1;
    const x = u * n, i = Math.min(n - 1, x | 0), t = ease(x - i);
    const p = pts[i].clone().lerp(pts[i + 1], t), l = look[i].clone().lerp(look[i + 1], t);
    const c = this.w.camera; c.position.copy(p); c.lookAt(l); c.fov = mix(50, 27, ease(u)); c.updateProjectionMatrix();
    this.w.post.setDOF(true, c.position.distanceTo(l), mix(0.00002, 0.00008, u));
    this.w.followSun(l);
  }

  // the clock stays at 0 until release() (after the loader fades), so the fly-in never starts behind the overlay
  release() { if (this.done) return; this.live = true; this.t = 0; this.place(0); }
  update(dt) {
    if (this.done || !this.live) return;
    this.t = Math.min(DUR, this.t + dt);
    const u = this.t / DUR;
    this.place(u);
    const el = $('intro');
    el.classList.toggle('show', u > 0.16);
    el.classList.toggle('hold', u > 0.28);
    if (this.t >= DUR) this.finish();
  }

  skip() { if (!this.done) this.finish(); }

  finish() {
    if (this.done) return;
    this.done = true;
    removeEventListener('pointerdown', this.onSkip, { capture: true });
    removeEventListener('keydown', this.onSkip, { capture: true });
    this.place(1);
    $('intro').classList.add('show', 'hold', 'out');
    document.body.classList.remove('intro');
    this.w.post.setDOF(false);
    // leave the hero shot and the rocket on the pad under the menu
    this.g.showMenu(true);
    setTimeout(() => $('intro').classList.add('hidden'), 700);
    // a 2k sky swap mid-fly-in would rebuild PMREM and hitch; wait until we have arrived
    if (this.g.settings.quality === 'ultra') this.w.loadHDRIs('2k').catch(() => {});
  }

  // drop the display rocket and put the sky back when the player leaves the menu
  teardown() {
    if (this.mesh) { this.mesh.removeFromParent(); disposeTree(this.mesh); this.mesh = null; }
    this.w.post.setDOF(false);
    const want = this.g.settings.timeOfDay || 'day';
    if (this.w.skyKey !== want && SKIES[want]) this.w.setSky(want).catch(() => {});
  }
}

export const shouldPlayIntro = () => !window.__NOINTRO;
