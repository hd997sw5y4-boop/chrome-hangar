// Cockpit glass displays: each one is a canvas texture redrawn from a plain data object (see Cockpit.data()).
// Nothing here reads the sim directly, so a phone layout can reuse the same displays with its own input.
import * as THREE from 'three';
import { engineReadout } from './cockpit-engine.js';

const FONT = '"DejaVu Sans Mono", Consolas, "Roboto Mono", monospace';
const C = { bg: '#05080a', grid: '#16222a', text: '#d8e4ea', dim: '#6d7f88', green: '#4fe08a', cyan: '#5cd6ff', amber: '#ffb23d', red: '#ff4a3d', magenta: '#e070ff', sky: '#2f6fa8', ground: '#7a5530' };
const fmt = (v, d = 0) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Screen {
  constructor(w, h, draw) {
    this.cv = document.createElement('canvas'); this.cv.width = w; this.cv.height = h;
    this.x = this.cv.getContext('2d'); this.draw = draw;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
  }
  update(d) { const x = this.x, { width: w, height: h } = this.cv; x.save(); x.fillStyle = C.bg; x.fillRect(0, 0, w, h); this.draw(x, d, w, h); x.restore(); this.scan(x, w, h); this.tex.needsUpdate = true; }
  scan(x, w, h) { x.fillStyle = 'rgba(255,255,255,0.025)'; for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 1); }
}
const txt = (x, s, px, py, size, col = C.text, align = 'left', weight = 600) => { x.font = `${weight} ${size}px ${FONT}`; x.fillStyle = col; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(s, px, py); };
const box = (x, px, py, w, h, col, lw = 2) => { x.strokeStyle = col; x.lineWidth = lw; x.strokeRect(px, py, w, h); };

