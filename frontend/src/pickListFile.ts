/**
 * Pick one shopping-list FILE from the phone's files (or the computer, on the
 * web): a PDF, or a JPG/PNG picture that is not in the photo gallery — saved
 * from an email, in Files, in Drive. Hands back its contents as base64 and
 * which reader it needs.
 *
 * What the file IS is read from its first bytes, not its name or the type the
 * provider claims: a provider can hand back a file with no type and no
 * extension. The checks here are the friendly early version of the server's
 * (backend/server.py shopping_pdf_bytes and the photo path), which has the
 * last word.
 */
import { Platform } from 'react-native';

/** Same as SHOPPING_PDF_MAX_BYTES on the server. */
export const PDF_MAX_BYTES = 5 * 1024 * 1024;
/** The server takes 14 MB of base64 for a picture (MAX_IMAGE_B64_CHARS): 10 MB of file. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** What the picker offers. HEIC is left out on purpose: see `heic` below. */
export const LIST_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export type ListFileKind = 'pdf' | 'image';

export type PickedListFile =
  | { kind: ListFileKind; base64: string }
  | { problem: 'too_large' | 'not_supported' | 'heic' | 'update_needed' }
  | null; // cancelled

/** "data:application/pdf;base64,JVBER…" → "JVBER…"; bare base64 is kept. */
export function bareBase64(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

/**
 * An iPhone photo saved as a file is usually HEIC, which the server cannot
 * open. The gallery converts it on the way in, so that is where to send it.
 */
export function isHeic(name?: string | null, mimeType?: string | null): boolean {
  return /^image\/hei[cf]/i.test(mimeType || '') || /\.hei[cf]$/i.test(name || '');
}

/**
 * Only what is plainly something else is turned away before reading: a type
 * the provider states that is none of ours, with no name of ours either.
 * No type, or the generic octet-stream, goes on to be recognised by content.
 */
export function plainlyUnsupported(name?: string | null, mimeType?: string | null): boolean {
  const type = (mimeType || '').toLowerCase();
  if (LIST_FILE_TYPES.includes(type) || type === 'image/jpg') return false;
  if (/\.(pdf|jpe?g|png)$/i.test(name || '')) return false;
  return type !== '' && type !== 'application/octet-stream';
}

/**
 * What the file is, from its first bytes in base64: "%PDF-" is "JVBER",
 * a JPEG's FF D8 FF is "/9j/", a PNG's signature is "iVBORw0KGgo".
 */
export function kindOf(base64: string): ListFileKind | null {
  if (base64.startsWith('JVBER')) return 'pdf';
  if (base64.startsWith('/9j/') || base64.startsWith('iVBORw0KGgo')) return 'image';
  return null;
}

export async function pickListFile(): Promise<PickedListFile> {
  // Same guard as the Coffre's file import: a binary without the picker gets
  // a nudge to update, never a crash.
  let DocumentPicker: any;
  try {
    DocumentPicker = require('expo-document-picker');
  } catch {
    return { problem: 'update_needed' };
  }
  const res = await DocumentPicker.getDocumentAsync({
    type: LIST_FILE_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
    // Not read yet: the size is checked first, so a 300 MB file is turned
    // away without being loaded into memory as text.
    base64: false,
  });
  if (res?.canceled || !res?.assets?.[0]) return null;
  const asset = res.assets[0];
  if (isHeic(asset.name, asset.mimeType)) return { problem: 'heic' };
  if (plainlyUnsupported(asset.name, asset.mimeType)) return { problem: 'not_supported' };
  if (asset.size && asset.size > IMAGE_MAX_BYTES) return { problem: 'too_large' };

  let base64: string;
  if (Platform.OS === 'web') {
    const file: Blob | undefined = asset.file;
    if (!file) return null;
    base64 = bareBase64(await readAsDataUrl(file));
  } else {
    const FS = require('expo-file-system/legacy');
    base64 = await FS.readAsStringAsync(asset.uri, { encoding: FS.EncodingType.Base64 });
  }

  const kind = kindOf(base64);
  if (!kind) return { problem: 'not_supported' };
  // A PDF has the tighter limit; measured on what was read, in case the
  // picker did not say the size.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > (kind === 'pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES)) return { problem: 'too_large' };
  return { kind, base64 };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}
