// Bloom slider, collapsible settings sections, Metal059A / painted_concrete_02 assets, leftover floor gone.
import { register } from 'node:module';
import fs from 'fs';
const ROOT = new URL('../', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${ROOT}vendor/three/three.module.js', shortCircuit: true };
  return next(spec, ctx);
}`));
const { fillVideo, VIDEO_DEFAULTS, videoRows } = await import('../js/video-settings.js');

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { fails++; console.log('  FAIL  ' + msg); } };

const d = VIDEO_DEFAULTS();
ok(d.bloom === 0.28, 'VIDEO_DEFAULTS.bloom is 0.28');
const filled = fillVideo({});
ok(filled.bloom === 0.28, 'fillVideo supplies default bloom');
const zero = fillVideo({ bloom: 0 });
ok(zero.bloom === 0, 'fillVideo keeps bloom 0 (off)');
const clamp = fillVideo({ bloom: 9 });
ok(clamp.bloom === 2, 'fillVideo clamps bloom to 2');
const rows = videoRows(fillVideo({}));
ok(rows.includes('vBloom') && rows.includes('Bloom'), 'videoRows includes Bloom slider');

const main = read('js/main.js');
ok(main.includes('setSec') && main.includes('setSecHead') && main.includes("settingsSec"), 'settings categories are collapsible sections');
ok(main.includes("s.settingsSec || 'audio'"), 'first section (audio) or last-used stays open');
ok(main.includes("el.classList.toggle('open', on)"), 'section toggle does not rebuild the panel');
const nav = main.match(/uiNav\([\s\S]*?\n  \}/);
ok(nav && nav[0].includes('offsetParent !== null'), 'uiNav still skips hidden (closed) controls');

const post = read('js/post.js');
ok(post.includes('UnrealBloomPass'), 'post still uses UnrealBloomPass');
ok(post.includes('bloomAmt > 0') && post.includes('this.bloom.strength'), 'bloom pass is created/applied from the slider');
ok(post.includes('applyBloom'), 'Post.applyBloom exists for live updates');

const tex = read('js/tex.js');
ok(tex.includes("'metal059a'") && tex.includes("'painted_concrete_02'"), 'tex.js lists the new PBR sets');
ok(!tex.includes('hangar_concrete_floor'), 'tex.js no longer references hangar_concrete_floor');
ok(tex.includes('METAL_TILE') && tex.includes('FLOOR_TILE') && tex.includes('tileRepeat'), 'shared tiling helpers exist');

const env = read('js/env.js');
ok(env.includes("applyPBR(floor.material, 'painted_concrete_02'"), 'hangar floor uses painted_concrete_02');
ok(!env.includes('hangar_concrete_floor'), 'env.js no longer references hangar_concrete_floor');

const parts = read('js/parts3d.js');
ok(parts.includes("applyPBR(m, 'metal059a'") && parts.includes("applyPBR(M[k], 'metal059a'"), 'rocket and shared metal parts use Metal059A');
ok(parts.includes('tileRepeat(Math.PI * 2 * radius, len, METAL_TILE)'), 'hull tiling uses part circumference and length');

const credits = read('CREDITS.md');
ok(credits.includes('Metal 059 A') && credits.includes('ambientcg.com/view?id=Metal059A'), 'CREDITS lists Metal059A');
ok(credits.includes('Painted Concrete 02') && credits.includes('painted_concrete_02'), 'CREDITS lists painted_concrete_02');
ok(!credits.includes('hangar_concrete_floor'), 'CREDITS dropped the unused hangar floor texture');

const need = [
  'assets/tex/metal059a_diff_1k.webp', 'assets/tex/metal059a_diff_2k.webp',
  'assets/tex/metal059a_nor_1k.webp', 'assets/tex/metal059a_nor_2k.webp',
  'assets/tex/metal059a_arm_1k.webp', 'assets/tex/metal059a_arm_2k.webp',
  'assets/tex/painted_concrete_02_diff_1k.webp', 'assets/tex/painted_concrete_02_diff_2k.webp',
  'assets/tex/painted_concrete_02_nor_1k.webp', 'assets/tex/painted_concrete_02_nor_2k.webp',
  'assets/tex/painted_concrete_02_arm_1k.webp', 'assets/tex/painted_concrete_02_arm_2k.webp',
];
for (const f of need) ok(fs.existsSync(new URL('../' + f, import.meta.url)), f + ' exists');
const gone = ['assets/tex/hangar_concrete_floor_diff_1k.webp', 'assets/tex/hangar_concrete_floor_diff_2k.webp',
  'assets/tex/hangar_concrete_floor_nor_1k.webp', 'assets/tex/hangar_concrete_floor_nor_2k.webp',
  'assets/tex/hangar_concrete_floor_arm_1k.webp', 'assets/tex/hangar_concrete_floor_arm_2k.webp'];
for (const f of gone) ok(!fs.existsSync(new URL('../' + f, import.meta.url)), f + ' removed');

if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall ok');
