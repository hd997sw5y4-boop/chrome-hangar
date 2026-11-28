// Video settings rows and apply, adapted from Window Workshop 3D
// addons/video-settings.js (origin/main 95f5c68, rows() + applyExp/applySh/applyRS / FPS cap).
// Anti-aliasing from that file is not copied: Chrome Hangar already has Off / FXAA / SMAA / MSAA+SMAA.
// Graphics quality stays the existing CH dropdown. Persistence is the CH `ch_settings` object, not ww_v_* keys.
import * as THREE from 'three';

export const VIDEO_DEFAULTS = () => ({ bri: 1, roomBri: 1, exp: 1, sh: true, shq: 'auto', ss: true, rs: 1, fps: 0 });

export const SHADOW_Q = {
  auto: { label: 'Auto (follows Graphics)' },
  low: { label: 'Low', size: 512 },
  medium: { label: 'Medium', size: 1024 },
  high: { label: 'High', size: 2048 },
  ultra: { label: 'Ultra', size: 4096 },
};

const pct = v => Math.round(v * 100) + '%';

export function fillVideo(s) {
  const d = VIDEO_DEFAULTS();
  for (const k of Object.keys(d)) if (s[k] == null || s[k] === '') s[k] = d[k];
  if (typeof s.sh === 'string') s.sh = s.sh !== '0' && s.sh !== 'false';
  if (typeof s.ss === 'string') s.ss = s.ss !== '0' && s.ss !== 'false';
  s.bri = +s.bri; s.roomBri = +s.roomBri; s.exp = +s.exp; s.rs = +s.rs; s.fps = +s.fps;
  if (!SHADOW_Q[s.shq]) s.shq = 'auto';
  return s;
}

export function videoRows(s) {
  fillVideo(s);
  const rng = (id, txt, min, max, st, val, fmt) =>
    `<div class="setRow"><span>${txt}</span><b id="${id}V" class="setVal">${fmt(val)}</b><input type="range" id="${id}" min="${min}" max="${max}" step="${st}" value="${val}"></div>`;
  const sel = (id, txt, opts, val) =>
    `<div class="setRow"><span>${txt}</span><select id="${id}">${opts.map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  return rng('vBri', 'Brightness', 0.5, 1.6, 0.05, s.bri, pct)
    + rng('roomBri', 'Room brightness', 0.4, 1.6, 0.05, s.roomBri, pct)
    + rng('vExp', 'Exposure', 0.6, 1.6, 0.05, s.exp, v => Number(v).toFixed(2))
    + sel('vShOn', 'Shadows', [['1', 'On'], ['0', 'Off']], s.sh ? '1' : '0')
    + sel('vShQ', 'Shadow quality', Object.entries(SHADOW_Q).map(([k, p]) => [k, p.label]), s.shq)
    + sel('vSS', 'Ultra supersampling', [['1', '150%'], ['0', 'Off']], s.ss ? '1' : '0')
    + rng('vRS', 'Render scale', 0.5, 1.5, 0.05, s.rs, pct)
    + sel('vFps', 'FPS cap', [['0', 'Off'], ['30', '30'], ['45', '45'], ['60', '60'], ['120', '120']], s.fps);
}

export function bindVideoRows(s, onChange) {
  const num = (id, fmt, fn) => {
    const i = document.getElementById(id), b = document.getElementById(id + 'V');
    if (!i) return;
    i.oninput = () => { const v = +i.value; if (b) b.textContent = fmt(v); fn(v); onChange(false); };
  };
  num('vBri', pct, v => { s.bri = v; });
  num('roomBri', pct, v => { s.roomBri = v; });
  num('vExp', v => Number(v).toFixed(2), v => { s.exp = v; });
  num('vRS', pct, v => { s.rs = v; });
  const sel = (id, fn) => {
    const e = document.getElementById(id);
    if (e) e.onchange = ev => { fn(ev.target.value); onChange(true); };
  };
  sel('vShOn', v => { s.sh = v === '1'; });
  sel('vShQ', v => { s.shq = v; });
  sel('vSS', v => { s.ss = v === '1'; });
  const fps = document.getElementById('vFps');
  if (fps) fps.onchange = ev => { s.fps = +ev.target.value; onChange(false); };
}

export function videoPixelRatio(s, quality, preset) {
  fillVideo(s);
  const pr = preset?.pr ?? 1.5;
  const ssMul = (s.ss && quality === 'ultra') ? 1.5 : 1;
  const cap = pr * ssMul;
  return Math.min((window.devicePixelRatio || 1) * Math.min(s.rs, 1.5) * ssMul, cap);
}

export function shadowSize(s, quality, preset) {
  fillVideo(s);
  if (!s.sh) return 0;
  if (s.shq !== 'auto' && SHADOW_Q[s.shq]?.size) return SHADOW_Q[s.shq].size;
  return preset?.shadow ?? 2048;
}

export function applyVideo(world, s) {
  if (!world?.renderer) return;
  fillVideo(s);
  world._vidBri = s.bri;
  world._vidRoom = s.roomBri;
  world._vidExp = s.exp;
  const r = world.renderer;
  const skyExp = world.sky?.exp ?? 1;
  r.toneMappingExposure = skyExp * s.exp * s.roomBri;
  const bri = s.bri;
  if (world.sky) {
    const k = THREE.MathUtils.smoothstep(world.alt || 0, 1500, 40000), sp = 1 - k;
    if (world.sun) world.sun.intensity = world.sky.sun * (1 + 0.3 * k) * bri;
    if (world.hemi && !world.indoor) world.hemi.intensity = world.sky.hemi * sp * bri;
    else if (world.hemi && world.indoor) world.hemi.intensity = (world.sky.hemi || 0.35) * bri;
  }
  world._relight?.();
}

export function applyShadows(world, s, quality, preset) {
  if (!world?.renderer) return;
  fillVideo(s);
  const r = world.renderer, size = shadowSize(s, quality, preset);
  const on = !!(s.sh && size > 0);
  const was = r.shadowMap.enabled;
  r.shadowMap.enabled = on;
  world.shadowSize = size;
  if (on) {
    for (const l of [world.sun, world.bayDir, world.spot]) {
      if (!l?.shadow) continue;
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
      }
    }
    if (world.indoor) { if (world.bayDir) world.bayDir.castShadow = true; world.sun.castShadow = false; }
    else { world.sun.castShadow = true; if (world.bayDir) world.bayDir.castShadow = false; }
  } else {
    if (world.sun) world.sun.castShadow = false;
    if (world.bayDir) world.bayDir.castShadow = false;
  }
  r.shadowMap.autoUpdate = false;
  r.shadowMap.needsUpdate = true;
  world._shadowHold = 3;
  world.markShadow?.();
  if (was !== on) world.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
}
