// Fueling: a code-built cryo (LOX) tank with CC0 Poly Haven industrial pipes, a draggable rubber hose
// on a spline, and a nozzle that couples to the rocket. Flow raises the rocket's real fuel fill
// (game.fill, used by the flight and test physics), with a dial + HUD gauge, cold vapor venting
// and frost growing on the rocket's tanks and the supply tank.
import * as THREE from 'three';
import { HANGAR } from './env.js';
import { pieces } from './models.js';
import { layout } from './rocket.js';
import { hitBox, labelTex } from './interactive.js';

const TANK = new THREE.Vector3(-12, 0, 2.5), R = 1.15, TH = 5.2, OUTLET = new THREE.Vector3(-12 + R + 0.15, 0.55, 2.5);
const PARK = new THREE.Vector3(-12 + R + 0.12, 1.35, 3.05), HOSE_MAX = 17;

function frostTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.clearRect(0, 0, 256, 256);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) { const a = 0.15 + r() * 0.55, sz = 0.6 + r() * 2.4; g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(r() * 256, r() * 256, sz, 0, 7); g.fill(); }
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(255,255,255,${0.2 + r() * 0.3})`; g.lineWidth = 0.8; const x = r() * 256, y = r() * 256, l = 4 + r() * 10; for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI; g.beginPath(); g.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// soft cold vapor: alpha-blended point sprites that drift and sink (cold gas is heavy)
class Vapor {
  constructor(n) {
    this.n = n; this.i = 0; const geo = new THREE.BufferGeometry();
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 }, uLight: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale; void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; uniform float uLight; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vec3(0.86, 0.9, 0.95) * uLight, a); }`,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 6; this.points.userData.noAO = true;
  }
  emit(pos, vel, size = 0.5, life = 2.5) { const i = this.i = (this.i + 1) % this.n; this.p.set([pos.x, pos.y, pos.z], i * 3); this.v.set([vel.x, vel.y, vel.z], i * 3); this.life[i] = life; this.max[i] = life; this.size[i] = size; }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt; const k = this.life[i] / this.max[i], j = i * 3;
      this.v[j + 1] -= 0.25 * dt; this.v[j] *= 1 - 0.8 * dt; this.v[j + 2] *= 1 - 0.8 * dt; this.v[j + 1] *= 1 - 0.5 * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] = Math.max(0.15, this.p[j + 1] + this.v[j + 1] * dt); this.p[j + 2] += this.v[j + 2] * dt;
      this.size[i] += dt * 0.55; this.alpha[i] = Math.sin(Math.PI * Math.min(1, (1 - k) * 4)) * 0.32 * k + 0.25 * k * (1 - k);
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
  }
}

