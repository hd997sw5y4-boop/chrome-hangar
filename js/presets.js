// Prebuilt rockets (read-only): shown in the Saved rockets panel as "Prebuilt" (main.js showSaves). Loading one copies it onto the
// stand like a saved rocket; nothing here changes any part's numbers.
const S = (p, o = {}) => ({ p, ...o });
let FINS = 2; export const setFins = k => { FINS = k; };
const n = (k, p) => Array.from({ length: k }, () => S(p));
// Moon Rocket (gb3-wide): Saturn V proportions, 10 m wide and about 10 times as tall, with physical tank densities. Four stages:
// 1 Wide Booster Engine (5 bells) + 3 Wide Booster Tanks (fins on the bottom one); 2 Wide Hydrogen Engine + 3 Wide Hydrogen Tanks;
// 3 Wide Hydrogen Engine + 1 Wide Hydrogen Tank + the Wide Adapter down to 4 m; 4 the lander: Lunar Descent Engine, Lander Tank
// with legs and the Crew Capsule on top (the cockpit view rides in it).
export const moonRocket = () => ({
  engine: 'wide_booster_engine',
  stack: [S('wide_mount'), S('wide_tank_kero', { fins: FINS }), ...n(2, 'wide_tank_kero'), S('wide_decoupler'),
    S('wide_mount', { engine: 'wide_hydro_engine' }), ...n(3, 'wide_tank_hydro'), S('wide_decoupler'),
    S('wide_mount', { engine: 'wide_hydro_engine' }), S('wide_tank_hydro'), S('wide_adapter'), S('mid_decoupler'),
    S('mid_mount', { engine: 'lunar_engine' }), S('lander_tank', { legs: true }), S('crew_capsule')],
});
export const PREBUILT = [
  { id: 'moon_rocket', name: 'Moon Rocket', rocket: moonRocket, blurb: 'Saturn-sized: 10 m wide, four stages, pad to a Moon landing. Free Mode: launch, then press Autopilot (J) and watch, or fly it yourself.' },
];
