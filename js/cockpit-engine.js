// Map window.CH.engine (gb3-throttle: { thr, thrCmd, on, state, failed, fuelFrac }) onto gauge fields.
// Fall back to the sim when the hook is missing. state is 'ON' | 'OFF' | 'NO FUEL'.
export function engineGauges(e, simFuel, pub) {
  const has = !!(pub && typeof pub === 'object');
  const on = has ? !!pub.on : !!e?.on;
  const failed = has ? !!pub.failed : !!e?.failed;
  const thr = has ? (pub.thr ?? 0) : ((e?.thr ?? 0) * (on ? 1 : 0));
  const thrCmd = has ? (pub.thrCmd ?? 0) : (e?.cmd ?? 0);
  const fuelFrac = has ? (pub.fuelFrac ?? 0) : (simFuel ?? 0);
  const state = (has && pub.state) || (fuelFrac <= 0 ? 'NO FUEL' : (on ? 'ON' : 'OFF'));
  return { thr, thrCmd, on, failed, fuelFrac, state };
}
export function engineReadout(d) {
  return d.engState || (d.engOn ? 'ON' : ((d.fuelFrac ?? 0) <= 0 ? 'NO FUEL' : 'OFF'));
}
