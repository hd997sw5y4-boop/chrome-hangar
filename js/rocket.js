// Rocket model: part data, layout, and stats. Pure logic (no three.js) so it can be tested headless.
export const G0 = 9.80665;
export const PARTS = {};
export let PART_IDS = [];

export async function loadParts(base = 'data/parts/') {
  const idx = await (await fetch(base + 'index.json')).json();
  PART_IDS = idx.parts;
  const list = await Promise.all(PART_IDS.map(id => fetch(base + id + '.json').then(r => r.json())));
  for (const p of list) PARTS[p.id] = p;
  return PARTS;
}
export function registerParts(list) { for (const p of list) { PARTS[p.id] = p; if (!PART_IDS.includes(p.id)) PART_IDS.push(p.id); } }

export const MAX_STACK = 24;   // gb3-moon-rocket: was 7; staged rockets (Decoupler + a Mount and engine per stage) need the room
export const emptyRocket = () => ({ stack: [], engine: null });
export const cloneRocket = r => JSON.parse(JSON.stringify(r));
export const starterRocket = () => ({ stack: [{ p: 'mount' }, { p: 'tank_short', fins: 1, legs: true }, { p: 'nose' }], engine: 'spark' });

// sandbox stock: stable through max-q in a crosswind and reaches space at full throttle
export const stockRocket = () => ({ stack: [{ p: 'mount' }, { p: 'tank_short', fins: 2, legs: true }, { p: 'tank_mini' }, { p: 'nose_needle' }], engine: 'vesper' });
// ---- gb3-moon-rocket: stages. A Decoupler ends a stage; the stage above starts with an Engine Mount that carries its own engine
// ({ p: 'mount', engine: id }). Stage 0 (the bottom, burning first) is stack[0..first Decoupler] with rocket.engine. In flight the
// rocket is always "the active stage at the bottom": staging (staging.js) cuts the stack, so upper stages are always still full.
export function decouplers(r) { const o = []; r.stack.forEach((s, i) => { if (PARTS[s.p]?.kind === 'decoupler') o.push(i); }); return o; }
export function activeEnd(r) { const d = decouplers(r); return d.length ? d[0] : r.stack.length - 1; }   // last stack index of the burning stage
export function topStageStart(r) { const d = decouplers(r); return d.length ? d[d.length - 1] + 1 : 0; }
// legs belong to the top stage (the lander); they only touch the ground once that stage is the one at the bottom
export function lowestTankIndex(r) { const a = topStageStart(r), i = r.stack.slice(a).findIndex(s => PARTS[s.p]?.kind === 'tank'); return i < 0 ? -1 : i + a; }
export function hasLegs(r) { const e = activeEnd(r); return r.stack.some((s, i) => s.legs && i <= e); }
export function partCount(r) {
  let n = r.stack.length + (r.engine ? 1 : 0);
  for (const s of r.stack) n += (s.fins || 0) + (s.legs ? 1 : 0);
  return n;
}

// Vertical layout in rocket-local metres. y=0 is the engine nozzle exit.
export function layout(r) {
  const eng = r.engine ? PARTS[r.engine] : null;
  const engLen = eng && r.stack[0] && PARTS[r.stack[0].p].kind === 'mount' ? eng.length : 0;
  let y = engLen;
  const engines = [];   // gb3-moon-rocket: upper-stage engines, each hanging under its mount (nozzle on the Decoupler below)
  const items = r.stack.map((s, i) => {
    const d = PARTS[s.p];
    if (i > 0 && d.kind === 'mount' && PARTS[s.engine]) { const e = PARTS[s.engine]; engines.push({ id: s.engine, d: e, i, y0: y, y1: y + e.length }); y += e.length; }
    const it = { i, s, d, y0: y, y1: y + d.length };
    y += d.length;
    return it;
  });
  const legs = PARTS.legs;
  return { engLen, items, engines, top: y, bottom: hasLegs(r) && legs ? -legs.drop : 0, radius: 0.9 };
}

