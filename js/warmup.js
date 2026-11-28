// Pre-warm the first view (the golden-hour fly-in, or the hangar if the intro is skipped) so the first real
// frames don't hitch on shader compiles, texture uploads or the first shadow-map fill.
// compileAsync (compile as fallback) covers scene programs; a few full composer frames cover bloom / DOF /
// SMAA and the sun's shadow atlas. Capped by a timeout so boot can never hang.
import * as THREE from 'three';
import { Flame } from './fx.js';

const SETTLE = 8;
const THRESH = 50;     // ms; a slow GPU is allowed 1.5× its own recent median instead
const TIMEOUT = 12000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function visitTex(r, t, seen) {
  if (!t || !t.isTexture || seen.has(t)) return;
  seen.add(t);
  try { r.initTexture(t); } catch (_) {}
}

function uploadTextures(w) {
  const r = w.renderer, seen = new Set();
  w.scene.traverse(o => {
    for (const m of [].concat(o.material || [])) {
      if (!m) continue;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) visitTex(r, v, seen); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value && u.value.isTexture) visitTex(r, u.value, seen);
    }
  });
  for (const t of [w.scene.environment, w.scene.background, w.envs?.hangar, w.envs?.sky, w.envs?.skyTex, w.localIn?.rt?.texture, w.localOut?.rt?.texture, w.post?.grade?.uniforms?.tDirt?.value]) visitTex(r, t, seen);
}

// lock terrain / sea defines to the values the fly-in (low, outdoor, earth on) will use, so World.render
// does not flip material.transparent + needsUpdate mid-shot — that recompiles those programs
function stabilizeOutdoor(w) {
  const o = w.outdoor; if (!o || w.indoor) return;
  const earthOn = !!w.earth?.ready;
  for (const [m, b] of [[o.terrainMat, false], [o.terrainRingMat, earthOn], [o.oceanMat, earthOn]]) {
    if (m && m.transparent !== b) { m.transparent = b; m.needsUpdate = true; }
  }
  if (o.group) o.group.visible = true;
}

// chute is already in the scene (LandingKit). Exhaust is not, and adding a Flame light would change
// the light count and recompile everything: add only the plume meshes, no light, then hide them.
function prewarmFx(g) {
  if (g._fxWarm) return;
  const f = new Flame();
  if (f.light) f.group.remove(f.light);
  f.group.visible = true; f.group.position.set(0, -8, 0);
  f.update(0, 0.6, 0.8, 8, 1.225, 60000);
  g.world.scene.add(f.group);
  g._fxWarm = f;
}

function hideFx(g) { if (g._fxWarm) g._fxWarm.group.visible = false; }

export async function warmup(game, opts = {}) {
  const w = game.world, r = w.renderer, intro = opts.brief ? null : game.intro;
  const times = game._warmupTimes = [];
  const txt = document.getElementById('loadText');
  if (txt) txt.textContent = 'Warming the view…';

  // the planet and its zoom levels stream in the first time we go outdoors; if a level lands mid-fly-in
  // its array texture uploads and hitch the approach. Load the globe, request every level the path will
  // want, and wait for the fetches (capped) before compiling.
  if (!w.indoor && w.earth) {
    try { await Promise.race([w.earth.load() || Promise.resolve(), sleep(4000)]); } catch (_) {}
    const poses0 = intro?.pts ? [0, 0.45, 1] : [0];
    for (const u of poses0) { if (intro) intro.place(u); w.earth.prepare(w.camera, 1); }
    const t0 = performance.now();
    const pending = () => { const lv = w.earth.lv; if (!lv) return false; if (lv.busy > 0) return true; for (let k = 0; k < lv.want.length; k++) if (lv.want[k] && lv.state[k] < 2) return true; return false; };
    while (pending() && performance.now() - t0 < 5000) await sleep(40);
  }
  stabilizeOutdoor(w);
  uploadTextures(w);
  prewarmFx(game);

  const compile = (r.compileAsync ? r.compileAsync.bind(r) : (s, c) => { r.compile(s, c); return Promise.resolve(); });
  const props = w._props || w.hangar?.getObjectByName('props');
  const poses = intro?.pts ? [0, 0.45, 1] : [0];
  // one compileAsync from the opening camera (compile() is sync, so we only do this once), then a full
  // composer frame at each pose so shadow maps and post (bloom / DOF) compile too
  if (intro) intro.place(0);
  const was = props?.visible; if (props) props.visible = true;
  try { await Promise.race([compile(w.scene, w.camera), sleep(3000)]); } catch (_) {}
  for (const u of poses) {
    if (intro) intro.place(u);
    if (props) props.visible = true;
    w.update(0); w.render();
  }
  if (props && was !== undefined) props.visible = was;
  if (intro) intro.place(0);
  hideFx(game);
  uploadTextures(w);   // earth level tiles that just arrived

  // full frames fill the sun shadow atlas and compile bloom / DOF / SMAA (compileAsync does not)
  const tLimit = performance.now() + (opts.brief ? 3000 : TIMEOUT);
  let steady = 0;
  while (performance.now() < tLimit) {
    if (intro) intro.place(0);
    const t0 = performance.now();
    w.update(0); w.render();
    const dt = performance.now() - t0;
    times.push(+dt.toFixed(2));
    const recent = times.slice(-SETTLE);
    const med = recent.slice().sort((a, b) => a - b)[Math.floor(recent.length / 2)] || dt;
    const cap = Math.max(THRESH, med * 1.5);
    if (times.length >= SETTLE && dt <= cap && recent.every(x => x <= cap * 1.25)) steady++;
    else steady = 0;
    if (times.length >= SETTLE && steady >= 3) break;
    await new Promise(res => requestAnimationFrame(res));
  }
  if (intro) intro.place(0);
  return times;
}

export function fadeLoading(ms = 400) {
  const el = document.getElementById('loading');
  if (!el || el.classList.contains('hidden')) return Promise.resolve();
  if (!ms) { el.classList.add('hidden'); return Promise.resolve(); }
  el.classList.add('fadeout');
  return new Promise(r => setTimeout(() => { el.classList.add('hidden'); r(); }, ms));
}
