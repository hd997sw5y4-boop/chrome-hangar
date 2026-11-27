# Chrome Hangar (v1 web slice)

Stand in a quiet hangar, bolt a metal rocket together, static-fire it on the test stand, then launch it.

Static three.js site, no build step. three.js r187 is vendored in `vendor/`.

- `index.html`, `css/style.css`: UI
- `js/main.js`: boot, menus, missions, saves, settings, results
- `js/build.js`: first-person hangar, tray, snapping, undo/redo, checkout panel, tutorial
- `js/testfire.js`: test stand static fire
- `js/flight.js`: launch, cameras, assists, landing guide, failures
- `js/sim.js`: fixed-step single-rigid-body flight + engine/heat model (pure JS)
- `js/rocket.js`: part data, layout, mass / CoM / CoP stats, snap rules (pure JS)
- `js/parts3d.js`, `js/env.js`, `js/fx.js`, `js/audio.js`, `js/input.js`
- `data/parts/*.json`: one file per part (add a part = add a file + list it in `index.json`)
- `data/missions.json`

Run locally: `python3 -m http.server` and open http://localhost:8000. Credits: `CREDITS.md`.
