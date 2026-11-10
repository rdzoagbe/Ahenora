/**
 * A shopping list sent as a PDF goes through the same scan sheet as a photo
 * of one (tests/test_a_pdf_shopping_list_is_read.py is the server's side).
 */
import fs from 'fs';
import path from 'path';

const mockGetDocument = jest.fn();
const mockReadAsString = jest.fn();
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockGetDocument(...a) }), { virtual: true });
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (...a: unknown[]) => mockReadAsString(...a),
  EncodingType: { Base64: 'base64' },
}), { virtual: true });

import { bareBase64, looksLikePdf, pickPdf, PDF_MAX_BYTES } from '../pickPdf';

const root = path.join(__dirname, '..', '..', '..');
const kitchen = fs.readFileSync(path.join(root, 'frontend', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.ts'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'frontend', 'src', 'i18n.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend', 'server.py'), 'utf8');

beforeEach(() => {
  mockGetDocument.mockReset();
  mockReadAsString.mockReset();
});

describe('what counts as a PDF', () => {
  it('goes by the type, or by the name when the phone does not say the type', () => {
    expect(looksLikePdf('liste.pdf', null)).toBe(true);
    expect(looksLikePdf('LISTE.PDF', '')).toBe(true);
    expect(looksLikePdf('scan', 'application/pdf')).toBe(true);
    expect(looksLikePdf('photo.jpg', 'image/jpeg')).toBe(false);
  });

  it('strips a data URL down to the base64 the server expects', () => {
    expect(bareBase64('data:application/pdf;base64,JVBERi0x')).toBe('JVBERi0x');
    expect(bareBase64('JVBERi0x')).toBe('JVBERi0x');
  });

  it('turns a file away at the same size as the server does', () => {
    expect(server).toContain('SHOPPING_PDF_MAX_BYTES = 5 * 1024 * 1024');
    expect(PDF_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('picking one', () => {
  it('asks for PDFs only, one at a time, and reads the file it was given', async () => {
    mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/l.pdf', name: 'l.pdf', mimeType: 'application/pdf', size: 2000 }] });
    mockReadAsString.mockResolvedValue('JVBERi0x');
    await expect(pickPdf()).resolves.toEqual({ base64: 'JVBERi0x' });
    expect(mockGetDocument.mock.calls[0][0]).toMatchObject({ type: 'application/pdf', multiple: false });
    expect(mockReadAsString).toHaveBeenCalledWith('file:///cache/l.pdf', { encoding: 'base64' });
  });

  it('a cancelled pick is nothing, not an error', async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickPdf()).resolves.toBeNull();
  });

  it('says a heavy file is too large before uploading it', async () => {
    mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'x', name: 'big.pdf', mimeType: 'application/pdf', size: PDF_MAX_BYTES + 1 }] });
    await expect(pickPdf()).resolves.toEqual({ problem: 'too_large' });
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it('says a file that is not a PDF is not one', async () => {
    mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'x', name: 'photo.jpg', mimeType: 'image/jpeg', size: 10 }] });
    await expect(pickPdf()).resolves.toEqual({ problem: 'not_pdf' });
  });
});

describe('the scan sheet', () => {
  it('offers "Import a PDF" beside the camera and the gallery', () => {
    const camera = kitchen.indexOf('testID="scan-camera"');
    const gallery = kitchen.indexOf('testID="scan-gallery"');
    const pdf = kitchen.indexOf('testID="scan-pdf"');
    expect(camera).toBeGreaterThan(0);
    expect(pdf).toBeGreaterThan(gallery);
    expect(kitchen).toContain('onPress={pickScanPdf}');
  });

  it('sends the PDF to the shopping reader, into the same ticked review', () => {
    expect(api).toContain("body: { pdf_base64: pdfBase64 }");
    expect(kitchen).toContain('const { items } = await api.scanShoppingPdf(picked.base64);');
    expect(kitchen).toMatch(/scanShoppingPdf\(picked\.base64\);\s*setScanItems\(items\.map\(\(i\) => \(\{ \.\.\.i, checked: !i\.unsure \}\)\)\);/);
  });

  it('an empty allowance closes the sheet for a PDF exactly as for a photo', () => {
    expect(kitchen).toContain("scanFailed(e, 'scan_failed');");
    expect(kitchen).toContain("scanFailed(e, 'scan_pdf_failed');");
  });

  it('is worded in all four languages', () => {
    for (const key of ['scan_pdf', 'scan_pdf_failed', 'scan_pdf_too_large', 'scan_pdf_not_pdf', 'scan_pdf_again', 'scan_note_pdf']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain('scan_pdf: "Importer un PDF"');
  });
});
