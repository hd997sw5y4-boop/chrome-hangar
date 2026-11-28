# Launch Stand: models and licence

The Launch Stand (js/launchstand.js) uses **no external models and no textures**. Its geometry is
procedural Three.js, written for this game:

- launch mount: a lathe ring on six splayed box legs with braces and hold-downs
- integration tower: a square box-beam lattice with X-braced bays, a roof platform and a lightning mast
- swing arms: box-beam trusses with a walkway and an end plate

It is merged into three meshes, one per material. It is sized to the current stack every time the
stack changes: tower = 1.12 x the rocket's tip height, and the mount ring matches the base diameter.
It is original work under the project's own licence, so no third-party credit is needed. It
carries no logos, names or trademarks of any launch company or agency. "Launch Stand" is a generic
name.

## Why not a CC0 model

Searched on 2026-11-28 (Pacific time):

- **Poly Pizza:** "launch tower" and "launch pad" return only sci-fi landing pads, lander bases and
  plain towers. None of them is a launch mount or an integration tower.
- **Kenney:** the Space Kit has rocket parts and sci-fi structures, but no launch tower or mount.
- **ambientCG / Poly Haven:** both carry materials and HDRIs, plus a small set of general props. There
  is no launch infrastructure.

CC0 launch-complex models exist elsewhere:

- 3dassets.dev, "Rocket Launch Pad and Gantry". It is AI-assisted, with stackable 6 m gantry sections.
- Innerscene, "Launch gantry". It is fixed at 84 m and 12 MB.
- tevy.dev, "Launch Tower and Pad". It is fixed at 66 m and 3.5 MB.

These were not used for four reasons:

- they come from sources outside the requested ones;
- the fixed-height models cannot follow the stack;
- they add megabytes to download;
- the AI-assisted provenance of one pack is less clear than CC0 from the usual sources.

If one of them is adopted later, record it here with:

- the source URL;
- the author;
- the licence (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/);
- the download date.