// ---- primary flight display: attitude ball, heading tape, speed / altitude tapes ----
function drawPFD(x, d, W, H) {
  const cx = W / 2, cy = H * 0.46, R = W * 0.3, k = R / 35;   // px per degree of pitch
  x.save(); x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
  x.translate(cx, cy); x.rotate(d.roll * Math.PI / 180); x.translate(0, d.pitch * k);
  const g1 = x.createLinearGradient(0, -R * 4, 0, 0); g1.addColorStop(0, '#0c2a4a'); g1.addColorStop(1, C.sky);
  x.fillStyle = g1; x.fillRect(-R * 3, -R * 6, R * 6, R * 6);
  const g2 = x.createLinearGradient(0, 0, 0, R * 4); g2.addColorStop(0, C.ground); g2.addColorStop(1, '#3a2614');
  x.fillStyle = g2; x.fillRect(-R * 3, 0, R * 6, R * 6);
  x.strokeStyle = '#fff'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(-R * 3, 0); x.lineTo(R * 3, 0); x.stroke();
  for (let p = -90; p <= 90; p += 10) {
    if (!p) continue; const y = -p * k, l = p % 30 === 0 ? R * 0.42 : R * 0.26;
    x.lineWidth = 2; x.beginPath(); x.moveTo(-l, y); x.lineTo(l, y); x.stroke();
    if (p % 30 === 0) { txt(x, Math.abs(p), -l - 22, y, 18, '#fff', 'center'); txt(x, Math.abs(p), l + 22, y, 18, '#fff', 'center'); }
  }
  x.restore();
  // ball ring, roll scale, fixed aircraft symbol
  x.strokeStyle = '#9aa7ad'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.stroke();
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const t = (a - 90) * Math.PI / 180, l = a % 30 === 0 ? 16 : 9; x.beginPath(); x.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); x.lineTo(cx + Math.cos(t) * (R + l), cy + Math.sin(t) * (R + l)); x.stroke(); }
  x.save(); x.translate(cx, cy); x.rotate(d.roll * Math.PI / 180); x.fillStyle = C.amber; x.beginPath(); x.moveTo(0, -R + 2); x.lineTo(-9, -R + 18); x.lineTo(9, -R + 18); x.fill(); x.restore();
  x.strokeStyle = C.amber; x.lineWidth = 6; x.beginPath(); x.moveTo(cx - R * 0.55, cy); x.lineTo(cx - R * 0.18, cy); x.lineTo(cx - R * 0.1, cy + 12); x.moveTo(cx + R * 0.55, cy); x.lineTo(cx + R * 0.18, cy); x.lineTo(cx + R * 0.1, cy + 12); x.stroke();
  x.fillStyle = C.amber; x.fillRect(cx - 4, cy - 4, 8, 8);
  // speed tape (left) and altitude tape (right)
  const tape = (px, val, step, label, unit, col) => {
    const tw = 92, th = R * 2, ty = cy - R;
    x.fillStyle = 'rgba(20,30,36,0.9)'; x.fillRect(px, ty, tw, th); box(x, px, ty, tw, th, '#33444c');
    x.save(); x.beginPath(); x.rect(px, ty, tw, th); x.clip();
    const ppu = 46 / step, base = Math.floor(val / step) * step;
    for (let i = -5; i <= 5; i++) { const v = base + i * step, y = cy - (v - val) * ppu; x.strokeStyle = C.dim; x.lineWidth = 2; x.beginPath(); x.moveTo(px + (col === 'L' ? tw - 14 : 0), y); x.lineTo(px + (col === 'L' ? tw : 14), y); x.stroke(); txt(x, fmt(v), px + tw / 2, y, 17, C.dim, 'center'); }
    x.restore();
    x.fillStyle = '#000'; x.fillRect(px - 4, cy - 20, tw + 8, 40); box(x, px - 4, cy - 20, tw + 8, 40, '#fff', 2);
    txt(x, fmt(val), px + tw / 2, cy, 22, '#fff', 'center', 700);
    txt(x, label, px + tw / 2, ty - 16, 16, C.cyan, 'center'); txt(x, unit, px + tw / 2, ty + th + 16, 15, C.dim, 'center');
  };
  tape(14, d.speed, d.speed > 400 ? 100 : 20, 'SPD', 'M/S', 'L');
  const altStep = d.alt > 20000 ? 5000 : d.alt > 2000 ? 500 : 50;
  tape(W - 106, d.alt, altStep, 'ALT', 'M', 'R');
  // vertical speed readout
  txt(x, (d.vs >= 0 ? '+' : '') + fmt(d.vs, Math.abs(d.vs) < 10 ? 1 : 0), W - 60, cy + R + 44, 18, d.vs < -20 ? C.amber : C.green, 'center');
  txt(x, 'V/S', W - 60, cy + R + 66, 14, C.dim, 'center');
  // heading tape
  const hy = H - 58, hw = W * 0.56, hx = cx - hw / 2;
  x.fillStyle = 'rgba(20,30,36,0.9)'; x.fillRect(hx, hy, hw, 40); box(x, hx, hy, hw, 40, '#33444c');
  x.save(); x.beginPath(); x.rect(hx, hy, hw, 40); x.clip();
  const ppd = 4, h0 = Math.floor(d.hdg / 10) * 10;
  for (let i = -7; i <= 7; i++) {
    const v = h0 + i * 10, px = cx + (v - d.hdg) * ppd, vv = ((v % 360) + 360) % 360;
    x.strokeStyle = C.dim; x.lineWidth = 2; x.beginPath(); x.moveTo(px, hy); x.lineTo(px, hy + (vv % 30 ? 8 : 14)); x.stroke();
    if (vv % 30 === 0) txt(x, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[vv] ?? String(vv / 10).padStart(2, '0'), px, hy + 27, 16, vv % 90 ? C.text : C.cyan, 'center');
  }
  x.restore();
  x.fillStyle = '#000'; x.fillRect(cx - 34, hy - 30, 68, 26); box(x, cx - 34, hy - 30, 68, 26, '#fff');
  txt(x, String(Math.round(((d.hdg % 360) + 360) % 360)).padStart(3, '0'), cx, hy - 17, 18, '#fff', 'center', 700);
  txt(x, 'PFD', 16, 18, 15, C.dim); txt(x, d.assist ? 'HOLD UPRIGHT' : 'MANUAL', W - 16, 18, 15, d.assist ? C.green : C.amber, 'right');
  txt(x, 'PITCH ' + fmt(d.pitch) + '\u00b0', W / 2, 18, 15, C.text, 'center');
}

