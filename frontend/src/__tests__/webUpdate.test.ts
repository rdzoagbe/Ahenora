/**
 * The web app cannot restart itself into a new build, so it has to notice one.
 *
 * These pin the detection rule: the entry bundle is named after a hash of its
 * own contents, so a changed filename means changed code and an unchanged one
 * means there is nothing to tell the user about. Getting that backwards either
 * nags on every poll or never fires at all.
 */

const ENTRY_RE = /entry-([a-z0-9]+)\.js/i;

/** Mirrors the extraction the banner performs on a page's script tags. */
function entryHash(src: string): string | null {
  return src.match(ENTRY_RE)?.[1] ?? null;
}

/** Mirrors how the banner derives where the app is served from. */
function serveBase(src: string): string {
  return src.split('/_expo/')[0] || '';
}

const RUNNING = '/Household-COO/app/_expo/static/js/web/entry-42212083256652d8dca75700e3110824.js';

describe('spotting a new web deploy', () => {
  it('reads the hash out of the running bundle', () => {
    expect(entryHash(RUNNING)).toBe('42212083256652d8dca75700e3110824');
  });

  it('says nothing when the deployed bundle is the same one', () => {
    const deployed = `<script src="${RUNNING}" defer></script>`;
    expect(deployed.match(ENTRY_RE)?.[1]).toBe(entryHash(RUNNING));
  });

  it('spots a genuinely different build', () => {
    const deployed = '<script src="/Household-COO/app/_expo/static/js/web/entry-ffffffffffffffffffffffffffffffff.js"></script>';
    expect(deployed.match(ENTRY_RE)?.[1]).not.toBe(entryHash(RUNNING));
  });

  it('finds the serving path so a sub-path deploy still checks the right page', () => {
    // The app is not served from the domain root, so a hardcoded "/index.html"
    // would fetch the wrong document — or somebody else's.
    expect(serveBase(RUNNING)).toBe('/Household-COO/app');
  });

  it('ignores scripts that are not the entry bundle', () => {
    expect(entryHash('/Household-COO/app/_expo/static/js/web/StoreReview-d17bdf7d.js')).toBeNull();
  });
});
