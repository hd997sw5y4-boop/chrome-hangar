// Altitude detail for the base (hangar, apron, pads, test stand, outdoor props, ground) during flight.
// Each direct child of a base root is a unit, judged by its on-screen size:
//   < SHADOW_PX   stops casting shadows (it is a few pixels; its shadow is less)
//   < HIDE_PX     hidden (sub-pixel)
//   all hidden for FREE_AFTER s (not in map view): its GPU geometry and textures are freed. The JS side stays,
//   so it can be re-uploaded: textures go up a few per frame through renderer.initTexture, then units reappear a
//   few per frame (their geometry uploads then) while they are still sub-pixel.
// Show thresholds sit above hide thresholds (hysteresis), and the show test uses where the camera will be RESTORE_LEAD s
// from now, so on a fast descent everything is back well before it can be seen. The rocket, sky, Earth and Moon are
// never touched. Map view shows a resident one-draw low-poly proxy whenever the full base is not all there.
// Leaving flight restores everything at once.
import * as THREE from 'three';

const SHADOW_PX = 6, SHADOW_ON_PX = 9;   // stop / resume casting
const HIDE_PX = 0.25, SHOW_PX = 0.6;     // hide when a unit is under a quarter pixel, back above 0.6 px (still not visible)
const RESTORE_LEAD = 4;                  // s of closing speed folded into the show test
const FREE_AFTER = 3;                    // s with the whole base hidden before its GPU memory is freed
const TEX_PER_FRAME = 6, UNITS_PER_FRAME = 24;
const ROOT_NAMES = ['apron', 'apronJoints', 'testStand', 'padSite', 'padComplex', 'padRelease', 'handsOut', 'cartCourse', 'robotsOut', 'golfCart'];
const MAP_CAM = 7;   // flight.js CAMS[7] = 'Top-down map'
const GROUND_RESTORE_ALT = 32000;        // m: the local ground fades back in below ~22 km (env.js GLOBE_FADE); re-upload it before that

const _box = new THREE.Box3();

export class BaseLOD {
  constructor(game) { this.g = game; this.w = game.world; this.units = null; this.freed = false; this.outSince = 0; this.queue = []; this.prev = new THREE.Vector3(); this.vel = 0; this.testCam = null; }