// ---- propulsion / stages: fuel per tank, stage lights, burn time ----
function drawSYS(x, d, W, H) {
  txt(x, 'PROP / STAGES', 16, 22, 17, C.cyan);
  txt(x, d.phaseLabel, W - 16, 22, 16, d.phase === 'crashed' ? C.red : C.green, 'right');
  const n = Math.max(1, d.tanks.length), top = 56, bh = H * 0.5, gap = 12, bw = Math.min(70, (W - 40 - gap * (n - 1)) / n), x0 = (W - (bw * n + gap * (n - 1))) / 2;
  d.tanks.forEach((t, i) => {
    const px = x0 + i * (bw + gap), col = t.state === 'active' ? C.green : t.state === 'spent' ? '#3a4448' : C.cyan;
    x.fillStyle = '#0e171c'; x.fillRect(px, top, bw, bh); box(x, px, top, bw, bh, '#3b4c55');
    const fh = bh * clamp(t.frac, 0, 1); x.fillStyle = t.frac < 0.15 && t.state === 'active' ? C.amber : col; x.globalAlpha = 0.85; x.fillRect(px + 3, top + bh - fh, bw - 6, fh); x.globalAlpha = 1;
    for (let q = 1; q < 4; q++) { x.fillStyle = '#05080a'; x.fillRect(px, top + bh * q / 4, 8, 2); }
    txt(x, fmt(t.frac * 100) + '%', px + bw / 2, top + bh + 18, 15, C.text, 'center');
    txt(x, 'S' + (i + 1), px + bw / 2, top + bh + 40, 16, col, 'center', 700);
    // stage light
    const ly = top + bh + 66; x.beginPath(); x.arc(px + bw / 2, ly, 9, 0, Math.PI * 2);
    x.fillStyle = t.state === 'active' ? C.green : t.state === 'spent' ? '#2a2f31' : '#e8eef0'; x.fill();
  });
  const y = H - 92;
  x.strokeStyle = C.grid; x.lineWidth = 2; x.beginPath(); x.moveTo(16, y - 16); x.lineTo(W - 16, y - 16); x.stroke();
  txt(x, 'TOTAL', 20, y + 6, 15, C.dim); txt(x, fmt(d.fuelFrac * 100, 1) + ' %', 20, y + 32, 22, d.fuelFrac < 0.15 ? C.amber : C.text);
  txt(x, 'BURN LEFT', W / 2, y + 6, 15, C.dim, 'center'); txt(x, d.burnLeft == null ? '--' : fmt(d.burnLeft, 0) + ' s', W / 2, y + 32, 22, C.text, 'center');
  txt(x, 'APEX', W - 20, y + 6, 15, C.dim, 'right'); txt(x, fmt(d.apex) + ' m', W - 20, y + 32, 22, C.text, 'right');
  txt(x, 'ACTIVE \u25cf  NEXT \u25cb  SPENT \u25aa', W / 2, H - 16, 13, C.dim, 'center');
}

// ---- engine: throttle arc (command vs actual), chamber temp, thrust, G, dynamic pressure ----
function arcGauge(x, cx, cy, r, v, lo, hi, label, val, col, mark) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, t = a0 + (a1 - a0) * clamp((v - lo) / (hi - lo), 0, 1);
  x.lineCap = 'butt'; x.strokeStyle = '#1d2a31'; x.lineWidth = 14; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke();
  x.strokeStyle = col; x.beginPath(); x.arc(cx, cy, r, a0, t); x.stroke();
  if (mark != null) { const m = a0 + (a1 - a0) * clamp((mark - lo) / (hi - lo), 0, 1); x.strokeStyle = C.magenta; x.lineWidth = 4; x.beginPath(); x.moveTo(cx + Math.cos(m) * (r - 14), cy + Math.sin(m) * (r - 14)); x.lineTo(cx + Math.cos(m) * (r + 14), cy + Math.sin(m) * (r + 14)); x.stroke(); }
  x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(t) * (r - 4), cy + Math.sin(t) * (r - 4)); x.stroke();
  txt(x, val, cx, cy + r * 0.55, 22, '#fff', 'center', 700); txt(x, label, cx, cy + r + 4, 15, C.dim, 'center');
}
function drawENG(x, d, W, H) {
  const st = engineReadout(d);
  const stCol = d.engFailed ? C.red : st === 'ON' ? C.green : st === 'NO FUEL' ? C.amber : C.dim;
  txt(x, 'ENGINE', 16, 22, 17, C.cyan);
  x.beginPath(); x.arc(W - 118, 22, 7, 0, Math.PI * 2); x.fillStyle = stCol; x.fill();
  txt(x, st, W - 16, 22, 16, stCol, 'right');
  arcGauge(x, W * 0.28, 140, 74, d.thr * 100, 0, 100, 'THROTTLE %', fmt(d.thr * 100), C.green, d.thrCmd * 100);
  const hc = d.heat > 80 ? C.red : d.heat > 55 ? C.amber : C.cyan;
  arcGauge(x, W * 0.72, 140, 74, d.temp, 0, Math.max(1, d.limitTemp), 'CHAMBER \u00b0C', fmt(d.temp), hc);
  const rows = [['THRUST', fmt(d.thrust, 1) + ' kN', C.text], ['ACCEL', fmt(d.g, 2) + ' G', d.g > 4.5 ? C.amber : C.text], ['DYN PRESS', fmt(d.q / 1000, 1) + ' kPa', d.q > 30000 ? C.amber : C.text], ['ENG HEAT', fmt(d.heat) + ' %', hc], ['WIND', fmt(d.wind, 1) + ' m/s', C.text]];
  rows.forEach(([a, b, c], i) => { const y = 268 + i * 44; x.fillStyle = i % 2 ? '#0a1216' : '#0d171c'; x.fillRect(16, y - 20, W - 32, 40); txt(x, a, 28, y, 17, C.dim); txt(x, b, W - 28, y, 21, c, 'right', 700); });
  const by = H - 22, bw = W - 32; x.fillStyle = '#1d2a31'; x.fillRect(16, by - 8, bw, 12); x.fillStyle = hc; x.fillRect(16, by - 8, bw * clamp(d.heat / 100, 0, 1), 12);
}

