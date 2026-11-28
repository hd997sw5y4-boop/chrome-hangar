// Prebuilt rockets (read-only): shown in the Saved rockets panel as "Prebuilt" (main.js showSaves). Loading one copies it onto the
// stand like a saved rocket; nothing here changes any part's numbers.
const S = (p, o = {}) => ({ p, ...o });
const n = (k, p) => Array.from({ length: k }, () => S(p));
// Moon Rocket: four stages. 1 Saturn Booster Engine + 7 Saturn Booster Tanks (two fin pairs on each of the bottom two); 2 and 3 a Hydrogen Upper Engine
// on 6 and 2 Hydrogen Tanks; 4 a Flicker lander (it throttles low, so it can nearly hover on the Moon) with legs and a Dome Cap.
export const moonRocket = () => ({
  engine: 'saturn_engine',
  stack: [S('mount'), S('tank_saturn', { fins: 2 }), S('tank_saturn', { fins: 2 }), ...n(5, 'tank_saturn'), S('decoupler'),
    S('mount', { engine: 'hydro_upper' }), ...n(6, 'tank_hydro'), S('decoupler'),
    S('mount', { engine: 'hydro_upper' }), ...n(2, 'tank_hydro'), S('decoupler'),
    S('mount', { engine: 'flicker' }), S('tank_short', { legs: true }), S('nose_dome')],
});
export const PREBUILT = [
  { id: 'moon_rocket', name: 'Moon Rocket', rocket: moonRocket, blurb: 'Four stages, pad to a Moon landing. Free Mode: launch, then press Autopilot (J) and watch, or fly it yourself.' },
];
