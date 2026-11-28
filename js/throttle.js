// Flight throttle and engine cutoff / relight. Keyboard, DualSense and touch all write a 0..1
// command (thr); the sim (engineStep in sim.js) is what ignites, burns fuel and makes thrust.
// Zero command (or below the engine's min throttle) means the engine is off: no thrust, no fuel burn.
// Exhaust, flame light and engine sound already follow f.e.on via flight.js visuals (power = 0 when off).
//
// Controls (flight):
//   Keyboard: X cuts (throttle 0), Z full, Shift or R raises, Ctrl or F lowers, about 50%/s while held.
//   DualSense: R2 is an absolute throttle (same as before; L2 stays zoom-in). L3 (left stick click)
//     cuts the engine — no face or shoulder button was free (✕ launch, ○ end flight, □ assist,
//     △ camera, L1/L2 zoom, R1 chute, R2 throttle).
//   Touch: the existing right-hand slider is absolute; ENGINE ON/OFF toggles cut / relight.
// Relight (Z, raise above min throttle, or ENGINE ON) only works while fuel remains and the engine has not failed.
//
// Cockpit (gb5-cockpit): do not merge that branch here. Each frame FlightMode publishes
//   game.engine  (also window.CH.engine, and flight.engine)
// as { thr, thrCmd, on, state, failed, fuelFrac }.
//   thr      — actual throttle used for thrust (0 when the engine is off), same meaning as d.thr in cockpit-instruments.js
//   thrCmd   — the player's command (the lever / d.thrCmd)
//   on       — engine running (d.engOn)
//   state    — 'ON' | 'OFF' | 'NO FUEL' for the HUD
//   failed   — overheat / fail (d.engFailed)
//   fuelFrac — 0..1
// The gauges can also keep reading the sim directly: f.e.cmd, f.e.thr, f.e.on, f.e.failed, and flight.thr for the lever.

export const RATE = 0.5;
export const PAD_CUT = 10; // standard mapping: L3 (left stick click)

export function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }

export function engineState(e, fuelFrac) {
  if ((fuelFrac ?? 0) <= 0) return 'NO FUEL';
  return e?.on ? 'ON' : 'OFF';
}

export function canRelight(e, fuelFrac) {
  return (fuelFrac ?? 0) > 0 && !e?.failed;
}

// One held "up" and one "down", so Shift+R is still 50%/s (not double). Ctrl is Control only, not Cmd/meta.
export function applyKeys(thr, inp, dt, rate = RATE) {
  const k = c => inp.down?.(c) ? 1 : 0;
  const up = (k('ShiftLeft') || k('ShiftRight') || k('KeyR')) ? 1 : 0;
  const down = (k('ControlLeft') || k('ControlRight') || k('KeyF')) ? 1 : 0;
  if (up !== down) thr = clamp(thr + (up - down) * rate * dt);
  if (inp.hit?.('KeyZ')) thr = 1;
  if (inp.hit?.('KeyX') || inp.hit?.('Pad' + PAD_CUT)) thr = 0;
  return thr;
}

export function padCut(inp) { return !!inp.hit?.('Pad' + PAD_CUT); }

// After a cut, ignore absolute R2 / the touch slider until that source is released, so holding
// R2 or a finger on the slider does not immediately relight.
export function applyAbs(thr, inp, s) {
  const r2 = inp.pad?.b?.[7] || 0, r2On = r2 > 0.04;
  // a fresh touch on the slider after a cut is a new gesture and may relight
  if (s.touchFresh) { s.cutLatch = false; s.touchFresh = false; }
  if (s.cutLatch) {
    if (!r2On && s.touchThr == null) s.cutLatch = false;
    else return thr;
  }
  if (inp.pad && (r2On || s.padThrHeld)) { thr = r2; s.padThrHeld = r2On; }
  if (s.touchThr != null) thr = s.touchThr;
  return thr;
}

export function cut(s) {
  if (s.thr > 0) s.lastThr = s.thr;
  s.thr = 0; s.touchThr = null; s.cutLatch = true;
}

export function toggle(s, e, fuelFrac, minThrottle = 0) {
  const running = e?.on || s.thr > 0;
  if (running) { cut(s); return { ok: true, on: false }; }
  if (!canRelight(e, fuelFrac)) return { ok: false, on: false, dry: (fuelFrac ?? 0) <= 0 };
  s.thr = clamp(Math.max(s.lastThr ?? 0, minThrottle, 1e-6)); s.cutLatch = false;
  return { ok: true, on: true };
}

export function snapshot(thrCmd, e, fuelFrac) {
  const state = engineState(e, fuelFrac);
  return { thr: e?.on ? e.thr : 0, thrCmd: thrCmd ?? e?.cmd ?? 0, on: !!e?.on, state, failed: !!e?.failed, fuelFrac: fuelFrac ?? 0 };
}
