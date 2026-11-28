// Build mode: first-person hangar, parts tray, snap-to-mount with ghost preview, delete, undo/redo,
// a build stand that raises/lowers/turns, checkout panel with CoM gem and CoD ring.
import * as THREE from 'three';
import { PARTS, PART_IDS, layout, stats, stability, problems, candidates, applyPlace, applyRemove, cloneRocket, partCount } from './rocket.js';
import { rocketMesh, partMesh, finPair, legSet, ghostify, disposeTree, initMaterials } from './parts3d.js';
import { HANGAR, IS_TOUCH } from './env.js';
import { DECK } from './stand.js';
import { groundAt, rampEdges } from './ground.js';
import { walk as collideWalk, playerFrame, R_PLAYER, insideHangar } from './collide.js';
import { Tray } from './tray.js';
import { TrayView } from './trayview.js';

const $ = id => document.getElementById(id);
const EYE = 1.65;

export class BuildMode {
  constructor(game) {
    this.g = game; this.w = game.world;
    this.player = { x: 2.5, z: 9.5, yaw: 0.22, pitch: 0.08 };
    this.standH = 0; this.standTarget = 0; this.standYaw = 0.5;
    this.sel = null; this.undoS = []; this.redoS = [];
    this.rocketGroup = null; this.markers = new THREE.Group(); this.w.stand.add(this.markers);
    this.cg = new THREE.Group(); this.w.stand.add(this.cg); // CoM gem / CoD ring
    const M = initMaterials();
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb000, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.2 }));
    this.ringM = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 24), new THREE.MeshStandardMaterial({ color: 0x7fe7ff, emissive: 0x2fb7ff, emissiveIntensity: 0.8 }));
    this.cg.add(this.gem, this.ringM);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.35, depthWrite: false });
    this.markHot = new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.95, depthWrite: false });
    this.ringGeo = new THREE.TorusGeometry(1.22, 0.035, 8, 64); this.dotGeo = new THREE.SphereGeometry(0.22, 16, 12);
    this.ray = new THREE.Raycaster(); this.tut = null; this.aimXY = null; this.dragging = null;
    this.held = {};
    this.view = new TrayView(this); this.trayOpen = true;
    this.wireUI();
    this.rebuild();
  }
  // ---------- UI ----------
  wireUI() {
    $('btnUndo').onclick = () => this.undo(); $('btnRedo').onclick = () => this.redo();
    $('toStand').onclick = () => this.g.travel('test'); $('toPad').onclick = () => this.g.travel('flight');
    $('btnSave').onclick = () => this.g.showSaves(); $('btnLoad').onclick = () => this.g.showSaves();
    $('ckToggle').onclick = () => { const b = $('ckBody'); b.classList.toggle('hidden'); $('ckToggle').textContent = b.classList.contains('hidden') ? '+' : '–'; };
    $('fillBtns').innerHTML = [0.25, 0.5, 0.75, 1].map(f => `<button data-f="${f}">${f * 100}%</button>`).join('');
    $('fillBtns').onclick = e => { const f = +e.target.dataset.f; if (f) { this.g.fill = f; this.g.audio.tap(); this.refreshCheckout(); this.g.saveState(); } };
    $('standCtl').querySelectorAll('button').forEach(b => {
      const k = b.dataset.s;
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.held[k] = true; this.g.audio.tap(); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { this.held[k] = false; });
    });
    if (IS_TOUCH) { $('ckBody').classList.add('hidden'); $('ckToggle').textContent = '+'; }
    // tray: tap a card to pick it, drag it up onto the rocket, wheel / drag sideways to scroll
    this.tray = new Tray($('tray'), {
      onHover: () => this.g.audio.hover(),
      onTap: card => { this.view.open(); if (this.pickable(card)) this.select(this.sel === card.dataset.id && !IS_TOUCH ? null : card.dataset.id); },
      onDragOut: (card, e) => {
        const id = card.dataset.id; if (id === 'delete' || !this.pickable(card)) return;
        if (this.sel !== id) this.select(id);
        this.view.open();
        this.dragging = { id, moved: 31 }; this.aimXY = { x: e.clientX, y: e.clientY };
      },
    });
    // Tray button (also T / Tab / wheel click, R3 or the touchpad click on a DualSense): open = free cursor + framed view,
    // close = back to the walk-around view and mouse-look. Losing mouse-look any other way (Esc) opens the tray.
    $('btnTray').onclick = () => this.toggleTray();
    document.addEventListener('pointerlockchange', () => {
      if (this.g.mode !== 'build') return;
      const locked = document.pointerLockElement === this.w.renderer.domElement;
      if (locked && this.trayOpen) this.showTray(false);
      else if (!locked && !this.trayOpen) this.showTray(true, false);
    });
    addEventListener('resize', () => this.measureTray());
    // a part being carried out of the tray follows the pointer; let go over the hangar to place it
    addEventListener('pointermove', e => { if (this.dragging) { this.dragging.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (e.target === this.w.renderer.domElement || this.dragging.moved > 30) this.aimXY = { x: e.clientX, y: e.clientY }; } });
    addEventListener('pointercancel', () => { if (this.dragging) { this.dragging = null; if (IS_TOUCH) this.aimXY = null; } });   // a cancelled touch drag drops the part
    addEventListener('pointerup', e => {
      if (!this.dragging) return; const d = this.dragging; this.dragging = null;
      if (d.moved > 30 && document.elementFromPoint(e.clientX, e.clientY) === this.w.renderer.domElement) { this.aimXY = { x: e.clientX, y: e.clientY }; this.aim(); this.place(); }
      if (IS_TOUCH) this.aimXY = null;
    });
  }
  showTray(open, frame = open) {
    this.trayOpen = open; document.body.classList.toggle('trayShut', !open); $('btnTray').classList.toggle('on', open);
    if (open && frame) this.view.open(); if (!open) this.view.close();
    this.measureTray();
  }
  toggleTray() {
    const open = !this.trayOpen; this.g.audio.tap(); this.showTray(open);
    if (open) this.g.input.exitLock(); else this.g.input.requestLock();
  }
  measureTray() { const h = $('tray').offsetHeight; if (h) document.documentElement.style.setProperty('--trayH', h + 'px'); }
  // with the tray shut, picking a part (wheel, keys, L1/R1) flashes it up for a moment
  peekTray() {
    if (this.trayOpen) return;
    document.body.classList.add('trayPeek'); clearTimeout(this.peekT);
    this.peekT = setTimeout(() => document.body.classList.remove('trayPeek'), 1400);
  }
  makeTray() {
    const secs = { structure: 'Structure', propulsion: 'Propulsion', control: 'Control' };
    let html = '';
    for (const [k, label] of Object.entries(secs)) {
      const ids = PART_IDS.filter(id => PARTS[id].section === k);
      html += `<div class="traySec"><h4>${label}</h4><div class="tiles">` + ids.map(id => {
        const p = PARTS[id], n = PART_IDS.indexOf(id) + 1, locked = !this.g.partUnlocked(id);
        return `<div class="tile ${locked ? 'locked' : ''}" data-id="${id}" data-lock="${locked ? '★' + p.unlockStars : ''}" title="${p.name}: ${p.blurb}"><span class="kb">${n <= 9 ? n : ''}</span><img src="${this.g.thumbs?.[id] || ''}" alt=""><span class="nm">${p.name}</span></div>`;
      }).join('') + '</div></div>';
    }
    html += `<div class="traySec"><h4>Tools</h4><div class="tiles"><div class="tile del" data-id="delete" title="Delete / detach a part"><span class="kb">0</span><span class="ico">✕</span><span class="nm">Delete</span></div></div></div>`;
    $('tray').innerHTML = html;
    this.refreshTray(); this.measureTray();
  }
  pickable(t) {
    this.g.audio.unlock();
    if (!t.classList.contains('locked')) return true;
    const id = t.dataset.id; this.g.toast(`Earn ${PARTS[id].unlockStars}★ in missions to unlock ${PARTS[id].name}.`); this.g.audio.bad(); return false;
  }
  refreshTray() {
    const step = this.tut && this.tutSteps[this.tut.i];
    $('tray').querySelectorAll('.tile').forEach(t => {
      t.classList.toggle('sel', t.dataset.id === this.sel);
      t.classList.toggle('pulse', !!step && step.part === t.dataset.id && this.sel !== t.dataset.id);
      t.classList.toggle('dim', !!step && !!step.part && step.part !== t.dataset.id);
    });
  }
  selectable() { return [...PART_IDS.filter(id => this.g.partUnlocked(id)), 'delete']; }
  select(id) {
    this.sel = id; this.g.audio.tap(); this.refreshTray(); this.clearGhost(); this.hoverDel = null;
    if (id) { this.tray?.reveal($('tray').querySelector(`.tile[data-id="${id}"]`)); this.peekTray(); }
    if (id && id !== 'delete') this.autoStand(id);
  }

  // ---------- rocket + history ----------
  get rocket() { return this.g.rocket; }
  setRocket(r, record = true, placedAt = null) {
    if (record) { this.undoS.push(cloneRocket(this.g.rocket)); if (this.undoS.length > 60) this.undoS.shift(); this.redoS.length = 0; }
    this.g.rocket = r; this.g.saveState(); this.rebuild(placedAt); this.tutCheck();
  }
  resetHistory() { this.undoS.length = 0; this.redoS.length = 0; this.rebuild(); }
  undo() { if (!this.undoS.length) { this.g.audio.bad(); return; } this.redoS.push(cloneRocket(this.g.rocket)); this.g.rocket = this.undoS.pop(); this.g.audio.remove(); this.g.saveState(); this.rebuild(); this.usedUndo = true; this.tutCheck(); }
  redo() { if (!this.redoS.length) { this.g.audio.bad(); return; } this.undoS.push(cloneRocket(this.g.rocket)); this.g.rocket = this.redoS.pop(); this.g.audio.snap(); this.g.saveState(); this.rebuild(); this.tutCheck(); }
  problemsFor() { return problems(this.g.rocket); }

  rebuild(placedAt) {
    if (this.rocketGroup) { this.rocketGroup.removeFromParent(); disposeTree(this.rocketGroup); }
    const g = this.rocketGroup = rocketMesh(this.g.rocket);
    const L = g.userData.layout;
    g.position.y = DECK - L.bottom; this.w.stand.add(g);
    this.fitClamps();
    if (placedAt) { // the new part drops in softly
      const pk = g.userData.picks.filter(p => p.t.type === placedAt.type && p.t.index === placedAt.index).pop();
      if (pk) this.settle = { obj: pk.obj, y: pk.obj.position.y, t: 0 };
    }
    this.delKey = null; this.delGhost = null;   // the old delete highlight went with the old meshes (undo/redo/load)
    this.clearGhost(); this.refreshCheckout();
  }
  clearGhost() { if (this.ghost) { this.ghost.removeFromParent(); disposeTree(this.ghost); this.ghost = null; this.ghostKey = null; } }

  refreshCheckout() {
    const r = this.g.rocket, st = stats(r, this.g.fill), stab = stability(st), probs = problems(r);
    const twrC = st.twr >= 1.2 ? 'good' : st.twr >= 1 ? 'warn' : 'badc';
    const stabC = ['badc', 'warn', 'good'][stab.level];
    const eng = r.engine ? PARTS[r.engine] : null;
    $('ckStats').innerHTML = [
      ['Mass', (st.mass / 1000).toFixed(2) + ' t'],
      ['Thrust-to-weight', `<span class="${twrC}">${st.twr.toFixed(2)} ${st.twr >= 1 ? '✓' : '✗ needs > 1.0'}</span>`],
      ['Burn time', st.burnTime ? Math.round(st.burnTime) + ' s' : '—'],
      ['Δv', st.dv ? Math.round(st.dv) + ' m/s' : '—'],
      ['Balance', `<span class="${stabC}">${stab.level === 2 ? '◆ above ○' : stab.level === 1 ? '◆ ≈ ○' : '◆ below ○'} ${stab.word}</span>`],
      ['Engine', eng ? `${eng.name}${eng.engines > 1 ? ' · ' + eng.engines + ' nozzles' : ''} · min ${Math.round(eng.minThrottle * 100)}%` : '—'],
      ['Parts', partCount(r)],
    ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    $('ckProblems').textContent = probs[0] || (stab.level === 0 ? 'The gem sits below the ring, so it will flip. Add fins to the lowest tank.' : '');
    $('fillBtns').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.f === this.g.fill));
    this.drawDiagram(st);
    // 3D markers beside the rocket
    const off = this.rocketGroup.position.y;
    this.gem.position.set(2.6, off + st.com, 0); this.ringM.position.set(2.6, off + st.cop, 0);
    this.cg.visible = r.stack.length > 0;
  }
  drawDiagram(st) {
    const cv = $('ckDiagram'), g = cv.getContext('2d'), W = cv.width, H = cv.height, r = this.g.rocket, L = layout(r);
    g.clearRect(0, 0, W, H);
    const h = Math.max(6, L.top - L.bottom), s = (H - 16) / h, x0 = 34, y = v => H - 8 - (v - L.bottom) * s, rw = 0.9 * s;
    g.fillStyle = '#cfd6dd';
    for (const it of L.items) {
      if (it.d.kind === 'nose') { g.beginPath(); g.moveTo(x0 - rw, y(it.y0)); g.quadraticCurveTo(x0 - rw, y(it.y1), x0, y(it.y1)); g.quadraticCurveTo(x0 + rw, y(it.y1), x0 + rw, y(it.y0)); g.fill(); }
      else { g.fillStyle = it.d.kind === 'mount' ? '#555c63' : '#cfd6dd'; g.fillRect(x0 - rw, y(it.y1), rw * 2, (it.y1 - it.y0) * s - 1); g.fillStyle = '#cfd6dd'; }
      if (it.s.fins) { g.fillStyle = '#9aa6b2'; g.beginPath(); g.moveTo(x0 - rw, y(it.y0 + 1.4)); g.lineTo(x0 - rw - 1.25 * s, y(it.y0 - 0.2)); g.lineTo(x0 - rw, y(it.y0 - 0.35)); g.moveTo(x0 + rw, y(it.y0 + 1.4)); g.lineTo(x0 + rw + 1.25 * s, y(it.y0 - 0.2)); g.lineTo(x0 + rw, y(it.y0 - 0.35)); g.fill(); g.fillStyle = '#cfd6dd'; }
      if (it.s.legs) { g.strokeStyle = '#555c63'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - rw, y(it.y0 + 0.9)); g.lineTo(x0 - 2.3 * s, y(L.bottom)); g.moveTo(x0 + rw, y(it.y0 + 0.9)); g.lineTo(x0 + 2.3 * s, y(L.bottom)); g.stroke(); }
    }
    if (L.engLen) {
      const e = PARTS[r.engine], n = e.engines || 1, br = (e.bellRadius || e.radius);
      g.fillStyle = '#3a3f45';
      if (n === 1) { g.beginPath(); g.moveTo(x0 - br * 0.35 * s, y(L.engLen)); g.lineTo(x0 + br * 0.35 * s, y(L.engLen)); g.lineTo(x0 + br * s, y(0)); g.lineTo(x0 - br * s, y(0)); g.fill(); }
      else { const xs = n === 3 ? [-br, 0, br] : n === 9 ? [-2 * br, -br, 0, br, 2 * br] : [-3 * br, -1.5 * br, 0, 1.5 * br, 3 * br]; for (const dx of xs) { g.beginPath(); g.moveTo(x0 + (dx - br * 0.28) * s, y(L.engLen)); g.lineTo(x0 + (dx + br * 0.28) * s, y(L.engLen)); g.lineTo(x0 + (dx + br) * s, y(0)); g.lineTo(x0 + (dx - br) * s, y(0)); g.fill(); } }
    }
    if (!r.stack.length) return;
    // gem = centre of mass, ring = centre of drag (shape + word, never colour alone)
    const gy = y(st.com), cy = y(st.cop);
    g.fillStyle = '#ffd34d'; g.beginPath(); g.moveTo(x0 + rw + 12, gy - 6); g.lineTo(x0 + rw + 18, gy); g.lineTo(x0 + rw + 12, gy + 6); g.lineTo(x0 + rw + 6, gy); g.fill();
    g.strokeStyle = '#7fe7ff'; g.lineWidth = 2.5; g.beginPath(); g.arc(x0 + rw + 12, cy, 5, 0, 7); g.stroke();
    g.font = '9px sans-serif'; g.fillStyle = '#ffd34d'; g.fillText('mass', x0 + rw + 20, gy + 3); g.fillStyle = '#7fe7ff'; g.fillText('drag', x0 + rw + 20, cy + 3);
  }

  fitClamps() {
    const r = this.g.rocket, a = this.w.assembly; if (!a) return;
    if (!r.stack.length && !r.engine) { a.openClamps(); return; }
    const eng = r.engine && PARTS[r.engine];
    a.fitClamps((eng && (eng.radius || eng.bellRadius)) || 0.9);
  }

  // ---------- stand ----------
  autoStand(id) {
    const r = this.g.rocket, L = layout(r), d = PARTS[id]; let wy = L.top;
    if (d.kind === 'engine' || d.kind === 'mount') wy = L.engLen;
    else if (d.kind === 'fins' || d.kind === 'legs') { const t = L.items.find(it => it.d.kind === 'tank'); wy = t ? t.y0 + 0.8 : L.top; }
    // Keep the pad flush on the hangar floor. Only drop it into the pit so tall stacks stay at work height.
    this.standTarget = THREE.MathUtils.clamp(Math.min(0, 1.2 - (wy - L.bottom)), -(HANGAR.pitDepth - 1.5), 0);
  }

  // ---------- mode hooks ----------
  enter() {
    this.w.setIndoor(true); this.w.camera.fov = 70; this.w.camera.updateProjectionMatrix();
    this.w.stand.visible = true; this.w.assembly?.setFold(0, true); this.standH = this.standTarget = 0;
    this.w.stand.position.y = 0;
    for (const b of $('standCtl').querySelectorAll('[data-s="up"], [data-s="down"]')) b.classList.add('hidden');
    this.rebuild(); this.view.reset(); this.showTray(true, false); this.applyCam();
    this.g.scene = this.w.scene;
  }
  exit() { this.view.reset(); document.body.classList.remove('trayShut', 'trayPeek'); this.g.input.exitLock(); this.clearGhost(); this.markers.clear(); $('aimReason').classList.add('hidden'); this._why = this._whyAt = null; this.g.prompt(null); }
  idle() {
    this.applyCam(); this.view.update(0, null); this.w.stand.position.y = 0; this.w.stand.rotation.y = this.standYaw;
  }
  // eye over the shared ground (terrain + walkable ramps); with dt it eases onto a slope so steps never pop, a teleport snaps
  applyCam(dt = 0) {
    const P = this.player, g = groundAt(P.x, P.z);
    if (dt > 0 && this.eyeG != null && Math.abs(g - this.eyeG) < 1.5) this.eyeG += (g - this.eyeG) * (1 - Math.exp(-(g > this.eyeG ? 14 : 18) * dt));
    else this.eyeG = g;
    this.w.camera.position.set(P.x, EYE + this.eyeG, P.z); this.w.camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
  }

  camRay() {
    const cam = this.w.camera;
    if (this.aimXY) {
      const v = new THREE.Vector2(this.aimXY.x / innerWidth * 2 - 1, -(this.aimXY.y / innerHeight) * 2 + 1);
      this.ray.setFromCamera(v, cam);
    } else this.ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    return this.ray.ray;
  }
  // candidate anchor positions in world space
  candWorld(c, L = layout(this.g.rocket)) {
    const g = this.rocketGroup;
    let y = 0, side = false;
    if (c.type === 'stack') y = c.index >= L.items.length ? L.top : (c.index === 0 && L.items.length ? L.items[0].y0 - 0.4 : L.items[c.index].y0);
    else if (c.type === 'engine') y = L.engLen ? L.engLen * 0.5 : -0.4;
    else { y = L.items[c.index].y0 + (c.type === 'fins' ? 0.7 : 0.4); side = true; }
    const p = new THREE.Vector3(0, y, 0);
    if (side) { const cl = g.worldToLocal(this.w.camera.position.clone()); cl.y = 0; cl.normalize().multiplyScalar(1.15); p.x = cl.x; p.z = cl.z; }
    return { local: p, world: g.localToWorld(p.clone()) };
  }
  aim() {
    const out = { cand: null, reason: null, del: null };
    if (!this.sel) return out;
    const ray = this.camRay();
    if (this.sel === 'delete') {
      const hits = this.ray.intersectObjects(this.rocketGroup.children, true);
      const h = hits.find(x => x.object.userData.target);
      out.del = h ? h.object.userData.target : null;
      return out;
    }
    const cs = candidates(this.g.rocket, this.sel);
    if (cs.length && !cs[0].ok) { out.reason = cs[0].reason; return out; }
    let best = null, bd = Infinity;
    const L = layout(this.g.rocket);
    for (const c of cs) {
      const w = this.candWorld(c, L).world; c.w = w;
      const d = ray.distanceToPoint(w), dist = w.distanceTo(this.w.camera.position);
      const lim = Math.max(2.4, dist * 0.16);
      if (d < lim && d < bd) { bd = d; best = c; }
    }
    if (!best && cs.length === 1 && this.aimXY) best = cs[0]; // touch: one spot, tap anywhere near the stand
    out.cand = best; out.all = cs;
    return out;
  }
  place3D(a = this.lastAim) {
    // markers for every valid spot, the hovered one bright; ghost preview of the part
    // (a small pool of marker meshes is reused every frame instead of rebuilding them)
    const pool = this.markers.children; let n = 0;
    if (a && this.sel && this.sel !== 'delete') {
      const off = this.rocketGroup.position.y, L = layout(this.g.rocket);
      for (const c of a.all || []) {
        const { local } = this.candWorld(c, L), hot = c === a.cand, dot = c.type === 'fins' || c.type === 'legs';
        let m = pool[n++];
        if (!m) { m = new THREE.Mesh(this.ringGeo, this.markMat); m.raycast = () => {}; this.markers.add(m); }
        m.visible = true; m.geometry = dot ? this.dotGeo : this.ringGeo; m.material = hot ? this.markHot : this.markMat;
        m.position.set(local.x, local.y + off, local.z); m.rotation.set(dot ? 0 : Math.PI / 2, 0, 0);
        m.scale.setScalar(hot ? 1.15 : 1);
      }
    }
    for (let i = n; i < pool.length; i++) pool[i].visible = false;
  }
  updateGhost(a) {
    const c = a.cand;
    const key = c ? `${this.sel}:${c.type}:${c.index}:${this.g.rocket.stack.length}` : null;
    if (key === this.ghostKey) return;
    this.clearGhost(); this.ghostKey = key;
    if (!c) return;
    const L = layout(this.g.rocket), d = PARTS[this.sel];
    let o;
    if (c.type === 'fins') { o = finPair(this.g.rocket.stack[c.index].fins || 0); o.position.y = L.items[c.index].y0 + 0.35; }
    else if (c.type === 'legs') { o = legSet(L.items[c.index].y0 + PARTS.legs.drop); o.position.y = L.items[c.index].y0; }
    else {
      o = partMesh(this.sel);
      if (c.type === 'engine') o.position.y = L.engLen - d.length;
      else if (c.index >= L.items.length) o.position.y = L.top;
      else o.position.y = L.items[c.index].y0 - (c.index === 0 ? d.length : 0);
    }
    ghostify(o, false); o.scale.multiplyScalar(1.02);
    this.rocketGroup.add(o); this.ghost = o;
  }
  setDelHover(t) {
    const key = t ? t.type + t.index : null;
    if (key === this.delKey) return; this.delKey = key;
    if (this.delGhost) { this.delGhost.removeFromParent(); this.delGhost = null; }
    if (!t) return;
    const pk = this.rocketGroup.userData.picks.filter(p => p.t.type === t.type && p.t.index === t.index).pop();
    if (!pk) return;
    const cl = pk.obj.clone(); ghostify(cl, true); cl.scale.multiplyScalar(1.03);
    pk.obj.parent.add(cl); this.delGhost = cl;
    this.g.audio.hover();
  }
  place() {
    const a = this.aim();
    if (this.sel === 'delete') { if (a.del) this.remove(a.del); else this.g.audio.bad(); return; }
    if (!a.cand) { if (a.reason) { this.g.toast(a.reason); this.g.audio.bad(); } return; }
    const was = this.g.rocket.engine;
    const target = a.cand.type === 'stack' ? { type: 'stack', index: a.cand.index } : a.cand.type === 'engine' ? { type: 'engine', index: 0 } : { type: a.cand.type, index: a.cand.index };
    this.setRocket(applyPlace(this.g.rocket, this.sel, a.cand), true, target);
    this.g.audio.snap();
    if (a.cand.type === 'engine' && was) this.g.toast(`Swapped ${PARTS[was].name} → ${PARTS[this.sel].name}`);
    if (!candidates(this.g.rocket, this.sel).some(c => c.ok)) this.select(null); else this.autoStand(this.sel);
  }
  remove(t) {
    this.setRocket(applyRemove(this.g.rocket, t)); this.g.audio.remove(); this.delKey = null; this.delGhost = null;
    this.removedSomething = true; this.tutCheck();
  }

  update(dt, blocked) {
    const inp = this.g.input, cam = this.w.camera, P = this.player;
    if (blocked) { this.place3D(); return; }
    // keys / pad buttons
    if (inp.hit('KeyZ') || inp.hit('Ctrl+KeyZ') || inp.hit('Pad1')) this.undo();
    if (inp.hit('KeyY') || inp.hit('Ctrl+KeyY') || inp.hit('Ctrl+Shift+KeyZ') || inp.hit('Pad3')) this.redo();
    for (let i = 1; i <= 9; i++) if (inp.hit('Digit' + i)) { const id = PART_IDS[i - 1]; if (id && this.g.partUnlocked(id)) this.select(this.sel === id ? null : id); }
    if (inp.hit('Digit0') || inp.hit('Delete') || inp.hit('Backspace') || inp.hit('Pad2')) this.select(this.sel === 'delete' ? null : 'delete');
    if (inp.hit('Pad4') || inp.hit('Pad5')) { const l = this.selectable(); const i = l.indexOf(this.sel); this.select(l[(i + (inp.hit('Pad5') ? 1 : l.length - 1) + (i < 0 ? 1 : 0)) % l.length]); }
    if (inp.hit('Pad8')) this.g.travel('test');
    // mouse captured: the wheel steps through the tray (one notch = one part); Tab frees / recaptures the cursor
    if (inp.locked && inp.zoom) {
      this.wheelAcc = (this.wheelAcc || 0) + inp.zoom;
      if (Math.abs(this.wheelAcc) >= 0.9) { const l = this.selectable(), i = l.indexOf(this.sel), d = this.wheelAcc > 0 ? 1 : -1; this.wheelAcc = 0; this.select(l[i < 0 ? (d > 0 ? 0 : l.length - 1) : (i + d + l.length) % l.length]); }
    }
    if (inp.hit('KeyT') || inp.hit('Tab') || inp.hit('Mouse1') || inp.hit('Pad11') || inp.hit('Pad17')) this.toggleTray();
    // look + walk (while the tray view is framing the work, look / move orbit and zoom it instead)
    const framed = this.view.on;
    if (!framed) { P.yaw -= inp.look.x; P.pitch = THREE.MathUtils.clamp(P.pitch - inp.look.y, -1.35, 1.35); }
    const sp = framed ? 0 : (inp.down('ShiftLeft') ? 6.5 : 3.6) * dt;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    // forward = (fx, fz), right = (-fz, fx); move.x > 0 strafes right, move.y < 0 walks forward
    const nx = P.x + (fx * -inp.move.y + -fz * inp.move.x) * sp, nz = P.z + (fz * -inp.move.y + fx * inp.move.x) * sp;
    const obs = playerFrame(this.g).concat(rampEdges()), bots = this.g.robots?.obstacles(); if (bots?.length) obs.push(...bots);   // ramp sides are too tall to step up
    const p = collideWalk(nx, nz, R_PLAYER, obs); P.x = p.x; P.z = p.z;
    const wantIn = insideHangar(P.x, P.z, this.w.indoor ? -0.4 : 1.0);
    if (wantIn !== this.w.indoor) this.w.setIndoor(wantIn);
    this.applyCam(dt); this.view.update(dt, inp);
    // stand: R/F raise/lower, Q/E turn (also d-pad and on-screen buttons)
    const k = c => inp.down(c) ? 1 : 0, pb = inp.pad?.b || [];
    const up = k('KeyR') + (pb[12] > 0.5) + (this.held.up ? 1 : 0) - k('KeyF') - (pb[13] > 0.5) - (this.held.down ? 1 : 0);
    const turn = k('KeyE') + (pb[15] > 0.5) + (this.held.right ? 1 : 0) - k('KeyQ') - (pb[14] > 0.5) - (this.held.left ? 1 : 0);
    this.standTarget = 0; this.standH = 0;
    this.standYaw += turn * 1.4 * dt;
    this.w.stand.position.y = 0; this.w.stand.rotation.y = this.standYaw;
    if (this.settle) { const s = this.settle; s.t += dt * 4; const e = Math.max(0, 1 - s.t); s.obj.position.y = s.y + 0.5 * e * e; if (s.t >= 1) { s.obj.position.y = s.y; this.settle = null; } }
    this.w.standGlow.material.color.setHSL(0.53, 0.9, 0.55 + 0.15 * Math.sin(performance.now() / 600));
    this.gem.rotation.y += dt * 1.5;
    // aiming: cursor when the mouse is free, screen centre when locked or on a pad
    if (!IS_TOUCH && !this.dragging) this.aimXY = inp.locked || inp.lastDevice === 'pad' ? null : { x: inp.mouse.x, y: inp.mouse.y };
    const a = this.lastAim = this.aim();
    if (this.sel === 'delete') { this.setDelHover(a.del); this.clearGhost(); } else { this.setDelHover(null); this.updateGhost(a); }
    this.place3D(a);
    const rs = $('aimReason');
    // only touch the DOM when the hint actually changes (no style recalc every frame)
    const why = a.reason && !IS_TOUCH ? a.reason : '', at = why && this.aimXY ? `${this.aimXY.x}|${this.aimXY.y}` : '';
    if (why !== this._why) { this._why = why; if (why) rs.textContent = why; rs.classList.toggle('hidden', !why); }
    if (why && at !== this._whyAt) { this._whyAt = at; rs.style.left = this.aimXY ? this.aimXY.x + 'px' : ''; rs.style.top = this.aimXY ? (this.aimXY.y + 22) + 'px' : ''; }
    // clicks / taps
    const tap = inp.taps[0];
    if (tap) {
      this.aimXY = { x: tap.x, y: tap.y };
      if (this.g.hands?.inspectTap?.(tap)) { inp.taps.shift(); this.aimXY = null; }
      else if (this.sel) this.place();
      else this.tryPickDelete(true);
      this.aimXY = null;
    }
    if (inp.mouse.clicked) {
      if (this.g.hands?.blockLock?.()) inp.mouse.clicked = false;
      else {
        const hoveringSomething = a.cand || a.del;
        if (inp.locked || hoveringSomething) this.place();
        else if (!this.view.on) inp.requestLock();   // while the tray view frames the work, a click on empty floor keeps the cursor
      }
    }
    if (inp.hit('Pad0') || inp.hit('Enter')) this.place();
    if (inp.mouse.right || inp.hit('KeyX')) this.tryPickDelete(false);
    this.tutUpdate();
  }
  // right-click (or tap with nothing selected): remove the part under the aim
  tryPickDelete(tapInfo) {
    this.camRay();
    const h = this.ray.intersectObjects(this.rocketGroup.children, true).find(x => x.object.userData.target);
    if (!h) return;
    if (tapInfo) { const t = h.object.userData.target; const id = t.type === 'stack' ? this.g.rocket.stack[t.index].p : t.type === 'engine' ? this.g.rocket.engine : t.type; this.g.toast(`${PARTS[id].name}: ${PARTS[id].blurb}`, 3000); return; }
    this.remove(h.object.userData.target);
  }

  // ---------- tutorial: First bolt ----------
  // Part-by-part build of a basic rocket, with a short fact card for each real part.
  // No payload/capsule or staging/decoupler exists in the parts list, so those are omitted.
  get tutFacts() {
    return {
      stack: { title: 'Why the order matters', body: 'The heavy engine goes at the bottom. That keeps the rocket’s balance point (the center of mass) above the spot where air pushes (the center of pressure), so it stays pointed straight.' },
      mount: { title: 'Engine mount', body: 'Engines bolt under this mount at the very bottom. Putting the heavy engine down low helps the rocket stay upright.' },
      engine: { title: 'Engine and nozzle', body: 'The engine and its nozzle push hot gas down, so the rocket goes up. That’s Newton’s third law: every action has an equal and opposite reaction.' },
      tank: { title: 'Fuel and oxidizer tanks', body: 'This tank holds fuel and oxidizer — the rocket’s own oxygen. There is no air in space to burn, so a rocket has to bring oxygen with it.' },
      nose: { title: 'Nose cone', body: 'The pointed nose cone cuts through the air and makes less drag. Less drag means the rocket can fly faster and higher.' },
      fins: { title: 'Fins', body: 'Fins keep the rocket pointed straight, like feathers on an arrow. They pull the air-push point down so the rocket does not flip.' },
      legs: { title: 'Landing legs', body: 'These legs let the rocket stand after it comes back down. You’ll need them later to land softly.' },
      balance: { title: 'Center of mass and pressure', body: 'The gem ◆ is the center of mass (the balance point), and the ring ○ is the center of pressure (where the air pushes). Keep the gem above the ring, and thrust-to-weight above 1.0, so the rocket can lift off and fly straight.' },
    };
  }
  get tutSteps() {
    const has = k => this.g.rocket.stack.some(s => PARTS[s.p].kind === k);
    const f = this.tutFacts;
    return [
      { text: 'We’ll build a basic rocket the real way: one part at a time, from the bottom up.', fact: f.stack, button: 'Let’s build' },
      { text: 'Pick the <b>Engine Mount</b> in the tray. It is the base everything else stacks on.', part: 'mount', fact: f.mount, check: () => this.sel === 'mount' || has('mount') },
      { text: 'Aim at the glowing ring on the stand and place it.', part: 'mount', fact: f.mount, check: () => has('mount') },
      { text: 'Engines bolt under the mount. Pick <b>Spark</b> and place it.', part: 'spark', fact: f.engine, check: () => this.g.rocket.engine === 'spark' },
      { text: 'Now a <b>Short Tank</b> on top of the mount. This is the rocket’s fuel.', part: 'tank_short', fact: f.tank, check: () => has('tank') },
      { text: 'Cap it with the <b>Nose Cone</b>.', part: 'nose', fact: f.nose, check: () => has('nose') },
      { text: 'Add a <b>Fin Pair</b>. It snaps on as a mirrored pair.', part: 'fins', fact: f.fins, check: () => this.g.rocket.stack.some(s => s.fins) },
      { text: 'Add <b>Landing Legs</b> to the tank.', part: 'legs', fact: f.legs, check: () => this.g.rocket.stack.some(s => s.legs), star: 0 },
      { text: 'Try the <b>Delete</b> tool: remove the fin pair.', part: 'delete', check: () => !this.g.rocket.stack.some(s => s.fins) },
      { text: 'Oops. Press <b>Undo ↶</b> to put the fins back.', check: () => this.usedUndo && this.g.rocket.stack.some(s => s.fins), star: 1 },
      { text: 'Look at the <b>Checkout</b> panel. These two markers tell you if the rocket can lift off and fly straight.', fact: f.balance, button: 'Got it', finish: true, star: 2 },
    ];
  }
  startTutorial() { this.tut = { i: 0, stars: [false, false, false] }; this.usedUndo = false; this.select(null); this.showTut(); if (IS_TOUCH) { $('ckBody').classList.remove('hidden'); $('ckToggle').textContent = '–'; } }
  tutHtml(s) {
    const fact = s.fact ? `<div class="factCard"><span class="factLabel">Did you know?</span><b>${s.fact.title}</b><p>${s.fact.body}</p></div>` : '';
    return `<div class="tutDo">${s.text}</div>${fact}`;
  }
  showTut() {
    const s = this.tutSteps[this.tut.i];
    this.g.prompt(this.tutHtml(s), s.button, s.button ? () => this.tutButton() : null);
    this.refreshTray();
  }
  tutButton() {
    const s = this.tutSteps[this.tut.i];
    if (s.star === 2) this.tut.stars[2] = true;
    if (s.finish) { this.finishTutorial(); return; }
    this.tut.i++; this.g.audio.star(0); this.showTut();
  }
  tutCheck() { this.tutUpdate(); }
  tutUpdate() {
    if (!this.tut || this.g.mission?.type !== 'tutorial') { if (this.tut) { this.tut = null; this.g.prompt(null); this.refreshTray(); } return; }
    const s = this.tutSteps[this.tut.i];
    if (s.check && s.check()) {
      if (s.star === 0) this.tut.stars[0] = true;
      if (s.star === 1) this.tut.stars[1] = true;
      this.tut.i++; this.g.audio.star(0); this.showTut();
    }
  }
  finishTutorial() {
    const stars = this.tut.stars; this.tut = null; this.g.prompt(null); this.refreshTray();
    this.g.award('m0', stars);
    if (this.g.training?.active) { this.g.training.onBuildDone(); return; }
    this.g.showResults({ ok: true, title: 'First bolt: done', reason: 'You built a basic rocket part by part. Next, fire it on the test stand.', stars });
  }
}
