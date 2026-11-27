// Training: the First bolt hangar lesson, then a flight-controls lesson.
// Started anytime from the Training menu button (also from Missions → First bolt).
// Skip is always on screen; finishing shows a Training complete card and returns to the menu.
import { IS_TOUCH } from './env.js';

const $ = id => document.getElementById(id);

// Real camera names. Pad cam is the ground-level tracking lens from the apron
// (the brief's "ground tracking"), Viewing stand and Chase are named as they exist.
const VIEW_GOALS = [
  { i: 2, name: 'Viewing stand' },
  { i: 3, name: 'Pad cam' },
  { i: 1, name: 'Chase' },
];

function flightCopy() {
  if (IS_TOUCH) {
    return {
      launch: 'Tap <b>Launch</b> to start the countdown.',
      steer: 'Steer <b>left or right</b> with the left stick.',
      look: 'Drag on the screen to rotate the camera, then pinch to zoom.',
      views: 'Tap <b>View</b> to cycle, or open <b>Views ▾</b>. Switch to <b>Viewing stand</b>, <b>Pad cam</b> (the ground camera that tracks the rocket), and <b>Chase</b>.',
    };
  }
  return {
    launch: 'Press <b>Space</b> or the <b>Launch</b> button to start the countdown. DualSense: press ✕.',
    steer: 'Steer <b>left or right</b> with <b>A/D</b> or the arrow keys. DualSense: left stick.',
    look: 'Drag the mouse to rotate the camera, then scroll the wheel to zoom. DualSense: right stick to look, L2 zoom in, L1 zoom out.',
    views: 'Press <b>C</b> to cycle views, or <b>V</b> to open the picker (keys 1–8 also work). DualSense: △ or D-pad ◀▶. Switch to <b>Viewing stand</b>, <b>Pad cam</b> (the ground camera that tracks the rocket), and <b>Chase</b>.',
  };
}

export class Training {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.phase = null;
    this.flightI = 0;
    $('btnTrainSkip').onclick = () => { try { this.g.audio.tap(); } catch (_) {} this.skip(); };
  }

  start() {
    this.active = true;
    this.phase = 'build';
    this.flightI = 0;
    this.seenViews = new Set();
    this.lookAcc = 0;
    this.zoomAcc = 0;
    this.doneOpen = false;
    this.showSkip(true);
  }

  stop() {
    if (!this.active && !this.doneOpen) { this.showSkip(false); return; }
    this.active = false;
    this.phase = null;
    this.doneOpen = false;
    this.showSkip(false);
    if (this.g.build?.tut) { this.g.build.tut = null; this.g.build.refreshTray?.(); }
    this.g.prompt(null);
  }

  showSkip(v) { $('btnTrainSkip').classList.toggle('hidden', !v); }

  // After the hangar lesson, roll the finished rocket to the pad and teach flight controls.
  onBuildDone() {
    if (!this.active) return;
    this.g.prompt(null);
    this.g.build.tut = null;
    this.g.build.refreshTray();
    this.g.travel('flight');
    if (this.g.mode !== 'flight') { this.g.toast(this.g.build.problemsFor()?.[0] || 'The rocket is not ready to fly.'); return; }
    this.phase = 'flight';
    this.flightI = 0;
    this.seenViews = new Set();
    if (this.g.flight?.cam != null) this.seenViews.add(this.g.flight.cam);
    this.lookAcc = 0;
    this.zoomAcc = 0;
    this.showFlightStep();
  }

  flightSteps() {
    const copy = flightCopy();
    const fl = this.g.flight;
    const inp = this.g.input;
    return [
      {
        text: copy.launch,
        check: () => fl.countdown != null || fl.armed || (fl.f && fl.f.phase !== 'pad'),
      },
      {
        text: copy.steer,
        check: () => Math.abs(inp.steer.x) > 0.35,
      },
      {
        text: copy.look,
        check: () => {
          this.lookAcc += Math.abs(inp.look.x) + Math.abs(inp.look.y);
          this.zoomAcc += Math.abs(inp.zoom || 0);
          if (inp.pad) this.zoomAcc += Math.abs((inp.pad.b[4] || 0) - (inp.pad.b[6] || 0)) * 0.5;
          return this.lookAcc > 0.12 && this.zoomAcc > 0.15;
        },
      },
      {
        text: copy.views,
        check: () => {
          if (fl.cam != null) this.seenViews.add(fl.cam);
          return VIEW_GOALS.every(v => this.seenViews.has(v.i));
        },
      },
    ];
  }

  showFlightStep() {
    const steps = this.flightSteps();
    const s = steps[this.flightI];
    if (!s) { this.complete(); return; }
    this.g.prompt(`<div class="tutDo">${s.text}</div>`);
  }

  onFlightFrame() {
    if (!this.active || this.phase !== 'flight' || this.doneOpen || this.g.menuOpen) return;
    const steps = this.flightSteps();
    const s = steps[this.flightI];
    if (!s) return;
    if (s.check()) {
      this.g.audio.star(0);
      this.flightI++;
      if (this.flightI >= steps.length) this.complete();
      else this.showFlightStep();
    }
  }

  complete() {
    if (!this.active || this.doneOpen) return;
    this.phase = 'done';
    this.doneOpen = true;
    this.g.prompt(null);
    this.showSkip(false);
    const r = this.g.flight;
    if (r && !r.ended && r.f) { r.ended = true; r.armed = false; r.f.e.cmd = 0; r.resultsShown = true; }
    this.g.showResults({
      ok: true,
      title: 'Training complete',
      reason: 'You built a basic rocket part by part and learned the flight controls.',
      trainDone: true,
    });
  }

  skip() {
    if (!this.active && !this.doneOpen) return;
    this.returnToMenu();
  }

  returnToMenu() {
    this.stop();
    this.g.mission = null;
    this.g.hideResults();
    this.g.closePanel();
    this.g.setMode('build');
    this.g.showMenu(true);
  }
}

