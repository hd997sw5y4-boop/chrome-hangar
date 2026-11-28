// Grep-style check: the click-a-part lesson / facts panel is gone from the source.
// The First Bolt tutorial may still mention facts; this only flags the inspect popup.
// Run: node tests/no-part-lessons.test.mjs
import fs from 'fs';

const files = {
  'js/interact2.js': [
    'ixFact', 'openInspect', 'inspectTap', 'maybeInspect', 'factFor',
    'inspectCtl', 'inspecting', 'blockLock', 'factEl', 'Look at a part',
  ],
  'js/build.js': ['inspectTap', 'blockLock'],
  'js/main.js': ['Look at a part'],
  'index.html': ['ixFact'],
  'css/style.css': ['ixFact'],
};

let fails = 0;
for (const [file, needles] of Object.entries(files)) {
  const t = fs.readFileSync(file, 'utf8');
  for (const n of needles) {
    if (t.includes(n)) { fails++; console.log('  FAIL  ' + file + ' still has ' + JSON.stringify(n)); }
    else console.log('  ok  ' + file + ' has no ' + JSON.stringify(n));
  }
}
if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall ok');