// All mass/aero numbers for a rocket at a given fuel fraction (0..1) of a fill level.
export function stats(r, fill = 1, fuelFrac = 1) {
  const L = layout(r);
  const eng = r.engine ? PARTS[r.engine] : null;
  const masses = []; // [m, y, len]
  let fuelCap = 0, cn = 0, cnY = 0, cd = 0.75;
  const f0 = fill * fuelFrac, aEnd = activeEnd(r), legsLive = hasLegs(r);
  for (const e of L.engines) masses.push([e.d.dryMass, e.y0 + e.d.length * 0.55, e.d.length]);   // gb3-moon-rocket: upper-stage engines
  for (const it of L.items) {
    const d = it.d, f = it.i <= aEnd ? f0 : fill;   // gb3-moon-rocket: only the burning (bottom) stage drains; stages above stay full
    masses.push([d.dryMass, (it.y0 + it.y1) / 2, d.length]);
    if (d.fuelMass) {
      if (it.i <= aEnd) fuelCap += d.fuelMass * fill;
      if (f > 0) masses.push([d.fuelMass * f, it.y0 + d.length * f / 2, d.length * f]);
    }
    let pc = d.cnAlpha, py = (it.y0 + it.y1) / 2;
    if (d.kind === 'nose') py = it.y1 - 0.466 * d.length;
    cn += pc; cnY += pc * py;
    cd += d.cd || 0;
    if (s_fins(it.s)) {
      const fd = PARTS.fins, n = it.s.fins;
      masses.push([fd.dryMass * n, it.y0 + 0.5, 1.5]);
      cn += fd.cnAlpha * n; cnY += fd.cnAlpha * n * (it.y0 + 0.35);
      cd += fd.cd * n;
    }
    if (it.s.legs) {
      const ld = PARTS.legs, ly = legsLive ? it.y0 * 0.5 : it.y0 + 0.5;   // stowed on an upper stage until it is the bottom one
      masses.push([ld.dryMass, ly, legsLive ? it.y0 + 1 : 1]);
      cn += ld.cnAlpha; cnY += ld.cnAlpha * ly;
      cd += ld.cd;
    }
  }
  if (eng && L.engLen) masses.push([eng.dryMass, eng.length * 0.55, eng.length]);
  const hasNose = r.stack.length && PARTS[r.stack[r.stack.length - 1].p].kind === 'nose';
  if (!hasNose && r.stack.length) cd += 0.25; // blunt top
  let m = 0, my = 0;
  for (const [mm, yy] of masses) { m += mm; my += mm * yy; }
  const com = m ? my / m : 0;
  let I = 0;
  for (const [mm, yy, len] of masses) I += mm * (len * len / 12 + 0.2) + mm * (yy - com) ** 2;
  const cop = cn ? cnY / cn : 0;
  const thrust = eng && L.engLen ? eng.thrust : 0;
  const fuel = fuelCap * fuelFrac;   // the burning stage's fuel (all of it when there is no Decoupler)
  const mdot = eng ? thrust / (eng.isp * G0) : 0;
  const dry = m - fuel;
  return {
    mass: m, dry, fuel, fuelCap, com, cop, cn, cd, I,
    length: L.top - L.bottom, top: L.top, bottom: L.bottom,
    thrust, twr: m ? thrust / (m * G0) : 0,
    burnTime: mdot ? fuel / mdot : 0,
    dv: eng && dry > 0 && fuel > 0 ? eng.isp * G0 * Math.log(m / dry) : 0,
    margin: (com - cop), // >0 = CoM above CoP = stable
    parts: partCount(r),
  };
}
function s_fins(s) { return s.fins > 0; }

export function stability(st) {
  const m = st.margin / 1.8; // in calibers (diameter 1.8 m)
  if (m > 0.15) return { word: 'Stable', level: 2 };
  if (m > -0.05) return { word: 'Marginal', level: 1 };
  return { word: 'Will flip', level: 0 };
}

// Problems that block a test or a launch.
export function problems(r) {
  const out = [];
  if (!r.stack.length) out.push('Place some parts on the stand first.');
  else if (PARTS[r.stack[0].p].kind !== 'mount') out.push('Needs an engine mount at the bottom.');
  else if (!r.engine) out.push('Needs an engine under the mount.');
  if (r.stack.length && !r.stack.some(s => PARTS[s.p]?.kind === 'tank')) out.push('Needs at least one fuel tank.');
  // gb3-moon-rocket: staging rules (one engine per stage, matching fuel)
  const st = r.stack, D = decouplers(r);
  for (let k = 0; k <= D.length; k++) {
    const a = k ? D[k - 1] + 1 : 0, e = k < D.length ? D[k] : st.length - 1, seg = st.slice(a, e + 1), eng = k ? st[a]?.engine : r.engine;
    if (k && (!seg.length || PARTS[seg[0].p].kind !== 'mount')) { out.push(`Stage ${k + 1} needs an Engine Mount right on its Decoupler.`); continue; }
    if (k && !PARTS[eng]) { out.push(`Stage ${k + 1} needs an engine under its mount.`); continue; }
    if (!seg.some(s => PARTS[s.p].kind === 'tank')) { out.push(`Stage ${k + 1} needs a fuel tank.`); continue; }
    const h = PARTS[eng]?.fuel === 'hydrogen';
    if (eng && seg.some(s => PARTS[s.p].kind === 'tank' && (PARTS[s.p].fuel === 'hydrogen') !== h)) out.push(h ? `Stage ${k + 1}: the Hydrogen Upper Engine only burns Hydrogen Tanks.` : `Stage ${k + 1}: Hydrogen Tanks need the Hydrogen Upper Engine.`);
  }
  st.forEach((s, i) => { if (i > 0 && PARTS[s.p].kind === 'mount' && PARTS[st[i - 1].p].kind !== 'decoupler') out.push('An Engine Mount above the bottom needs a Decoupler right under it.'); });
  if (D.length && D[D.length - 1] === st.length - 1) out.push('A Decoupler cannot be the top of the rocket.');
  return out;
}

