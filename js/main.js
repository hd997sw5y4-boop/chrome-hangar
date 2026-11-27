// Chrome Hangar: boot, game state, menus, missions, saves, settings, results.
import * as THREE from 'three';
import { loadParts, PARTS, PART_IDS, emptyRocket, starterRocket, stockRocket, cloneRocket, stats, partCount } from './rocket.js';
import { World, PRESETS, SKIES, defaultQuality, IS_TOUCH, IS_IOS } from './env.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Smoke, Debris, Sparks } from './fx.js';
import { BuildMode } from './build.js';
import { TestMode } from './testfire.js';
import { FlightMode } from './flight.js';
import { partMesh, rocketMesh, disposeTree } from './parts3d.js';
import { dressHangar } from './props.js';
import { Intro, shouldPlayIntro } from './intro.js';

const $ = id => document.getElementById(id);
const LS = { get: (k, d) => { try { const v = localStorage.getItem('ch_' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem('ch_' + k, JSON.stringify(v)); } catch (_) {} } };
const DEFAULTS = () => ({ invertY: false, sens: 1, master: 0.8, music: 0.45, sfx: 0.8, quality: defaultQuality(), assist: true, guide: true, timeOfDay: 'day' });

class Game {
  constructor() {
    this.settings = { ...DEFAULTS(), ...LS.get('settings', {}) };
    this.progress = LS.get('progress', { stars: {}, best: {} });
    this.saves = LS.get('saves', []);
    this.rocket = LS.get('rocket', null) || stockRocket();
    this.fill = LS.get('fill', 1);
    this.mission = null; // mission object or null = sandbox
    this.mode = 'loading';
    this.timer = new THREE.Timer();
    this.acc = 0;
  }
  async boot() {
    const bar = $('loadBar'), txt = $('loadText');
    const step = (p, t) => { bar.style.width = p + '%'; if (t) txt.textContent = t; };
    document.body.classList.toggle('touch', IS_TOUCH);
    step(10, 'Reading part data…');
    await loadParts();
    this.missions = (await (await fetch('data/missions.json')).json()).missions;
    step(25, 'Building the hangar…');
    this.world = new World($('c'), this.settings.quality);
    this.audio = new Audio(); this.audio.setVolumes(this.settings);
    this.input = new Input($('c'));
    this.smoke = new Smoke(PRESETS[this.settings.quality]?.particles || 900); this.world.scene.add(this.smoke.points); this.world.smokeFX = this.smoke;
    this.debris = new Debris(this.world.scene);
    this.sparks = new Sparks(PRESETS[this.settings.quality]?.particles > 600 ? 500 : 200); this.world.scene.add(this.sparks.points);
    this.applySettings();
    addEventListener('resize', () => this.resize()); this.resize();
    step(45, 'Hanging the lights…');
    await this.world.loadHDRIs('1k', this.settings.timeOfDay);
    step(60, 'Laying out the range…');
    await Promise.all([this.world.buildOutdoor(this.settings.quality), dressHangar(this.world)]);
    this.world.applySky();
    step(80, 'Polishing the steel…');
    this.build = new BuildMode(this); this.test = new TestMode(this); this.flight = new FlightMode(this);
    await this.makeThumbs();
    this.build.makeTray();
    this.wireUI();
    step(100);
    if (shouldPlayIntro()) {
      this.intro = new Intro(this);
      await this.intro.start();
      $('loading').classList.add('hidden');
    } else {
      $('loading').classList.add('hidden');
      this.setMode('build');
      this.showMenu(true);
    }
    this.loop();
    if (this.settings.quality === 'ultra') this.world.loadHDRIs('2k').catch(() => {});
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.world.resize(w, h);
    $('rotate').classList.toggle('hidden', !(IS_TOUCH && h > w));
  }
  applySettings() {
    const s = this.settings;
    this.input.sens = s.sens; this.input.invertY = s.invertY;
    this.audio.setVolumes(s);
    this.world.applyQuality(s.quality, innerWidth, innerHeight);
    const n = PRESETS[s.quality].particles; if (this.smoke.max !== n) { this.smoke.build(n); this.world.scene.add(this.smoke.points); this.world.smokeFX = this.smoke; }
    LS.set('settings', s);
  }
  saveState() { LS.set('rocket', this.rocket); LS.set('fill', this.fill); LS.set('progress', this.progress); }

  // ---------- part thumbnails for the tray (rendered once, non-MSAA target) ----------
  async makeThumbs() {
    const W = 128, H = 112, r = this.world.renderer;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0, type: THREE.UnsignedByteType });
    const scene = new THREE.Scene(); scene.environment = this.world.envs.hangar;
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(3, 4, 5); scene.add(key);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    const buf = new Uint8Array(W * H * 4), cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    this.thumbs = {};
    const old = r.getRenderTarget(), oldTM = r.toneMapping;
    for (const id of PART_IDS) {
      const m = partMesh(id); scene.add(m);
      const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const d = Math.max(s.y, s.x * 1.1, s.z) * 2.1 + 0.5;
      cam.position.set(c.x + d * 0.55, c.y + d * 0.35, c.z + d * 0.8); cam.lookAt(c);
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      g.putImageData(img, 0, 0); this.thumbs[id] = cv.toDataURL('image/png');
      scene.remove(m); disposeTree(m);
    }
    r.setRenderTarget(old); r.toneMapping = oldTM; r.setClearColor(0x000000, 1); rt.dispose();
  }
  // photo of the current rocket for saves
  photo() {
    const W = 120, H = 160, r = this.world.renderer, rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    const st = stats(this.rocket), cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
    const target = new THREE.Vector3(); this.build.rocketGroup.getWorldPosition(target); target.y += st.length / 2 + st.bottom;
    const d = st.length * 1.9 + 4; cam.position.set(target.x + d * 0.5, target.y + 1, target.z + d * 0.85); cam.lookAt(target);
    r.setRenderTarget(rt); r.render(this.world.scene, cam);
    const buf = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, buf); r.setRenderTarget(null); rt.dispose();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    g.putImageData(img, 0, 0); return cv.toDataURL('image/jpeg', 0.7);
  }

  // ---------- modes ----------
  setMode(m, opts = {}) {
    if (this.intro) { this.intro.teardown(); this.intro = null; }
    const prev = this.modeObj;
    if (prev) prev.exit();
    this.mode = m;
    this.modeObj = { build: this.build, test: this.test, flight: this.flight }[m];
    document.body.classList.toggle('build', m === 'build');
    for (const [id, mm] of [['buildUI', 'build'], ['testUI', 'test'], ['flightUI', 'flight']]) $(id).classList.toggle('hidden', m !== mm);
    $('stickL').classList.toggle('hidden', !(m === 'build' || m === 'flight'));
    $('hud').classList.remove('hidden');
    $('btnUndo').classList.toggle('hidden', m !== 'build'); $('btnRedo').classList.toggle('hidden', m !== 'build');
    this.smoke.clear(); this.debris.clear(); this.sparks?.clear(); this.audio.setEngine(0);
    this.modeObj.enter(opts);
    this.updateObjective();
  }
  travel(m) {
    const probs = this.build.problemsFor();
    if (m !== 'build' && probs.length) { this.toast(probs[0]); this.audio.bad(); return; }
    this.audio.whoosh(); this.setMode(m);
  }
  updateObjective() {
    const mi = this.mission;
    const titles = { build: 'Hangar', test: 'Test stand', flight: 'Launch pad' };
    $('modeTitle').textContent = titles[this.mode] + (mi ? ' · ' + mi.name : ' · Sandbox');
    let o = '';
    if (!mi) o = 'Free build. Every part is unlocked.';
    else if (mi.type === 'tutorial') o = 'Build a basic rocket part by part. Each card teaches what that part is for.';
    else if (mi.type === 'static') o = this.mode === 'test' ? 'Hold the fire for 5 seconds without overheating.' : 'Build a rocket, then Send to stand.';
    else if (mi.type === 'altitude') o = this.mode === 'flight' ? 'Climb to 1,000 m.' : 'Build something that can reach 1,000 m, then Roll to pad.';
    else if (mi.type === 'landing') o = this.mode === 'flight' ? 'Climb above 100 m, then land under 3 m/s.' : 'You need landing legs. Spark is the easy lander.';
    $('objective').textContent = o;
  }
  prompt(html, btn, cb) {
    const p = $('prompt'); if (!html) { p.classList.add('hidden'); return; }
    p.innerHTML = html; p.classList.remove('hidden');
    if (btn) { const b = document.createElement('button'); b.textContent = btn; b.onclick = () => { this.audio.tap(); cb(); }; p.appendChild(b); }
  }
  toast(t, ms = 2200) {
    const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this.toastT); this.toastT = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- progress ----------
  totalStars() { return Object.values(this.progress.stars).reduce((a, s) => a + s.filter(Boolean).length, 0); }
  missionDone(id) { return !!(this.progress.stars[id] && this.progress.stars[id][0]); }
  missionUnlocked(i) { return i === 0 || this.missionDone(this.missions[i - 1].id); }
  sandboxUnlocked() { return this.missionDone('m1'); }
  partUnlocked(id) { return !this.mission || !(PARTS[id].unlockStars > this.totalStars()); }
  award(id, stars) {
    const old = this.progress.stars[id] || [false, false, false];
    const before = this.totalStars();
    this.progress.stars[id] = old.map((v, i) => v || !!stars[i]);
    this.saveState();
    const after = this.totalStars();
    const unlocked = PART_IDS.filter(p => PARTS[p].unlockStars > before && PARTS[p].unlockStars <= after).map(p => PARTS[p].name);
    if (unlocked.length) setTimeout(() => this.toast('Unlocked: ' + unlocked.join(', '), 3200), 1200);
    this.build.makeTray();
  }

  // ---------- menus ----------
  showMenu(v) {
    $('menu').classList.toggle('hidden', !v); document.body.classList.toggle('menuopen', v);
    if (v) { this.input.exitLock(); this.input.clearHeld(); $('btnSandbox').disabled = !this.sandboxUnlocked(); $('btnSandbox').title = this.sandboxUnlocked() ? '' : 'Finish "Hold the fire" to unlock'; }
    this.menuOpen = v;
  }
  startMission(i) {
    const m = this.missions[i];
    this.mission = m; this.closePanel(); this.showMenu(false); $('results').classList.add('hidden');
    if (m.type === 'tutorial') { this.rocket = emptyRocket(); this.build.resetHistory(); this.setMode('build'); this.build.startTutorial(); }
    else this.setMode('build');
    this.audio.tap();
  }
  startSandbox() { this.mission = null; if (!this.rocket.stack.length || JSON.stringify(this.rocket) === JSON.stringify(starterRocket())) { this.rocket = stockRocket(); this.build.resetHistory(); } this.showMenu(false); this.closePanel(); this.setMode('build'); this.build.makeTray(); }
  continueGame() {
    // first time: tutorial. Otherwise the first mission without all its stars, or sandbox.
    if (!this.missionDone('m0')) return this.startMission(0);
    for (let i = 1; i < this.missions.length; i++) if (!this.missionDone(this.missions[i].id)) return this.startMission(i);
    this.startSandbox();
  }
  openPanel(title, html) { $('panelTitle').textContent = title; $('panelBody').innerHTML = html; $('panel').classList.remove('hidden'); this.input.exitLock(); this.panelOpen = true; }
  closePanel() { $('panel').classList.add('hidden'); this.panelOpen = false; }
  starStr(id) { const s = this.progress.stars[id] || []; return [0, 1, 2].map(i => s[i] ? '★' : '<span class="off">★</span>').join(''); }
  showMissions() {
    const html = '<div class="mList">' + this.missions.map((m, i) => `<div class="mItem"><div><b>${i}. ${m.name}</b> <span class="st">${this.starStr(m.id)}</span><p>${m.desc}</p><p>${m.stars.map((s, k) => `${k + 1}★ ${s}`).join(' · ')}</p></div><button data-m="${i}" ${this.missionUnlocked(i) ? '' : 'disabled'}>${this.missionUnlocked(i) ? 'Play' : 'Locked'}</button></div>`).join('') +
      `<div class="mItem"><div><b>Sandbox</b><p>Free build with every part, after "Hold the fire".</p></div><button data-sb ${this.sandboxUnlocked() ? '' : 'disabled'}>${this.sandboxUnlocked() ? 'Play' : 'Locked'}</button></div></div>` +
      `<p style="color:var(--dim);font-size:13px">Stars unlock parts: Tall Tank at 2★, Thunder at 4★. You have ${this.totalStars()}★.</p>`;
    this.openPanel('Missions', html);
    $('panelBody').querySelectorAll('[data-m]').forEach(b => b.onclick = () => this.startMission(+b.dataset.m));
    const sb = $('panelBody').querySelector('[data-sb]'); if (sb) sb.onclick = () => this.startSandbox();
  }
  showSaves() {
    const can = this.mode === 'build';
    let html = can ? `<div class="row"><input type="text" id="saveName" maxlength="24" placeholder="Rocket name" value="Rocket ${this.saves.length + 1}"><button id="saveNow" class="go" ${this.saves.length >= 10 ? 'disabled' : ''}>Save current rocket</button></div><p style="color:var(--dim);font-size:12px">${this.saves.length}/10 slots used.</p>` : '';
    html += '<div class="saves">' + (this.saves.map((s, i) => `<div class="save"><img src="${s.photo}" alt=""><div><b>${esc(s.name)}</b></div><div style="font-size:11px;color:var(--dim)">${s.parts} parts</div><div class="row"><button data-load="${i}" ${can ? '' : 'disabled'}>Load</button><button data-del="${i}">Delete</button></div></div>`).join('') || '<p>No saved rockets yet.</p>') + '</div>';
    this.openPanel('Saved rockets', html);
    const sn = $('saveNow'); if (sn) sn.onclick = () => {
      if (!this.rocket.stack.length) { this.toast('Nothing on the stand to save.'); return; }
      this.saves.push({ name: $('saveName').value.trim() || 'Rocket', rocket: cloneRocket(this.rocket), photo: this.photo(), parts: partCount(this.rocket), date: Date.now() });
      LS.set('saves', this.saves); this.audio.snap(); this.showSaves();
    };
    $('panelBody').querySelectorAll('[data-load]').forEach(b => b.onclick = () => { this.build.setRocket(cloneRocket(this.saves[+b.dataset.load].rocket)); this.closePanel(); this.toast('Loaded ' + this.saves[+b.dataset.load].name); });
    $('panelBody').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { this.saves.splice(+b.dataset.del, 1); LS.set('saves', this.saves); this.audio.remove(); this.showSaves(); });
  }
  showSettings() {
    const s = this.settings;
    const sl = (k, label, min, max, st) => `<div class="setRow"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${st}" value="${s[k]}"></div>`;
    const ck = (k, label) => `<div class="setRow"><span>${label}</span><button data-t="${k}" class="${s[k] ? 'on' : ''}">${s[k] ? 'On' : 'Off'}</button></div>`;
    const html = `${sl('master', 'Master volume', 0, 1, 0.05)}${sl('music', 'Music volume', 0, 1, 0.05)}${sl('sfx', 'Effects volume', 0, 1, 0.05)}
      ${sl('sens', 'Look sensitivity', 0.3, 2.5, 0.05)}${ck('invertY', 'Invert look up/down')}${ck('assist', 'Hold-upright assist')}${ck('guide', 'Landing guide')}
      <div class="setRow"><span>Time of day</span><select id="selSky">${Object.entries(SKIES).map(([k, p]) => `<option value="${k}" ${k === s.timeOfDay ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <div class="setRow"><span>Graphics</span><select id="selQ">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${k === s.quality ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <div class="row"><button id="resetDefaults">Reset to defaults</button><button id="resetProgress">Reset mission progress</button></div>`;
    this.openPanel('Settings', html);
    const pb = $('panelBody');
    pb.querySelectorAll('input[type=range]').forEach(i => i.oninput = () => { s[i.dataset.k] = +i.value; this.applySettingsLight(); });
    pb.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { s[b.dataset.t] = !s[b.dataset.t]; this.applySettingsLight(); this.audio.tap(); this.showSettings(); });
    $('selQ').onchange = e => { s.quality = e.target.value; this.applySettings(); };
    $('selSky').onchange = e => this.setTimeOfDay(e.target.value);
    $('resetDefaults').onclick = () => { this.settings = DEFAULTS(); this.applySettings(); this.flight.syncButtons(); this.showSettings(); };
    $('resetProgress').onclick = () => { if (confirm('Reset all mission stars?')) { this.progress = { stars: {}, best: {} }; this.saveState(); this.build.makeTray(); this.toast('Progress reset'); } };
  }
  setTimeOfDay(k) {
    this.settings.timeOfDay = k; this.applySettingsLight();
    this.toast?.('Sky: ' + SKIES[k].label + '…');
    this.world.setSky(k).catch(() => this.toast?.('Could not load that sky'));
  }
  applySettingsLight() { const s = this.settings; this.input.sens = s.sens; this.input.invertY = s.invertY; this.audio.setVolumes(s); this.flight.syncButtons(); LS.set('settings', s); }
  showHelp() {
    const rows = IS_TOUCH ? [
      ['Look', 'Drag anywhere on the screen'], ['Walk', 'Left stick'], ['Pick a part', 'Tap it in the tray'], ['Place', 'Tap a glowing ring (or near it)'], ['Remove', 'Pick Delete in the tray, then tap a part'],
      ['Stand', '▲ ▼ raise / lower, ⟲ ⟳ turn'], ['Fly', 'Throttle slider on the right, steer with the left stick'], ['Flight views', 'Drag to orbit · pinch to zoom · View button cycles · Views ▾ opens the picker']]
      : [['Look / walk', 'Mouse (click to grab the mouse) · WASD'], ['Pick a part', 'Click it in the tray, or keys 1–9 · Delete tool: 0'], ['Place', 'Aim at a glowing ring and click'], ['Remove', 'Right-click a part, or the Delete tool'],
        ['Undo / redo', 'Z / Y (or Ctrl+Z / Ctrl+Y)'], ['Stand', 'R / F raise and lower, Q / E turn'], ['Test stand', 'Space fire / shut down · Shift / R and F throttle'],
        ['Flight', 'Space launch · Shift or R throttle up, F down, Z full, X cut · WASD / arrows steer · drag mouse to orbit · wheel zoom · 1–8 pick view · C next view · V view menu · H assist'], ['Menu', 'Esc']];
    const pad = [['DualSense', 'Left stick walk / steer · Right stick look · ✕ place / launch · □ delete tool · ○ undo · △ redo · L1/R1 pick part · D-pad stand · R2 throttle · in flight: right stick orbit, L2 zoom in, L1 zoom out, △ or D-pad ◀▶ change view, D-pad ▲ view menu · Options menu']];
    this.openPanel('How to play', `<p>Build a rocket on the stand, read the checkout panel, static-fire it on the test stand, then launch. If it fails, you get one plain "Try this" tip and your rocket is still on the stand.</p><table class="help">${rows.concat(pad).map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
      <p><b>The two markers:</b> the gem ◆ is the center of mass (the balance point), the ring ○ is the center of pressure (where the air pushes). Keep the gem above the ring or the rocket flips. Fins pull the ring down.</p>`);
  }
  async showCredits() {
    let t = ''; try { t = await (await fetch('CREDITS.md')).text(); } catch (_) {}
    this.openPanel('Credits', `<pre style="white-space:pre-wrap;font:13px/1.5 inherit">${esc(t)}</pre>`);
  }

  // ---------- results ----------
  showResults(r) {
    this.input.exitLock();
    $('results').classList.remove('hidden');
    $('rTitle').textContent = r.title; $('rTitle').className = r.ok ? 'good' : '';
    $('rReason').textContent = r.reason || ''; $('rHint').innerHTML = r.hint ? '<b>Try this:</b> ' + r.hint : ''; $('rHint').classList.toggle('hidden', !r.hint);
    const st = r.stars;
    if (st) {
      $('rStars').innerHTML = st.map(v => `<span>${'★'}</span>`).join('') + `<small>${this.mission.stars.map((s, i) => (st[i] ? '✓ ' : '· ') + s).join('<br>')}</small>`;
      const spans = $('rStars').querySelectorAll('span');
      st.forEach((v, i) => v && setTimeout(() => { spans[i].classList.add('lit'); this.audio.star(0); }, 400 + i * 300));
    } else $('rStars').innerHTML = '';
    $('rStats').innerHTML = (r.stats || []).map(([l, v]) => `<div><label>${l}</label><b>${v}</b></div>`).join('');
    const g = $('rGraph'); g.classList.toggle('hidden', !r.samples);
    if (r.samples) drawGraph(g, r.samples);
    const idx = this.mission ? this.missions.indexOf(this.mission) : -1;
    $('rNext').classList.toggle('hidden', !(r.ok && idx >= 0 && idx < this.missions.length - 1));
    $('rRetry').textContent = this.mode === 'test' ? 'Fire again' : 'Fly again';
    this.resultsOpen = true;
  }
  hideResults() { $('results').classList.add('hidden'); this.resultsOpen = false; }

  wireUI() {
    $('menu').addEventListener('click', e => {
      const a = e.target.dataset?.act; if (!a) return; this.audio.unlock(); this.audio.tap();
      ({ continue: () => this.continueGame(), missions: () => this.showMissions(), sandbox: () => this.startSandbox(), saves: () => this.showSaves(), settings: () => this.showSettings(), help: () => this.showHelp(), credits: () => this.showCredits() })[a]();
    });
    $('panelClose').onclick = () => { this.audio.tap(); this.closePanel(); };
    $('btnMenu').onclick = () => { this.audio.tap(); this.showMenu(true); };
    $('rHangar').onclick = () => { this.hideResults(); this.setMode('build'); };
    $('rRetry').onclick = () => { this.hideResults(); this.setMode(this.mode); };
    $('rNext').onclick = () => { this.hideResults(); this.startMission(this.missions.indexOf(this.mission) + 1); };
    for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, () => this.audio.unlock(), { capture: true });
    document.addEventListener('keydown', () => this.audio.unlock(), { capture: true });
    document.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => this.audio.hover()));
    this.input.bindStick($('stickL'), 'touchMove');
  }

  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (document.hidden) return;
      this.timer.update(); const dt = Math.min(0.05, this.timer.getDelta());
      this.input.update(dt);
      const inp = this.input;
      if (this.intro && !this.intro.done) {
        if (inp.hit('Escape') || inp.hit('Pad9') || inp.hit('Space') || inp.hit('Enter')) this.intro.skip();
      } else if (inp.hit('Escape') || inp.hit('Pad9')) {
        if (this.panelOpen) this.closePanel();
        else if (this.intro && this.mode === 'loading') this.continueGame();
        else if (!this.resultsOpen) this.showMenu(!this.menuOpen);
      }
      if (this.intro && !this.intro.done) this.intro.update(dt);
      else {
        const paused = this.menuOpen || this.panelOpen;
        if (this.modeObj) { if (!paused) this.modeObj.update(dt, this.resultsOpen); else this.modeObj.idle?.(dt); }
      }
      this.smoke.update(dt, this.windNow || { x: 0, z: 0 }, this.world.h * this.world.renderer.getPixelRatio() / Math.tan(this.world.camera.fov * Math.PI / 360) / 2);
      this.debris.update(dt); this.sparks.update(dt, this.world.h * this.world.renderer.getPixelRatio() / Math.tan(this.world.camera.fov * Math.PI / 360) / 2);
      if (this.windNow) this.world.wind = this.windNow;
      this.world.update(dt);
      this.world.render();
      inp.endFrame();
      this.frames = (this.frames || 0) + 1;
    };
    tick();
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function drawGraph(cv, s) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  const max = Math.max(10, ...s), n = s.length;
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.fillStyle = '#9aa6b2'; g.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) { const y = H - 16 - (H - 26) * i / 4; g.beginPath(); g.moveTo(34, y); g.lineTo(W - 6, y); g.stroke(); g.fillText(Math.round(max * i / 4) + '', 2, y + 4); }
  g.fillText('altitude (m) over ' + (n / 4).toFixed(0) + ' s', 40, 12);
  g.strokeStyle = '#7fe7ff'; g.lineWidth = 2; g.beginPath();
  s.forEach((v, i) => { const x = 34 + (W - 40) * i / Math.max(1, n - 1), y = H - 16 - (H - 26) * v / max; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
}

const game = new Game();
window.CH = game; // handy for headless checks
game.boot().catch(e => { console.error(e); document.getElementById('loadText').textContent = 'Could not start: ' + e.message; });
