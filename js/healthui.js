// Rocket health panel: a live schematic of the player's own stack (engines / cluster bells, mount, tanks with
// fuel bars, fins, legs, nose) tinted by health, with short warning lines underneath. Redraws at ~10 Hz.
import { clusterOffsets } from './parts3d.js';
import { PARTS } from './rocket.js';
import { LV, partLevel } from './health.js';

const $ = id => document.getElementById(id);
const FILL = ['#5fe39a', '#ffcf5a', '#ff9a3c', '#ff5b4e', '#59616b'];
const EDGE = ['rgba(200,255,225,.55)', 'rgba(255,236,170,.6)', 'rgba(255,200,150,.65)', 'rgba(255,190,180,.8)', 'rgba(150,160,170,.45)'];
const WCLS = ['ok', 'warn', 'crit', 'bad'];
const DASH = [2, 2], SOLID = [];
const W = 128, H = 196;

export class HealthPanel {
  constructor(game) {
    this.g = game; this.el = $('hpPanel'); this.cv = $('hpCanvas'); this.ctx = this.cv.getContext('2d');
    this.tip = $('hpTip'); this.lines = [...$('hpWarn').children];
    this.acc = 0; this.hover = -1; this.tapT = 0; this.lineT = new Float32Array(this.lines.length); this.next = 0;
    this.model = null; this.boxes = new Float32Array(0);
    const pick = e => { const r = this.cv.getBoundingClientRect(); this.hover = this.hit((e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height); };
    this.cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { pick(e); this.tipNow(); } });
    this.cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { this.hover = -1; this.tipNow(); } });
    this.cv.addEventListener('pointerdown', e => { pick(e); this.tapT = e.pointerType === 'mouse' ? 0 : 2.5; this.tipNow(); e.stopPropagation(); });
    $('hpHide').onclick = () => this.toggle();
  }
  get on() { return this.g.settings.healthPanel !== false; }
  toggle() { this.g.settings.healthPanel = !this.on; this.g.applySettingsLight(); this.g.audio.tap(); this.g.toast(this.on ? 'Rocket health panel on' : 'Rocket health panel hidden (P or Settings brings it back)'); this.sync(); }
  sync() { this.el.classList.toggle('hidden', !this.on || !this.model); }

  // Lay the stack out once per flight: each part gets a box in canvas px (bottom to top), engines below the mount.
  attach(model) {
    this.model = model; this.hover = -1; this.tapT = 0; this.tip.classList.add('hidden');
    for (let i = 0; i < this.lines.length; i++) { this.lines[i].className = ''; this.lines[i].textContent = ''; this.lineT[i] = 0; }
    const P = model.parts, n = P.length, eng = model.engines[0] ? PARTS[model.engines[0].id] : null;
    this.boxes = new Float32Array(n * 4);
    const cx = 52, bw = 26, top = 8, bottom = H - 10;
    const engH = eng ? 16 : 0, legsH = model.legs ? 6 : 0;
    const span = bottom - top - engH - legsH;
    // part heights follow real lengths, but every part stays at least 9 px tall to stay tappable
    let sum = 0; for (const p of model.stack) sum += Math.max(0.6, p.y1 - p.y0);
    const minH = 9, k0 = span / sum; let fixed = 0, flex = 0;
    for (const p of model.stack) { const h = Math.max(0.6, p.y1 - p.y0) * k0; if (h < minH) fixed += minH; else flex += h; }
    const k = flex ? (span - fixed) / flex * k0 : k0;
    let y = bottom - engH - legsH; const ys = new Map();
    for (const p of model.stack) { const h = Math.max(minH, Math.max(0.6, p.y1 - p.y0) * k); ys.set(p.i, [y - h, y]); this.box(P.indexOf(p), cx - bw / 2, y - h, bw, h); y -= h; }
    this.stackTop = y; this.stackBot = bottom - engH - legsH; this.cx = cx; this.bw = bw;
    for (const p of P) {
      const j = P.indexOf(p), s = ys.get(p.i);
      if (p.kind === 'fins') { const fh = Math.min(16, (s[1] - s[0]) * 0.9); this.box(j, cx - bw / 2 - 9, s[1] - fh, bw + 18, fh); }
      if (p.kind === 'legs') this.box(j, cx - bw / 2 - 8, s[1] - 4, bw + 16, engH + legsH + 4);
    }
    // engines: one bell, or a bottom-view ring of bells beside the stack for a cluster
    this.ring = null;
    if (model.engines.length === 1) this.box(P.indexOf(model.engines[0]), cx - 9, this.stackBot, 18, engH);
    else if (model.engines.length > 1) {
      const offs = clusterOffsets(eng.engines, eng.bellRadius, eng.bellGap ?? 0.05);
      let R = 0; for (const o of offs) R = Math.max(R, Math.hypot(o.x, o.z) + eng.bellRadius);
      const rc = 22, s = rc / R, ox = 104, oy = bottom - rc - 2;
      this.ring = { ox, oy, rc, br: Math.max(2, eng.bellRadius * s * 0.92) };
      for (const p of model.engines) { const o = offs[p.nz]; this.box(P.indexOf(p), ox + o.x * s - this.ring.br, oy + o.z * s - this.ring.br, this.ring.br * 2, this.ring.br * 2); }
      this.clusterBell = [cx - 12, this.stackBot, 24, engH];
    }
    this.sync(); this.draw();
  }
  detach() { this.model = null; this.sync(); }
  box(j, x, y, w, h) { const b = this.boxes; b[j * 4] = x; b[j * 4 + 1] = y; b[j * 4 + 2] = w; b[j * 4 + 3] = h; }
  // engines win, then fins / legs where they stick out past the body, then the stack part itself
  hit(x, y) {
    const b = this.boxes, P = this.model?.parts; if (!P) return -1;
    const inBody = x >= this.cx - this.bw / 2 && x <= this.cx + this.bw / 2;
    let best = -1, bestR = 0;
    for (let j = 0; j < P.length; j++) {
      if (x < b[j * 4] || x > b[j * 4] + b[j * 4 + 2] || y < b[j * 4 + 1] || y > b[j * 4 + 1] + b[j * 4 + 3]) continue;
      const k = P[j].kind, r = k === 'engine' ? 3 : k === 'fins' ? (inBody ? 0 : 2) : k === 'legs' ? (inBody && y < this.stackBot ? 0 : 2) : 1;
      if (r > bestR) { best = j; bestR = r; }
    }
    return best;
  }

  update(dt, audio) {
    const m = this.model; if (!m) return;
    if (m.warns.length) { for (const w of m.warns) this.say(w.text, w.lv, audio); m.warns.length = 0; }
    for (let i = 0; i < this.lines.length; i++) if (this.lineT[i] > 0) { this.lineT[i] -= dt; if (this.lineT[i] <= 0) this.lines[i].classList.add('gone'); }
    if (this.tapT > 0) { this.tapT -= dt; if (this.tapT <= 0) { this.hover = -1; this.tipNow(); } }
    this.acc += dt; if (this.acc < 0.1) return; this.acc = 0;
    if (!this.on) return;
    this.draw(); this.tipNow();
  }
  // newest line on top; the oldest one gets reused
  say(text, lv, audio) {
    const L = this.lines, n = L.length;
    for (let i = n - 1; i > 0; i--) { L[i].textContent = L[i - 1].textContent; L[i].className = L[i - 1].className; this.lineT[i] = this.lineT[i - 1]; }
    L[0].textContent = text; L[0].className = WCLS[Math.min(3, lv)]; this.lineT[0] = lv >= LV.bad ? 5 : 3.5;
    if (audio && this.on && lv >= LV.warn) audio.alertTick(lv >= LV.bad);
  }
  tipNow() {
    const j = this.hover, P = this.model?.parts;
    if (j < 0 || !P || !P[j]) { this.tip.classList.add('hidden'); return; }
    const p = P[j];
    const why = p.lost ? (p.lost === 'out' ? 'shut down' : p.lost === 'detach' ? 'torn off' : p.lost === 'burn' ? 'burned through' : 'destroyed')
      : p.kind === 'engine' ? `heat ${Math.round(Math.max(p.eHeat, p.heat) * 100)}%` : `load ${Math.round(p.load * 100)}% · heat ${Math.round(p.heat * 100)}%`;
    const fuel = p.fuel >= 0 && !p.lost ? ` · fuel ${Math.round(p.fuel * 100)}%` : '';
    const txt = `<b>${p.name}</b> ${p.lost ? '—' : Math.round(p.hp) + '%'}<small>${why}${fuel}</small>`;
    if (txt !== this.tipTxt) { this.tipTxt = txt; this.tip.innerHTML = txt; }
    this.tip.style.top = Math.max(0, this.boxes[j * 4 + 1] * this.cv.clientHeight / H - 6) + 'px';
    this.tip.classList.remove('hidden');
  }

  draw() {
    const c = this.ctx, m = this.model, P = m.parts, b = this.boxes, t = m.t, dpr = Math.min(2, devicePixelRatio || 1);
    const pw = Math.round(this.cv.clientWidth * dpr) || W, ph = Math.round(this.cv.clientHeight * dpr) || H;
    if (this.cv.width !== pw || this.cv.height !== ph) { this.cv.width = pw; this.cv.height = ph; }
    c.setTransform(pw / W, 0, 0, ph / H, 0, 0); c.clearRect(0, 0, W, H);
    const blink = (t * 4 | 0) % 2 === 0;
    for (let j = 0; j < P.length; j++) {
      const p = P[j], lv = partLevel(p), x = b[j * 4], y = b[j * 4 + 1], w = b[j * 4 + 2], h = b[j * 4 + 3];
      // lost parts fade to a dim ghost over a second; detached ones keep drifting out
      const age = p.lost ? t - p.lostT : 0;
      c.globalAlpha = p.lost ? Math.max(p.lost === 'detach' || p.lost === 'out' ? 0.22 : 0.4, 1 - age * 0.7) : (lv === 3 && !blink ? 0.6 : 1);
      c.fillStyle = FILL[lv]; c.strokeStyle = j === this.hover ? '#ffffff' : EDGE[lv]; c.lineWidth = j === this.hover ? 1.6 : 1;
      const dx = p.lost === 'detach' ? Math.min(10, age * 8) : 0;
      if (p.kind === 'engine') {
        if (this.ring) { c.beginPath(); c.arc(x + w / 2, y + h / 2, w / 2, 0, 6.2832); c.fill(); c.stroke(); }
        else bell(c, x, y, w, h);
      } else if (p.kind === 'nose') nose(c, x, y, w, h, p.id);
      else if (p.kind === 'mount') { c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w - 4, y + h); c.lineTo(x + 4, y + h); c.closePath(); c.fill(); c.stroke(); }
      else if (p.kind === 'fins') { fin(c, x + 9 - dx, y, -1, h); fin(c, x + w - 9 + dx, y, 1, h); }
      else if (p.kind === 'legs') { legs(c, x, y, w, h, dx); }
      else { rr(c, x, y, w, h, 2.5); c.fill(); c.stroke(); }
      if (p.fuel >= 0 && !p.lost && h > 6) {   // fuel bar on the tank's right edge
        c.globalAlpha = 1; c.fillStyle = 'rgba(8,12,16,.55)'; c.fillRect(x + w - 6, y + 2, 3.5, h - 4);
        c.fillStyle = p.fuel < 0.1 ? '#ff6b5e' : '#e6f6ff'; const fh = (h - 4) * p.fuel; c.fillRect(x + w - 6, y + h - 2 - fh, 3.5, fh);
      }
      if (p.lost) {
        c.globalAlpha = 0.85; const col = p.lost === 'out' || p.lost === 'detach' ? '#c9d1d8' : '#ff8e84';
        if (p.kind === 'fins') { cross(c, x - dx, y + h * 0.4, 9, h * 0.6, col); cross(c, x + w - 9 + dx, y + h * 0.4, 9, h * 0.6, col); }
        else if (p.kind !== 'legs') cross(c, x, y, w, h, col);
      }
    }
    c.globalAlpha = 1;
    if (this.ring) {   // the cluster's bell under the mount (side view) + its bottom-view ring of nozzles
      const [x, y, w, h] = this.clusterBell, lv = worst(m.engines);
      c.fillStyle = FILL[lv]; c.strokeStyle = EDGE[lv]; bell(c, x, y, w, h);
      c.strokeStyle = 'rgba(255,255,255,.25)'; c.setLineDash(DASH); c.beginPath(); c.moveTo(x + w, y + h / 2); c.lineTo(this.ring.ox - this.ring.rc - 2, this.ring.oy); c.stroke(); c.setLineDash(SOLID);
      c.beginPath(); c.arc(this.ring.ox, this.ring.oy, this.ring.rc + 2, 0, 6.2832); c.stroke();
      c.fillStyle = 'rgba(233,238,243,.6)'; c.font = '600 7px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText('ENGINES', this.ring.ox, this.ring.oy - this.ring.rc - 5);
    }
  }
}

