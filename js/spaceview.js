// Drawing for the Moon flight once the rocket leaves the range: a floating-origin renderer.
// - Distant pass (kilometres, camera at the origin): Earth, Moon, stars, Sun light and the predicted path. Every position is
//   computed in float64 on the CPU as (body - camera) and only then handed to the GPU, so nothing jitters at 384,000 km.
//   The near plane follows the distance to the nearest surface, so one 24-bit depth buffer covers LEO to lunar orbit.
// - Local pass (metres, fresh depth): the rocket (borrowed from the world scene for the draw) and, on the Moon, a curved
//   ground cap with the LRO colour map (exact sphere curvature, dense rings under the lander, 400 km to the horizon).
// The world scene (range, terrain, Earth pass) is not drawn while this is active.
import * as THREE from 'three';
import * as O from './orbit.js';

const KM = 0.001;
const tv = (v, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);

export class SpaceView {
  constructor(world) {
    this.w = world; this.active = false; this.mode = 'deep'; this.ready = false; this.lite = world.quality === 'phone' || world.quality === 'low';
    // ---- distant scene (km) ----
    const S = this.far = new THREE.Scene(); S.background = new THREE.Color(0x000000);
    this.cam = new THREE.PerspectiveCamera(60, 1, 1, 2e6);
    this.sunL = new THREE.DirectionalLight(0xfff4e8, 3.2); this.sunL.target.position.set(0, 0, 0); S.add(this.sunL, this.sunL.target);
    S.add(new THREE.AmbientLight(0x223344, 0.08));
    const L = new THREE.TextureLoader(), an = Math.min(4, world.renderer.capabilities.getMaxAnisotropy());
    const tex = (url, cb) => L.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = an; cb?.(t); });
    this.earthMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.9, metalness: 0 });
    tex('assets/earth/earth_day_2k.webp', t => { this.earthMat.map = t; this.earthMat.color.set(0xffffff); this.earthMat.needsUpdate = true; });
    this.moonMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1, metalness: 0 });
    this.moonTex = null;
    tex(this.lite ? 'assets/moon/moon_lroc_1k.jpg' : 'assets/moon/moon_lroc_2k.jpg', t => { this.moonTex = t; t.wrapS = THREE.RepeatWrapping; this.moonMat.map = t; this.moonMat.color.set(0xffffff); this.moonMat.needsUpdate = true; this.capMat.map = t; this.capMat.color.set(0xffffff); this.capMat.needsUpdate = true; this.texLoaded = true; });
    const seg = this.lite ? 64 : 128;
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(O.R_E * KM, seg, seg / 2), this.earthMat); this.earth.matrixAutoUpdate = false;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(O.R_M * KM, seg, seg / 2), this.moonMat); this.moon.matrixAutoUpdate = false;
    // a thin blue limb so the Earth reads as a planet from the Moon
    this.atm = new THREE.Mesh(new THREE.SphereGeometry(O.R_E * KM * 1.015, 64, 32), new THREE.MeshBasicMaterial({ color: 0x5a8cff, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false }));
    this.atm.matrixAutoUpdate = false;
    for (const m of [this.earth, this.moon, this.atm]) m.frustumCulled = false;
    S.add(this.earth, this.atm, this.moon);
    // stars on a unit-ish shell that rides with the camera
    const n = this.lite ? 1800 : 4000, p = new Float32Array(n * 3), cl = new Float32Array(n * 3);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, t = rnd() * 6.283, r = Math.sqrt(1 - z * z), m = Math.pow(rnd(), 6) * 1.4 + 0.18, w = rnd();
      p.set([r * Math.cos(t) * 1e6, z * 1e6, r * Math.sin(t) * 1e6], i * 3); cl.set([m * (0.85 + 0.15 * w), m * 0.9, m * (1.05 - 0.2 * w)], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3)); sg.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: this.lite ? 1.6 : 1.8, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -1; S.add(this.stars);
    // predicted path (km, camera-relative, rewritten every frame from float64 points)
    this.pathN = 0; this.pathMax = 520;
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pathMax * 3), 3)); pg.setDrawRange(0, 0);
    this.path = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.path.frustumCulled = false; this.path.renderOrder = 3; S.add(this.path);
    this.pathAbs = [];   // [{x,y,z}] render-local frame, metres from the frame origin (float64)
    // ---- local scene (m) ----
    const LS = this.near = new THREE.Scene();
    this.sunN = new THREE.DirectionalLight(0xfff4e8, 3.0); LS.add(this.sunN, this.sunN.target);
    this.hemiN = new THREE.HemisphereLight(0x8899bb, 0x444444, 0.35); LS.add(this.hemiN);
    // lunar ground cap (built per landing site)
    this.capMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0 });
    this.detail = detailTex(); this.detail.channel = 1;
    this.capMat.bumpMap = this.detail; this.capMat.bumpScale = 2.2;
    this.capMat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float dv = length(vViewPosition); float k = 1.0 - smoothstep(600.0, 9000.0, dv);
          float dt = texture2D(bumpMap, vBumpMapUv).r * 0.6 + texture2D(bumpMap, vBumpMapUv * 0.137 + 0.31).r * 0.4;   // two scales hide the tiling
          diffuseColor.rgb *= mix(1.0, 0.62 + 0.7 * dt, k); }`);
    };
    this.cap = null; this.capBuilt = null;
    // screen markers for the Moon and the Earth
    const mk = (cls, txt) => { const d = document.createElement('div'); d.className = 'mkBody hidden ' + cls; d.innerHTML = `<i></i><span>${txt}</span><b></b>`; document.body.appendChild(d); return d; };
    this.mkMoon = mk('moon', 'Moon'); this.mkEarth = mk('earth', 'Earth');
    this.tmpM = new THREE.Matrix4(); this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3();
  }
  // ---- per frame from moon.js: frame = { B (inertial basis of the render-local axes), camECI: fn(localVec3)->[x,y,z] Earth-centred,
  //      sky, t, moon: bool (on the lunar surface frame) } ----
  setFrame(fr) { this.fr = fr; }
  bodyMatrix(m, ax, posRel, scale = 1) {
    // sphere-local +x = body x (longitude 0), +y = body z (north), +z = -body y; columns expressed in render-local axes
    const B = this.fr.B, L = d => O.vecToLocal(B, d);
    const c0 = L(ax.x), c1 = L(ax.z), c2 = L(O.V.mul(ax.y, -1));
    m.matrix.set(c0.x * scale, c1.x * scale, c2.x * scale, posRel.x, c0.y * scale, c1.y * scale, c2.y * scale, posRel.y, c0.z * scale, c1.z * scale, c2.z * scale, posRel.z, 0, 0, 0, 1);
    m.matrixWorldNeedsUpdate = true;
  }
  // Moon ground cap around a landing site. bodyUp = site direction in Moon body axes; cap centre sits at local (ox, 0, oz).
  buildCap(sky, t, bodyUp, ox, oz) {
    const key = bodyUp.map(x => x.toFixed(6)).join() + ox + ',' + oz;
    if (this.capBuilt === key) return; this.capBuilt = key;
    const R = O.R_M, rings = [0]; let d = 25; while (d < 400e3) { rings.push(d); d *= 1.11; } rings.push(400e3);
    const segs = this.lite ? 72 : 128, nv = rings.length * segs;
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), uv1 = new Float32Array(nv * 2), nrm = new Float32Array(nv * 3);
    // site frame in body axes: up, east, north (x local = west)
    const up = O.V.norm(bodyUp); let east = O.V.cross([0, 0, 1], up); if (O.V.len(east) < 1e-6) east = [0, 1, 0]; east = O.V.norm(east); const north = O.V.cross(up, east);
    const lon0 = Math.atan2(up[1], up[0]) / (2 * Math.PI);
    let k = 0;
    for (const r of rings) {
      const a = r / R, h = R * Math.sin(a), y = R * Math.cos(a) - R;
      for (let j = 0; j < segs; j++, k++) {
        const ph = j / segs * Math.PI * 2, cx = Math.cos(ph), cz = Math.sin(ph);
        pos.set([ox + h * cx, y, oz + h * cz], k * 3);
        // direction from the Moon centre in body axes: up*cos a + (west*cx + north*cz)*sin a ; west = -east
        const n = O.V.add(O.V.mul(up, Math.cos(a)), O.V.add(O.V.mul(east, -cx * Math.sin(a)), north, cz * Math.sin(a)));
        nrm.set([cx * Math.sin(a), Math.cos(a), cz * Math.sin(a)], k * 3);
        let u = Math.atan2(n[1], n[0]) / (2 * Math.PI); u -= Math.round(u - lon0);   // unwrap around the site so no triangle spans the seam
        uv.set([u + 0.5, Math.asin(Math.max(-1, Math.min(1, n[2]))) / Math.PI + 0.5], k * 2);
        uv1.set([h * cx / 180, h * cz / 180], k * 2);
      }
    }
    const idx = [];
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs, c = (i + 1) * segs + j, e = (i + 1) * segs + (j + 1) % segs;
      idx.push(a, b, c, b, e, c);   // counter-clockwise seen from above
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2)); g.setIndex(idx);
    if (this.cap) { this.near.remove(this.cap); this.cap.geometry.dispose(); }
    this.cap = new THREE.Mesh(g, this.capMat); this.cap.frustumCulled = false; this.cap.receiveShadow = false; this.near.add(this.cap);
  }
  setPath(ptsLocal) { this.pathAbs = ptsLocal; }
  // draw; true if this pass replaced the world render
  render(r, camera) {
    if (!this.active || !this.fr) return false;
    const fr = this.fr, sky = fr.sky, t = fr.t, c = this.cam;
    c.quaternion.copy(camera.quaternion); c.fov = camera.fov; c.aspect = camera.aspect; c.position.set(0, 0, 0); c.updateMatrixWorld();
    const camE = fr.camECI(camera.position);                       // camera, Earth-centred inertial (float64)
    const mE = O.moonPos(sky, t);
    const rel = d => { const l = O.vecToLocal(fr.B, d); return this.v1.set(l.x * KM, l.y * KM, l.z * KM).clone(); };
    const pe = rel(O.V.mul(camE, -1)), pm = rel(O.V.sub(mE, camE));
    const th = sky.theta0 + O.W_E * t, eAx = { x: [Math.cos(th), Math.sin(th), 0], y: [-Math.sin(th), Math.cos(th), 0], z: [0, 0, 1] };
    this.bodyMatrix(this.earth, eAx, pe); this.atm.matrix.copy(this.earth.matrix);
    this.bodyMatrix(this.moon, O.moonAxes(sky, t), pm);
    const sunL = O.vecToLocal(fr.B, sky.sun);
    this.sunL.position.set(sunL.x, sunL.y, sunL.z).multiplyScalar(1e5); this.sunN.position.copy(camera.position).add(this.v2.set(sunL.x, sunL.y, sunL.z).multiplyScalar(500)); this.sunN.target.position.copy(camera.position); this.sunN.target.updateMatrixWorld();
    // near plane from the nearest surface (km)
    const dE = O.V.len(camE) - O.R_E, dM = O.V.len(O.V.sub(camE, mE)) - O.R_M;
    const dn = Math.max(0.5, Math.min(fr.moon ? Math.max(dE, 1) : Math.min(dE, dM), 4e5) * KM * 0.5);
    c.near = dn; c.far = 2.2e6; c.updateProjectionMatrix();
    // path: camera-relative km
    const P = this.path.geometry.attributes.position, n = Math.min(this.pathMax, this.pathAbs.length), cp = camera.position;
    for (let i = 0; i < n; i++) { const q = this.pathAbs[i]; P.setXYZ(i, (q.x - cp.x) * KM, (q.y - cp.y) * KM, (q.z - cp.z) * KM); }
    P.needsUpdate = true; this.path.geometry.setDrawRange(0, n); this.path.visible = n > 1;
    r.render(this.far, c);
    // local pass
    const grp = fr.group, parent = grp?.parent;
    if (grp) this.near.add(grp);
    this.near.environment = this.w.scene.environment;
    if (this.cap) this.cap.visible = !!fr.moon;
    r.autoClear = false; r.clearDepth();
    r.render(this.near, camera);   // the flight camera's own near / far: the far Moon sphere fills in past the cap's drawn range
    r.autoClear = true;
    if (grp && parent) parent.add(grp);
    return true;
  }
  // world-renderer overlay (pad frame, near Earth): only the path line, drawn over the world in metres
  overlay(r, camera) {
    if (this.active || !this.fr || !this.overlayOn) return;
    const n = Math.min(this.pathMax, this.pathAbs.length); if (n < 2) return;
    const P = this.path.geometry.attributes.position, cp = camera.position;
    for (let i = 0; i < n; i++) { const q = this.pathAbs[i]; P.setXYZ(i, (q.x - cp.x), (q.y - cp.y), (q.z - cp.z)); }
    P.needsUpdate = true; this.path.geometry.setDrawRange(0, n);
    this.ovScene ??= new THREE.Scene(); this.ovCam ??= new THREE.PerspectiveCamera();
    const c = this.ovCam; c.quaternion.copy(camera.quaternion); c.fov = camera.fov; c.aspect = camera.aspect; c.position.set(0, 0, 0); c.near = 1; c.far = 1e9; c.updateProjectionMatrix(); c.updateMatrixWorld();
    const prev = this.path.parent; this.ovScene.add(this.path); this.path.material.depthTest = false;
    r.autoClear = false; r.render(this.ovScene, c); r.autoClear = true;
    this.path.material.depthTest = true; prev.add(this.path);
  }
  // screen labels: Moon / Earth with distance, clamped to the screen edge when off screen
  markers(camera, show) {
    const fr = this.fr; if (!show || !fr) { this.mkMoon.classList.add('hidden'); this.mkEarth.classList.add('hidden'); return; }
    const camE = fr.camECI(camera.position), mE = O.moonPos(fr.sky, fr.t);
    this.place(this.mkMoon, camera, O.V.sub(mE, camE), O.V.len(O.V.sub(mE, camE)) - O.R_M, !fr.moon);
    this.place(this.mkEarth, camera, O.V.mul(camE, -1), O.V.len(camE) - O.R_E, fr.moon || O.V.len(camE) > 2.5e7);
  }
  place(el, camera, dirE, dist, on) {
    if (!on) { el.classList.add('hidden'); return; }
    const d = O.vecToLocal(this.fr.B, O.V.norm(dirE)), p = this.v1.set(d.x, d.y, d.z).multiplyScalar(1000).add(camera.position).project(camera);
    let x = p.x, y = p.y; const behind = p.z > 1; if (behind) { x = -x; y = -y; }
    const edge = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.9; if (edge) { const k = 0.92 / Math.max(Math.abs(x), Math.abs(y) / 0.9 * 0.92, 1e-6); x *= Math.min(1, k); y *= Math.min(1, k); }
    el.classList.remove('hidden'); el.classList.toggle('edge', edge);
    el.style.transform = `translate(${((x * 0.5 + 0.5) * innerWidth) | 0}px, ${((-y * 0.5 + 0.5) * innerHeight) | 0}px)`;
    const txt = dist > 1e6 ? Math.round(dist / 1000).toLocaleString() + ' km' : (dist / 1000).toFixed(dist > 1e5 ? 0 : 1) + ' km';
    const b = el.querySelector('b'); if (b.textContent !== txt) b.textContent = txt;
  }
  hideAll() { this.active = false; this.overlayOn = false; this.markers(null, false); }
}

// tileable regolith: soft noise + small craters (one 256 px canvas, built once)
function detailTex() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const v = 100 + r() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3); }
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, R = 2 + Math.pow(r(), 3) * 26;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const gr = g.createRadialGradient(x + ox - R * 0.2, y + oy - R * 0.2, R * 0.1, x + ox, y + oy, R);
      gr.addColorStop(0, 'rgba(60,60,60,0.55)'); gr.addColorStop(0.75, 'rgba(90,90,90,0.25)'); gr.addColorStop(0.92, 'rgba(190,190,190,0.45)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, R, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; return t;
}
