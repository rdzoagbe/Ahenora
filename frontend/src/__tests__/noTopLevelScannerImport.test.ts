/**
 * One import would undo all of it.
 *
 * react-native-document-scanner-plugin calls TurboModuleRegistry.getEnforcing()
 * at module top level, and getEnforcing throws when the native module is
 * absent. src/documentScanner.ts therefore reaches it through a require inside
 * a try, so the throw happens when somebody taps Scan and is caught there.
 *
 * A single `import ... from 'react-native-document-scanner-plugin'` written
 * anywhere else puts that same throw back at module-load time, where nothing
 * catches it — and every binary that predates the scanner is one, so the app
 * dies for all of them on the next update. That is precisely how expo-audio
 * took the Android app down; see scripts/check-native-deps.js.
 *
 * So this walks the source rather than trusting the convention.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const PLUGIN = 'react-native-document-scanner-plugin';
/** The one file allowed to touch it, and only by require inside a try. */
const WRAPPER = path.join('src', 'documentScanner.ts');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // __tests__ is excluded on purpose: these files run under node, never on a
    // phone, and they legitimately name the plugin to mock it.
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Does this file import the plugin, ignoring comments?
 *
 * Line by line, because a regex with [^;]* spans NEWLINES — the first version
 * of this matched the word "import" in a comment and then found the plugin
 * name three lines below it, and reported the wrapper's own careful
 * explanation as a violation. Fifth time this session that text matching has
 * tripped over prose.
 */
function importsPlugin(file: string): boolean {
  const code = fs
    .readFileSync(file, 'utf8')
    // Block comments FIRST, across lines. documentScanner.ts's own docstring
    // quotes the forbidden import as the example of what not to write, and a
    // stripper that only removes // comments reads that sentence as the
    // violation it is warning about.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return code
    .split('\n')
    .some((line) => new RegExp(`^\\s*import\\b[^'"]*['"]${PLUGIN}['"]`).test(line)
      || new RegExp(`\\bfrom\\s+['"]${PLUGIN}['"]`).test(line));
}

describe('the scanner is never imported at module level', () => {
  const files = [
    ...sourceFiles(path.join(ROOT, 'src')),
    ...sourceFiles(path.join(ROOT, 'app')),
  ];

  it('finds the source tree at all', () => {
    // A walk that silently returns nothing would pass every case below.
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no import of the plugin anywhere', () => {
    const offenders = files.filter(
      (file) => !file.endsWith(WRAPPER) && importsPlugin(file));
    expect(offenders).toEqual([]);
  });

  it('and the wrapper itself uses require, not import', () => {
    const src = fs.readFileSync(path.join(ROOT, WRAPPER), 'utf8');
    expect(src).toContain(`require('${PLUGIN}')`);
    expect(importsPlugin(path.join(ROOT, WRAPPER))).toBe(false);
  });

  it('and that require sits inside a try', () => {
    const src = fs.readFileSync(path.join(ROOT, WRAPPER), 'utf8');
    const before = src.slice(0, src.indexOf(`require('${PLUGIN}')`));
    // The nearest enclosing block opener before the require must be a try.
    expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('} catch'));
  });
});
