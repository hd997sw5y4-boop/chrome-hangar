// Extra hands-on toys on top of the existing hangar interactions: workbench props,
// a workshop radio, part close-ups, a hand fuel valve, outdoor switches, climb views,
// a pre-launch walk-around, and a test-stand fire lever with a water spray.
import * as THREE from 'three';
import { HANGAR, SPOTS, IS_TOUCH } from './env.js';
import { height } from './terrain.js';
import { loadModel } from './models.js';
import { hitBox, labelTex } from './interactive.js';
import { FENCE, VIEW_STAND } from './outdoor.js';
import { C, setWestYard } from './collide.js';
import { PARTS } from './rocket.js';
import { Radio } from './radio.js';

const H = HANGAR, UP = new THREE.Vector3(0, 1, 0);
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const steel = (c, r = 0.4, m = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

const CSS = `
#ixFact{position:absolute;z-index:32;left:50%;bottom:92px;transform:translateX(-50%);display:none;max-width:min(420px,92vw);padding:12px 16px;border-radius:14px;background:rgba(12,18,26,.78);border:1px solid rgba(127,231,255,.4);color:#e8f8ff;font:14px/1.4 system-ui,sans-serif;backdrop-filter:blur(8px);text-align:left;pointer-events:none}
#ixFact.on{display:block}#ixFact b{display:block;font-size:15px;margin:2px 0 4px}#ixFact .k{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7fe7ff;font-weight:700}
#ixWalk{position:fixed;z-index:28;left:14px;top:86px;display:none;min-width:190px;padding:10px 12px;border-radius:14px;background:rgba(12,18,26,.72);border:1px solid rgba(127,231,255,.35);color:#e8f8ff;font:600 13px/1.35 system-ui,sans-serif;backdrop-filter:blur(6px)}
#ixWalk.on{display:block}#ixWalk h5{margin:0 0 6px;font:700 12px system-ui;letter-spacing:.04em;text-transform:uppercase;color:#7fe7ff}
#ixWalk .row{display:flex;align-items:center;gap:8px;padding:3px 0}#ixWalk .box{width:14px;height:14px;border-radius:4px;border:2px solid rgba(127,231,255,.55);flex:none}
#ixWalk .row.ok .box{background:#5fe39a;border-color:#5fe39a}
#ixWalk .skip{margin-top:8px;width:100%;min-height:34px;border-radius:10px;border:1px solid rgba(127,231,255,.4);background:rgba(12,18,26,.6);color:#e8f8ff;font:700 12px system-ui;cursor:pointer}
#ixWalk .hint{margin-top:4px;font-weight:500;opacity:.8;font-size:11px}
`;

async function cloneTree(name, filter = null) {
  const root = await loadModel(name);
  const src = root.clone(true);
  if (filter) {
    const drop = [];
    src.traverse(o => { if (o.isMesh && !filter(o.name)) drop.push(o); });
    drop.forEach(o => o.parent?.remove(o));
  }
  const box = new THREE.Box3().setFromObject(src);
  const c = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  wrap.add(src);
  src.position.set(-c.x, -box.min.y, -c.z);
  wrap.userData.size = box.getSize(new THREE.Vector3());
  wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return wrap;
}

function puffSys(n = 40) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), life = new Float32Array(n), max = new Float32Array(n);
  const size = new Float32Array(n), alpha = new Float32Array(n), v = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uScale: { value: 500 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale; void main(){ vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=smoothstep(1.0,0.0,d); a*=a*vA; if(a<0.003) discard; gl_FragColor=vec4(vec3(0.92,0.94,0.96),a); }`,
  });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 7; points.userData.noAO = true;
  let i = 0;
  return {
    points, p, v, life, max, size, alpha, n,
    emit(pos, vel, sz = 0.35, lifeT = 0.8) {
      const k = i = (i + 1) % n;
      p.set([pos.x, pos.y, pos.z], k * 3); v.set([vel.x, vel.y, vel.z], k * 3);
      life[k] = lifeT; max[k] = lifeT; size[k] = sz; alpha[k] = 0.8;
    },
    update(dt, scale) {
      for (let k = 0; k < n; k++) {
        if (life[k] <= 0) { alpha[k] = 0; continue; }
        life[k] -= dt; const t = life[k] / max[k], j = k * 3;
        v[j + 1] += 0.4 * dt; v[j] *= 1 - 1.2 * dt; v[j + 2] *= 1 - 1.2 * dt;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
        size[k] += dt * 0.7; alpha[k] = Math.max(0, t) * 0.7;
      }
      geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = geo.attributes.aAlpha.needsUpdate = true;
      if (scale) mat.uniforms.uScale.value = scale;
    },
  };
}

export class Hands {
  constructor(game) {
    this.g = game; this.w = game.world; this.movers = []; this.gateUp = false;
    this.busy = null; this.floods = []; this.beaconOn = false; this.climb = null;
    this.checks = { clamps: false, hose: false, doors: false, robot: false };
    this.skipped = false; this.inspecting = null; this.valveDrag = null;
    this.puffs = puffSys(48); this.deluge = puffSys(80);
    this.lite = this.w.quality === 'phone' || this.w.quality === 'low';
    this.radio = new Radio(this);
    setWestYard(() => this.gateUp);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.factEl = this.mk('ixFact'); this.walkEl = this.mk('ixWalk');
  }
  mk(id) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; }
  get ix() { return this.g.interact; }

  async load() {
    const ix = this.ix;
    const start = performance.now();
    while (!ix?.ready && performance.now() - start < 15000) await new Promise(r => setTimeout(r, 20));
    if (!ix?.ready) { console.warn('hands: interactive not ready'); return; }
    this.group = new THREE.Group(); this.group.name = 'hands'; this.w.hangar.add(this.group);
    this.outGroup = new THREE.Group(); this.outGroup.name = 'handsOut'; this.w.scene.add(this.outGroup);
    this.w.scene.add(this.puffs.points); this.w.scene.add(this.deluge.points);
    await Promise.all([
      this.buildWorkbench(),
      this.buildGenerator(),
      this.buildCarts(),
      this.buildExtinguishers(),
      this.buildClock(),
      this.buildClimb(),
      this.buildOutdoor(),
      this.buildValve(),
      this.buildWalkaround(),
      this.buildTestLever(),
    ].map(p => Promise.resolve(p).catch(e => console.warn('hands', e?.message || e))));
    this.hookConsole();
    this.bindPointers();
    this.hideReplacedDress();
    this.ready = true;
  }

  // ---------- workbench, drawers, vice, lid chest, radio ----------
  async buildWorkbench() {
    const ix = this.ix, g = new THREE.Group(); g.position.set(9, 0, 5); this.group.add(g);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.84), steel(0x8b9098, 0.45, 0.65));
    top.position.y = 1.02; top.castShadow = true; top.receiveShadow = true; g.add(top);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.8), steel(0x2c3036, 0.5, 0.5));
    kick.position.y = 0.03; g.add(kick);
    for (const x of [-1.18, 1.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.72), steel(0x3a4048, 0.4, 0.7));
      leg.position.set(x, 0.5, 0); leg.castShadow = true; g.add(leg);
    }
    // four sliding drawers in the middle of the bench, facing the stand (−Z)
    this.drawers = [];
    const faceZ = -0.36;
    for (let i = 0; i < 4; i++) {
      const y = 0.22 + i * 0.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.17, 0.7), steel(0xc45a22, 0.4, 0.35));
      body.position.set(0, y, 0); body.castShadow = true; g.add(body);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.04), steel(0xd8dadc, 0.25, 0.9));
      handle.position.set(0, y, faceZ - 0.02); g.add(handle);
      const hit = hitBox(1.8, 0.22, 0.9); hit.position.set(0, y, 0); g.add(hit);
      const d = { body, handle, hit, open: false, t: 0, y, z0: 0 };
      this.drawers.push(d);
      ix.add({
        hit, glow: [body, handle], range: 3.6,
        label: () => d.open ? 'Drawer: close' : 'Drawer: open',
        use: () => this.toggleDrawer(d),
      });
    }
    // lid toolbox on the left of the bench
    try {
      const box = await cloneTree('metal_tool_chest');
      box.position.set(-0.8, 1.06, 0.1); box.rotation.y = 0.1; box.scale.setScalar(1); g.add(box);
      this.lid = { root: box, open: false, t: 0 };
      const lidMesh = [];
      box.traverse(o => { if (o.isMesh && /lid|hinge_lid/i.test(o.name)) lidMesh.push(o); });
      const pivot = this.lid.pivot = new THREE.Group();
      // if we found a lid, parent it to a hinge; otherwise the whole box tips a little
      if (lidMesh.length) {
        const bb = new THREE.Box3(); lidMesh.forEach(m => bb.expandByObject(m));
        const back = new THREE.Vector3(); bb.getCenter(back); back.y = bb.min.y; back.z = bb.min.z;
        box.worldToLocal(back);
        pivot.position.copy(back); box.add(pivot);
        lidMesh.forEach(m => { const w = m.getWorldPosition(new THREE.Vector3()); pivot.attach(m); });
      } else {
        box.add(pivot);
      }
      this.lid.meshes = lidMesh;
      const hit = hitBox(0.7, 0.55, 0.6); hit.position.set(-0.8, 1.28, 0.1); g.add(hit);
      ix.add({ hit, glow: lidMesh.length ? lidMesh : [box], range: 3.4, label: () => this.lid.open ? 'Toolbox: close the lid' : 'Toolbox: open the lid', use: () => this.toggleLid() });
    } catch (e) { console.warn('chest', e.message); }

    // vice on the right
    try {
      const vice = await cloneTree('bench_vice_01', n => !/def_|ctrl_|tgt_/.test(n));
      const s = 0.32 / Math.max(vice.userData.size.x, vice.userData.size.y, 0.01);
      vice.position.set(1.9, 1.06, 0); vice.rotation.y = Math.PI / 2; vice.scale.setScalar(s); g.add(vice);
      this.vice = { root: vice, a: 0, t: 0, cranking: false };
      const parts = { dial: [], bar: [], clamp: [], frame: [] };
      vice.traverse(o => {
        if (!o.isMesh) return;
        const n = o.name || '';
        if (/dial/i.test(n)) parts.dial.push(o);
        else if (/bar/i.test(n)) parts.bar.push(o);
        else if (/clamp/i.test(n)) parts.clamp.push(o);
        else parts.frame.push(o);
      });
      this.vice.parts = parts;
      const hit = hitBox(0.55, 0.5, 0.55); hit.position.set(1.9, 1.28, 0); g.add(hit);
      ix.add({ hit, glow: [...parts.dial, ...parts.bar, ...parts.clamp, ...parts.frame], range: 3.4, label: () => 'Bench vice: crank', use: () => this.crankVice() });
    } catch (e) { console.warn('vice', e.message); }

    this.radio.build(g, new THREE.Vector3(0.35, 1.06, 0.12));
    addEventListener('pointerup', () => this.radio.endDrag());
    addEventListener('pointercancel', () => this.radio.endDrag());
  }
  toggleDrawer(d) {
    d.open = !d.open; this.ix.sfx.lever();
    this.g.audio.noise(0.22, 900, 1.4, 0.06, 0, 'bandpass', 0.12);
    this.g.audio.tone(180, 0.12, 'sine', 0.05, 0.1);
  }
  toggleLid() {
    this.lid.open = !this.lid.open; this.ix.sfx.clunk(0.35);
    this.g.audio.tone(420, 0.08, 'sine', 0.04, 0.15);
  }
  crankVice() {
    this.vice.cranking = true; this.vice.t = 0;
    this.ix.sfx.click();
    this.g.audio.noise(0.35, 1400, 2.2, 0.05, 0, 'bandpass', 0.08);
    this.g.audio.tone(90, 0.3, 'sine', 0.04, 0);
  }

  async buildGenerator() {
    const ix = this.ix;
    try {
      const gen = await cloneTree('portable_generator');
      gen.position.set(-12, 0, 13.2); gen.rotation.y = 0.3; this.group.add(gen);
      this.gen = { root: gen, on: false, hum: null, j: 0, home: gen.position.clone() };
      const led = this.gen.led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xff4a3a, emissiveIntensity: 0, roughness: 0.4 }));
      led.position.set(0.25, 0.62, 0.35); gen.add(led);
      if (!this.lite) {
        const l = this.gen.light = new THREE.PointLight(0xff7a4a, 0, 2.4, 2);
        l.position.copy(led.position); gen.add(l);
      }
      const hit = hitBox(1.4, 1.3, 1.2); hit.position.set(-12, 0.6, 13.2); this.group.add(hit);
      ix.add({ hit, glow: [gen], range: 4.2, label: () => this.gen.on ? 'Generator: shut down' : 'Generator: start', use: () => this.toggleGen() });
    } catch (e) { console.warn('generator', e.message); }
  }
  toggleGen() {
    const g = this.gen; g.on = !g.on;
    if (g.on) {
      this.ix.sfx.button(); this.g.audio.tone(70, 0.4, 'sine', 0.08, 0);
      g.hum = this.ix.sfx.loop('rumble'); g.hum.set(0.45); g.hum.pitch?.(1.15);
      this.g.toast('Generator is running.', 1400);
    } else {
      g.hum?.stop(); g.hum = null; this.ix.sfx.clunk(0.3);
      this.g.toast('Generator off.', 1200);
    }
  }

  async buildCarts() {
    const ix = this.ix, spots = [];
    const add = async (name, x, z, ry, r, label) => {
      const o = await cloneTree(name);
      o.position.set(x, 0, z); o.rotation.y = ry; this.group.add(o);
      const c = { g: o, x, z, x0: x, z0: z, t: 1, from: { x, z }, to: { x, z }, r, name: label };
      this.movers.push(c); spots.push(c);
      const hit = hitBox(Math.max(1.1, r * 2.4), 1.4, Math.max(1.1, r * 2.4));
      hit.position.set(0, 0.7, 0); o.add(hit);
      ix.add({ hit, glow: [o], range: 4.2, label: () => `Push the ${label}`, use: () => this.pushCart(c) });
    };
    await Promise.all([
      add('tool_cart', 5.2, 7.4, 0.5, 0.5, 'tool cart'),
      add('tool_cart', -6, -9.5, 2.4, 0.5, 'tool cart'),
      add('industrial_storage_cart', 12.6, -10.2, 0.45, 0.55, 'storage cart').catch(() => null),
      add('portable_welding_cart', -9.9, 9.3, 2.6, 0.55, 'welding cart').catch(() => null),
    ].map(p => Promise.resolve(p).catch(e => console.warn('cart', e.message))));
    this.carts = spots;
  }
  pushCart(c) {
    if (c.t < 1) return;
    const P = this.g.build?.player, dx = c.x - (P?.x ?? 0), dz = c.z - (P?.z ?? 0);
    const len = Math.hypot(dx, dz) || 1;
    const dirx = dx / len, dirz = dz / len;
    const dist = 0.7 + Math.random() * 0.6;
    let nx = c.x + dirx * dist, nz = c.z + dirz * dist;
    // stay inside the hangar, off the walls
    nx = THREE.MathUtils.clamp(nx, -H.x + 1.2, H.x - 1.2);
    nz = THREE.MathUtils.clamp(nz, -H.z + 1.2, H.z - 1.2);
    c.from = { x: c.x, z: c.z }; c.to = { x: nx, z: nz }; c.t = 0;
    this.ix.sfx.clunk(0.25);
    this.g.audio.noise(0.4, 700, 1.2, 0.07, 0, 'bandpass', 0.1);
    this.g.audio.tone(140, 0.2, 'sine', 0.04, 0);
  }

  buildExtinguishers() {
    const ix = this.ix, red = steel(0xc81e14, 0.35, 0.2), blk = steel(0x15171a, 0.6, 0.4);
    this.exts = [];
    for (const [x, z, ry] of [[-H.x + 0.25, -8, Math.PI / 2], [H.x - 0.25, 4, -Math.PI / 2], [-4, H.z - 0.25, Math.PI]]) {
      const e = new THREE.Group(); e.position.set(x, 0.9, z); e.rotation.y = ry; this.group.add(e);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 16), red); can.castShadow = true; e.add(can);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.1, 10), blk); top.position.y = 0.3; e.add(top);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), blk);
      handle.position.set(0.02, 0.34, 0); handle.rotation.z = -Math.PI / 2; e.add(handle);
      const hose = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12, Math.PI), blk);
      hose.position.set(0.08, 0.2, 0); hose.rotation.z = -Math.PI / 2; e.add(hose);
      const ext = { e, handle, cool: 0 };
      this.exts.push(ext);
      const hit = hitBox(0.55, 1.1, 0.55); hit.position.y = 0; e.add(hit);
      ix.add({ hit, glow: [can, handle], range: 3.5, label: () => ext.cool > 0 ? 'Extinguisher: ready again in a moment' : 'Fire extinguisher: give it a puff', use: () => this.puffExt(ext) });
    }
  }
  puffExt(ext) {
    if (ext.cool > 0) { this.g.audio.bad(); return; }
    ext.cool = 1.6; this.ix.sfx.lever();
    this.g.audio.noise(0.55, 2800, 0.8, 0.1, 0, 'highpass', 0.05);
    const origin = ext.e.localToWorld(new THREE.Vector3(0.2, 0.25, 0));
    const fwd = new THREE.Vector3(1, 0.15, 0).applyQuaternion(ext.e.getWorldQuaternion(new THREE.Quaternion()));
    for (let i = 0; i < 18; i++) {
      const j = fwd.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.2) * 0.4, (Math.random() - 0.5) * 0.5));
      this.puffs.emit(origin.clone().addScaledVector(j, 0.05), j.multiplyScalar(1.4 + Math.random()), 0.22, 0.7 + Math.random() * 0.4);
    }
  }

  buildClock() {
    // the live clock already hangs on the back wall; we just give it a chime
    const ix = this.ix, hit = hitBox(1.4, 1.4, 0.5);
    hit.position.set(6, 5.2, H.z - 0.2); this.group.add(hit);
    let clock = null;
    this.w.hangar.traverse(o => { if (o.isMesh && o.material?.map?.image?.width === 256 && o.geometry?.type === 'CircleGeometry') clock = o; });
    ix.add({
      hit, glow: clock ? [clock] : [], range: 8,
      label: () => 'Wall clock: tap to chime',
      use: () => this.chimeClock(),
    });
  }
  chimeClock() {
    const n = ((new Date().getHours()) % 12) || 12;
    const count = Math.min(n, 6);
    this.ix.sfx.chime(2);
    for (let i = 0; i < count; i++) this.g.audio.tone(880, 0.55, 'sine', 0.07, 0.45, i * 0.55);
    this.g.toast('The shop clock chimes.', 1600);
  }

  // ---------- climb: scaffold + wall ladder ----------
  buildClimb() {
    const ix = this.ix;
    const sets = [
      {
        name: 'scaffold',
        hit: [ -6.4, 1.2, 6.0, 3.2, 2.6, 2.2 ],
        views: [
          { pos: V3(-6.35, 4.3, 6.0), look: V3(0, 3.2, 0), label: 'Scaffold, mid level' },
          { pos: V3(-6.35, 6.4, 6.0), look: V3(0, 3.6, 0), label: 'Scaffold, upper level' },
          { pos: V3(-6.35, 8.5, 6.0), look: V3(0, 4.2, 0), label: 'Scaffold, top' },
        ],
      },
      {
        name: 'ladder',
        hit: [ 21.2, 4.5, -7, 0.8, 9, 1.2 ],
        views: [
          { pos: V3(20.2, 5.5, -7), look: V3(0, 3.4, 0), label: 'Ladder, mid' },
          { pos: V3(20.2, 9.2, -7), look: V3(0, 4.5, 0), label: 'Ladder, high' },
          { pos: V3(20.2, 13.0, -7), look: V3(0, 6.0, 0), label: 'Ladder, very high' },
        ],
      },
    ];
    this.climbs = sets;
    for (const s of sets) {
      const [x, y, z, hx, hy, hz] = s.hit;
      const hit = hitBox(hx, hy, hz); hit.position.set(x, y, z); this.group.add(hit);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), steel(0xe0a816, 0.4, 0.4));
      rail.position.set(x, 1.6, z); rail.visible = false; this.group.add(rail);
      ix.add({
        hit, glow: [rail], range: 5.5,
        label: () => this.climb?.set === s ? 'Climb higher · Esc to come down' : `Climb the ${s.name} for a look down at the rocket`,
        use: () => this.takeClimb(s),
        notIn: this.radio, // unused; climb works anytime in build
      });
    }
    this.climbLook = { x: 0, y: 0 };
    this.climbCtl = {
      camPose: () => {
        const v = this.climb.views[this.climb.i];
        const inp = this.g.input;
        this.climbLook.x = THREE.MathUtils.clamp(this.climbLook.x + inp.look.x * 0.8, -1.1, 1.1);
        this.climbLook.y = THREE.MathUtils.clamp(this.climbLook.y - inp.look.y * 0.8, -0.6, 0.6);
        inp.look.x = inp.look.y = 0;
        const look = v.look.clone();
        look.x += this.climbLook.x * 4; look.y += this.climbLook.y * 3;
        return { pos: v.pos, look };
      },
      onTake: () => { this.climbLook.x = this.climbLook.y = 0; this.g.toast(this.climb.views[this.climb.i].label + ' · Esc to come down', 2200); },
      onRelease: () => { this.climb = null; this.climbLook.x = this.climbLook.y = 0; },
    };
  }
  takeClimb(s) {
    if (this.ix.ctl && this.ix.ctl !== this.climbCtl) this.ix.release(true);
    if (this.climb?.set === s) this.climb.i = (this.climb.i + 1) % s.views.length;
    else this.climb = { set: s, i: 0, views: s.views };
    this.ix.sfx.clunk(0.3);
    this.g.audio.tone(240, 0.12, 'sine', 0.05, 0.1);
    this.ix.take(this.climbCtl);
    this.g.toast(s.views[this.climb.i].label + ' · Esc to come down', 2000);
  }

  // ---------- outdoor: gate, flood lights, bunker beacon, viewing stand ----------
  buildOutdoor() {
    const ix = this.ix, F = FENCE, out = this.w.outdoor;
    // gate boom: reuse the existing mesh if we can find it, else make a new arm
    const boomAt = V3(F.x0 - 1, 1.05, F.gateZ);
    let boom = null;
    out?.group?.traverse(o => {
      if (boom || !o.isMesh || o.userData.noBake !== true) return;
      const p = o.getWorldPosition(new THREE.Vector3());
      if (p.distanceTo(boomAt) < 2 && o.geometry?.type === 'BoxGeometry') boom = o;
    });
    const pivot = this.boomPivot = new THREE.Group();
    const post = V3(F.x0 - 1, 1.05, F.gateZ - F.gateW / 2 + 0.3);
    pivot.position.copy(post); this.outGroup.add(pivot);
    if (boom) {
      pivot.attach(boom);
    } else {
      const stripe = document.createElement('canvas'); stripe.width = 256; stripe.height = 16;
      const cg = stripe.getContext('2d'); for (let i = 0; i < 8; i++) { cg.fillStyle = i % 2 ? '#f2f2f2' : '#d6281f'; cg.fillRect(i * 32, 0, 32, 16); }
      const tex = new THREE.CanvasTexture(stripe); tex.colorSpace = THREE.SRGBColorSpace;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, F.gateW - 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
      arm.position.set(0, 0, (F.gateW - 1) / 2); pivot.add(arm); boom = arm;
    }
    this.boom = { pivot, t: 0, target: 0 };
    const hit = hitBox(1.6, 2.2, F.gateW + 1.2); hit.position.set(F.x0 - 1, 1.1, F.gateZ); this.outGroup.add(hit);
    ix.add({
      hit, glow: [boom], range: 10,
      label: () => this.gateUp ? 'Gate arm: lower' : 'Gate arm: lift',
      use: () => this.toggleGate(),
      enabled: () => !this.w.indoor,
    });

    // flood-light masts (click the base; lights are great at dusk)
    const PAD = SPOTS.pad;
    const masts = [
      ...[[-34, -150], [34, -150], [-34, -80], [34, -80]].map(([x, z]) => ({ x, z, h: 26, face: Math.atan2(PAD.x - x, PAD.z - z) })),
      ...[[30, -55], [66, -90]].map(([x, z]) => ({ x, z, h: 18, face: Math.atan2(SPOTS.test.x - x, SPOTS.test.z - z) })),
    ];
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff1c8, emissiveIntensity: 0, roughness: 0.4 });
    this.floods = [];
    masts.forEach((m, i) => {
      const grp = new THREE.Group(); grp.position.set(m.x, 0, m.z); grp.rotation.y = m.face; this.outGroup.add(grp);
      const lenses = [];
      for (let k = 0; k < 6; k++) {
        const lx = -1.5 + (k % 3) * 1.5, ly = m.h + 0.7 + Math.floor(k / 3) * 0.9;
        const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), lampMat); lens.position.set(lx, ly, 0.34); grp.add(lens); lenses.push(lens);
      }
      let spot = null;
      if (!this.lite) {
        spot = new THREE.SpotLight(0xfff0c8, 0, 80, 0.55, 0.45, 1.2);
        spot.position.set(0, m.h + 1.1, 0.2); spot.target.position.set(0, 0, 18); grp.add(spot); grp.add(spot.target);
      }
      const f = { on: false, lenses, spot, lampMat, grp };
      this.floods.push(f);
      const hitB = hitBox(3.2, 3.2, 3.2); hitB.position.set(m.x, 1.2, m.z); this.outGroup.add(hitB);
      ix.add({
        hit: hitB, glow: lenses, range: 10,
        label: () => f.on ? 'Flood lights: turn off' : 'Flood lights: turn on',
        use: () => this.toggleFlood(f),
        enabled: () => !this.w.indoor,
      });
    });
    // share one emissive intensity via the shared material — each mast still has its own on flag,
    // so we use per-lens materials for independent toggles
    this.floods.forEach(f => {
      f.lenses.forEach(l => { l.material = lampMat.clone(); });
    });

    // bunker beacon
    const bunk = out?.bunker;
    const bLocal = V3(-7, 16.1, -6);
    const bWorld = bunk ? bLocal.clone().applyMatrix4((bunk.updateMatrixWorld(true), bunk.matrixWorld)) : V3(-118, 16, -135);
    const bcn = new THREE.Group(); bcn.position.copy(bWorld); this.outGroup.add(bcn);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), new THREE.MeshStandardMaterial({ color: 0x4a1010, emissive: 0xff2a2a, emissiveIntensity: 0.15, roughness: 0.3 }));
    bcn.add(dome);
    this.beacon = { dome, on: false };
    const bHit = hitBox(2.2, 2.4, 2.2); bHit.position.y = 0; bcn.add(bHit);
    const doorHit = hitBox(4, 4, 3);
    if (bunk) {
      const door = V3(6.5, 1.6, -11.1).applyMatrix4(bunk.matrixWorld);
      doorHit.position.copy(door); this.outGroup.add(doorHit);
    }
    const togB = () => this.toggleBeacon();
    ix.add({ hit: bHit, glow: [dome], range: 12, label: () => this.beacon.on ? 'Bunker beacon: turn off' : 'Bunker beacon: blink on', use: togB, enabled: () => !this.w.indoor });
    if (bunk) ix.add({ hit: doorHit, glow: [dome], range: 8, label: () => this.beacon.on ? 'Bunker beacon: turn off' : 'Bunker beacon: blink on', use: togB, enabled: () => !this.w.indoor });

    // viewing stand seat
    const V = VIEW_STAND, yaw = Math.atan2(SPOTS.pad.x - V.x, SPOTS.pad.z - V.z);
    const seatLocal = V3(1.625, 2.55, -2.4);
    const standY = (typeof height === 'function' ? height(V.x, V.z) : 0);
    const seatWorld = seatLocal.clone().applyAxisAngle(UP, yaw).add(V3(V.x, standY, V.z));
    this.seat = { pos: seatWorld, yaw, eye: seatWorld.clone().setY(seatWorld.y + 1.15) };
    const sHit = hitBox(2.4, 1.6, 2.2); sHit.position.copy(seatWorld); sHit.position.y += 0.4; this.outGroup.add(sHit);
    const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.48), steel(0x4a5560, 0.5, 0.3));
    seatMesh.position.copy(seatWorld); seatMesh.rotation.y = yaw; this.outGroup.add(seatMesh);
    ix.add({
      hit: sHit, glow: [seatMesh], range: 8,
      label: () => 'Sit in the viewing stand',
      use: () => this.sitStand(),
      enabled: () => !this.w.indoor && this.ix.ctl !== this.seatCtl,
    });
    this.seatLook = { x: 0, y: 0 };
    this.seatCtl = {
      camPose: () => {
        const inp = this.g.input;
        this.seatLook.x = THREE.MathUtils.clamp(this.seatLook.x + inp.look.x * 0.7, -0.8, 0.8);
        this.seatLook.y = THREE.MathUtils.clamp(this.seatLook.y - inp.look.y * 0.7, -0.4, 0.5);
        inp.look.x = inp.look.y = 0;
        const pos = this.seat.eye.clone();
        const look = V3(SPOTS.pad.x, 14, SPOTS.pad.z);
        const right = V3(Math.cos(this.seat.yaw), 0, -Math.sin(this.seat.yaw));
        look.addScaledVector(right, this.seatLook.x * 40);
        look.y += this.seatLook.y * 25;
        return { pos, look };
      },
      onTake: () => this.g.toast('Viewing stand. Drag to look, Esc to stand up.', 2400),
      onRelease: () => { this.seatLook.x = this.seatLook.y = 0; },
    };
  }
  toggleGate() {
    this.gateUp = !this.gateUp; this.boom.target = this.gateUp ? 1 : 0;
    this.ix.sfx.lever();
    this.boom.rumble = this.ix.sfx.loop('motor');
    this.g.toast(this.gateUp ? 'Gate is up. You can walk out to the viewing stand.' : 'Gate is down.', 2200);
  }
  toggleFlood(f) {
    f.on = !f.on; this.ix.sfx.click();
    if (f.on) this.g.audio.tone(140, 0.25, 'sine', 0.04, 0.1);
  }
  toggleBeacon() {
    this.beacon.on = !this.beacon.on; this.ix.sfx.click();
    this.g.toast(this.beacon.on ? 'Bunker beacon is blinking.' : 'Bunker beacon off.', 1400);
  }
  sitStand() {
    if (!this.gateUp) this.g.toast('Lift the gate arm first if you want a short walk back later.', 2000);
    this.ix.sfx.click(); this.ix.take(this.seatCtl);
  }

  // ---------- fuel valve ----------
  buildValve() {
    const fuel = this.ix.fuel, ix = this.ix;
    if (!fuel?.wheel) return;
    fuel.valve = fuel.valve ?? 1;
    const hit = hitBox(0.55, 0.55, 0.55);
    fuel.wheel.add(hit);
    ix.add({
      hit, glow: [fuel.wheel], range: 4.2,
      label: () => `Fuel valve: ${Math.round((fuel.valve ?? 1) * 100)}% · ${IS_TOUCH ? 'drag' : 'drag or hold'} to turn`,
      use: (xy) => this.beginValve(xy),
    });
  }
  beginValve(xy) {
    const fuel = this.ix.fuel; if (!fuel) return;
    this.valveDrag = { x: xy?.x ?? this.g.input.mouse.x, y: xy?.y ?? this.g.input.mouse.y, v: fuel.valve ?? 1 };
    this.ix.sfx.click();
    this.g.toast('Turn the valve to set how fast the tanks fill. The console pump still has to be on.', 2400);
  }

  // ---------- walk-around checklist ----------
  buildWalkaround() {
    const ix = this.ix;
    // clamps on the assembly stand (one check covers the set)
    const hit = hitBox(4.2, 1.4, 4.2); hit.position.set(0, 0.7, 0); this.group.add(hit);
    ix.add({
      hit, glow: [], range: 5,
      label: () => this.checks.clamps ? 'Clamps: checked' : 'Walk-around: check the hold-down clamps',
      use: () => this.mark('clamps', 'Clamps look solid.'),
      enabled: () => this.ix.ctl == null,
    });
    // hook existing door / hose actions
    const doors = ix.doors, set = doors.set.bind(doors);
    doors.set = (v) => { set(v); this.mark('doors', v ? 'Bay doors open — checked.' : 'Bay doors checked.'); };
    const fuel = ix.fuel;
    if (fuel?.pickUp) {
      const pu = fuel.pickUp.bind(fuel), cn = fuel.connect.bind(fuel);
      fuel.pickUp = () => { pu(); this.mark('hose', 'Fuel hose checked.'); };
      fuel.connect = () => { cn(); this.mark('hose', 'Fuel hose connected and checked.'); };
    }
    this.syncWalkUI();
  }
  mark(key, msg) {
    if (this.checks[key]) { if (msg && key !== 'doors') return; }
    const was = this.allChecked();
    this.checks[key] = true;
    this.ix.sfx.tapFx();
    if (!was && this.allChecked()) { this.ix.sfx.chime(2); this.g.toast('Walk-around complete. The console is GO.', 2400); }
    else if (msg) this.g.toast(msg, 1600);
    this.syncWalkUI();
  }
  allChecked() { return this.skipped || (this.checks.clamps && this.checks.hose && this.checks.doors && this.checks.robot); }
  required() { return !!this.g.mission && !this.g.training?.active; }
  skipWalk() { this.skipped = true; this.ix.sfx.chime(1); this.g.toast('Walk-around skipped. The console can go to GO.', 2000); this.syncWalkUI(); }
  hookConsole() {
    const c = this.ix.console; if (!c?.startCount) return;
    const start = c.startCount.bind(c), draw = c.drawLaptop.bind(c);
    c.startCount = () => {
      if (this.required() && !this.allChecked()) {
        this.g.toast('Walk around first: check the clamps, hose, doors and the robot. Then the console will read GO.', 3200);
        this.g.audio.bad(); this.syncWalkUI(); return;
      }
      start();
    };
    c.drawLaptop = () => {
      draw();
      if (!c.lapCv) return;
      const g = c.lapCv.getContext('2d'), W = 256;
      const ok = !this.required() || this.allChecked();
      g.fillStyle = '#8aa0b4'; g.textAlign = 'left'; g.font = 'bold 13px monospace';
      g.fillText('WALKAROUND', 12, 156);
      g.fillStyle = ok ? '#5dff9a' : '#ff6a5f'; g.textAlign = 'right';
      g.fillText(ok ? 'GO' : 'NO-GO', W - 12, 156);
      c.lapTex.needsUpdate = true;
    };
  }
  syncWalkUI() {
    const el = this.walkEl; if (!el) return;
    const show = this.ready && this.g.mode === 'build' && !this.g.training?.active && !this.g.menuOpen && !this.g.panelOpen && !(this.g.intro && !this.g.intro.done);
    el.classList.toggle('on', !!show);
    if (!show) return;
    const rows = [['clamps', 'Clamps'], ['hose', 'Fuel hose'], ['doors', 'Bay doors'], ['robot', 'Robot']];
    const opt = !this.required();
    el.innerHTML = `<h5>Pre-launch walk-around</h5>` +
      rows.map(([k, n]) => `<div class="row ${this.checks[k] ? 'ok' : ''}"><i class="box"></i><span>${n}</span></div>`).join('') +
      (this.allChecked() ? `<div class="hint">Console is GO.</div>` : opt ? `<div class="hint">Optional in Free Mode.</div><button class="skip" type="button">Skip walk-around</button>` : `<div class="hint">Check each one so the console can read GO.</div>`);
    el.querySelector('.skip')?.addEventListener('click', () => this.skipWalk());
  }

  // ---------- test-stand fire lever + deluge ----------
  buildTestLever() {
    const p = SPOTS.test, g = new THREE.Group(); g.position.set(p.x + 5.35, 2.15, p.z - 3.6); this.w.scene.add(g);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), steel(0x2c3036, 0.4, 0.6)); post.position.y = 0.15; g.add(post);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.4), steel(0xe0a816, 0.4, 0.4)); plate.position.y = 0.72; g.add(plate);
    const piv = new THREE.Group(); piv.position.set(0, 0.72, 0); g.add(piv);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 10), steel(0x22262c, 0.35, 0.8));
    shaft.position.y = 0.28; piv.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.16, 10), steel(0xc81e14, 0.35, 0.3));
    grip.position.y = 0.58; piv.add(grip);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), new THREE.MeshBasicMaterial({
      map: labelTex([['FIRE', 90]], { w: 256, h: 64, fg: '#fff', bg: '#c81e14' }), transparent: true,
    }));
    lab.position.set(0, 0.05, 0.1); lab.rotation.x = -0.3; g.add(lab);
    this.lever = { g, piv, a: 0, target: 0, pulling: false };
    const hit = hitBox(0.9, 1.6, 0.9); hit.position.y = 0.4; g.add(hit);
    this.lever.hit = hit; this.lever.glow = [grip, shaft, plate];
  }
  pullLever() {
    const t = this.g.test, e = t?.s?.e; if (!t || !e) return;
    this.lever.pulling = true; this.lever.target = 1; this.ix.sfx.lever();
    this.g.audio.tone(90, 0.2, 'sine', 0.08, 0.05);
    t.toggleFire();
  }

  // ---------- inspect (click a built part) ----------
  bindPointers() {
    const c = this.w.renderer.domElement;
    let down = null;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), alt: e.altKey, moved: 0 };
      this._ptr = down;
    });
    c.addEventListener('pointermove', e => {
      if (!down) return;
      down.moved += Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
    });
    const up = e => {
      const p = down; down = this._ptr = null;
      this.radio.endDrag();
      if (this.valveDrag) { this.valveDrag = null; this.ix.sfx.tapFx(); }
      if (!p || p.moved > 11 || performance.now() - p.t > 600) return;
      if (this.g.mode === 'test') this.clickTest(p.x, p.y);
      else this.maybeInspect(p.x, p.y, p.alt);
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }
  hitPart(x, y) {
    const b = this.g.build, rg = b?.rocketGroup; if (!rg) return null;
    const locked = document.pointerLockElement === this.w.renderer.domElement;
    const ndc = locked || (x == null) ? new THREE.Vector2(0, 0) : new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(ndc, this.w.camera); ray.far = 40;
    const h = ray.intersectObjects(rg.children, true).find(o => o.object.userData.target || o.object.parent?.userData.target);
    if (!h) return null;
    let o = h.object; while (o && !o.userData.target) o = o.parent;
    return o?.userData.target ? { target: o.userData.target, point: h.point, object: o } : null;
  }
  // build.js calls this on mousedown so a part-click does not grab the mouse or place a part
  blockLock() {
    if (this.g.mode !== 'build' || !this.ready) return false;
    if (this.ix?.ctl) return false;
    const alt = this.g.input.down('AltLeft') || this.g.input.down('AltRight') || this._ptr?.alt;
    const inp = this.g.input;
    const x = inp.locked ? null : inp.mouse.x, y = inp.locked ? null : inp.mouse.y;
    if (!this.hitPart(x, y)) return false;
    if (alt) return true;
    if (this.g.build.sel) return false;
    return true;
  }
  inspectTap(tap) {
    if (this.g.build?.sel) return false;
    const hit = this.hitPart(tap.x, tap.y); if (!hit) return false;
    this.openInspect(hit); return true;
  }
  maybeInspect(x, y, alt) {
    if (this.g.mode !== 'build' || this.g.menuOpen || this.g.panelOpen || this.ix?.ctl) return;
    if (this.g.build?.sel && !alt) return;
    const hit = this.hitPart(x, y); if (!hit) return;
    this.openInspect(hit);
  }
  partId(t) {
    if (t.type === 'stack') return this.g.rocket.stack[t.index]?.p;
    if (t.type === 'engine') return this.g.rocket.engine;
    return t.type;
  }
  factFor(id) {
    const p = PARTS[id], facts = this.g.build?.tutFacts || {};
    const kind = p?.kind;
    const by = kind === 'mount' ? facts.mount : kind === 'engine' ? facts.engine : kind === 'tank' ? facts.tank
      : kind === 'nose' ? facts.nose : kind === 'fins' ? facts.fins : kind === 'legs' ? facts.legs : null;
    const title = p?.name || 'Part';
    const body = by?.body || p?.blurb || 'A piece of your rocket.';
    return { title, body, blurb: p?.blurb, factTitle: by?.title };
  }
  openInspect(hit) {
    const id = this.partId(hit.target); if (!id || !PARTS[id]) return;
    const fact = this.factFor(id);
    const bb = new THREE.Box3().setFromObject(hit.object);
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const r = Math.max(0.35, size.length() * 0.7);
    const cam = this.w.camera;
    const away = cam.position.clone().sub(c); if (away.lengthSq() < 0.01) away.set(0.6, 0.4, 0.6);
    away.normalize();
    const pos = c.clone().addScaledVector(away, r + 0.55); pos.y = Math.max(pos.y, c.y + 0.15);
    this.inspecting = { fact, pos, look: c, t: 0 };
    this.ix.sfx.clunk(0.2);
    this.g.audio.tone(1900, 0.07, 'sine', 0.035, 0.2);
    this.g.audio.tone(520, 0.1, 'sine', 0.04, 0.15);
    this.factEl.innerHTML = `<span class="k">${fact.factTitle ? 'Did you know?' : 'Part'}</span><b>${fact.title}</b>${fact.body}`;
    this.factEl.classList.add('on');
    this.ix.take(this.inspectCtl);
  }
  get inspectCtl() {
    return this._inspCtl || (this._inspCtl = {
      camPose: () => this.inspecting ? { pos: this.inspecting.pos, look: this.inspecting.look } : { pos: this.w.camera.position, look: this.w.camera.position.clone().add(V3(0, 0, -1)) },
      onTake: () => {},
      onRelease: () => { this.inspecting = null; this.factEl.classList.remove('on'); },
    });
  }

  clickTest(x, y) {
    if (!this.lever || this.g.menuOpen || this.g.resultsOpen) return;
    const ndc = new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(ndc, this.w.camera); ray.far = 80;
    const hits = ray.intersectObject(this.lever.hit, false);
    if (hits.length) this.pullLever();
  }

  hideReplacedDress() {
    const spots = [[5.2, 7.4], [-6, -9.5], [12.6, -10.2], [-9.9, 9.3], [-12, 13.2], [8.2, 5.1], [10.9, 5]];
    // hide original carts / chest / vice / generator placed by props.js and interactive.dress
    const roots = [];
    this.w.hangar.traverse(o => { if (o.name === 'props' || o.name === 'ixDress') roots.push(o); });
    for (const root of roots) {
      const kids = [...root.children];
      for (const ch of kids) {
        const p = ch.getWorldPosition(new THREE.Vector3());
        if (spots.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 1.6)) ch.visible = false;
      }
    }
    // hide original code-built extinguishers (red cylinders in props)
    const props = roots.find(o => o.name === 'props');
    if (props) {
      const extAt = [[-H.x + 0.25, -8], [H.x - 0.25, 4], [-4, H.z - 0.25]];
      for (const ch of [...props.children]) {
        const p = ch.getWorldPosition(new THREE.Vector3());
        if (extAt.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 0.5) && ch.type === 'Group') ch.visible = false;
      }
    }
  }

  obstacles() {
    return this.movers.map(c => C(c.x, c.z, c.r + 0.05));
  }

  frame(dt, paused) {
    if (!this.ready) return false;
    const g = this.g, inBuild = g.mode === 'build' && !(g.intro && !g.intro.done);
    const scale = this.w.h * this.w.renderer.getPixelRatio() / Math.tan(this.w.camera.fov * Math.PI / 360) / 2;
    this.puffs.update(dt, scale); this.deluge.update(dt, scale);

    // drawers, lid, vice, carts, generator
    for (const d of this.drawers || []) {
      d.t += ((d.open ? 1 : 0) - d.t) * Math.min(1, dt * 6);
      const z = d.z0 - d.t * 0.48;
      d.body.position.z = z; d.handle.position.z = z - 0.38;
    }
    if (this.lid?.pivot) {
      this.lid.t += ((this.lid.open ? 1 : 0) - this.lid.t) * Math.min(1, dt * 7);
      this.lid.pivot.rotation.x = -this.lid.t * 1.55;
    }
    if (this.vice?.cranking) {
      this.vice.t += dt; const k = Math.min(1, this.vice.t / 0.9);
      this.vice.a += dt * 7 * (1 - k);
      const slide = 0.04 * Math.sin(this.vice.a);
      for (const m of this.vice.parts.dial) m.rotation.y = this.vice.a;
      for (const m of this.vice.parts.bar) m.position.x = (m.userData.hx ??= m.position.x) + slide;
      for (const m of this.vice.parts.clamp) m.position.x = (m.userData.hx ??= m.position.x) + slide;
      if (k >= 1) this.vice.cranking = false;
    }
    for (const c of this.movers) {
      if (c.t < 1) {
        c.t = Math.min(1, c.t + dt / 0.55);
        const e = ease(c.t);
        c.x = c.from.x + (c.to.x - c.from.x) * e;
        c.z = c.from.z + (c.to.z - c.from.z) * e;
        c.g.position.x = c.x; c.g.position.z = c.z;
        c.g.rotation.y += dt * 0.4 * (1 - c.t);
      }
    }
    if (this.gen) {
      if (this.gen.on) {
        this.gen.j += dt * 40;
        this.gen.root.position.x = this.gen.home.x + Math.sin(this.gen.j) * 0.006;
        this.gen.root.position.z = this.gen.home.z + Math.cos(this.gen.j * 1.3) * 0.004;
        this.gen.led.material.emissiveIntensity = 1.4;
        if (this.gen.light) this.gen.light.intensity = 0.6;
        this.gen.hum?.set(0.4 + 0.08 * Math.sin(this.gen.j * 0.2));
      } else {
        this.gen.root.position.copy(this.gen.home);
        this.gen.led.material.emissiveIntensity = 0;
        if (this.gen.light) this.gen.light.intensity = 0;
      }
    }
    for (const e of this.exts || []) {
      e.cool = Math.max(0, e.cool - dt);
      e.handle.rotation.z = -Math.PI / 2 - (e.cool > 1.2 ? 0.4 : 0);
    }
    this.radio.update(dt);

    // valve drag
    const fuel = this.ix.fuel, inp = g.input;
    if (this.valveDrag && fuel) {
      const dv = (this.valveDrag.y - inp.mouse.y) * 0.006 + (inp.mouse.x - this.valveDrag.x) * 0.003;
      fuel.valve = THREE.MathUtils.clamp(this.valveDrag.v + dv, 0, 1);
      inp.look.x = inp.look.y = 0;
    }
    if (this.radio.dragging) inp.look.x = inp.look.y = 0;

    // boom
    if (this.boom) {
      const b = this.boom;
      b.t += (b.target - b.t) * Math.min(1, dt * 2.2);
      b.pivot.rotation.x = -b.t * (Math.PI / 2 - 0.12);
      if (b.rumble) {
        const moving = Math.abs(b.target - b.t) > 0.01;
        b.rumble.set(moving ? 0.6 : 0);
        if (!moving) { b.rumble.stop(); b.rumble = null; this.ix.sfx.clunk(0.5); }
      }
    }
    // floods
    for (const f of this.floods) {
      const want = f.on ? 2.2 : 0;
      for (const l of f.lenses) l.material.emissiveIntensity += (want - l.material.emissiveIntensity) * Math.min(1, dt * 6);
      if (f.spot) f.spot.intensity += ((f.on ? 18 : 0) - f.spot.intensity) * Math.min(1, dt * 6);
    }
    if (this.beacon) {
      const t = performance.now() / 1000;
      this.beacon.dome.material.emissiveIntensity = this.beacon.on ? (Math.sin(t * 8) > 0 ? 3.2 : 0.15) : 0.12;
    }
    this.outGroup.visible = !this.w.indoor || g.mode === 'test' || g.mode === 'flight';

    // walk-around: robot greet counts as a check (no robots.js edits)
    if (inBuild && !this.checks.robot) {
      const list = g.robots?.list;
      if (list && list.some(r => r.greet && r.where === 'hangar')) this.mark('robot', 'The robot checked in.');
    }
    if (!paused) this.syncWalkUI();
    else this.walkEl?.classList.remove('on');

    // inspect auto-release after a short look (Esc also works)
    if (this.inspecting && this.ix.ctl === this.inspectCtl) {
      this.inspecting.t += dt;
      if (this.inspecting.t > 5.5) this.ix.release();
    }

    // test lever + deluge
    if (this.lever) {
      const firing = !!(g.test?.s?.e?.cmd > 0 && g.mode === 'test');
      this.lever.target = firing || this.lever.pulling ? 1 : 0;
      this.lever.a += (this.lever.target - this.lever.a) * Math.min(1, dt * 8);
      this.lever.piv.rotation.x = this.lever.a * 1.15;
      if (this.lever.pulling && this.lever.a > 0.85) this.lever.pulling = false;
      this.lever.g.visible = g.mode === 'test' || (g.mode === 'build' && !this.w.indoor && this.w.camera.position.distanceTo(SPOTS.test) < 40);
      if (g.mode === 'test' && firing) {
        const p = SPOTS.test;
        for (let i = 0; i < (this.lite ? 2 : 5); i++) {
          this.deluge.emit(
            V3(p.x + (Math.random() - 0.5) * 2.2, 2.6, p.z + 0.4 + Math.random() * 2),
            V3((Math.random() - 0.5) * 1.5, -2.5 - Math.random(), 2 + Math.random() * 3),
            0.28, 0.7,
          );
        }
      }
    }

    return false;
  }
}
