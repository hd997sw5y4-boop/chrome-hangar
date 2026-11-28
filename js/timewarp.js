// Time warp for the coast between the Earth and the Moon (1x .. 100,000x). Pure JS.
// The space leg propagates coasting arcs analytically (orbit.js coast), so warp never changes the physics, only how much
// sim time passes per real second. Limits: no warp on the range or the Moon's surface frame (the rigid-body sim), at most
// 10x while the engine burns or low over a body, and moderate warp near a body so the per-frame arcs stay short.
export const WARPS = [1, 10, 100, 1000, 10000, 100000];
export function warpCap({ flat = false, thrust = false, body = 'E', alt = Infinity }) {
  if (flat) return 1;
  if (thrust) return 10;
  if (body === 'E' && alt < 150e3) return 10;
  if (body === 'M' && alt < 40e3) return 10;
  if (body === 'M' && alt < 300e3) return 1000;
  if (body === 'E' && alt < 3000e3) return 1000;
  return 100000;
}
export class TimeWarp {
  constructor() { this.i = 0; this.limited = false; }
  get k() { return WARPS[this.i]; }
  reset() { this.i = 0; this.limited = false; }
  up(cap) { if (WARPS[this.i + 1] && WARPS[this.i + 1] <= cap) { this.i++; return true; } return false; }
  down() { if (this.i > 0) { this.i--; return true; } return false; }
  // lower the level to the cap; true if it had to drop
  clamp(cap) { let d = false; while (this.i > 0 && WARPS[this.i] > cap) { this.i--; d = true; } return d; }
}
