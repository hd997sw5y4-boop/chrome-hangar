# Chrome Hangar (v1 web slice)

Stand in a quiet hangar, bolt a metal rocket together, static-fire it on the test stand, then launch it.

Play: https://chrome-hangar.vercel.app

What's in it now: real Guadalupe-dunes terrain (USGS elevation + aerial colour) with CC0 props, four time-of-day HDRI skies,
19 parts, eight flight views (free orbit with drag/wheel/pinch zoom, chase, viewing stand, pad, onboard, engine, director, map),
and the whole NASA Earth with stars and an atmosphere rim as you climb (range top 400 km).

Static three.js site, no build step. three.js r187 is vendored in `vendor/`.

- `index.html`, `css/style.css`: UI
- `js/main.js`: boot, menus, missions, saves, settings, results
- `js/build.js`: first-person hangar, tray, snapping, undo/redo, checkout panel, tutorial
- `js/testfire.js`: test stand static fire
- `js/flight.js`: launch, cameras, assists, landing guide, failures
- `js/sim.js`: fixed-step single-rigid-body flight + engine/heat model (pure JS)
- `js/rocket.js`: part data, layout, mass / CoM / CoP stats, snap rules (pure JS)
- `js/parts3d.js`, `js/env.js` (renderer, HDRI skies), `js/fx.js`, `js/audio.js`, `js/input.js`
- `js/terrain.js`, `js/outdoor.js`: DEM terrain LOD, ocean, range structures, scatter
- `js/earth.js`: planet pass (NASA Blue Marble / Black Marble) for high altitude
- `tools/`: DEM + imagery converter, HDRI sun analysis, credits generator
- `data/parts/*.json`: one file per part (add a part = add a file + list it in `index.json`)
- `data/missions.json`

Run locally: `python3 -m http.server` and open http://localhost:8000. Credits: `CREDITS.md`.
