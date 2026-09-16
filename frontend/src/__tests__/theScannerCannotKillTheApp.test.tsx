/**
 * The guard that failed last time, tested against the failure that happened.
 *
 * scripts/check-native-deps.js records it: expo-audio was added, published
 * over the air, and "the app was dead for everyone on Android" — because JS
 * reached for a native module the installed binary did not contain. And:
 *
 *   "A test passed for the guard that was supposed to make it survivable,
 *    because the guard was tested against a mock that threw a JavaScript
 *    error — which is not what a missing native module does."
 *
 * react-native-document-scanner-plugin registers with
 * TurboModuleRegistry.getEnforcing() at module top level, and getEnforcing
 * throws when the module is absent. So these model BOTH shapes a missing
 * native module takes:
 *
 *   1. require THROWS  (getEnforcing on the new architecture)
 *   2. require SUCCEEDS but hands back an object with nothing on it
 *
 * The second is the one that caught somebody out before. A guard that only
 * catches the throw passes its test and still takes the app down.
 */
import { Platform } from 'react-native';

const MODULE = 'react-native-document-scanner-plugin';

/** Fresh module registry each time: documentScanner caches its lookup. */
function loadScanner() {
  let mod!: typeof import('../documentScanner');
  jest.isolateModules(() => {
    mod = require('../documentScanner');
  });
  return mod;
}

describe('a binary that does not have the scanner', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock(MODULE);
  });

  it('survives a require that throws, which is what getEnforcing does', () => {
    jest.doMock(MODULE, () => {
      throw new Error('Invariant Violation: TurboModuleRegistry.getEnforcing(...)');
    });
    const s = loadScanner();
    expect(s.hasDocumentScanner()).toBe(false);
  });

  it('and reports unavailable rather than throwing at the caller', async () => {
    jest.doMock(MODULE, () => {
      throw new Error('Invariant Violation: TurboModuleRegistry.getEnforcing(...)');
    });
    const s = loadScanner();
    await expect(s.scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('survives a module that loads but carries no method', async () => {
    // THE ONE THAT WAS MISSED LAST TIME. Nothing throws here; a guard written
    // around try/catch alone is satisfied and hands back a broken object.
    jest.doMock(MODULE, () => ({ default: {} }));
    const s = loadScanner();
    expect(s.hasDocumentScanner()).toBe(false);
    await expect(s.scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('survives a module whose scanDocument is not a function', async () => {
    jest.doMock(MODULE, () => ({ default: { scanDocument: 'nope' } }));
    const s = loadScanner();
    expect(s.hasDocumentScanner()).toBe(false);
    await expect(s.scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('survives a module that is undefined altogether', async () => {
    jest.doMock(MODULE, () => undefined);
    const s = loadScanner();
    await expect(s.scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('a binary that does have it', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock(MODULE);
  });

  it('returns the scanned page', async () => {
    jest.doMock(MODULE, () => ({
      default: {
        scanDocument: async () => ({ scannedImages: ['file:///tmp/page.jpg'] }),
      },
    }));
    const s = loadScanner();
    expect(s.hasDocumentScanner()).toBe(true);
    await expect(s.scanDocument()).resolves.toEqual({
      kind: 'scanned', uri: 'file:///tmp/page.jpg',
    });
  });

  it('treats a user backing out as cancelled, not as a failure', async () => {
    // Falling back to the picker here would open a second camera at somebody
    // who just closed the first one.
    jest.doMock(MODULE, () => ({
      default: { scanDocument: async () => ({ scannedImages: [], status: 'cancel' }) },
    }));
    const s = loadScanner();
    await expect(s.scanDocument()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('falls back when the scanner itself throws mid-scan', async () => {
    jest.doMock(MODULE, () => ({
      default: { scanDocument: async () => { throw new Error('camera busy'); } },
    }));
    const s = loadScanner();
    await expect(s.scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('asks for one page and a quality that is not 100', async () => {
    // The page is already cropped and deskewed by then, so what is left is
    // pure JPEG weight on an upload that was the original complaint.
    const seen: Record<string, unknown>[] = [];
    jest.doMock(MODULE, () => ({
      default: {
        scanDocument: async (o: Record<string, unknown>) => {
          seen.push(o);
          return { scannedImages: ['file:///tmp/page.jpg'] };
        },
      },
    }));
    await loadScanner().scanDocument();
    expect(seen[0].maxNumDocuments).toBe(1);
    expect(seen[0].croppedImageQuality).toBeLessThan(100);
  });
});

describe('the web build', () => {
  it('never even looks for a native module', () => {
    const original = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    jest.doMock(MODULE, () => {
      throw new Error('should not have been required on web');
    });
    try {
      expect(loadScanner().hasDocumentScanner()).toBe(false);
    } finally {
      (Platform as { OS: string }).OS = original;
      jest.dontMock(MODULE);
      jest.resetModules();
    }
  });
});
