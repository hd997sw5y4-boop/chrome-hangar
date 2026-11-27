// Workshop radio: a small original (unbranded) set that sits on the workbench.
// The tuner knob cycles the hangar's existing lo-fi tracks; the volume wheel drives
// the same music volume as Settings and stays in sync with that slider.
import * as THREE from 'three';
import { hitBox, labelTex } from './interactive.js';
import { IS_TOUCH } from './env.js';

export const TRACKS = [
  { file: 'assets/music/puppy-love.mp3', name: 'Puppy Love' },
  { file: 'assets/music/new-shoes.mp3', name: 'New Shoes' },
  { file: 'assets/music/poor-but-happy.mp3', name: 'Poor, But Happy' },
];

export function installMusicControls(audio) {
  if (audio._trackCtl) return audio._trackCtl;
  const ctl = {
    names: TRACKS.map(t => t.name),
    skip: () => audio.skipTrack?.() ?? ctl.names[0],
    name: () => audio.trackName?.() ?? ctl.names[0],
    index: () => audio.trackIndex?.() ?? 0,
  };
  audio._trackCtl = ctl;
  return ctl;
}

export function setMusicVolume(game, v) {
  const s = game.settings;
  s.music = THREE.MathUtils.clamp(v, 0, 1);
  game.applySettingsLight();
  const sl = document.querySelector('#panelBody input[data-k="music"]');
  if (sl) sl.value = String(s.music);
}

function metal(color, rough = 0.35, metalness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness });
}

export class Radio {
  constructor(hands) {
    this.h = hands; this.g = hands.g; this.ix = hands.ix;
    this.spin = 0; this.volA = 0; this.tuneA = 0;
    this.dragging = null;
    this.ctl = installMusicControls(this.g.audio);
  }
  build(parent, pos) {
    const ix = this.ix, root = this.root = new THREE.Group();
    root.name = 'workshopRadio';
    root.position.copy(pos);
    parent.add(root);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.16), metal(0xc45a2a, 0.45, 0.2));
    body.position.y = 0.09; body.castShadow = true; root.add(body);
    const grill = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.02), metal(0x2a2c30, 0.6, 0.4));
    grill.position.set(-0.06, 0.09, 0.081); root.add(grill);
    for (let i = 0; i < 5; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.006, 0.004), metal(0x8a8e94, 0.3, 0.8));
      sl.position.set(-0.06, 0.055 + i * 0.018, 0.092); root.add(sl);
    }
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.04), new THREE.MeshBasicMaterial({
      map: labelTex([['HANGAR FM', 48]], { w: 256, h: 64, fg: '#f2e6c8' }), transparent: true,
    }));
    plate.position.set(-0.06, 0.155, 0.082); root.add(plate);

    const knobs = [
      { key: 'tune', x: 0.08, label: 'TUNE', color: 0xe8c872 },
      { key: 'vol', x: 0.14, label: 'VOL', color: 0xd8dadc },
    ];
    this.knobs = {};
    for (const k of knobs) {
      const g = new THREE.Group(); g.position.set(k.x, 0.12, 0.09); root.add(g);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.02, 16), metal(k.color, 0.28, 0.7));
      cap.rotation.x = Math.PI / 2; g.add(cap);
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.02), metal(0x1a1c20, 0.4, 0.3));
      tick.position.z = 0.008; tick.position.y = 0.012; g.add(tick);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.016), new THREE.MeshBasicMaterial({
        map: labelTex([[k.label, 72]], { w: 128, h: 40, fg: '#3a2a1a' }), transparent: true,
      }));
      lab.position.set(0, -0.04, 0.001); g.add(lab);
      const hit = hitBox(0.09, 0.1, 0.1); g.add(hit);
      this.knobs[k.key] = { g, cap, tick, hit };
    }

    const led = this.led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x14220c, emissive: 0x7cff6a, emissiveIntensity: 1.6, roughness: 0.4 }));
    led.position.set(0.03, 0.155, 0.082); root.add(led);

    const bodyHit = hitBox(0.4, 0.28, 0.28); bodyHit.position.y = 0.1; root.add(bodyHit);
    ix.add({
      hit: bodyHit, glow: [body, grill], range: 3.2,
      label: () => `Radio: ${this.ctl.name()}`,
      use: () => this.cycle(),
      enabled: () => !this.dragging,
    });
    ix.add({
      hit: this.knobs.tune.hit, glow: [this.knobs.tune.cap], range: 3.2,
      label: () => `Tuner: ${this.ctl.name()} · click for the next song`,
      use: () => this.cycle(),
      enabled: () => !this.dragging,
    });
    ix.add({
      hit: this.knobs.vol.hit, glow: [this.knobs.vol.cap], range: 3.2,
      label: () => `Volume: ${Math.round((this.g.settings.music ?? 0) * 100)}% · ${IS_TOUCH ? 'drag' : 'drag'} to turn`,
      use: (xy) => this.beginVol(xy),
    });

    this.volA = (this.g.settings.music ?? 0.45) * Math.PI * 1.6;
    this.tuneA = this.ctl.index() * 0.7;
    this.knobs.vol.g.rotation.z = -this.volA;
    this.knobs.tune.g.rotation.z = -this.tuneA;
    return root;
  }
  cycle() {
    this.g.audio.unlock();
    const name = this.ctl.skip();
    this.tuneA += 0.7;
    this.ix.sfx.click();
    this.ix.sfx.button();
    this.g.toast(`Radio: ${name}`, 1800);
  }
  beginVol(xy) {
    this.g.audio.unlock();
    this.dragging = { x: xy?.x ?? this.g.input.mouse.x, y: xy?.y ?? this.g.input.mouse.y, a: this.volA };
    this.ix.sfx.click();
  }
  update(dt) {
    if (!this.root) return;
    const inp = this.g.input;
    if (this.dragging) {
      const x = inp.mouse.x, y = inp.mouse.y;
      const da = (x - this.dragging.x) * 0.012 + (this.dragging.y - y) * 0.012;
      this.volA = THREE.MathUtils.clamp(this.dragging.a + da, 0, Math.PI * 1.6);
      setMusicVolume(this.g, this.volA / (Math.PI * 1.6));
      if (!inp.dragging && !inp.down?.('Mouse0') && !this._held) {
        // pointer-up is tracked below
      }
    }
    const want = (this.g.settings.music ?? 0) * Math.PI * 1.6;
    if (!this.dragging) this.volA += (want - this.volA) * Math.min(1, dt * 12);
    this.knobs.vol.g.rotation.z = -this.volA;
    this.knobs.tune.g.rotation.z = -this.tuneA;
    this.led.material.emissiveIntensity = 1.2 + 0.5 * Math.sin(performance.now() / 260);
  }
  endDrag() {
    if (!this.dragging) return;
    this.dragging = null;
    this.ix.sfx.tapFx();
  }
}
