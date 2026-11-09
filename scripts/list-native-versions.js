/**
 * Every installed package that carries native code, with its version.
 *
 * check-native-deps.js guards the NAMES of native packages. It cannot see a
 * new VERSION of one we already ship, and a version can move native code just
 * as surely: expo 57.0.8 -> 57.0.32 moves expo-modules-core 57.0.7 -> 57.0.25.
 * Run this on main and on the branch and diff the two: any changed line means
 * a new binary on both stores before the JavaScript ships.
 * See runbooks/STORE-BUILD-checklist.md.
 *
 *   cd frontend && node ../scripts/list-native-versions.js > /tmp/native-after.txt
 */
const fs = require('fs'), path = require('path');
const root = path.resolve('node_modules');
const out = [];
const visit = (dir) => {
  const pj = path.join(dir, 'package.json');
  if (!fs.existsSync(pj)) return;
  const native = ['android', 'ios', 'expo-module.config.json', 'react-native.config.js']
    .some((f) => fs.existsSync(path.join(dir, f)));
  if (native) { const p = JSON.parse(fs.readFileSync(pj, 'utf8')); out.push(`${p.name}@${p.version}`); }
};
for (const name of fs.readdirSync(root)) {
  if (name.startsWith('.')) continue;
  if (name.startsWith('@')) for (const sub of fs.readdirSync(path.join(root, name))) visit(path.join(root, name, sub));
  else visit(path.join(root, name));
}
console.log(out.sort().join('\n'));