function worst(list) { let lv = 0, live = 0; for (const p of list) { if (p.lost) continue; live++; const l = partLevel(p); if (l > lv) lv = l; } return live ? lv : LV.lost; }
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
function bell(c, x, y, w, h) { c.beginPath(); c.moveTo(x + w * 0.32, y); c.lineTo(x + w * 0.68, y); c.quadraticCurveTo(x + w * 0.74, y + h * 0.6, x + w, y + h); c.lineTo(x, y + h); c.quadraticCurveTo(x + w * 0.26, y + h * 0.6, x + w * 0.32, y); c.closePath(); c.fill(); c.stroke(); }
function nose(c, x, y, w, h, id) {
  c.beginPath(); c.moveTo(x, y + h);
  if (id === 'nose_dome') c.quadraticCurveTo(x, y, x + w / 2, y), c.quadraticCurveTo(x + w, y, x + w, y + h);
  else { const k = id === 'nose_needle' ? 0.15 : 0.3; c.quadraticCurveTo(x + w * k, y + h * 0.15, x + w / 2, y); c.quadraticCurveTo(x + w * (1 - k), y + h * 0.15, x + w, y + h); }
  c.closePath(); c.fill(); c.stroke();
}
function fin(c, x, y, s, h) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + s * 9, y + h * 0.55); c.lineTo(x + s * 9, y + h); c.lineTo(x, y + h); c.closePath(); c.fill(); c.stroke(); }
function legs(c, x, y, w, h, dx) {
  c.lineWidth = 2; c.strokeStyle = c.fillStyle;
  c.beginPath(); c.moveTo(x + 8 - dx, y); c.lineTo(x + 1 - dx, y + h); c.moveTo(x + w - 8 + dx, y); c.lineTo(x + w - 1 + dx, y + h); c.stroke();
  c.lineWidth = 1;
}
function cross(c, x, y, w, h, col) {
  const s = Math.min(w, h, 14) * 0.38, cx = x + w / 2, cy = y + h / 2;
  c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); c.moveTo(cx - s, cy - s); c.lineTo(cx + s, cy + s); c.moveTo(cx + s, cy - s); c.lineTo(cx - s, cy + s); c.stroke(); c.lineWidth = 1;
}
