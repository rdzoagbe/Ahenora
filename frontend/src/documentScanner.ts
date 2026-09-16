/**
 * Real automatic framing, and a binary that does not have it.
 *
 * Android has Google's ML Kit Document Scanner and iOS has VisionKit's
 * document camera. Both find the page edges live, take the shot themselves
 * when the frame is steady, and correct the perspective — so what is uploaded
 * is the document at its true rectangle rather than a photograph of a table
 * with a letter on it. react-native-document-scanner-plugin wraps exactly
 * those two, so this is the operating system's own scanner, not a third-party
 * service: nothing leaves the phone, and it works with no signal.
 *
 * THE DANGER, WHICH THIS FILE EXISTS TO CONTAIN
 *
 * The plugin registers with TurboModuleRegistry.getEnforcing(), at module top
 * level. getEnforcing THROWS when the native module is absent. So a plain
 * `import DocumentScanner from 'react-native-document-scanner-plugin'`
 * anywhere in the bundle takes the whole app down on every installed binary
 * that predates the scanner — which is all of them, the moment an update is
 * published.
 *
 * That is not a hypothetical here. scripts/check-native-deps.js records the
 * last time: expo-audio was added, published over the air, and "the app was
 * dead for everyone on Android". The guard that was supposed to make it
 * survivable had a passing test, because the test modelled the wrong failure.
 *
 * So: the module is reached through a require inside a try, never an import,
 * and the result is checked for the METHOD rather than merely for truthiness.
 * A missing native module does not always throw — on some setups it returns an
 * object that is missing everything — and a guard that only catches the throw
 * is the guard that had a passing test last time.
 *
 * Absent for any reason at all, the caller is told so and falls back to the
 * picker with its manual crop. Degrading to the old behaviour is the whole
 * point; there is no path here that leaves a caller with nothing.
 */
import { Platform } from 'react-native';

export type ScanResult =
  /** The OS scanner ran and the user kept a page. */
  | { kind: 'scanned'; uri: string }
  /** The OS scanner ran and the user backed out. Not an error, and not a
   *  reason to open a second camera at them. */
  | { kind: 'cancelled' }
  /** No scanner on this binary. The caller does what it did before. */
  | { kind: 'unavailable' };

type Plugin = { scanDocument: (o: Record<string, unknown>) => Promise<unknown> };

// undefined = not looked yet, null = looked and it is not here.
let cached: Plugin | null | undefined;

/** The plugin, or null. Never throws, and only ever looks once. */
function plugin(): Plugin | null {
  if (cached !== undefined) return cached;
  cached = null;
  // Web has no native modules at all, and react-native-web would resolve the
  // import to something that cannot work. Not worth finding out at runtime.
  if (Platform.OS === 'web') return cached;
  try {
    // require, not import, and the lint rule is disabled on purpose: an import
    // is hoisted and runs at module load, where nothing can catch it. This runs
    // when a person taps Scan, inside this try. That difference is the whole
    // reason the app does not die on every binary that predates the scanner.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-document-scanner-plugin');
    const candidate = (mod?.default ?? mod) as Partial<Plugin> | undefined;
    // The METHOD, not the object. See the note above about the guard that
    // passed its test and took the app down anyway.
    if (candidate && typeof candidate.scanDocument === 'function') {
      cached = candidate as Plugin;
    }
  } catch {
    // Old binary, or a build without the module. Nothing to report: the
    // caller's fallback is the correct behaviour, not a degraded one worth
    // interrupting somebody over.
  }
  return cached;
}

/** Is the OS document scanner usable on this binary? */
export function hasDocumentScanner(): boolean {
  return plugin() !== null;
}

/**
 * Open the OS document scanner for a single page.
 *
 * Returns a file URI rather than base64: ML Kit and VisionKit both hand back a
 * cropped JPEG, and asking for base64 across the bridge doubles a multi-megabyte
 * string in memory for no reason. The caller reads the file when it needs it.
 */
export async function scanDocument(): Promise<ScanResult> {
  const scanner = plugin();
  if (!scanner) return { kind: 'unavailable' };
  try {
    const res = (await scanner.scanDocument({
      maxNumDocuments: 1,
      // 85 rather than 100: the page is already cropped and deskewed by then,
      // so the remaining size is all JPEG quality, and the model reads an 85
      // exactly as well while the upload is a fraction of the size.
      croppedImageQuality: 85,
    })) as { scannedImages?: string[]; status?: string } | undefined;

    const uri = res?.scannedImages?.[0];
    if (!uri) return { kind: 'cancelled' };
    return { kind: 'scanned', uri };
  } catch {
    // The scanner was there and something went wrong inside it. Treated as
    // unavailable so the caller falls back rather than showing an error for a
    // scan the picker could still do.
    return { kind: 'unavailable' };
  }
}
