/**
 * A timeout is not a dead network, and the app was telling people it was.
 *
 * Roland scanned a document on wifi AND 4G and was told:
 *
 *     "No connection. It'll go through when you're back online."
 *
 * Both halves were wrong. He had a connection, and nothing was ever going to
 * go through — the scan is not a queueable write, so there was no queue for it
 * to sit in. The message was a false promise on top of a false diagnosis, and
 * it sent him looking at his signal instead of at the app.
 *
 * Three causes, stacked:
 *
 * 1. `apiError` classified ANY error without an HTTP status as offline. An
 *    aborted request has no status, so a timeout landed in the offline branch.
 *    The comment above that line stated the assumption out loud — "status 0 /
 *    undefined is what fetch gives on a dead network" — which is true of a
 *    dead network and false of a timeout.
 *
 * 2. One 30-second budget applied to every request. Fetching a list and
 *    uploading a photograph for a model to read are not the same shape of
 *    call, and the second routinely exceeds thirty seconds on mobile data.
 *
 * 3. The photo was never shrunk: 12MP at quality 0.55 is megabytes, and
 *    base64 adds a third. Three to five megabytes went up before the model
 *    saw anything — which is also why extraction was mediocre, because it was
 *    reading a photo of a TABLE with a letter on it.
 *
 * The third has an over-the-air half (crop before upload) and a native half
 * (real edge detection), and only the first can ship as an update. Same rule
 * that decided the Android push question the same afternoon: an OTA cannot
 * add native capability.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const API = readFileSync(join(__dirname, '..', 'api.ts'), 'utf8');
const API_ERROR = readFileSync(join(__dirname, '..', 'apiError.ts'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');
const CAMERA = readFileSync(
  join(__dirname, '..', 'components', 'CameraCaptureModal.tsx'), 'utf8');
const SPENDING = readFileSync(
  join(__dirname, '..', 'components', 'SpendingView.tsx'), 'utf8');

/** Source with comments removed.
 *
 *  A text search cannot tell code from prose, and twice now an assertion has
 *  failed on the comment EXPLAINING the thing it was checking for. Strip the
 *  commentary and the question becomes answerable. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('a timeout is told apart from a dead network', () => {
  it('checks for an abort before falling through to offline', () => {
    // Order matters: the offline branch catches everything without a status,
    // so the abort check is worthless below it.
    expect(API_ERROR).toContain("=== 'AbortError'");
    expect(API_ERROR.indexOf("'AbortError'"))
      .toBeLessThan(API_ERROR.indexOf("if (!err?.status)"));
  });

  it('reads the name rather than using instanceof DOMException', () => {
    // Not a defined global on Hermes — referencing it would itself throw,
    // which is the same reason request() checks the name.
    //
    // Asserted on the CODE, with comments stripped. Two earlier versions of
    // this line failed on the comment explaining why DOMException is not
    // used — first by banning the bare word, then by banning the phrase the
    // comment happens to quote. A text search cannot tell code from prose
    // unless the prose is removed first.
    expect(codeOnly(API_ERROR)).not.toMatch(/instanceof\s+DOMException/);
    // And the thing it SHOULD do is checked positively, so this cannot pass
    // by the check simply being absent.
    expect(codeOnly(API_ERROR)).toContain("=== 'AbortError'");
  });

  it('has its own words, in every language', () => {
    expect(inEveryLanguage('err_timeout')).toBe(4);
  });
});

describe('nothing promises a retry that will not happen', () => {
  it('no longer says it will go through when you are back online', () => {
    // A write that IS queued returns { queued: true } and never throws, so
    // nothing reaching this message was ever queued. The promise was false
    // in every case it could possibly be shown.
    expect(I18N).not.toContain('back online.');
    expect(I18N).not.toContain('vuelvas a estar en línea');
  });

  it('tells people what to actually do instead', () => {
    expect(I18N).toContain('Check your signal and try again.');
  });
});

describe('a call that waits for a model gets a budget that fits', () => {
  it('has one shared constant rather than a number per call site', () => {
    expect(API).toContain('const VISION_TIMEOUT_MS = 90_000;');
    // No stray literal: a second copy is a second place to forget.
    const literals = API.split('\n').filter((l) => l.includes('90_000'));
    expect(literals).toHaveLength(1);
  });

  it('applies it to every call that uploads a photograph', () => {
    // All four, not just the one that was reported. The document scan was
    // the one Roland hit; the receipt, the shopping list and the recipe make
    // the identical round trip.
    // Sliced to the next api method rather than a fixed character count: the
    // first version took 420 characters and failed the moment a comment
    // pushed the code past it, which says nothing about the timeout and
    // everything about how long the comment is.
    const methodStart = (name: string) => API.indexOf(`  ${name}: `);
    for (const call of ['visionExtract', 'scanShoppingList',
                        'scanReceipt', 'captureRecipe']) {
      const at = methodStart(call);
      expect(at).toBeGreaterThan(-1);
      const next = API.indexOf('\n  ', API.indexOf('request<', at));
      const body = API.slice(at, API.indexOf('),', next) + 2);
      expect(body).toContain('VISION_TIMEOUT_MS');
    }
  });

  it('leaves everything else on the ordinary budget', () => {
    // Widening the default would hide a genuinely hung request behind a
    // minute and a half of spinner.
    expect(API).toContain('const REQUEST_TIMEOUT_MS = 30_000;');
    expect(API).toContain('opts.timeoutMs ?? REQUEST_TIMEOUT_MS');
  });
});

describe('the photo is cropped before it is uploaded', () => {
  it('offers the crop step on the document scanner', () => {
    expect(CAMERA).toContain('allowsEditing: true');
  });

  it('offers it on the receipt scanner too', () => {
    // Same round trip, same megabytes, same 30-second abort.
    expect(SPENDING.match(/allowsEditing: true/g) || []).toHaveLength(2);
  });

  it('keeps one set of capture options for camera and library', () => {
    // They drifted apart once already; a shared object is why they cannot.
    expect(CAMERA).toContain('launchCameraAsync(shot)');
    expect(CAMERA).toContain('launchImageLibraryAsync(shot)');
  });

  it('tries the OS document scanner first, and only for the camera', () => {
    // The automatic framing that was asked for. It is reached through the
    // wrapper, never the plugin, and only on the camera path: neither
    // platform's scanner works on a photo already in the gallery.
    expect(CAMERA).toContain("from '../documentScanner'");
    expect(CAMERA).toContain("if (source === 'camera') {");
    expect(CAMERA.indexOf('await scanDocument()')).toBeLessThan(
      CAMERA.indexOf('launchCameraAsync(shot)'));
  });

  it('is gated by the runtime version, not by a JavaScript guard', () => {
    // 2026-09-15: the scanner went out over the air behind a guard with ten
    // passing tests, and the app crashed on a real phone within minutes. A
    // missing native module aborts the process; JavaScript cannot catch it.
    // The thing that makes this safe is that JS built for the scanner can
    // never reach a binary without it — which is what runtimeVersion is for.
    const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')).expo;
    expect(app.runtimeVersion).toBe('3.0.0');
    expect(app.plugins.some((p: unknown) =>
      (Array.isArray(p) ? p[0] : p) === 'react-native-document-scanner-plugin')).toBe(true);
  });
});
