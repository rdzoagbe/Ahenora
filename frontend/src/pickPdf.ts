/**
 * Pick one PDF from the phone's files (or the computer, on the web) and hand
 * back its contents as base64, for the shopping-list reader.
 *
 * The checks here are the friendly early version of the server's: a file
 * that is too heavy or is not a PDF is said so before it is uploaded. The
 * server checks again (backend/server.py shopping_pdf_bytes) and is the one
 * that counts.
 */
import { Platform } from 'react-native';

/** Same as SHOPPING_PDF_MAX_BYTES on the server. */
export const PDF_MAX_BYTES = 5 * 1024 * 1024;

export type PickedPdf =
  | { base64: string }
  | { problem: 'too_large' | 'not_pdf' | 'update_needed' }
  | null; // cancelled

export function looksLikePdf(name?: string | null, mimeType?: string | null): boolean {
  return (mimeType || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(name || '');
}

/** "data:application/pdf;base64,JVBER…" → "JVBER…"; bare base64 is kept. */
export function bareBase64(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

export async function pickPdf(): Promise<PickedPdf> {
  // Same guard as the Coffre's file import: a binary without the picker gets
  // a nudge to update, never a crash.
  let DocumentPicker: any;
  try {
    DocumentPicker = require('expo-document-picker');
  } catch {
    return { problem: 'update_needed' };
  }
  const web = Platform.OS === 'web';
  const res = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
    // On the web the picker reads the file itself; on a phone it is read
    // from the cache copy below.
    base64: web,
  });
  if (res?.canceled || !res?.assets?.[0]) return null;
  const asset = res.assets[0];
  if (!looksLikePdf(asset.name, asset.mimeType)) return { problem: 'not_pdf' };
  if (asset.size && asset.size > PDF_MAX_BYTES) return { problem: 'too_large' };
  if (web) {
    return asset.base64 ? { base64: bareBase64(asset.base64) } : null;
  }
  const FS = require('expo-file-system/legacy');
  const base64 = await FS.readAsStringAsync(asset.uri, { encoding: FS.EncodingType.Base64 });
  return { base64 };
}
