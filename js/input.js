// Unified input: keyboard + mouse (pointer lock), DualSense/standard gamepads, and touch.
// Safety rules carried over from Window Workshop: standard mapping only, radial deadzone,
// arm a pad on its first real press, and clear held input on blur / menus.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set();
    this.look = { x: 0, y: 0 }; this.move = { x: 0, y: 0 }; this.steer = { x: 0, y: 0 };
    this.mouse = { x: 0, y: 0, clicked: false, right: false };
    this.taps = []; this.throttleAbs = null; this.padArmed = false; this.padPrev = []; this.padActive = false;
    this.sens = 1; this.invertY = false; this.locked = false; this.enabled = true;
    this.touchMove = { x: 0, y: 0 };
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add((e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight' ? 'Shift+' : '') + e.code);
      this.keys.add(e.code); this.lastDevice = 'kb';
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    const clear = () => { this.keys.clear(); this.throttleAbs = null; this.touchMove = { x: 0, y: 0 }; };
    addEventListener('blur', clear); document.addEventListener('visibilitychange', clear);
    this.clearHeld = clear;
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.clicked = true; if (e.button === 2) this.mouse.right = true;
      this.lastDevice = 'kb';
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) { this.look.x += e.movementX * 0.0022 * this.sens; this.look.y += e.movementY * 0.0022 * this.sens * (this.invertY ? -1 : 1); }
      else if (this.dragging) { this.look.x += e.movementX * 0.004 * this.sens; this.look.y += e.movementY * 0.004 * this.sens * (this.invertY ? -1 : 1); }
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) clear(); });
    this.initTouch();
  }
  requestLock() { if (!this.isTouch && document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {} } }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  hit(code) { return this.pressed.has(code); }
  down(code) { return this.keys.has(code); }

  initTouch() {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const c = this.canvas, touches = new Map();
    c.addEventListener('touchstart', e => {
      e.preventDefault(); this.lastDevice = 'touch';
      for (const t of e.changedTouches) touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0 });
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); if (!s) continue;
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        s.moved += Math.abs(dx) + Math.abs(dy); s.x = t.clientX; s.y = t.clientY;
        this.look.x += dx * 0.006 * this.sens; this.look.y += dy * 0.006 * this.sens * (this.invertY ? -1 : 1);
      }
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); touches.delete(t.identifier);
        if (s && s.moved < 14 && performance.now() - s.t0 < 450) this.taps.push({ x: t.clientX, y: t.clientY });
      }
    };
    c.addEventListener('touchend', end); c.addEventListener('touchcancel', end);
  }
  // on-screen stick element -> target vector object (written into this[key])
  bindStick(el, key) {
    const knob = el.querySelector('.knob'); let id = null, cx = 0, cy = 0, R = 1;
    const set = (x, y) => { this[key] = { x, y }; knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`; };
    el.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; id = t.identifier; const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2; this.lastDevice = 'touch'; }, { passive: false });
    el.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) { let x = (t.clientX - cx) / R, y = (t.clientY - cy) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } set(x, y); }
    }, { passive: false });
    const up = e => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; set(0, 0); } };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null; for (const g of pads) if (g && g.connected && g.mapping === 'standard') { p = g; break; }
    this.pad = null; if (!p) return;
    const b = p.buttons.map(x => x.value);
    if (!this.padArmed) { if (b.some((v, i) => v > 0.5 && i !== 6 && i !== 7) || p.axes.slice(0, 4).some(a => Math.abs(a) > 0.6)) this.padArmed = true; else return; }
    const dz = (x, y) => { const l = Math.hypot(x, y); if (l < 0.18) return { x: 0, y: 0 }; const k = (l - 0.18) / 0.82 / l; return { x: x * k, y: y * k }; };
    const L = dz(p.axes[0], p.axes[1]), R = dz(p.axes[2], p.axes[3]);
    this.pad = { L, R, b };
    for (let i = 0; i < b.length; i++) if (b[i] > 0.5 && !(this.padPrev[i] > 0.5)) { this.pressed.add('Pad' + i); this.lastDevice = 'pad'; }
    if (Math.hypot(L.x, L.y, R.x, R.y) > 0) this.lastDevice = 'pad';
    if (b[7] > 0.04 || (this.padPrev[7] > 0.04)) this.padThrottle = b[7];
    this.padPrev = b;
  }

  // called once per frame by the game
  update(dt) {
    this.pollPad();
    const k = c => this.keys.has(c) ? 1 : 0;
    this.move = { x: k('KeyD') - k('KeyA') + this.touchMove.x, y: k('KeyS') - k('KeyW') + this.touchMove.y };
    this.steer = { x: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + this.touchMove.x, y: k('KeyS') + k('ArrowDown') - k('KeyW') - k('ArrowUp') + this.touchMove.y };
    if (this.pad) {
      const { L, R } = this.pad;
      this.move.x += L.x; this.move.y += L.y; this.steer.x += L.x; this.steer.y += L.y;
      this.look.x += R.x * 2.6 * dt * this.sens; this.look.y += R.y * 2.6 * dt * this.sens * (this.invertY ? -1 : 1);
    }
    for (const v of [this.move, this.steer]) { const l = Math.hypot(v.x, v.y); if (l > 1) { v.x /= l; v.y /= l; } }
  }
  endFrame() { this.pressed.clear(); this.look.x = this.look.y = 0; this.mouse.clicked = false; this.mouse.right = false; this.taps.length = 0; }
}
