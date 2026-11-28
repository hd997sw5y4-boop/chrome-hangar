// Flight results screen (Free Mode flights): max altitude, downrange, top speed, flight time, a 1-3 star rating and a personal best
// saved in localStorage. The panel is built once per flight from the sim's own stats (flightStep keeps apex / topSpeed / downrange /
// flightT), so nothing here runs per frame except one key / pad poll while it is open.
const KEY = 'ch_flight_best';
const STATS = [   // [key on the best record, label, value from the flight, unit, decimals]
  ['alt', 'Max altitude', f => f.apex, 'm', 0],
  ['down', 'Downrange', f => f.downrange, 'm', 0],
  ['speed', 'Top speed', f => f.topSpeed, 'm/s', 0],
  ['time', 'Flight time', f => f.flightT, 's', 1],
];
const fmt = (v, d) => v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const loadBest = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (_) { return null; } };
const saveBest = b => { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (_) {} };

export class FlightResults {
  constructor(game) {
    this.g = game; this.open = false; this.t = 0; this.timers = [];
    const el = this.el = document.createElement('div');
    el.id = 'fResults'; el.className = 'modal hidden';
    el.innerHTML = '<div class="card"><h2 id="frTitle"></h2><div id="frBanner" class="hidden"></div><div id="frStars"></div><p id="frReason"></p><p id="frBroke" class="hidden"></p><p id="frHint" class="hidden"></p>' +
      '<div id="frStats"></div><div class="row"><button id="frHangar"></button><button id="frReplay"></button><button id="frAgain" class="go"></button></div></div>';
    document.body.appendChild(el);
    this.$ = id => el.querySelector('#' + id);
    this.$('frAgain').onclick = () => this.choose('again');
    this.$('frHangar').onclick = () => this.choose('hangar');
    this.$('frReplay').onclick = () => this.replay();
    el.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => this.g.audio.hover()));
  }
  // Free Mode results have no stars (goals were removed). A soft touchdown is recorded as a stat, not a rating.
  softNote(f) {
    if (!f.soft) return null;
    return `Soft landing: ${f.landSpeed.toFixed(1)} m/s touchdown`;
  }
  show(f, how, info) {
    const g = this.g, $ = this.$, flew = f.apex > 1;
    // personal best: compare, then save
    const prev = loadBest(), next = { ...(prev || {}) }, won = {};
    let changed = false;
    if (flew) for (const [k, , get] of STATS) { const v = get(f); if (v > (prev?.[k] || 0) + 1e-6) { next[k] = v; won[k] = !!prev?.[k]; changed = true; } }
    const anyNew = Object.values(won).some(Boolean), first = flew && !prev;
    if (changed) saveBest(next);
    const soft = this.softNote(f);
    $('frTitle').textContent = info.title; $('frTitle').className = how === 'landed' || how === 'range' || f.soft ? 'good' : '';
    $('frReason').textContent = info.reason || ''; $('frBroke').textContent = info.broke || ''; $('frBroke').classList.toggle('hidden', !info.broke); $('frHint').innerHTML = info.hint ? '<b>Try this:</b> ' + info.hint : ''; $('frHint').classList.toggle('hidden', !info.hint);
    const bn = $('frBanner'); bn.classList.toggle('hidden', !(anyNew || first || soft));
    bn.textContent = first ? 'First flight on record' : anyNew ? '★ New best!' : (soft || '');
    $('frStars').innerHTML = ''; $('frStars').classList.add('hidden');
    $('frStats').innerHTML = STATS.map(([k, label, get, unit, d]) => {
      const b = next[k] ?? 0;
      return `<div class="${won[k] ? 'best' : ''}"><label>${label}</label><b>${fmt(get(f), d)} <i>${unit}</i></b>` +
        (won[k] ? '<em>New best!</em>' : `<small>Best ${b ? fmt(b, d) + ' ' + unit : '—'}</small>`) + '</div>';
    }).join('') + (soft ? `<div class="soft"><label>Touchdown</label><b>${fmt(f.landSpeed, 1)} <i>m/s</i></b><em>${soft}</em></div>` : '');
    const pad = g.input.lastDevice === 'pad', kb = !pad && g.input.lastDevice !== 'touch';
    $('frAgain').innerHTML = 'Fly again' + (pad ? ' <kbd>✕</kbd>' : kb ? ' <kbd>Enter</kbd>' : '');
    $('frHangar').innerHTML = 'Back to hangar' + (pad ? ' <kbd>○</kbd>' : kb ? ' <kbd>Esc</kbd>' : '');
    $('frReplay').innerHTML = 'Replay' + (pad ? ' <kbd>□</kbd>' : kb ? ' <kbd>R</kbd>' : ''); $('frReplay').classList.toggle('hidden', !flew);
    g.input.exitLock(); document.activeElement?.blur?.();
    this.timers.forEach(clearTimeout); this.timers = [];
    const spans = $('frStars').querySelectorAll('span');
    stars.forEach((s, i) => s[0] && this.timers.push(setTimeout(() => { spans[i].classList.add('lit'); g.audio.star(i); }, 400 + i * 300)));
    if (how === 'crash') g.audio.bad();
    this.el.classList.remove('hidden'); this.open = true; this.t = 0; this.done = false; g.resultsOpen = true;
  }
  hide() { this.timers.forEach(clearTimeout); this.timers = []; if (!this.open) return; this.open = false; this.el.classList.add('hidden'); this.g.resultsOpen = false; }
  // keyboard: Enter / Space = fly again, Esc / B / Backspace = hangar. DualSense: ✕ (Pad0) = fly again, ○ (Pad1) = hangar. A short grace
  // period keeps a mashed key or trigger from the end of the flight from dismissing it.
  poll(inp, dt) {
    const t0 = this.t; this.t += dt; if (this.t < 0.6 || this.done) return;
    // focus Fly again once the grace period is over (not at show time, so a key still held from the flight cannot click it)
    if (t0 < 0.6) { const b = this.$('frAgain'); b.focus({ preventScroll: true }); b.scrollIntoView?.({ block: 'nearest' }); }
    if (inp.hit('Enter') || inp.hit('NumpadEnter') || inp.hit('Space') || inp.hit('Pad0')) this.choose('again');
    else if (inp.hit('Escape') || inp.hit('KeyB') || inp.hit('Backspace') || inp.hit('Pad1')) this.choose('hangar');
    else if (inp.hit('KeyR') || inp.hit('Pad2')) this.replay();
  }
  // Replay: the panel steps aside (results stay "open" for input blocking) and comes back as it was afterwards
  replay() { if (!this.open || this.done || !this.onReplay) return; this.g.audio.tap(); this.onReplay(); }
  suspend() { this.el.classList.add('hidden'); this.open = false; this.g.resultsOpen = true; }
  resume() { this.el.classList.remove('hidden'); this.open = true; this.t = 0; this.done = false; this.g.resultsOpen = true; }
  choose(what) {
    if (this.done || !this.open) return; this.done = true;
    const g = this.g; g.audio.tap(); this.hide();
    g.setMode(what === 'again' ? g.mode : 'build');   // the same flows the mission results card uses (Fly again / Back to hangar)
  }
}
