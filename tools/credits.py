# Regenerates CREDITS.md from tools/polyhaven_info.json (Poly Haven info) plus the fixed sections below.
import json, os
c = json.load(open('tools/polyhaven_info.json'))
models = sorted(f[:-4] for f in os.listdir('assets/models'))
tex = sorted(set(f.rsplit('_', 2)[0] for f in os.listdir('assets/tex')))
L = []
L.append("""Chrome Hangar — credits

Game design, code, rockets and structures
  Made for Ezequiel Cortez. Every rocket part, the hangar shell, test stand, pad, tank farm, water
  tower, masts, bunker, viewing stand, trucks and fences are built procedurally in code. Engine
  roar, music and most sounds are synthesized live with the Web Audio API.

Everything below is CC0 1.0 (public domain) unless marked otherwise. Credit is given anyway.

3D models — Poly Haven (polyhaven.com), CC0 1.0
  Optimised for the web (meshopt geometry, WebP textures, simplified where needed).""")
for m in models:
    n, a = c['info'][m]; L.append(f"  \"{n}\" by {a} — https://polyhaven.com/a/{m}")
L.append("\nPBR textures — Poly Haven, CC0 1.0")
for t in tex:
    n, a = c['info'][t]; L.append(f"  \"{n}\" by {a} — https://polyhaven.com/a/{t}")
L.append("""
Environment lighting (HDRI) — Poly Haven, CC0 1.0
  "Hangar Interior" — https://polyhaven.com/a/hangar_interior
  Time-of-day skies (each drives the sky, chrome reflections, sun direction and shadows):
  "Qwantani Noon (Pure Sky)" by Greg Zaal (photography), Jarod Guest (processing) — https://polyhaven.com/a/qwantani_noon_puresky
  "Qwantani Sunset (Pure Sky)" by Greg Zaal (photography), Jarod Guest (processing) — https://polyhaven.com/a/qwantani_sunset_puresky
  "Qwantani Dusk 2 (Pure Sky)" by Greg Zaal (photography), Jarod Guest (processing) — https://polyhaven.com/a/qwantani_dusk_2_puresky
  "Kloofendal Overcast (Pure Sky)" by Greg Zaal — https://polyhaven.com/a/kloofendal_overcast_puresky
""")
extra = 'tools/credits_extra.txt'
if os.path.exists(extra): L.append(open(extra).read().rstrip() + "\n")
L.append("""Sound effects, CC0 1.0
  Kenney — "Interface Sounds" and "Impact Sounds" (kenney.nl): UI clicks, metal plate and clank hits.
  rubberduck — "100 CC0 metal and wood SFX" (opengameart.org/content/100-cc0-metal-and-wood-sfx).
  Ogrebane — "Wood and Metal Sound Effects: Volume 2" (opengameart.org).
  Brian MacIntosh — "Metal Impact Sounds" (opengameart.org/content/metal-impact-sounds).
  yd — "Factory ambiance" (opengameart.org/content/factory-ambiance): looped as the hangar hum.

Libraries
  three.js r187 — MIT License, (c) 2010-2026 three.js authors — https://threejs.org
  meshoptimizer decoder — MIT License, (c) 2016-2026 Arseny Kapoulkine — https://github.com/zeux/meshoptimizer

Rockets are original designs. No real company, vehicle, logo or name is depicted.""")
open('CREDITS.md', 'w').write('\n'.join(L) + '\n')
print('ok', len(models), len(tex))
