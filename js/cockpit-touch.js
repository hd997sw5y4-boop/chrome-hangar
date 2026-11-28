// Phone / touch cockpit decisions that do not need three.js or the DOM, so node tests can lock them.
// The detailed desktop cockpit stays on a mouse-and-keyboard machine. A phone gets the light interior
// when graphics are on the Phone preset, or when a coarse pointer sits on a short viewport
// (iPhone 13 Pro Max Safari: landscape ~844×390 or 926×428, portrait ~390×844 or 428×926).

export const COCKPIT_CAM = 4;     // flight.js CAM_COCKPIT
export const DIRECTOR_CAM = 6;    // scripted shots; not a camera to return to
export const CHASE_CAM = 1;
export const SHORT_SIDE_MAX = 540; // CSS px. Phones fit; iPad short side does not.
export const LOOK_PAD = 22;       // fat-finger margin around sticks, throttle, and buttons
export const RECENTER_MS = 320;
export const RECENTER_SLOP = 48;

// Elements a cockpit look-drag must not start on. The WebGL canvas never receives these hits;
// the pad catches a thumb that lands just outside the control.
export const CONTROL_IDS = [
  'stickL', 'thrTouch', 'btnEngCut', 'btnCockpit', 'fBtns', 'camPicker', 'ixAbort',
  'btnLaunch', 'topRight', 'hpPanel', 'countdown', 'landGuide', 'prompt', 'replayBar',
];

export function phoneCockpitLod({ quality = 'high', coarse = false, short = false } = {}) {
  if (quality === 'phone') return true;
  if (coarse && short) return true;
  return false;
}

export function isShortViewport(w, h, max = SHORT_SIDE_MAX) {
  return Math.min(w, h) <= max;
}

// Remember the outside camera so "Outside" returns to it. Director is a temporary cut.
export function rememberExternalCam(cam) {
  if (cam == null || cam === COCKPIT_CAM || cam === DIRECTOR_CAM) return CHASE_CAM;
  return cam;
}

export function cockpitToggleTarget(cam, extCam) {
  if (cam === COCKPIT_CAM) return extCam == null ? CHASE_CAM : extCam;
  return COCKPIT_CAM;
}

export function lookHitsControl(x, y, rects, pad = LOOK_PAD) {
  if (!rects) return false;
  for (const r of rects) {
    if (!r) continue;
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
  }
  return false;
}

// Head-look consumes the touch part of this frame's look. Mouse and gamepad deltas stay on inp.look
// so the outside orbit camera keeps today's desktop behaviour.
export function orbitLookAfterHead(look, touchLook) {
  return {
    x: (look?.x || 0) - (touchLook?.x || 0),
    y: (look?.y || 0) - (touchLook?.y || 0),
  };
}

export function takeRecenterTap(state, tap, now, windowMs = RECENTER_MS, slop = RECENTER_SLOP) {
  const close = !!(state?.t) && (now - state.t) <= windowMs && Math.hypot((tap?.x || 0) - state.x, (tap?.y || 0) - state.y) <= slop;
  if (close) { state.t = 0; return true; }
  if (state) { state.t = now; state.x = tap?.x || 0; state.y = tap?.y || 0; }
  return false;
}

// Triangle / texture budget the phone builder builds against. iPhone 13 Pro Max (A15, Safari) can draw
// this interior and still spend its frame on the world outside the windows. Desktop segments are not these.
export const PHONE_LOD = {
  cylSeg: 20,
  coneSeg: 24,
  coneSteps: 8,
  ringN: 2,
  ringRad: 8,
  ringTub: 20,
  winN: 4,
  winRad: 6,
  winTub: 24,
  tipSeg: 24,
  boxes: 18,
  planes: 6,
  lampW: 8,
  lampH: 6,
  leverSeg: 6,
  strutN: 2,
  strutSeg: 5,
  alphaW: 512,
  alphaH: 128,
};

export function phoneLodCost(g = PHONE_LOD) {
  const closed = seg => seg * 4; // cylinder sides + both caps
  const cyl = g.cylSeg * 2; // open cabin tube
  const cone = g.coneSeg * g.coneSteps * 2;
  const rings = g.ringN * g.ringRad * g.ringTub * 2;
  const wins = g.winN * g.winRad * g.winTub * 2;
  const tip = g.tipSeg * 2;
  const boxes = g.boxes * 12;
  const planes = g.planes * 2;
  const lamps = g.lampW * g.lampH * 2;
  const lever = closed(g.leverSeg);
  const struts = g.strutN * closed(g.strutSeg);
  const back = g.cylSeg;
  const tris = cyl + cone + rings + wins + tip + boxes + planes + lamps + lever + struts + back;
  const draws = g.boxes + g.planes + g.ringN + g.winN + g.strutN + 6; // shell, cone, tip, back, lamps, lever
  return { tris, draws, alphaPx: g.alphaW * g.alphaH };
}
