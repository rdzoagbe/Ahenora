/**
 * Take a picture with the camera, or choose one from the gallery, and hand
 * back its contents as base64 — the one way every scan in the app gets a
 * picture (the shopping list, recipe capture, Dépenses receipts, the Home
 * camera, the Coffre).
 *
 * It was five hand-copied blocks, and they went wrong together. Reported from
 * a real phone on 2026-11-10 ("when I choose from gallery it doesn't upload
 * the images"), with three faults in each copy:
 *
 *  - The gallery was gated on a media-library permission. expo-image-picker
 *    documents launchImageLibraryAsync as needing it "on iOS 10 only"; on
 *    Android it opens the system photo picker, which needs none. On Android 12
 *    and older the request asks for READ_EXTERNAL_STORAGE, which app.json
 *    removes on purpose, so it could never be granted and the gallery stopped
 *    there.
 *  - A refused permission was thrown as an Error with no HTTP status, which
 *    apiErrorText tells as "no connection".
 *  - A picture with no base64 ended in a bare `return` (nothing on screen),
 *    or sent its file:// path up as if it were the picture.
 *
 * Here: no permission for the gallery; the camera's refusal and an
 * unreadable picture come back as named problems for the caller to say in
 * its own words; a picture with no base64 is read from the copy the picker
 * leaves in the cache; and every picture that could not be got is reported
 * to the admin errors panel under `where`, so the next one leaves a trace.
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { reportPictureProblem } from './api';
import { scanDocumentPages } from './documentScanner';

export type PictureSource = 'camera' | 'library';

export type PickedPicture =
  /**
   * `pages`: the pages to read, top to bottom, never more than the scanner
   * option's maxPages; `base64` is the first. `dropped`: pages scanned past
   * that (an iPhone's scanner has no cap) and not returned, for the caller
   * to say so.
   */
  | { base64: string; fileName: string | null; pages: string[]; dropped: number }
  | { problem: 'camera_denied' | 'unreadable' }
  | null; // cancelled

export type PickPictureOptions = {
  /** Shown in the admin panel next to the problem: the route it was for. */
  where: string;
  quality?: number;
  /** The system crop step before anything is uploaded (plain camera only). */
  allowsEditing?: boolean;
  /**
   * The camera opens the phone's own document scanner (ML Kit / VisionKit):
   * it finds the paper's edges, shoots when steady and straightens the page,
   * as the Home camera does. Up to `maxPages` in one session, with the
   * scanner's own "add a page" and "done" buttons. Where there is no scanner
   * (the web, a build without it) the plain camera opens instead.
   */
  scanner?: { maxPages: number };
};

export async function pickPicture(source: PictureSource, options: PickPictureOptions): Promise<PickedPicture> {
  const native = Platform.OS !== 'web';
  try {
    if (native && source === 'camera' && options.scanner) {
      // Android's scanner (ML Kit) runs in Google Play services and needs no
      // camera permission of this app's own: asking first would block it for
      // somebody who once said no to the app's camera. VisionKit is the app's
      // own camera, so an iPhone is asked first.
      if (Platform.OS === 'ios') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return { problem: 'camera_denied' };
      }
      // The scanner is in every binary of runtime 3.0.0 and later, which is
      // what keeps this JavaScript off a binary without it (app.json); the
      // 'unavailable' answer is the web and a belt-and-braces fallback.
      const max = Math.max(1, options.scanner.maxPages);
      const scan = await scanDocumentPages(max);
      if (scan.kind === 'cancelled') return null;
      if (scan.kind === 'scanned') {
        // /legacy on purpose: readAsStringAsync lives there in SDK 57.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FS = require('expo-file-system/legacy');
        const kept = scan.uris.slice(0, max);
        const pages: string[] = await Promise.all(
          kept.map((uri) => FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 })));
        if (!pages.length || pages.some((p) => !p)) throw new Error('no scanned page data');
        return { base64: pages[0], fileName: null, pages, dropped: scan.uris.length - kept.length };
      }
      // 'unavailable': the plain camera below, as before.
    }
    if (native && source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { problem: 'camera_denied' };
    }
    const shot = {
      base64: true,
      quality: options.quality ?? 0.55,
      allowsEditing: options.allowsEditing ?? false,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(shot)
      : await ImagePicker.launchImageLibraryAsync(shot);
    if (res.canceled || !res.assets?.[0]) return null;
    const asset = res.assets[0];
    // Native supplies base64 directly; web supplies a data URL instead.
    let base64 = asset.base64 ?? (asset.uri?.startsWith('data:') ? asset.uri.split(',')[1] : null);
    if (!base64 && native && asset.uri) {
      // /legacy on purpose: readAsStringAsync lives there in SDK 57.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const FS = require('expo-file-system/legacy');
      base64 = await FS.readAsStringAsync(asset.uri, { encoding: FS.EncodingType.Base64 });
    }
    if (!base64) throw new Error('no picture data');
    return { base64, fileName: asset.fileName ?? null, pages: [base64], dropped: 0 };
  } catch (e: unknown) {
    reportPictureProblem(options.where, `${source}: ${(e as Error)?.message || String(e)}`);
    return { problem: 'unreadable' };
  }
}