  roots() {
    const w = this.w, out = [w.hangar, w.outdoor?.group];
    for (const n of ROOT_NAMES) { const o = w.scene.getObjectByName(n); if (o && o.parent === w.scene) out.push(o); }
    return [...new Set(out.filter(Boolean))];
  }
  // capture the units (when a flight starts: cart / robots may have moved since the last one)
  capture() {
    this.units = [];
    for (const root of this.roots()) for (const o of root.children) {
      if (o.isLight) continue;
      _box.setFromObject(o); if (_box.isEmpty()) continue;
      const s = _box.getBoundingSphere(new THREE.Sphere());
      const casters = []; o.traverse(m => { if (m.isMesh && m.castShadow) casters.push(m); });
      this.units.push({ o, root, s, casters, hidden: false, wasVis: true, shadowOff: false });
    }
    this.proxy?.removeFromParent(); const ground = this.w.outdoor?.group;
    for (const u of this.units) u.inProxy = u.root !== ground && u.s.radius >= 3;   // tiny props are sub-pixel in map view anyway; the ground is the planet pass
    this.proxy = this.proxy || this.buildProxy(); this.w.scene.add(this.proxy); this.proxy.visible = false;
  }
  // one merged, flat-shaded box per large unit (vertex colours from its main material): resident, one draw
  buildProxy() {
    const pos = [], col = [], idx = [], c = new THREE.Color(), bx = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), bp = bx.attributes.position;
    for (const u of this.units) {
      if (!u.inProxy) continue;
      _box.setFromObject(u.o); const size = _box.getSize(new THREE.Vector3()), ctr = _box.getCenter(new THREE.Vector3());
      let mat = null; u.o.traverse(m => { if (!mat && m.isMesh) mat = [].concat(m.material)[0]; });
      c.copy(mat?.color || c.set(0x9a9890));
      for (let i = 0; i < bp.count; i++) { pos.push(ctr.x + bp.getX(i) * Math.max(size.x, 0.2), ctr.y + bp.getY(i) * Math.max(size.y, 0.2), ctr.z + bp.getZ(i) * Math.max(size.z, 0.2)); col.push(c.r, c.g, c.b); }
    }
    bx.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.name = 'baseProxy'; m.frustumCulled = false; m.userData.noAO = true; return m;
  }

  update(dt) {
    const G = this.g, w = this.w, flying = G.mode === 'flight' && G.flight?.f && !(G.intro && !G.intro.done);
    if (!flying) { if (this.units) this.restoreAll(); return; }
    if (!this.units) this.capture();
    const cam = this.testCam || w.camera, r = w.renderer;
    // closing speed toward the base from the camera's own motion (works for every view, replay included)
    const d0 = cam.position.length(); if (this.prevD != null && dt > 0) this.vel += ((this.prevD - d0) / dt - this.vel) * Math.min(1, dt * 4); this.prevD = d0;
    const lead = Math.max(0, this.vel) * RESTORE_LEAD;
    const focal = (w.h || 720) * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
    const map = G.flight.cam === MAP_CAM;
    let proxyHidden = true, shadowChange = false;
    for (const u of this.units) {
      const d = Math.max(1, cam.position.distanceTo(u.s.center) - u.s.radius), px = 2 * u.s.radius * focal / d, pxSoon = 2 * u.s.radius * focal / Math.max(1, d - lead);
      u.px = px;
      // shadows
      const offNow = pxSoon < (u.shadowOff ? SHADOW_ON_PX : SHADOW_PX);   // judged on where the camera is heading, so no flip-flop
      if (offNow !== u.shadowOff) { u.shadowOff = offNow; for (const m of u.casters) m.castShadow = !offNow; shadowChange = true; }
      // visibility (showing a freed unit goes through the upload queue)
      if (!u.hidden && !u.pending && pxSoon < HIDE_PX) { u.hidden = true; u.wasVis = u.o.visible; }
      else if (u.hidden && !u.pending && pxSoon > SHOW_PX) { u.pending = true; this.queue.push(u); }
      if (u.hidden) u.o.visible = false; else if (u.inProxy) proxyHidden = false;   // re-asserted every frame: other code (props, terrain fade) toggles some of these
    }
    if (shadowChange) w.markShadow();
    // freed and coming back down (a unit wants to show, or the ground is about to fade back in): re-upload first
    if (this.freed && !this.upload && (this.queue.length || cam.position.y - lead < GROUND_RESTORE_ALT)) this.upload = [...this.freedTex];
    this.pump();
    // free GPU memory once the whole base (the ground counts once its own fade has hidden it) has been out of sight a while
    let out = 0; for (const u of this.units) if (u.hidden || !u.root.visible) out++;
    const allOut = out === this.units.length && !this.queue.length && cam.position.y - lead > GROUND_RESTORE_ALT;
    const now = performance.now(); if (!allOut) this.outSince = 0; else if (!this.outSince) this.outSince = now;
    if (!this.freed && this.outSince && now - this.outSince > FREE_AFTER * 1000) this.free();
    if (this.proxy) this.proxy.visible = map && proxyHidden;   // map view: the big structures are never just gone
  }
  // restore: a few freed textures up per frame, then (once they are all up) a few units revealed per frame
  pump() {
    if (this.upload) {
      const r = this.w.renderer;
      for (let n = TEX_PER_FRAME; n > 0 && this.upload.length; n--) { try { r.initTexture(this.upload.pop()); } catch (_) {} }
      if (this.upload.length) return;
      this.upload = null; this.freed = false; this.freedTex = null;   // geometry re-uploads as each unit is next drawn (still sub-pixel)
    }
    for (let n = UNITS_PER_FRAME; n > 0 && this.queue.length; n--) { const u = this.queue.shift(); u.pending = false; u.hidden = false; u.o.visible = u.wasVis; this.maxShowPx = Math.max(this.maxShowPx || 0, u.px || 0); }
  }
  // dispose GPU copies of what only the base uses (anything also drawn by the rocket, cockpit, Moon or Earth is kept)
  free() {
    const base = new Set(), keepG = new Set(), keepT = new Set(), geo = new Set(), tex = new Set();
    for (const u of this.units) u.o.traverse(o => base.add(o));
    const texOf = (m, into) => { for (const v of Object.values(m)) if (v?.isTexture) into.add(v); if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v?.isTexture) into.add(v); } };
    this.w.scene.traverse(o => { if (base.has(o)) return; if (o.geometry) keepG.add(o.geometry); for (const m of [].concat(o.material || [])) texOf(m, keepT); });
    for (const t of [this.w.scene.environment, this.w.scene.background]) if (t) keepT.add(t);
    const U = this.w.earth?.U; if (U) for (const k in U) { const v = U[k]?.value; if (v?.isTexture) keepT.add(v); }   // the planet pass shares the water normal map
    for (const sc of [this.w.spaceView?.far, this.w.spaceView?.near]) sc?.traverse(o => { if (o.geometry) keepG.add(o.geometry); for (const m of [].concat(o.material || [])) texOf(m, keepT); });
    for (const u of this.units) u.o.traverse(o => { if (o.geometry && !keepG.has(o.geometry)) geo.add(o.geometry); for (const m of [].concat(o.material || [])) { const s = new Set(); texOf(m, s); for (const t of s) if (!keepT.has(t) && !t.isRenderTargetTexture) tex.add(t); } });
    for (const gm of geo) gm.dispose();
    for (const t of tex) t.dispose();
    this.freedTex = [...tex]; this.upload = null; this.freed = true;
  }
  restoreAll() {
    for (const u of this.units) {
      if (u.hidden) u.o.visible = u.wasVis;
      if (u.shadowOff) for (const m of u.casters) m.castShadow = true;
    }
    if (this.freed) for (const t of this.freedTex) { try { this.w.renderer.initTexture(t); } catch (_) {} }   // geometry re-uploads on the next draw
    this.w.markShadow();
    if (this.proxy) this.proxy.visible = false;
    this.units = null; this.queue = []; this.freed = false; this.freedTex = null; this.upload = null; this.outSince = 0; this.prevD = null; this.vel = 0;
  }
  info() { return this.units ? { units: this.units.length, hidden: this.units.filter(u => u.hidden).length, shadowOff: this.units.filter(u => u.shadowOff).length, freed: this.freed, freedTex: this.freedTex?.length || 0, queue: this.queue.length, proxy: !!this.proxy?.visible, outFor: this.outSince ? +((performance.now() - this.outSince) / 1000).toFixed(1) : 0 } : { units: 0 }; }
}
