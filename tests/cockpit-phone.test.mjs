// Phone cockpit gate, touch look vs orbit, and the light-interior budget.
// Run: node tests/cockpit-phone.test.mjs
import {
  phoneCockpitLod, isShortViewport, rememberExternalCam, cockpitToggleTarget,
  lookHitsControl, orbitLookAfterHead, takeRecenterTap, phoneLodCost, PHONE_LOD,
  CONTROL_IDS, COCKPIT_CAM, CHASE_CAM, LOOK_PAD,
} from '../js/cockpit-touch.js';

let fails = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

console.log('who gets the light cockpit');
ok('Phone graphics preset, even on a desktop', phoneCockpitLod({ quality: 'phone', coarse: false, short: false }));
ok('iPhone-sized coarse pointer, graphics left on High', phoneCockpitLod({ quality: 'high', coarse: true, short: true }));
ok('iPhone-sized coarse pointer, graphics on Ultra', phoneCockpitLod({ quality: 'ultra', coarse: true, short: true }));
ok('desktop High stays on the detailed cockpit', !phoneCockpitLod({ quality: 'high', coarse: false, short: false }));
ok('desktop Low stays on the detailed cockpit', !phoneCockpitLod({ quality: 'low', coarse: false, short: false }));
ok('a narrow desktop window is not enough on its own', !phoneCockpitLod({ quality: 'high', coarse: false, short: true }));
ok('a large coarse screen on High (tablet) keeps the detailed cockpit', !phoneCockpitLod({ quality: 'high', coarse: true, short: false }));

console.log('iPhone 13 / 13 Pro Max CSS viewports count as short');
for (const [w, h] of [[844, 390], [390, 844], [926, 428], [428, 926], [800, 450]]) {
  ok(`${w}x${h} is a phone viewport`, isShortViewport(w, h));
}
ok('1080p is not a phone viewport', !isShortViewport(1920, 1080));
ok('iPad portrait is not a phone viewport', !isShortViewport(768, 1024));

console.log('cockpit button returns to the outside camera');
ok('chase -> cockpit', cockpitToggleTarget(CHASE_CAM, null) === COCKPIT_CAM);
ok('cockpit -> remembered pad cam', cockpitToggleTarget(COCKPIT_CAM, 3) === 3);
ok('cockpit with nothing remembered -> chase', cockpitToggleTarget(COCKPIT_CAM, null) === CHASE_CAM);
ok('round trip', cockpitToggleTarget(cockpitToggleTarget(5, null), rememberExternalCam(5)) === 5);
ok('director is not where Outside lands', rememberExternalCam(6) === CHASE_CAM);
ok('entering from chase remembers chase', rememberExternalCam(1) === 1);
ok('already inside does not remember the cockpit slot', rememberExternalCam(COCKPIT_CAM) === CHASE_CAM);

console.log('touch look does not also orbit');
{
  const mouse = orbitLookAfterHead({ x: 0.2, y: -0.1 }, { x: 0, y: 0 });
  ok('mouse / stick look is left intact', mouse.x === 0.2 && mouse.y === -0.1);
  const touch = orbitLookAfterHead({ x: 0.4, y: 0.2 }, { x: 0.4, y: 0.2 });
  ok('a pure touch drag leaves the orbit camera still', touch.x === 0 && touch.y === 0);
  const both = orbitLookAfterHead({ x: 0.5, y: 0.1 }, { x: 0.2, y: 0.0 });
  ok('gamepad look survives a touch drag in the same frame', both.x === 0.3 && both.y === 0.1);
}

console.log('fat-finger margin around throttle and buttons');
{
  const thr = { left: 700, top: 200, right: 770, bottom: 400 };
  ok('a thumb just outside the throttle is not a look', lookHitsControl(690, 300, [thr]));
  ok('the open glass is a look', !lookHitsControl(400, 200, [thr]));
  ok('pad is the exported margin', !lookHitsControl(700 - LOOK_PAD - 1, 300, [thr]) && lookHitsControl(700 - LOOK_PAD, 300, [thr]));
  ok('controls that must stay out of a look-drag', ['stickL', 'thrTouch', 'btnEngCut', 'btnCockpit', 'ixAbort', 'fBtns'].every(id => CONTROL_IDS.includes(id)));
}

console.log('double-tap recenters, a single tap does not');
{
  const s = { t: 0, x: 0, y: 0 };
  ok('first tap arms', takeRecenterTap(s, { x: 200, y: 180 }, 1000) === false);
  ok('second tap close and soon recenters', takeRecenterTap(s, { x: 210, y: 190 }, 1200) === true);
  ok('the pair is consumed', s.t === 0);
  ok('a far second tap does not recenter', takeRecenterTap(s, { x: 10, y: 10 }, 1000) === false && takeRecenterTap(s, { x: 400, y: 400 }, 1100) === false);
  const slow = { t: 0, x: 0, y: 0 };
  takeRecenterTap(slow, { x: 10, y: 10 }, 0);
  ok('a late second tap does not recenter', takeRecenterTap(slow, { x: 12, y: 12 }, 900) === false);
}

console.log('phone interior budget');
{
  const c = phoneLodCost();
  ok('triangle budget stays put', c.tris === 2672, 'got ' + c.tris);
  ok('draw budget stays put', c.draws === 38, 'got ' + c.draws);
  ok('window alpha is a small map', c.alphaPx === 512 * 128 && PHONE_LOD.alphaW === 512);
  ok('nose stays coarse', PHONE_LOD.coneSeg <= 28 && PHONE_LOD.cylSeg <= 24 && PHONE_LOD.winTub <= 28);
}

if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall passed');
