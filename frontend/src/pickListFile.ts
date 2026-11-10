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

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The first `count` bytes of a base64 string (no atob: not on every engine). */
export function headBytes(base64: string, count: number): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < base64.length && out.length < count; i += 1) {
    const value = B64.indexOf(base64[i]);
    if (value < 0) continue; // padding, line breaks
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

const ascii = (bytes: number[]) => String.fromCharCode(...bytes);
// The ftyp brands an iPhone photo is saved under.
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];

/**
 * What the file is, from its first bytes: "%PDF-" anywhere in the first
 * 1024 (the PDF spec allows a little before it, and so does the server),
 * a JPEG's FF D8 FF, a PNG's signature, or an HEIC's "ftyp" box.
 */
export function kindOf(base64: string): ListFileKind | 'heic' | null {
  const head = headBytes(base64, 1024);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image';
  if (ascii(head.slice(0, 8)) === '\x89PNG\r\n\x1a\n') return 'image';
  if (ascii(head.slice(4, 8)) === 'ftyp' && HEIC_BRANDS.includes(ascii(head.slice(8, 12)))) return 'heic';
  if (ascii(head).includes('%PDF-')) return 'pdf';
  return null;
}

/** Bytes in a base64 string, exactly: padding does not count. */
export function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
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
  // Said to be a PDF: its own, tighter limit, before it is read.
  const saysPdf = (asset.mimeType || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(asset.name || '');
  if (asset.size && asset.size > (saysPdf ? PDF_MAX_BYTES : IMAGE_MAX_BYTES)) return { problem: 'too_large' };

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
  // An HEIC that came with no type and no name: known by its content.
  if (kind === 'heic') return { problem: 'heic' };
  if (!kind) return { problem: 'not_supported' };
  // Measured on what was read, in case the picker did not say the size or
  // the name did not say PDF.
  if (decodedSize(base64) > (kind === 'pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES)) return { problem: 'too_large' };
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