// Snap candidates for placing a part. Returns [{type, index, ok, reason}]
export function candidates(r, partId) {
  const d = PARTS[partId];
  const out = [];
  if (!d) return out;
  const st = r.stack, n = st.length;
  const topKind = n ? PARTS[st[n - 1].p].kind : null;
  const mountAt0 = n && PARTS[st[0].p].kind === 'mount';
  if (d.attach === 'stack') {
    if (n >= MAX_STACK) return [{ ok: false, reason: `The stand holds ${MAX_STACK} stacked parts at most.` }];
    if (d.kind === 'decoupler' || (d.kind === 'mount' && mountAt0)) {   // gb3-moon-rocket: a Decoupler goes on a tank; the next stage's mount on a Decoupler
      const want = d.kind === 'decoupler' ? 'tank' : 'decoupler', hi = topKind === 'nose' ? n - 1 : n;
      for (let i = 1; i <= hi; i++) if (PARTS[st[i - 1].p].kind === want && (i >= n || PARTS[st[i].p].kind !== (d.kind === 'mount' ? 'mount' : 'decoupler'))) out.push({ type: 'stack', index: i, ok: true });
      if (!out.length) return [{ ok: false, reason: d.kind === 'decoupler' ? 'A Decoupler goes on top of a tank.' : 'One engine mount per stage: put a Decoupler on a tank first, then the mount on it.' }];
      return out;
    }
    if (d.kind === 'mount') {
      if (n && topKind === 'nose' && n === 1) return [{ ok: false, reason: 'Mounts go under a tank, not a nose cone.' }];
      out.push({ type: 'stack', index: 0, ok: true });
    } else if (d.kind === 'nose') {
      if (topKind === 'nose') return [{ ok: false, reason: 'There is already a nose cone on top.' }];
      if (!n) return [{ ok: false, reason: 'Start with an engine mount or a tank.' }];
      out.push({ type: 'stack', index: n, ok: true });
    } else { // tank: any gap above the mount and below the nose
      const lo = mountAt0 ? 1 : 0;
      const hi = topKind === 'nose' ? n - 1 : n;
      for (let i = lo; i <= hi; i++) if (!(i > 0 && PARTS[st[i - 1].p].kind === 'decoupler')) out.push({ type: 'stack', index: i, ok: true });   // gb3-moon-rocket: a Decoupler carries the next stage's mount
    }
  } else if (d.attach === 'engine') {
    if (!mountAt0) return [{ ok: false, reason: 'Needs an engine mount.' }];
    if (r.engine !== partId) out.push({ type: 'engine', index: 0, ok: true, swap: !!r.engine });
    st.forEach((s, i) => { if (i > 0 && PARTS[s.p].kind === 'mount' && s.engine !== partId) out.push({ type: 'engine', index: i, ok: true, swap: !!s.engine }); });   // gb3-moon-rocket: upper-stage mounts
    if (!out.length) return [{ ok: false, reason: d.name + ' is already mounted.' }];
  } else if (d.kind === 'fins') {
    st.forEach((s, i) => { if (PARTS[s.p].kind === 'tank' && (s.fins || 0) < d.maxPerTank) out.push({ type: 'fins', index: i, ok: true }); });
    if (!out.length) return [{ ok: false, reason: lowestTankIndex(r) < 0 ? 'Fins go on a tank.' : 'Each tank holds two fin pairs.' }];
  } else if (d.kind === 'legs') {
    const li = lowestTankIndex(r);
    if (li < 0) return [{ ok: false, reason: 'Legs go on the lowest tank.' }];
    if (hasLegs(r)) return [{ ok: false, reason: 'This rocket already has legs.' }];
    out.push({ type: 'legs', index: li, ok: true });
  }
  return out;
}

export function applyPlace(r, partId, c) {
  const n = cloneRocket(r);
  if (c.type === 'stack') {
    n.stack.splice(c.index, 0, { p: partId });
    // keep legs on the lowest tank
    const legged = n.stack.findIndex(s => s.legs);
    const li = lowestTankIndex(n);
    if (legged >= 0 && legged !== li) { delete n.stack[legged].legs; n.stack[li].legs = true; }
  } else if (c.type === 'engine') { if (c.index > 0) n.stack[c.index].engine = partId; else n.engine = partId; }
  else if (c.type === 'fins') n.stack[c.index].fins = (n.stack[c.index].fins || 0) + 1;
  else if (c.type === 'legs') n.stack[c.index].legs = true;
  return n;
}

// target: {type:'stack'|'engine'|'fins'|'legs', index}
export function applyRemove(r, t) {
  const n = cloneRocket(r);
  if (t.type === 'engine') { if (t.index > 0) delete n.stack[t.index].engine; else n.engine = null; }
  else if (t.type === 'fins') { n.stack[t.index].fins--; if (!n.stack[t.index].fins) delete n.stack[t.index].fins; }
  else if (t.type === 'legs') delete n.stack[t.index].legs;
  else if (t.type === 'stack') {
    const [rem] = n.stack.splice(t.index, 1);
    if (PARTS[rem.p].kind === 'mount' && t.index === 0) n.engine = null;
    if (rem.legs) { const li = lowestTankIndex(n); if (li >= 0) n.stack[li].legs = true; }
  }
  return n;
}
