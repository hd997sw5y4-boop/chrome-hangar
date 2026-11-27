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

export const MAX_STACK = 7;
export const emptyRocket = () => ({ stack: [], engine: null });
export const cloneRocket = r => JSON.parse(JSON.stringify(r));
export const starterRocket = () => ({ stack: [{ p: 'mount' }, { p: 'tank_short', fins: 1, legs: true }, { p: 'nose' }], engine: 'spark' });

export function lowestTankIndex(r) { return r.stack.findIndex(s => PARTS[s.p]?.kind === 'tank'); }
export function hasLegs(r) { return r.stack.some(s => s.legs); }
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
  const items = r.stack.map((s, i) => {
    const d = PARTS[s.p];
    const it = { i, s, d, y0: y, y1: y + d.length };
    y += d.length;
    return it;
  });
  const legs = PARTS.legs;
  return { engLen, items, top: y, bottom: hasLegs(r) && legs ? -legs.drop : 0, radius: 0.9 };
}

// All mass/aero numbers for a rocket at a given fuel fraction (0..1) of a fill level.
export function stats(r, fill = 1, fuelFrac = 1) {
  const L = layout(r);
  const eng = r.engine ? PARTS[r.engine] : null;
  const masses = []; // [m, y, len]
  let fuelCap = 0, cn = 0, cnY = 0, cd = 0.75;
  const f = fill * fuelFrac;
  for (const it of L.items) {
    const d = it.d;
    masses.push([d.dryMass, (it.y0 + it.y1) / 2, d.length]);
    if (d.fuelMass) {
      fuelCap += d.fuelMass * fill;
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
      const ld = PARTS.legs;
      masses.push([ld.dryMass, it.y0 * 0.5, it.y0 + 1]);
      cn += ld.cnAlpha; cnY += ld.cnAlpha * (it.y0 * 0.5);
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
  const fuel = fuelCap * fuelFrac;
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
  if (lowestTankIndex(r) < 0 && r.stack.length) out.push('Needs at least one fuel tank.');
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
    if (n >= MAX_STACK) return [{ ok: false, reason: 'The stand holds 7 stacked parts at most.' }];
    if (d.kind === 'mount') {
      if (mountAt0) return [{ ok: false, reason: 'One engine mount per rocket in v1.' }];
      if (n && topKind === 'nose' && n === 1) return [{ ok: false, reason: 'Mounts go under a tank, not a nose cone.' }];
      out.push({ type: 'stack', index: 0, ok: true });
    } else if (d.kind === 'nose') {
      if (topKind === 'nose') return [{ ok: false, reason: 'There is already a nose cone on top.' }];
      if (!n) return [{ ok: false, reason: 'Start with an engine mount or a tank.' }];
      out.push({ type: 'stack', index: n, ok: true });
    } else { // tank: any gap above the mount and below the nose
      const lo = mountAt0 ? 1 : 0;
      const hi = topKind === 'nose' ? n - 1 : n;
      for (let i = lo; i <= hi; i++) out.push({ type: 'stack', index: i, ok: true });
    }
  } else if (d.attach === 'engine') {
    if (!mountAt0) return [{ ok: false, reason: 'Needs an engine mount.' }];
    out.push({ type: 'engine', index: 0, ok: true, swap: !!r.engine && r.engine !== partId });
    if (r.engine === partId) return [{ ok: false, reason: d.name + ' is already mounted.' }];
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
  } else if (c.type === 'engine') n.engine = partId;
  else if (c.type === 'fins') n.stack[c.index].fins = (n.stack[c.index].fins || 0) + 1;
  else if (c.type === 'legs') n.stack[c.index].legs = true;
  return n;
}

// target: {type:'stack'|'engine'|'fins'|'legs', index}
export function applyRemove(r, t) {
  const n = cloneRocket(r);
  if (t.type === 'engine') n.engine = null;
  else if (t.type === 'fins') { n.stack[t.index].fins--; if (!n.stack[t.index].fins) delete n.stack[t.index].fins; }
  else if (t.type === 'legs') delete n.stack[t.index].legs;
  else if (t.type === 'stack') {
    const [rem] = n.stack.splice(t.index, 1);
    if (PARTS[rem.p].kind === 'mount') n.engine = null;
    if (rem.legs) { const li = lowestTankIndex(n); if (li >= 0) n.stack[li].legs = true; }
  }
  return n;
}
