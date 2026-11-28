// Headless Free Mode flight for node tests: the real sim.js / moon.js (MoonFlight) / health.js / staging.js / autopilot.js, stepped
// per 60 fps frame exactly like flight.js update() does (input -> autopilot -> engine command -> moon.step or the fixed 120 Hz flat
// sim + part health -> moon.afterFlat), with the renderer and DOM stubbed out (as in tests/orbit-stable.test.mjs).
import { register } from 'node:module';
import fs from 'fs';
const ROOT = new URL('../../', import.meta.url).href;
globalThis.document ??= { getElementById: () => null, querySelectorAll: () => [] };   // GB5's rcs-ui HUD writes go nowhere headless
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${ROOT}vendor/three/three.module.js', shortCircuit: true };
  if (ctx.parentURL?.endsWith('/js/moon.js') && spec === './spaceview.js') return { url: 'data:text/javascript,export class SpaceView{constructor(){return new Proxy({},{get:()=>()=>{},set:()=>true})}}', shortCircuit: true };
  if (ctx.parentURL?.endsWith('/js/moon.js') && spec === './env.js') return { url: 'data:text/javascript,export const SPOTS={pad:{x:0,y:0,z:-115}}', shortCircuit: true };
  return next(spec, ctx);
}`));
export const O = await import(ROOT + 'js/orbit.js');
export const S = await import(ROOT + 'js/sim.js');
export const R = await import(ROOT + 'js/rocket.js');
export const ST = await import(ROOT + 'js/staging.js');
export const APM = await import(ROOT + 'js/autopilot.js');
export const { TimeWarp } = await import(ROOT + 'js/timewarp.js');
export const { MoonFlight } = await import(ROOT + 'js/moon.js');
export const { RocketHealth } = await import(ROOT + 'js/health.js');
export const PRESETS = await import(ROOT + 'js/presets.js');
export const { Gb5Flight } = await import(ROOT + 'js/rcs-ui.js');   // GB5: RCS input + space-leg heating / heat damage, as in flight.js
const LS = await import('../../js/launchstand.js');   // gb3-stand
const idx = JSON.parse(fs.readFileSync(new URL('data/parts/index.json', ROOT))).parts;
R.registerParts(idx.map(id => JSON.parse(fs.readFileSync(new URL(`data/parts/${id}.json`, ROOT)))));
const noop = () => {};
const { V } = O;

export function makeFlight(rocket, opts = {}) {
  // gb3-stand: like flight.js, a stack too tall for the hangar launches from the Launch Stand's mount (opts.padY overrides)
  const padY = opts.padY ?? (LS.needsStand(rocket) ? LS.standSize(rocket).baseY : 0);
  const f = S.newFlight(R.cloneRocket(rocket), { fill: 1, padPos: { x: 0, y: padY, z: -115 }, assist: true, wind: opts.wind ?? 0, windDir: 0.6 });
  const notes = [];
  const fm = { f, g: { audio: { tap: noop, star: noop, noise: noop }, settings: { assist: true }, fill: 1, toast: (t) => notes.push(t), input: { hit: () => false }, resultsOpen: false, menuOpen: false, mission: null, training: null, prompt: noop },
    w: { camera: { position: { x: 0, y: 0, z: 0 } } }, ended: false, camInit: false, countdown: null, capture: noop, copyPose: noop, cur: {}, prev: {}, thr: 0, armed: false, acc: 0 };
  const m = Object.create(MoonFlight.prototype);
  Object.assign(m, { fm, w: fm.w, f, view: new Proxy({}, { get: () => noop, set: () => true }), warp: new TimeWarp(), on: true, sky: O.makeSky(opts.epoch ?? Date.UTC(2026, 10, 27, 12)),
    mode: 'flatE', s: null, att: null, point: 'hold', acc: 0, moonLandings: 0, everMoon: false, maxDistE: 0, pred: null, predT: 1, frameKind: null, uiT: 1, practice: false, padPos0: { ...f.padPos },
    hud: { classList: { add: noop, remove: noop } }, pad: { classList: { add: noop, remove: noop, contains: () => true } } });
  fm.moon = m;
  const health = new RocketHealth().reset(f.rocket, 1); fm.health = health;
  const doc = globalThis.document; delete globalThis.document; const gb5 = new Gb5Flight(fm.g, fm); globalThis.document = doc;   // no DOM: it skips building its HUD
  const game = { f, fm, m, health, gb5, notes, hullPeak: 0, log: [], frames: 0, stageEvents: [], maxWarp: 1, wantWarp: 1, assistOverride: null };
  const io = {
    get f() { return fm.f; }, get moon() { return m; },
    throttle: x => { fm.thr = x; }, steer: (x, z) => { fm.f.steer.x = x; fm.f.steer.z = z; },
    assist: on => { game.assistOverride = on; if (on != null) fm.f.assist = on; else fm.f.assist = true; },
    point: d => { if (d) { m.apDir = d; m.point = 'ap'; } else if (m.point === 'ap') { m.point = 'hold'; m.apDir = null; } },
    stage: () => game.stage(), warp: k => { game.wantWarp = k; }, launch: () => { if (fm.countdown == null && f.phase === 'pad' && !fm.armed) fm.countdown = 3.999; },
    note: t => notes.push(t),
  };
  game.io = io; game.ap = new APM.Autopilot(io);
  fm.launch = () => io.launch();
  game.stage = () => { const s = ST.separate(fm.f); return !!s; };
  // one 60 fps frame, in flight.js update() order
  game.frame = (dt = 1 / 60, player = null) => {
    const f = fm.f; game.frames++;
    const inp = { steer: { x: 0, y: 0 }, look: { x: 0, y: 0 }, touchMove: { x: 0, y: 0 }, pad: null, pressed: new Set(), taps: [], hit: () => false, down: () => false };
    game.gb5.input(inp, dt);                   // GB5-RCS input path (RCS stays off unless a test turns it on)
    if (player) player(game);                  // a "player" input this frame (takeover tests)
    game.ap.update(dt);
    // warp request -> the same TimeWarp moon.js uses (it still caps it)
    if (m.mode === 'space') { while (m.warp.k < game.wantWarp && m.warp.up(m.capNow())) {} while (m.warp.k > game.wantWarp) m.warp.down(); game.maxWarp = Math.max(game.maxWarp, m.warp.k); } else m.warp.reset();
    if (fm.countdown != null) { fm.countdown -= dt; if (fm.countdown <= 0) { fm.countdown = null; f.e.cmd = Math.max(fm.thr, f.eng.minThrottle); fm.armed = true; } }
    if (fm.armed && !fm.ended) f.e.cmd = fm.thr;
    fm.acc += dt; let steps = 0;
    if (m.step(dt)) fm.acc = 0;
    else while (fm.acc >= S.DT) {
      S.flightStep(f, S.DT); health.step(f, S.DT); fm.acc -= S.DT;
      if (m.afterFlat()) { fm.acc = 0; break; }
      if (++steps >= 8) { fm.acc = 0; break; }
    }
    game.gb5.frame(dt);                        // GB5-HEAT: heating on the Earth space leg + heat damage on the parts (flight.js calls it after hud())
    game.hullPeak = Math.max(game.hullPeak, f.hull?.T || 0);
    // moon.js frame(): a Moon touchdown keeps the flight going; throttling up on the Moon lifts off again
    for (const ev of f.events.splice(0)) {
      if (ev.type === 'stage') { game.stageEvents.push({ hull: f.hull?.T, index: ev.index, t: f.t, alt: f.alt, mode: m.mode, fuelFracBefore: ev.dropped.fuelFrac }); health.reset(f.rocket, 1); }
      if (ev.type === 'landed' && m.mode === 'flatM') { m.moonLandings++; game.moonLanded = { speed: f.landSpeed, tilt: f.tilt, t: f.t, fuel: R.stats(f.rocket, f.fill, f.fuelFrac).fuel }; }
      if (ev.type === 'crash') game.crash = { kind: ev.kind, failure: f.failure, mode: m.mode, alt: f.alt, t: f.t };
    }
    if (m.mode === 'flatM' && (f.phase === 'landed' || f.phase === 'pad') && f.eng) {
      const want = f.e.cmd >= f.eng.minThrottle - 1e-6 && f.fuelFrac > 0;
      if (want && f.phase === 'landed') { f.phase = 'pad'; f.heavyT = 0; } else if (!want && f.phase === 'pad') { f.phase = 'landed'; f.e.on = false; }
    }
  };
  return game;
}
export { V };
