// Landing kit for flight: the recovery chute (canopy + shroud lines, drawn from the sim's chute state) and the Legs / Chute controls.
// Keys: L (or D-pad down in flight) toggles the legs, K (or R1) pops the chute. Touch gets two small buttons in the flight bar.
// Everything is built once at construction and stays in the scene: while packed the canopy sits shrunk inside the nose with
// frustum culling off, so its material is compiled on the first pad frame and never mid-flight. Per frame: one matrix + 12 line verts.
import * as THREE from 'three';

const LINES = 6;
export class LandingKit {
  constructor(game) {
    this.g = game; const w = game.world;
    const canopyGeo = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
    // panel stripes baked into vertex colours (no texture, no extra program variant beyond vertexColors on one material)
    const col = [], pos = canopyGeo.attributes.position, c1 = new THREE.Color(0xf26b1d), c2 = new THREE.Color(0xf4f1ea);
    for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getX(i)), k = Math.floor((a + Math.PI) / (Math.PI / 5)) % 2; const c = k ? c1 : c2; col.push(c.r, c.g, c.b); }
    canopyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    this.canopy.frustumCulled = false;
    this.lineGeo = new THREE.BufferGeometry(); this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINES * 2 * 3), 3));
    this.lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.8 }));
    this.lines.frustumCulled = false;
    this.root = new THREE.Group(); this.root.name = 'landingKit'; this.root.add(this.canopy, this.lines); this.root.visible = false; w.scene.add(this.root);
    this.k = 0; this.collapse = 0; this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), r: new THREE.Vector3() };
    // touch / mouse buttons in the flight bar (only shown once off the pad)
    const bar = document.getElementById('fBtns');
    this.bLegs = document.createElement('button'); this.bLegs.id = 'btnLegs'; this.bLegs.className = 'hidden';
    this.bChute = document.createElement('button'); this.bChute.id = 'btnChute'; this.bChute.className = 'hidden'; this.bChute.textContent = 'Chute';
    bar?.prepend(this.bChute); bar?.prepend(this.bLegs);
    this.bLegs.onclick = () => this.toggleLegs(); this.bChute.onclick = () => this.popChute();
    this.ui = '';
  }
  reset(f) { this.f = f; this.k = 0; this.collapse = 0; this.root.visible = !!f; this.ui = ''; this.bLegs.classList.add('hidden'); this.bChute.classList.add('hidden'); this.hintShown = false; }
  toggleLegs() {
    const f = this.f; if (!f || !f.legs || f.phase !== 'flying') return;
    f.legCmd = f.legOut > 0.5 ? 'in' : 'out'; this.g.audio.tap();
    this.g.toast(f.legCmd === 'out' ? 'Legs down' : 'Legs up');
  }
  popChute() {
    const f = this.f; if (!f || f.phase !== 'flying') return;
    if (f.chute === 'none') { this.g.toast('No chute: it packs into a nose cone'); return; }
    if (f.chute !== 'packed') return;
    f.chuteCmd = true; this.g.audio.tap();
  }
  input(inp) {
    if (inp.hit('KeyL') || inp.hit('Pad13')) this.toggleLegs();
    if (inp.hit('KeyK') || inp.hit('Pad5')) this.popChute();
  }
  // per frame, after the render pose is blended. rs = { o, p, u } in world space; top = stack top above the body origin
  update(dt, f, rs, top, group) {
    if (!f) return;
    const T = this.tmp, open = f.chute === 'open', cut = f.chute === 'cut' || f.chute === 'torn';
    // buttons: only touch the DOM when what they say changes
    const flying = f.phase === 'flying', ui = flying ? (f.legs ? (f.legOut > 0.5 ? 'L1' : 'L0') : '') + '|' + f.chute : '';
    if (ui !== this.ui) {
      this.ui = ui;
      this.bLegs.classList.toggle('hidden', !flying || !f.legs); this.bLegs.textContent = f.legOut > 0.5 ? 'Legs: Down' : 'Legs: Up'; this.bLegs.classList.toggle('on', f.legOut > 0.5);
      this.bChute.classList.toggle('hidden', !flying || f.chute === 'none'); this.bChute.textContent = f.chute === 'packed' ? 'Chute' : f.chute === 'open' ? 'Chute: Open' : 'Chute: Gone'; this.bChute.disabled = f.chute !== 'packed';
    }
    if (flying && f.chute === 'packed' && !this.hintShown && f.vs < -25 && f.alt < 2500 && f.alt > 300) { this.hintShown = true; this.g.toast(this.g.input.lastDevice === 'pad' ? 'Falling fast: R1 for the chute' : this.g.input.lastDevice === 'touch' ? 'Falling fast: tap Chute' : 'Falling fast: K for the chute', 3000); }
    // canopy size and lag: grows with the sim's inflation, trails along the air flow, sags when cut
    if (open) this.k = f.chuteK; if (cut) this.collapse = Math.min(1, this.collapse + dt / 1.2);
    const R = Math.sqrt(Math.max(f.chuteA, 1) / Math.PI) * 0.55, s = (open || cut) ? Math.max(0.02, R * (0.15 + 0.85 * this.k * this.k)) * (1 - 0.7 * this.collapse) : 0.001;
    const anchor = T.a.copy(rs.o).addScaledVector(rs.u, top);
    // flow direction: opposite the air-relative velocity, blended toward straight up so a slow drift still looks hung
    T.d.set(-(f.vel.x - f.windNow.x), -(f.vel.y - f.windNow.y), -(f.vel.z - f.windNow.z)); const sp = T.d.length();
    if (sp > 0.1) T.d.multiplyScalar(1 / sp); else T.d.set(0, 1, 0);
    T.d.lerp(T.up, open ? 0.25 : 0.6).normalize();
    if (cut) T.d.lerp(T.r.set(0.4, -0.6, 0.2), this.collapse).normalize();
    const L = (open || cut) ? (3 + R * 2.4 * (0.4 + 0.6 * this.k)) : 0;
    this.canopy.position.copy(anchor).addScaledVector(T.d, L);
    this.canopy.quaternion.setFromUnitVectors(T.up, T.d);
    this.canopy.scale.set(s, s * (0.7 + 0.3 * this.k) * (1 - 0.5 * this.collapse), s);
    if (!open && !cut) { this.canopy.position.copy(anchor).addScaledVector(rs.u, -0.6); }   // packed: shrunk inside the nose (still drawn, so it is compiled up front)
    const P = this.lineGeo.attributes.position, rim = T.b;
    for (let i = 0; i < LINES; i++) {
      const a = i / LINES * Math.PI * 2;
      rim.set(Math.cos(a) * Math.sin(Math.PI * 0.42), Math.cos(Math.PI * 0.42), Math.sin(a) * Math.sin(Math.PI * 0.42)).multiply(this.canopy.scale).applyQuaternion(this.canopy.quaternion).add(this.canopy.position);
      const sAnch = (open || cut) ? anchor : this.canopy.position;
      P.setXYZ(i * 2, sAnch.x, sAnch.y, sAnch.z); P.setXYZ(i * 2 + 1, (open || cut) ? rim.x : sAnch.x, (open || cut) ? rim.y : sAnch.y, (open || cut) ? rim.z : sAnch.z);
    }
    P.needsUpdate = true;
    this.lines.material.opacity = 0.8 * (1 - this.collapse * 0.8);
  }
  hide() { this.root.visible = false; this.f = null; this.bLegs.classList.add('hidden'); this.bChute.classList.add('hidden'); }
}
