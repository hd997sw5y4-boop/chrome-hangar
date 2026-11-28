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
    el.innerHTML = '<div class="card"><h2 id="frTitle"></h2><div id="frBanner" class="hidden"></div><div id="frStars"></div><p id="frReason"></p><p id="frHint" class="hidden"></p>' +
      '<div id="frStats"></div><div class="row"><button id="frHangar"></button><button id="frAgain" class="go"></button></div></div>';
    document.body.appendChild(el);
    this.$ = id => el.querySelector('#' + id);
    this.$('frAgain').onclick = () => this.choose('again');
    this.$('frHangar').onclick = () => this.choose('hangar');
    el.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => this.g.audio.hover()));
  }
  // 1-3 stars: [met, label] per star. goal (optional) is { text, done, bonusText, bonusDone } from the mission goals.
  rate(f, how, goal) {
    const landed = how === 'landed';
    return [
      goal ? [goal.done, 'Goal: ' + goal.text] : [f.apex >= 20, 'Clear the pad (above 20 m)'],
      [landed, 'Land in one piece'],
      goal ? [goal.bonusDone, 'Bonus: ' + goal.bonusText] : [f.apex >= 150, 'Climb above 150 m'],
    ];
  }
  show(f, how, info) {
    const g = this.g, $ = this.$, flew = f.apex > 1, goal = info.goal;
    // personal best: compare, then save
    const prev = loadBest(), next = { ...(prev || {}) }, won = {};
    let changed = false;
    if (flew) for (const [k, , get] of STATS) { const v = get(f); if (v > (prev?.[k] || 0) + 1e-6) { next[k] = v; won[k] = !!prev?.[k]; changed = true; } }
    const anyNew = Object.values(won).some(Boolean), first = flew && !prev;
    if (changed) saveBest(next);
    const stars = this.rate(f, how, goal), lit = stars.filter(s => s[0]).length;
    $('frTitle').textContent = info.title; $('frTitle').className = how === 'landed' || how === 'range' ? 'good' : '';
    $('frReason').textContent = info.reason || ''; $('frHint').innerHTML = info.hint ? '<b>Try this:</b> ' + info.hint : ''; $('frHint').classList.toggle('hidden', !info.hint);
    const bn = $('frBanner'); bn.classList.toggle('hidden', !(anyNew || first));
    bn.textContent = first ? 'First flight on record' : '★ New best!';
    $('frStars').innerHTML = stars.map(() => '<span>★</span>').join('') + '<small>' + stars.map(s => (s[0] ? '✓ ' : '· ') + s[1]).join('<br>') + '</small>';
    $('frStats').innerHTML = STATS.map(([k, label, get, unit, d]) => {
      const b = next[k] ?? 0;
      return `<div class="${won[k] ? 'best' : ''}"><label>${label}</label><b>${fmt(get(f), d)} <i>${unit}</i></b>` +
        (won[k] ? '<em>New best!</em>' : `<small>Best ${b ? fmt(b, d) + ' ' + unit : '—'}</small>`) + '</div>';
    }).join('');
    const pad = g.input.lastDevice === 'pad', kb = !pad && g.input.lastDevice !== 'touch';
    $('frAgain').innerHTML = 'Fly again' + (pad ? ' <kbd>✕</kbd>' : kb ? ' <kbd>Enter</kbd>' : '');
    $('frHangar').innerHTML = 'Back to hangar' + (pad ? ' <kbd>○</kbd>' : kb ? ' <kbd>Esc</kbd>' : '');
    g.input.exitLock(); document.activeElement?.blur?.();
    this.timers.forEach(clearTimeout); this.timers = [];
    const spans = $('frStars').querySelectorAll('span');
    stars.forEach((s, i) => s[0] && this.timers.push(setTimeout(() => { spans[i].classList.add('lit'); g.audio.star(i); }, 400 + i * 300)));
    if (!lit) g.audio.bad();
    this.el.classList.remove('hidden'); this.open = true; this.t = 0; this.done = false; g.resultsOpen = true;
  }
  hide() { this.timers.forEach(clearTimeout); this.timers = []; if (!this.open) return; this.open = false; this.el.classList.add('hidden'); this.g.resultsOpen = false; }
  // keyboard: Enter / Space = fly again, Esc / B / Backspace = hangar. DualSense: ✕ (Pad0) = fly again, ○ (Pad1) = hangar. A short grace
  // period keeps a mashed key or trigger from the end of the flight from dismissing it.
  poll(inp, dt) {
    this.t += dt; if (this.t < 0.6 || this.done) return;
    if (inp.hit('Enter') || inp.hit('NumpadEnter') || inp.hit('Space') || inp.hit('Pad0')) this.choose('again');
    else if (inp.hit('Escape') || inp.hit('KeyB') || inp.hit('Backspace') || inp.hit('Pad1')) this.choose('hangar');
  }
  choose(what) {
    if (this.done || !this.open) return; this.done = true;
    const g = this.g; g.audio.tap(); this.hide();
    g.setMode(what === 'again' ? g.mode : 'build');   // the same flows the mission results card uses (Fly again / Back to hangar)
  }
}
