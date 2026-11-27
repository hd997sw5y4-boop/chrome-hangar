// Hangar dressing: CC0 Poly Haven props (tool chest, carts, barrels, gas cylinders, shelving,
// generator, crates, ladder, work lights) plus painted floor lanes, safety signs, extinguishers and a clock.
import * as THREE from 'three';
import { prop, pieces } from './models.js';
import { HANGAR } from './env.js';
import { bake } from './outdoor.js';

function signTex(lines, bg, fg, w = 512, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach(([t, size], i) => { g.font = `bold ${size}px Arial`; const mw = g.measureText(t).width, k = Math.min(1, (w - 60) / mw); g.save(); g.translate(w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.15); g.scale(k, 1); g.fillText(t, 0, 0); g.restore(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export async function dressHangar(world) {
  const H = HANGAR, g = new THREE.Group(); g.name = 'props'; world.hangar.add(g);
  const at = (o, x, y, z, ry = 0, s = 1) => { o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); g.add(o); return o; };
  const jobs = [
    prop('Barrel_01').then(o => { for (const [x, z, r] of [[-19.6, -13.2, 0], [-18.9, -13.6, 1], [-19.4, -12.4, 2], [-18.6, -12.8, 0.4], [18.8, -13.4, 1.2]]) at(o.clone(), x, 0, z, r); }),
    prop('propane_tank').then(o => { for (let i = 0; i < 5; i++) at(o.clone(), 15 + i * 0.75, 0, 15.3, i, 2.6); }),
    prop('steel_frame_shelves_01').then(o => { const s = 2.4 / o.userData.size.y; at(o, -21.4, 0, -3, Math.PI / 2, s); at(o.clone(), -21.4, 0, -0.2, Math.PI / 2, s); at(o.clone(), -21.4, 0, 2.6, Math.PI / 2, s); }),
    prop('metal_jerrycan').then(o => { for (const [x, z, r] of [[-11, 13.6, 0.1], [-10.6, 13.6, 0.0], [-10.2, 13.5, 0.3]]) at(o.clone(), x, 0, z, r); }),
    prop('wooden_crate_02').then(o => { at(o, -15, 0, -13.5, 0.1); at(o.clone(), -15, 0.45, -13.5, 0.05); at(o.clone(), -14.3, 0, -12.3, 1.5); }),
    prop('ladder_sectioned_01', n => n === 'ladder_section_01').then(o => { at(o, 21.5, 0, -7, -Math.PI / 2, 1.4); o.rotation.z = -0.12; o.position.x = 21.2; }),
    prop('small_lpg_tank').then(o => at(o, 11.6, 0, 5.6, 0)),
    prop('flood_lights', n => n.startsWith('flood_lights_standing_double_a')).then(o => { at(o, -4.8, 0, 3.6, 2.3, 1.15); at(o.clone(), 4.6, 0, -4.2, -0.8, 1.15); }),
  ];
  await Promise.all(jobs.map(j => j.catch(e => console.warn('prop', e.message))));

  // painted floor: yellow walk lanes and a hatched keep-out box at the door
  const lane = new THREE.MeshStandardMaterial({ color: 0xe0a816, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const strip = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lane); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.receiveShadow = true; g.add(m); };
  for (const x of [-7.5, 7.5]) strip(0.15, H.z * 2 - 3, x, -1.5);
  strip(15, 0.15, 0, 9); strip(H.x * 2 - 4, 0.15, 0, -H.z + 2.6);
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6), new THREE.MeshStandardMaterial({ map: signTex([['BAY 01', 150]], 'rgba(0,0,0,0)', '#e0a816', 512, 160), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  bay.material.map.premultiplyAlpha = false; bay.rotation.x = -Math.PI / 2; bay.position.set(0, 0.007, -H.z + 4.4); g.add(bay);
  // wall signs
  const sign = (lines, bg, fg, w, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTex(lines, bg, fg), roughness: 0.55 })); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); };
  sign([['EYE & EAR', 64], ['PROTECTION', 64], ['REQUIRED', 64]], '#1d5d8f', '#ffffff', 2.4, 1.2, -H.x + 0.06, 3.2, 8, Math.PI / 2);
  sign([['NO OPEN FLAME', 60], ['PROPELLANT AREA', 44]], '#c8241b', '#ffffff', 2.4, 1.2, H.x - 0.06, 3.2, 12, -Math.PI / 2);
  sign([['CHROME HANGAR', 64], ['ASSEMBLY BAY 01', 40]], '#16191d', '#e0a816', 6, 3, 0, 12, H.z - 0.06, Math.PI);
  sign([['DAYS WITHOUT', 46], ['A SCRUB:  12', 56]], '#f2f2f2', '#16191d', 2.2, 1.1, H.x - 0.06, 3.2, -2, -Math.PI / 2);
  // fire-extinguisher wall plates (the cans themselves are interactive, in interact2.js)
  for (const [x, z] of [[-H.x + 0.25, -8], [H.x - 0.25, 4], [-4, H.z - 0.25]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshStandardMaterial({ map: signTex([['FIRE', 90]], '#c8241b', '#fff', 256, 340), roughness: 0.6 }));
    plate.position.set(x + (x < 0 ? -0.18 : x > 20 ? 0.18 : 0), 1.7, z + (z > 15 ? 0.18 : 0)); plate.rotation.y = x < -20 ? Math.PI / 2 : x > 20 ? -Math.PI / 2 : Math.PI; g.add(plate);
  }
  // wall clock (real time) on the back wall
  const cc = document.createElement('canvas'); cc.width = cc.height = 256; const clockTex = new THREE.CanvasTexture(cc); clockTex.colorSpace = THREE.SRGBColorSpace;
  const drawClock = () => {
    const c = cc.getContext('2d'), d = new Date(), r = 120; c.fillStyle = '#f4f4f0'; c.beginPath(); c.arc(128, 128, r, 0, 7); c.fill(); c.lineWidth = 10; c.strokeStyle = '#16191d'; c.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 6 * Math.PI; c.lineWidth = 6; c.beginPath(); c.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96); c.lineTo(128 + Math.sin(a) * 110, 128 - Math.cos(a) * 110); c.stroke(); }
    const hand = (a, l, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + Math.sin(a) * l, 128 - Math.cos(a) * l); c.stroke(); };
    hand((d.getHours() % 12 + d.getMinutes() / 60) / 6 * Math.PI, 60, 9, '#16191d'); hand(d.getMinutes() / 30 * Math.PI, 90, 6, '#16191d'); hand(d.getSeconds() / 30 * Math.PI, 96, 2, '#c8241b');
    clockTex.needsUpdate = true;
  };
  drawClock(); setInterval(drawClock, 1000);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.4 })); clock.name = 'wallClock'; clock.position.set(6, 5.2, H.z - 0.05); clock.rotation.y = Math.PI; g.add(clock);
  g.traverse(o => { if (o.isMesh) { o.receiveShadow = true; } });
  if (world.quality === 'phone' || world.quality === 'low') { g.remove(clock); bake(g); g.add(clock); }
  return g;
}
