// Parts tray behaviour, ported from Window Workshop 3D's tray (tray2.js) and tuned for Chrome Hangar:
// - mouse wheel (and trackpad) scrolls the row sideways with an eased glide; the page never scrolls
// - drag the row sideways (mouse or touch) to scroll it, with momentum, friction and a soft edge bounce
// - a press on a card that barely moves is a tap (pick the part); a drag up out of the tray carries the part
//   onto the rocket; a sideways drag scrolls instead and never picks by accident
// - one delegated listener on the tray, so the first click after the tray is rebuilt (unlocks, tutorial) always lands
// - reveal(card) glides a card into view (keys, pad bumpers and the wheel-while-locked pick)
export class Tray {
  constructor(el, { onTap, onDragOut, onHover } = {}) {
    this.el = el; this.onTap = onTap; this.onDragOut = onDragOut; this.onHover = onHover;
    this.v = 0; this.ov = 0; this.target = null; this.raf = 0; this.press = null; this.lastHover = null;
    el.style.touchAction = 'none'; el.style.overscrollBehavior = 'contain';
    el.addEventListener('wheel', e => this.wheel(e), { passive: false });
    el.addEventListener('pointerdown', e => this.down(e));
    addEventListener('pointermove', e => this.move(e), { passive: false });
    addEventListener('pointerup', e => this.up(e));
    addEventListener('pointercancel', e => { if (this.press && e.pointerId === this.press.id) { this.press = null; this.el.classList.remove('dragging'); this.settle(); } });
    el.addEventListener('pointerover', e => { const c = e.target.closest?.('.tile'); if (c && c !== this.lastHover) { this.lastHover = c; this.onHover?.(c); } });
    el.addEventListener('pointerleave', () => { this.lastHover = null; });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  get max() { return Math.max(0, this.el.scrollWidth - this.el.clientWidth); }
  setOv(o) { this.ov = o; this.el.style.setProperty('--trayOv', o ? o.toFixed(1) + 'px' : '0px'); }   // edge bounce (CSS shifts the sections)
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.v = 0; this.target = null; }
  // wheel: vertical or horizontal deltas glide the row toward a target (lines and pages normalised to pixels)
  wheel(e) {
    const raw = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    e.preventDefault(); e.stopPropagation();
    if (!raw || this.max <= 0) return;
    const d = raw * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? this.el.clientWidth : 1);
    this.v = 0;
    this.target = Math.max(0, Math.min(this.max, (this.target ?? this.el.scrollLeft) + d * 1.1));
    this.loop();
  }
  reveal(card) {
    if (!card) return;
    const r = card.getBoundingClientRect(), b = this.el.getBoundingClientRect(), pad = 24;
    let t = null;
    if (r.left < b.left + pad) t = this.el.scrollLeft - (b.left + pad - r.left);
    else if (r.right > b.right - pad) t = this.el.scrollLeft + (r.right - (b.right - pad));
    if (t != null) { this.v = 0; this.target = Math.max(0, Math.min(this.max, t)); this.loop(); }
  }
  down(e) {
    if (e.button > 0) return;
    this.stop(); this.setOv(0);
    const card = e.target.closest?.('.tile');
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, s: this.el.scrollLeft, card, mode: null, lx: e.clientX, lt: performance.now(), v: 0, touch: e.pointerType !== 'mouse' };
    if (e.pointerType === 'mouse') e.preventDefault();   // no text selection / native image drag
  }
  move(e) {
    const p = this.press; if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) { p.mode = 'scroll'; this.el.classList.add('dragging'); }
      else if (-dy > 16 && -dy > Math.abs(dx) && p.card) { p.mode = 'out'; this.onDragOut?.(p.card, e); return; }
      else return;
    }
    if (p.mode !== 'scroll') return;
    const now = performance.now(), dt = Math.max(1, now - p.lt);
    p.v = p.v * 0.6 + ((e.clientX - p.lx) / dt) * 0.4; p.lx = e.clientX; p.lt = now;
    const want = p.s - dx, m = this.max;
    if (want < 0) { this.el.scrollLeft = 0; this.setOv(-want * 0.35); }
    else if (want > m) { this.el.scrollLeft = m; this.setOv(-(want - m) * 0.35); }
    else { this.el.scrollLeft = want; this.setOv(0); }
    e.preventDefault();
  }
  up(e) {
    const p = this.press; if (!p || e.pointerId !== p.id) return;
    this.press = null; this.el.classList.remove('dragging');
    if (p.mode === 'scroll') {
      this.v = performance.now() - p.lt > 120 ? 0 : -p.v * 16.7;   // px per 60 Hz frame
      this.loop(); return;
    }
    if (p.mode === 'out') return;
    // a tap: began and ended on the same card and barely moved
    const el = document.elementFromPoint(e.clientX, e.clientY), same = el?.closest?.('.tile') === p.card;
    if (p.card && same && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 12) this.onTap?.(p.card, e);
    this.settle();
  }
  settle() { if (this.ov) this.loop(); }
  loop() {
    if (this.raf) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now(), k = Math.min(3, (now - last) / 16.7); last = now;
      let busy = false;
      if (this.target != null) {
        // the browser rounds scrollLeft, so a sub-pixel step would never land: snap the last couple of pixels,
        // and re-clamp in case the row got shorter mid-glide (otherwise the loop would chase an unreachable target)
        const t = Math.min(this.target, this.max), cur = this.el.scrollLeft, d = t - cur;
        if (Math.abs(d) < 1.5) { this.el.scrollLeft = t; this.target = null; }
        else { this.el.scrollLeft = cur + Math.sign(d) * Math.max(1, Math.abs(d) * (1 - Math.pow(1 - 0.2, k))); busy = true; }
      } else if (Math.abs(this.v) > 0.15) {
        const m = this.max, nx = this.el.scrollLeft + this.v * k;
        if (nx < 0 || nx > m) { this.el.scrollLeft = Math.max(0, Math.min(m, nx)); this.setOv(this.ov - this.v * k * 0.3); this.v *= Math.pow(0.6, k); }
        else this.el.scrollLeft = nx;
        this.v *= Math.pow(0.94, k); busy = true;
      }
      if (this.ov) { this.setOv(Math.abs(this.ov) < 0.5 ? 0 : this.ov * Math.pow(0.8, k)); busy = busy || !!this.ov; }
      this.raf = busy ? requestAnimationFrame(step) : 0;
    };
    this.raf = requestAnimationFrame(step);
  }
}
