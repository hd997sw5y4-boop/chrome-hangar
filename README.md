# Chrome Hangar (v1 web slice)

Stand in a quiet hangar, bolt a metal rocket together, static-fire it on the test stand, then launch it.

Play: https://chrome-hangar.vercel.app

What's in it now: real Guadalupe-dunes terrain (USGS elevation + aerial colour) with CC0 props, four time-of-day HDRI skies,
19 parts, eight flight views (free orbit with drag/wheel/pinch zoom, chase, viewing stand, pad, onboard, engine, director, map),
and the whole NASA Earth with stars and an atmosphere rim as you climb (range top 400 km).

Static three.js site, no build step. three.js r187 is vendored in `vendor/`.

- `index.html`, `css/style.css`: UI
- `js/main.js`: boot, menus, missions, Free Mode (open play, no objectives or results cards), saves, settings, results
- `js/build.js`, `js/train.js`: hangar build plus Training (menu button; part-by-part rocket facts, then flight controls; Skip always available)
- `js/testfire.js`: test stand static fire
- `js/flight.js`: launch, cameras, assists, landing guide, failures
- `js/sim.js`: fixed-step single-rigid-body flight + engine/heat model, cluster engine-out (pure JS)
- `js/health.js`, `js/healthui.js`: live part health (load vs max-Q / g, re-entry heat, engine heat, fin loss) and the flight's Rocket health panel (P or Settings hides it)
- `js/rocket.js`: part data, layout, mass / CoM / CoP stats, snap rules (pure JS)
- `js/parts3d.js`, `js/env.js` (renderer, HDRI skies), `js/fx.js`, `js/audio.js`, `js/input.js`
- `js/cart.js`, `js/cartcourse.js`, `js/bodies.js`: drivable golf cart (model in `assets/models/golf_cart.glb`, credited in CREDITS.md; E in/out, WASD, Space handbrake, R flip, C horn/call the robot, V view, L lights; DualSense/Xbox: L-stick, R2/L2, △ in/out, ✕ handbrake, ○ flip, □ horn), apron jump ramps, cone slalom and knock-over props
- `js/robotbreak.js`: robot rides shotgun, breaks into pieces on a hard hit, the other robot welds him back together (self-reassembly fallback)
- `js/terrain.js`, `js/outdoor.js`: DEM terrain LOD, ocean, range structures, scatter
- `js/earth.js`: planet pass (NASA Blue Marble / Black Marble) for high altitude
- `js/moon.js`, `js/orbit.js`, `js/timewarp.js`, `js/spaceview.js`: Moon flight (Free Mode). Above 70 km the rocket switches to
  real orbital mechanics: Earth (g0 at 6371 km) and the Moon (384,400 km, 1737 km radius, 1.62 m/s^2) with patched conics (Moon
  sphere of influence ~66,000 km), the Moon on a fixed circular orbit (sidereal 27.32 d) placed from the real date, the pad at its
  real latitude / longitude on a spinning Earth. Coasting is analytic (Kepler), so time warp (`,` / `.`, up to 100,000x; 10x
  under thrust or low) is exact. Q points the rocket (prograde, retrograde, radial, normal). Predicted path + Moon / Earth markers;
  floating-origin renderer for deep space and the lunar surface (NASA LRO colour map). Below 12 km over the Moon, once slow sideways,
  the normal landing sim takes over at 1.62 m/s^2 with no air: same legs / speed / tilt rules; the rocket stays landed until you
  throttle up or press Back ("Landed on the Moon" on the results). No free delta-v: the pad shows what the trip needs
  (~13.5 km/s from the pad, ~4 km/s from orbit) and "Moon practice" starts a build in a 200 km orbit. Tests: `node tests/moon.test.mjs`.
- `tools/`: DEM + imagery converter, HDRI sun analysis, credits generator
- `data/parts/*.json`: one file per part (add a part = add a file + list it in `index.json`)
- `data/missions.json`

Run locally: `python3 -m http.server` and open http://localhost:8000. Credits: `CREDITS.md`.
