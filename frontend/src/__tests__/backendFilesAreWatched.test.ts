/**
 * A frontend test that reads a backend file needs CI to RUN when that backend
 * file changes.
 *
 * notificationRouting.test.ts reads backend/server.py for the push types the
 * server actually sends — deliberately, because a hand-kept list cannot report
 * what it was never told about. But frontend-ci-eas-update.yml only watched
 * frontend/**, legal/** and its own file. So #623 added the vault_doc push,
 * touching nothing but server.py and a backend test, this workflow never
 * fired, and main went red with nobody told: the nightly OTA is gated on it
 * (expo-update needs: frontend-ci), so three merged PRs would have reached no
 * phone at all. The test that would have caught it never ran.
 *
 * Adding 'backend/server.py' to the paths fixes that one instance. This fixes
 * the shape: the moment a frontend test reads a backend file the workflow does
 * not watch, this goes red and names the file.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TESTS_DIR = __dirname;
const REPO = join(__dirname, '..', '..', '..');
const WORKFLOW = join(REPO, '.github', 'workflows', 'frontend-ci-eas-update.yml');

/** Backend files this test suite reads, however the path was spelled. */
function backendFilesReadBy(source: string): string[] {
  const found = new Set<string>();

  // join(__dirname, '..', '..', '..', 'backend', 'server.py')
  for (const m of source.matchAll(/'backend',\s*'([^']+)'/g)) found.add(m[1]);

  // A plain path string, with or without a leading ../
  for (const m of source.matchAll(/['"`](?:[./]*\/)?backend\/([A-Za-z0-9_\-./]+)['"`]/g)) {
    found.add(m[1]);
  }

  return [...found];
}

/** The `paths:` entries of the workflow's push trigger. */
function watchedPaths(yaml: string): string[] {
  const entries = new Set<string>();
  for (const m of yaml.matchAll(/^\s*-\s*'([^']+)'\s*$/gm)) entries.add(m[1]);
  return [...entries];
}

function isCovered(file: string, paths: string[]): boolean {
  return paths.some((p) => {
    if (p === `backend/${file}`) return true;
    if (p === 'backend/**' || p === 'backend/*') return true;
    // backend/sub/** covering backend/sub/thing.py
    const star = p.indexOf('/**');
    return star !== -1 && `backend/${file}`.startsWith(p.slice(0, star + 1));
  });
}

describe('a frontend test that reads the backend runs when the backend changes', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8');
  const paths = watchedPaths(yaml);

  // A parser that found nothing would make every assertion below vacuous.
  it('can read the workflow it is checking', () => {
    expect(paths).toEqual(expect.arrayContaining(['frontend/**']));
  });

  // Every test but this one. This file is the scanner: it necessarily holds
  // backend path strings as patterns and examples, and matching itself would
  // report them as real reads.
  const SELF = 'backendFilesAreWatched.test.ts';
  const testFiles = readdirSync(TESTS_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => f !== SELF);

  it('finds the suite it is scanning', () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(10);
  });

  // The known reader, named outright: if this stops matching, the scanner
  // above has quietly broken and everything below would pass on an empty set.
  it('still sees notificationRouting.test.ts reading server.py', () => {
    const src = readFileSync(join(TESTS_DIR, 'notificationRouting.test.ts'), 'utf8');
    expect(backendFilesReadBy(src)).toContain('server.py');
  });

  it('has every backend file a frontend test reads in the workflow paths', () => {
    const unwatched: string[] = [];

    for (const file of testFiles) {
      const src = readFileSync(join(TESTS_DIR, file), 'utf8');
      for (const backendFile of backendFilesReadBy(src)) {
        if (!isCovered(backendFile, paths)) {
          unwatched.push(`${file} reads backend/${backendFile}`);
        }
      }
    }

    // Each entry means: change that backend file alone and this suite does not
    // run, so whatever it asserts about the backend is not actually checked.
    // Add the file to `paths:` in frontend-ci-eas-update.yml.
    expect(unwatched.sort()).toEqual([]);
  });
});