export class Fueling {
  constructor(ix) {
    this.ix = ix; this.g = ix.g; this.state = 'stowed'; this.pump = true; this.valve = 1; this.frost = 0; this.tankFrost = 0.15;
    this.nozzle = PARK.clone(); this.nozDir = new THREE.Vector3(0, -1, 0); this.lastKey = ''; this.flowing = false;
  }
  async load() {
    const ix = this.ix, root = this.root = new THREE.Group(); root.name = 'fueling'; ix.group.add(root);
    // ---- cryo tank: white painted steel, domed ends, legs, stiffener rings, LOX lettering ----
    const paint = new THREE.MeshStandardMaterial({ color: 0xeef1f3, metalness: 0.25, roughness: 0.38 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.75, roughness: 0.4 });
    const T = new THREE.Group(); T.position.copy(TANK); root.add(T);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TH, 48), paint); body.position.y = 1.0 + TH / 2; body.castShadow = body.receiveShadow = true; T.add(body);
    for (const sy of [1, -1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint); d.scale.y = 0.35; d.rotation.x = sy > 0 ? 0 : Math.PI; d.position.y = 1.0 + (sy > 0 ? TH : 0); d.castShadow = true; T.add(d); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), steel); l.position.set(Math.cos(a) * R * 0.85, 0.6, Math.sin(a) * R * 0.85); l.castShadow = true; T.add(l); const f = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.4), steel); f.position.set(l.position.x, 0.015, l.position.z); T.add(f); }
    for (const y of [1.6, 3.6, 5.6]) { const r = new THREE.Mesh(new THREE.TorusGeometry(R + 0.015, 0.03, 6, 48), steel); r.rotation.x = Math.PI / 2; r.position.y = y; T.add(r); }
    const lox = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 1.3, 48, 1, true, -0.9, 1.8), new THREE.MeshStandardMaterial({ map: labelTex([['LOX', 120]], { w: 512, h: 160, fg: '#1d5d8f' }), transparent: true, roughness: 0.5 })); lox.position.y = 4.6; lox.rotation.y = Math.PI / 2 - 0.9 + 0.9; T.add(lox);
    // relief valve + vent stack on top
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 10), steel); vent.position.set(0.3, 1.0 + TH + 0.6, 0); T.add(vent); this.ventTop = TANK.clone().add(new THREE.Vector3(0.3, 1.0 + TH + 1.05, 0));
    // frost shell on the lower tank
    this.frostMat = new THREE.MeshStandardMaterial({ map: frostTex(), color: 0xf6faff, roughness: 0.9, metalness: 0, transparent: true, opacity: 0, depthWrite: false });
    this.frostMat.map.repeat.set(4, 2);
    const fs = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, TH * 0.55, 48, 1, true), this.frostMat); fs.position.y = 1.0 + TH * 0.275; T.add(fs);
    // dial gauge facing the stand (+x side)
    const dc = this.dialCv = document.createElement('canvas'); dc.width = dc.height = 256; this.dialTex = new THREE.CanvasTexture(dc); this.dialTex.colorSpace = THREE.SRGBColorSpace;
    const dial = new THREE.Group(); dial.position.set(R + 0.06, 1.75, -0.45); dial.rotation.y = Math.PI / 2; T.add(dial);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.95, roughness: 0.2 })); rim.rotation.x = Math.PI / 2; dial.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.18, 32), new THREE.MeshBasicMaterial({ map: this.dialTex, color: 0xdddddd })); face.position.z = 0.031; dial.add(face);
    this.drawDial(0);
    // hose outlet valve + nozzle hanger bracket
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 16), steel); valve.rotation.z = Math.PI / 2; valve.position.set(R + 0.05, 0.55, 0); T.add(valve);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 6, 20), new THREE.MeshStandardMaterial({ color: 0x1d5d8f, roughness: 0.4 })); wheel.position.set(R + 0.05, 0.78, 0); wheel.rotation.x = Math.PI / 2; T.add(wheel); this.wheel = wheel;
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.06), steel); hanger.position.set(R + 0.04, 1.5, 0.55); T.add(hanger);
    // CC0 Poly Haven industrial pipe pieces as the supply manifold
    try {
      const names = ['pipe01', 'pipe05', 'pipe06', 'pipe02'], spots = [[-1.6, 0, 0.6, 0], [-1.6, 0, -0.7, Math.PI / 2], [-0.2, 0, -1.6, 0], [0.9, 0, -1.5, -Math.PI / 2]];
      const sets = await Promise.all(names.map(n => pieces('modular_industrial_pipes_01', x => x.endsWith(n))));
      sets.forEach((ps, i) => { const g = new THREE.Group(); for (const p of ps) { const m = new THREE.Mesh(p.geometry, p.material); m.castShadow = m.receiveShadow = true; g.add(m); } const [x, y, z, ry] = spots[i]; g.position.set(x, y, z); g.rotation.y = ry; T.add(g); });
    } catch (e) { console.warn('pipes', e.message); }
    // ---- hose (spline tube, plain dark rubber) + nozzle ----
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.78, metalness: 0 });
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat); this.hose.castShadow = true; this.hose.frustumCulled = false; root.add(this.hose);
    const noz = this.noz = new THREE.Group(); root.add(noz);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 1, roughness: 0.3 });
    const nb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.34, 16), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.95, roughness: 0.22 })); nb.rotation.x = Math.PI / 2; noz.add(nb);
    const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 16), brass); cp.rotation.x = Math.PI / 2; cp.position.z = 0.19; noz.add(cp);
    const hd = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1d5d8f, roughness: 0.4 })); hd.position.set(0, 0.07, -0.02); hd.rotation.y = Math.PI / 2; noz.add(hd);
    // rocket-side coupling (shown when connected)
    this.port = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), brass); this.port.rotation.x = Math.PI / 2; this.port.visible = false; root.add(this.port);
    this.vapor = new Vapor(ix.lite ? 70 : 180); root.add(this.vapor.points);
    // ---- interactions ----
    const nh = hitBox(0.7, 0.7, 0.8); noz.add(nh);
    ix.add({ hit: nh, glow: [noz], range: 4.5, label: () => this.state === 'stowed' ? 'Pick up the fuel hose' : this.state === 'connected' ? 'Disconnect the hose' : 'Fuel hose', use: () => this.pickUp(), enabled: () => this.state !== 'carry' });
    const th = hitBox(R * 2 + 0.4, TH + 1.8, R * 2 + 0.4); th.position.set(TANK.x, (TH + 1.8) / 2, TANK.z); root.add(th);
    ix.add({ hit: th, glow: [body], range: 7, label: () => this.state === 'carry' ? 'Hang the hose back up' : `LOX tank · rocket fuel ${Math.round(this.g.fill * 100)}%`, use: () => this.state === 'carry' ? this.stow() : this.state === 'stowed' ? this.pickUp() : this.g.toast('The hose is connected to the rocket. Fueling ' + (this.pump ? 'is on.' : 'is paused: pump is off at the console.')) });
    const rh = this.rocketHit = hitBox(3.2, 1, 3.2); root.add(rh);
    ix.add({ hit: rh, glow: [], range: 9, label: () => 'Connect the hose to the rocket', use: () => this.connect(), enabled: () => this.state === 'carry' });
    this.rebuildHose(true); this.ready = true;
  }
  drawDial(v) {
    const g = this.dialCv.getContext('2d'), c = 128; g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 256);
    g.lineWidth = 14; const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.strokeStyle = '#d6d9dd'; g.beginPath(); g.arc(c, c, 96, a0, a1); g.stroke();
    g.strokeStyle = '#2aa35a'; g.beginPath(); g.arc(c, c, 96, a0 + (a1 - a0) * 0.85, a1); g.stroke();
    g.fillStyle = '#16191d'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText('ROCKET LOX', c, 196); g.font = 'bold 34px Arial'; g.fillText(Math.round(v * 100) + '%', c, 168);
    const a = a0 + (a1 - a0) * v; g.strokeStyle = '#c81e14'; g.lineWidth = 6; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * 86, c + Math.sin(a) * 86); g.stroke(); g.fillStyle = '#16191d'; g.beginPath(); g.arc(c, c, 10, 0, 7); g.fill();
    this.dialTex.needsUpdate = true; this.dialV = v;
  }
  tankItem() { const L = layout(this.g.rocket); return L.items.filter(it => it.d.kind === 'tank'); }
  pickUp() {
    if (this.state === 'connected') { this.state = 'carry'; this.port.visible = false; this.ix.sfx.lever(); this.hiss?.stop(); this.hiss = null; this.g.saveState(); this.g.toast('Disconnected. Hang the hose back on the tank, or connect again.', 2200); return; }
    this.state = 'carry'; this.ix.sfx.clunk(0.3); this.g.toast('Walk the hose to the rocket and click it to connect.', 2600);
  }
  stow(quiet) { if (this.state === 'stowed') return; this.state = 'stowed'; this.port.visible = false; this.hiss?.stop(); this.hiss = null; if (!quiet) this.ix.sfx.clunk(0.3); this.g.saveState(); }
  connect() {
    const tanks = this.tankItem();
    if (!tanks.length) { this.g.toast('Add a fuel tank to the rocket first.'); this.g.audio.bad(); return; }
    const rg = this.g.build.rocketGroup; rg.updateWorldMatrix(true, false);
    // port on the lowest tank, on the side facing the supply tank (stored in rocket-local space so it turns with the stand)
    const t = tanks[0], R0 = (t.d.radius || 0.9) + 0.05;
    const toTank = rg.worldToLocal(TANK.clone().setY(0)).setY(0).normalize();
    this.portLocal = toTank.multiplyScalar(R0).setY(t.y0 + Math.min(1.2, t.d.length * 0.4));
    this.ventLocal = toTank.clone().normalize().multiplyScalar(R0).setY(tanks[tanks.length - 1].y1 - 0.35);
    this.state = 'connected'; this.port.visible = true; this.ix.sfx.lever(); setTimeout(() => this.ix.sfx.clunk(0.5), 120);
    this.g.toast(this.g.fill >= 0.999 ? 'Connected. Tanks are already full: topping off.' : !this.pump ? 'Connected. Turn the FUEL PUMP on at the console.' : (this.valve ?? 1) < 0.05 ? 'Connected. Open the fuel valve on the tank to start the flow.' : 'Connected. Fueling…', 2200);
    this.topOff = this.g.fill >= 0.999 ? 2.5 : 0;
  }
  rebuildHose(force) {
    const n = this.nozzle, key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`; if (!force && key === this.lastKey) return; this.lastKey = key;
    const back = n.clone().addScaledVector(this.nozDir, -0.3), dist = Math.hypot(n.x - OUTLET.x, n.z - OUTLET.z);
    let pts;
    if (this.state === 'stowed') pts = [OUTLET, new THREE.Vector3(OUTLET.x + 0.25, 0.08, OUTLET.z + 0.25), new THREE.Vector3(OUTLET.x + 0.55, 0.08, OUTLET.z + 0.7), new THREE.Vector3(PARK.x + 0.12, 0.55, PARK.z + 0.1), back];
    else {
      const a = new THREE.Vector3(OUTLET.x + 0.45, 0.06, OUTLET.z), b = new THREE.Vector3(n.x, 0.06, n.z).lerp(a, Math.min(0.5, 0.6 / Math.max(0.6, dist)));
      const mid = a.clone().lerp(b, 0.5); mid.x += (n.z - OUTLET.z) * 0.08; mid.z -= (n.x - OUTLET.x) * 0.08;
      pts = [OUTLET, new THREE.Vector3(OUTLET.x + 0.3, 0.2, OUTLET.z), a, mid, b, back.clone().setY(Math.max(0.3, back.y * 0.5)), back];
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4), this.ix.lite ? 40 : 72, 0.045, 8);
    this.hose.geometry.dispose(); this.hose.geometry = g;
  }
  update(dt, inBuild, active) {
    if (!this.ready) return;
    const g = this.g, cam = this.ix.w.camera;
    if (!inBuild && this.state !== 'stowed') this.stow(true);
    // nozzle placement
    if (this.state === 'stowed') { this.nozzle.copy(PARK); this.nozDir.set(0, -1, 0); }
    else if (this.state === 'carry') {
      const f = new THREE.Vector3(), r = new THREE.Vector3(); cam.getWorldDirection(f); r.crossVectors(f, cam.up).normalize();
      this.nozzle.copy(cam.position).addScaledVector(f, 0.85).addScaledVector(r, 0.32); this.nozzle.y -= 0.38; this.nozDir.copy(f);
      // hose length: gently hold the player back
      const P = g.build.player, dx = P.x - TANK.x, dz = P.z - TANK.z, d = Math.hypot(dx, dz);
      if (d > HOSE_MAX && !this.ix.ctl) { P.x = TANK.x + dx / d * HOSE_MAX; P.z = TANK.z + dz / d * HOSE_MAX; if (!this.stretchT || performance.now() - this.stretchT > 4000) { this.stretchT = performance.now(); g.toast('That’s the full hose length.', 1400); } }
      // rocket proxy around the stand
      const rg = g.build.rocketGroup, L = rg?.userData.layout;
      if (rg && L) { const top = L.top + 1; this.rocketHit.scale.set(1, top, 1); this.rocketHit.position.set(0, (rg.position.y || 0) + top / 2, 0); }
    } else if (this.state === 'connected') {
      const rg = g.build.rocketGroup; if (!rg || !this.tankItem().length) { this.state = 'carry'; this.port.visible = false; }
      else { rg.updateWorldMatrix(true, false); const p = rg.localToWorld(this.portLocal.clone()), c = rg.localToWorld(new THREE.Vector3(0, this.portLocal.y, 0)); this.nozDir.copy(c).sub(p).normalize(); this.nozzle.copy(p).addScaledVector(this.nozDir, -0.22); this.port.position.copy(p); this.port.lookAt(c); this.port.rotateX(Math.PI / 2); }
    }
    this.noz.position.copy(this.nozzle); this.noz.lookAt(this.nozzle.clone().add(this.nozDir));
    this.rebuildHose();
    // flow
    const flowing = this.state === 'connected' && this.pump && (this.valve ?? 1) > 0.04 && (g.fill < 0.999 || this.topOff > 0);
    if (flowing) {
      if (g.fill < 0.999) { g.fill = Math.min(1, g.fill + dt * 0.075 * Math.max(0.05, this.valve ?? 1)); this.saveT = (this.saveT || 0) - dt; if (this.saveT <= 0 || g.fill >= 1) { this.saveT = 0.3; g.build.refreshCheckout(); } if (g.fill >= 1) { g.saveState(); g.toast('Tanks full. Rocket is fueled.', 2000); this.ix.sfx.chime(2); this.topOff = 1.5; } }
      else this.topOff -= dt;
      this.frost = Math.min(1, this.frost + dt * 0.12); this.tankFrost = Math.min(0.75, this.tankFrost + dt * 0.08);
      if (!this.hiss) this.hiss = this.ix.sfx.loop('hiss');
      this.hiss.set(0.7 + 0.3 * Math.sin(performance.now() / 300));
      this.wheel.rotation.z = (this.valve ?? 1) * Math.PI * 3.2;
    } else {
      if (this.hiss) { this.hiss.stop(); this.hiss = null; }
      this.frost = Math.max(0, this.frost - dt * 0.006); this.tankFrost = Math.max(0.15, this.tankFrost - dt * 0.01);
    }
    this.flowing = flowing;
    this.frostMat.opacity = this.tankFrost;
    if (Math.abs((this.dialV ?? -1) - g.fill) > 0.004) this.drawDial(g.fill);
    // vapor: venting while flowing, a lazy wisp from the supply tank, frost wisps on a chilled rocket
    if (!inBuild) { this.vapor.points.visible = false; this.frostRocket(0); return; }
    this.vapor.points.visible = true;
    const rate = flowing ? 26 : this.frost > 0.3 ? 4 * this.frost : 0; this.acc = (this.acc || 0) + dt * rate;
    const rg = g.build.rocketGroup;
    while (this.acc > 1 && rg && this.ventLocal) { this.acc--; const p = rg.localToWorld(this.ventLocal.clone()), out = p.clone().setY(0).sub(rg.getWorldPosition(new THREE.Vector3()).setY(0)).normalize(); this.vapor.emit(p, out.multiplyScalar(0.5 + Math.random() * 0.6).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.05, (Math.random() - 0.5) * 0.3)), 0.35, 2.6); }
    if (this.acc > 1) this.acc = 0;
    this.tAcc = (this.tAcc || 0) + dt * (flowing ? 6 : 0.8); while (this.tAcc > 1) { this.tAcc--; this.vapor.emit(this.ventTop, new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.5, (Math.random() - 0.5) * 0.2), 0.4, 3.2); }
    const w = this.ix.w; this.vapor.mat.uniforms.uScale.value = w.h * w.renderer.getPixelRatio() / Math.tan(cam.fov * Math.PI / 360) / 2;
    this.vapor.mat.uniforms.uLight.value = 0.25 + 0.75 * this.ix.lights.k.bay;
    this.vapor.update(dt);
    this.frostRocket(this.frost);
  }
  // frost shells over the rocket's tank sections (rebuilt when the rocket changes)
  frostRocket(k) {
    const rg = this.g.build.rocketGroup; if (!rg) return;
    if (!this.rocketFrostMat) { this.rocketFrostMat = new THREE.MeshStandardMaterial({ map: frostTex(), color: 0xf8fbff, roughness: 0.92, metalness: 0, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }); this.rocketFrostMat.map.repeat.set(3, 2); }
    this.rocketFrostMat.opacity = 0.8 * k;
    const key = rg.uuid; if (k < 0.01) { if (this.fg) this.fg.visible = false; return; }
    if (this.fgKey !== key) {
      this.fgKey = key; this.fg = new THREE.Group(); this.fg.name = 'frost'; rg.add(this.fg);
      for (const t of this.tankItem()) { const r = (t.d.radius || 0.9) + 0.012; const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, t.d.length * 0.92, 40, 1, true), this.rocketFrostMat); m.position.y = (t.y0 + t.y1) / 2; m.raycast = () => {}; m.castShadow = false; this.fg.add(m); }
    }
    this.fg.visible = true;
  }
}
