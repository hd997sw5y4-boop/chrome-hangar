// SFX are synthesized with WebAudio: soft taps, a magnetic snap, boots on grate,
// engine roar and rumble, cooling ticks, and countdown beeps.
// Music is a rotating playlist of bright, warm chill lo-fi tracks (CC0) — not the old pad.
export class Audio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.45, sfx: 0.8 }; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.8); const vg = c.createGain(); vg.gain.value = 0.35; this.verb.connect(vg); vg.connect(this.master);
    this.noiseBuf = this.makeNoise();
    this.setVolumes(this.vol);
    this.startEngineBed(); this.startMusic();
  }
  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.4, t, 0.05);
  }
  impulse(sec) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    return b;
  }
  makeNoise() {
    const c = this.ctx, n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 * 0.6 + w * 0.4; }
    return b;
  }
  env(g, t, a, peak, decay) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay); }
  tone(freq, dur, type = 'sine', peak = 0.2, wet = 0.2, when = 0, slide = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    this.env(g, t, 0.004, peak, dur); o.connect(g); g.connect(this.sfx); if (wet) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.verb); }
    o.start(t); o.stop(t + dur + 0.1);
  }
  noise(dur, freq, q = 1, peak = 0.3, when = 0, type = 'bandpass', wet = 0.15) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this.env(g, t, 0.003, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); if (wet) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.verb); }
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }
  // UI and build
  hover() { this.tone(1500, 0.05, 'sine', 0.035, 0.1); }
  tap() { this.tone(900, 0.08, 'sine', 0.08, 0.2); this.noise(0.03, 3000, 2, 0.04); }
  snap() { // magnetic thunk + soft tink
    this.tone(150, 0.22, 'sine', 0.35, 0.25, 0, 0.6); this.noise(0.06, 900, 1.2, 0.18, 0, 'lowpass');
    this.tone(2400, 0.25, 'sine', 0.05, 0.4, 0.03); this.tone(3600, 0.18, 'sine', 0.025, 0.4, 0.05);
  }
  bad() { this.tone(220, 0.16, 'triangle', 0.08, 0.1); this.tone(180, 0.2, 'triangle', 0.06, 0.1, 0.09); }
  remove() { this.tone(500, 0.18, 'sine', 0.12, 0.2, 0, 0.5); this.noise(0.12, 1800, 0.8, 0.05); }
  step() { this.noise(0.05, 2300, 3, 0.05, 0, 'bandpass', 0.05); this.tone(90, 0.06, 'sine', 0.06, 0); }
  whoosh() { this.noise(0.5, 700, 0.7, 0.08, 0, 'bandpass', 0.3); }
  beep(hi) { this.tone(hi ? 1320 : 880, hi ? 0.5 : 0.12, 'sine', 0.12, 0.3); }
  star(i) { this.tone(880 * Math.pow(1.26, i), 0.4, 'sine', 0.12, 0.4, i * 0.18); }
  clamp() { this.noise(0.08, 400, 1, 0.25, 0, 'lowpass'); this.tone(2000, 0.1, 'square', 0.03, 0.2, 0.02); }
  boom(big = 1) {
    if (!this.ctx) return; this.noise(1.8 * big, 300, 0.5, 0.9, 0, 'lowpass', 0.5); this.tone(55, 1.2 * big, 'sine', 0.6, 0.2, 0, 0.4); this.noise(0.4, 2500, 0.6, 0.25, 0.02);
  }
  coolTicks() { // after-shutdown ticks as metal cools: fixed schedule, thinning out
    for (let i = 0; i < 14; i++) { const t = 0.4 + i * i * 0.05; this.tone(3200 + (i * 397) % 1400, 0.03, 'sine', 0.03 * (1 - i / 16), 0.3, t); }
  }
  // continuous engine bed: low rumble + roar + crackle, driven by setEngine()
  startEngineBed() {
    const c = this.ctx; this.eng = c.createGain(); this.eng.gain.value = 0; this.engDelay = c.createDelay(8); this.eng.connect(this.engDelay); this.engDelay.connect(this.sfx);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    this.engLP = c.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 400;
    src.connect(this.engLP); this.engLP.connect(this.eng);
    const crack = c.createBufferSource(); crack.buffer = this.noiseBuf; crack.loop = true; crack.playbackRate.value = 1.7;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8;
    this.crackG = c.createGain(); this.crackG.gain.value = 0; crack.connect(bp); bp.connect(this.crackG); this.crackG.connect(this.eng);
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = 38; this.subG = c.createGain(); this.subG.gain.value = 0; sub.connect(this.subG); this.subG.connect(this.eng);
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 0.15; lfo.connect(lg); lg.connect(this.crackG.gain);
    src.start(); crack.start(); sub.start(); lfo.start();
  }
  setEngine(level, near = 1, dist = 0) { // level 0..1, near 0..1 (distance), dist m: sound travels at 343 m/s
    if (!this.ctx || !this.eng) return; const t = this.ctx.currentTime, l = Math.max(0, level);
    this.engDelay.delayTime.setTargetAtTime(Math.min(7.5, dist / 343), t, 0.6);
    this.eng.gain.setTargetAtTime(l * (0.25 + 0.75 * near) * 0.9, t, 0.08);
    this.engLP.frequency.setTargetAtTime(180 + 900 * l * near, t, 0.1);
    this.crackG.gain.setTargetAtTime(0.12 * l * near, t, 0.1);
    this.subG.gain.setTargetAtTime(0.5 * l, t, 0.1);
  }
  startMusic() { // rotating bright, happy chill lo-fi (CC0 HoliznaCC0)
    if (this._musicOn) return;
    this._musicOn = true;
    const tracks = [
      'assets/music/puppy-love.mp3',
      'assets/music/new-shoes.mp3',
      'assets/music/poor-but-happy.mp3',
    ];
    const fade = 2.5;
    const decks = [0, 1].map(() => {
      const a = new Audio(); a.preload = 'auto'; a.crossOrigin = 'anonymous';
      const g = this.ctx.createGain(); g.gain.value = 0;
      this.ctx.createMediaElementSource(a).connect(g); g.connect(this.music);
      return { a, g };
    });
    tracks.forEach((src) => { const p = new Audio(); p.preload = 'auto'; p.src = src; });
    let arm = 0, idx = Math.floor(Math.random() * tracks.length), advancing = false;
    const fadeOut = (d) => {
      const t = this.ctx.currentTime;
      d.g.gain.cancelScheduledValues(t);
      d.g.gain.setValueAtTime(Math.max(d.g.gain.value, 0.0001), t);
      d.g.gain.linearRampToValueAtTime(0.0001, t + fade);
      setTimeout(() => { try { d.a.pause(); d.a.currentTime = 0; } catch (_) {} }, fade * 1000 + 80);
    };
    const cue = (i, fresh) => {
      const d = decks[arm], src = tracks[i];
      const go = () => {
        const t = this.ctx.currentTime;
        d.g.gain.cancelScheduledValues(t);
        d.g.gain.setValueAtTime(0.0001, t);
        d.g.gain.linearRampToValueAtTime(1, t + (fresh ? 1.2 : fade));
        d.a.play().catch(() => {});
        if (!fresh) fadeOut(decks[1 - arm]);
        const dur = d.a.duration;
        const leadMs = (Number.isFinite(dur) && dur > fade + 1 ? dur - fade : 120) * 1000;
        const next = () => {
          if (advancing) return;
          advancing = true;
          arm ^= 1; idx = (i + 1) % tracks.length;
          cue(idx, false);
          setTimeout(() => { advancing = false; }, 400);
        };
        clearTimeout(this._musicTo);
        this._musicTo = setTimeout(next, leadMs);
        d.a.onended = next;
      };
      d.a.onended = d.a.oncanplaythrough = d.a.onerror = null;
      d.a.src = src;
      // First play stays in the unlock() click so autoplay policies allow it.
      if (fresh) d.a.play().catch(() => {});
      d.a.oncanplaythrough = () => { d.a.oncanplaythrough = null; go(); };
      if (d.a.readyState >= 3) { d.a.oncanplaythrough = null; go(); }
      d.a.onerror = () => {
        d.a.onerror = null;
        arm ^= 1; idx = (i + 1) % tracks.length;
        if (idx !== i) cue(idx, fresh);
      };
      d.a.load();
    };
    cue(idx, true);
  }
}