// ---- Moon range (round display, hidden when the world has no Moon) ----
function drawMOON(x, d, W, H) {
  const cx = W / 2, cy = H / 2;
  x.strokeStyle = '#33444c'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, W * 0.44, 0, Math.PI * 2); x.stroke();
  txt(x, 'MOON', cx, cy - 58, 20, C.cyan, 'center');
  const km = (d.moon ?? 0) / 1000;
  txt(x, km >= 1000 ? fmt(km) : fmt(km, 1), cx, cy, km >= 100000 ? 30 : 36, '#fff', 'center', 700);
  txt(x, 'KM', cx, cy + 36, 18, C.dim, 'center');
  if (d.moonRate != null) txt(x, (d.moonRate <= 0 ? '\u25bc ' : '\u25b2 ') + fmt(Math.abs(d.moonRate)) + ' m/s', cx, cy + 70, 16, d.moonRate <= 0 ? C.green : C.amber, 'center');
}

// ---- annunciator panel ----
export const CAUTIONS = ['LOW FUEL', 'ENG HOT', 'HIGH G', 'MAX Q', 'ENG FAIL', 'LEGS UP', 'CHUTE', 'GUSTS'];
function drawANN(x, d, W, H) {
  const cols = 4, rows = 2, cw = W / cols, ch = H / rows;
  CAUTIONS.forEach((n, i) => {
    const on = d.cautions[n], px = (i % cols) * cw, py = Math.floor(i / cols) * ch, warn = n === 'ENG FAIL';
    x.fillStyle = on ? (warn ? '#ff3b2e' : '#ffae2e') : '#141414'; x.fillRect(px + 6, py + 6, cw - 12, ch - 12);
    x.strokeStyle = '#000'; x.lineWidth = 4; x.strokeRect(px + 6, py + 6, cw - 12, ch - 12);
    txt(x, n, px + cw / 2, py + ch / 2, 26, on ? '#1a0e00' : '#3a3a3a', 'center', 800);
  });
}

export class Instruments {
  constructor() {
    this.pfd = new Screen(512, 512, drawPFD); this.sys = new Screen(512, 512, drawSYS); this.eng = new Screen(512, 512, drawENG);
    this.moon = new Screen(256, 256, drawMOON); this.ann = new Screen(512, 160, drawANN);
    this.list = [this.pfd, this.sys, this.eng, this.moon, this.ann]; this.i = 0; this.t = 0;
  }
  // round-robin: one or two displays per frame at ~20 Hz each, so no single frame pays for all five canvases
  update(dt, d, force = false) {
    if (force) { for (const s of this.list) s.update(d); return; }
    this.t += dt; const per = 1 / (20 * this.list.length);
    let n = 0; while (this.t >= per && n < 2) { this.t -= per; n++; const s = this.list[this.i++ % this.list.length]; if (s !== this.moon || d.moon != null) s.update(d); }
    if (this.t > per * 4) this.t = 0;
  }
}
