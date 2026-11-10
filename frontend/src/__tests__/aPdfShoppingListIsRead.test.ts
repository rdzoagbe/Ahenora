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

import { bareBase64, plainlyNotPdf, pickPdf, PDF_MAX_BYTES } from '../pickPdf';

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
  it('turns away only what is plainly something else', () => {
    expect(plainlyNotPdf('liste.pdf', null)).toBe(false);
    expect(plainlyNotPdf('LISTE.PDF', '')).toBe(false);
    expect(plainlyNotPdf('scan', 'application/pdf')).toBe(false);
    expect(plainlyNotPdf('photo.jpg', 'image/jpeg')).toBe(true);
  });

  it('lets through a provider that says neither type nor name: the server reads the header', () => {
    expect(plainlyNotPdf('Liste courses', null)).toBe(false);
    expect(plainlyNotPdf('Liste courses', 'application/octet-stream')).toBe(false);
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

  it('does not read the file while picking it, so the size is checked first', async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    await pickPdf();
    expect(mockGetDocument.mock.calls[0][0]).toMatchObject({ base64: false });
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
    expect(kitchen).toContain("await readScan('pdf', () => api.scanShoppingPdf(base64));");
    expect(kitchen).toContain("await readScan('photo', () => api.scanShoppingList(base64));");
    // One review for both: unsure lines come unticked.
    expect(kitchen).toMatch(/const \{ items \} = await read\(\);\s*setScanItems\(items\.map\(\(i\) => \(\{ \.\.\.i, checked: !i\.unsure \}\)\)\);/);
  });

  it('a file that would not open is not told as "no connection"', () => {
    expect(kitchen).toMatch(/picked = await pickPdf\(\);\s*\} catch \(e: any\) \{[\s\S]{0,300}setScanError\(t\('scan_pdf_open_failed'\)\);/);
  });

  it('the server\'s "not a PDF" and "too large" are said as such', () => {
    expect(kitchen).toContain("setScanError(t(e.status === 413 ? 'scan_pdf_too_large' : 'scan_pdf_not_pdf'));");
  });

  it('an empty allowance closes the sheet for a PDF exactly as for a photo', () => {
    expect(kitchen).toContain("scanFailed(e, 'scan_failed');");
    expect(kitchen).toContain("scanFailed(e, 'scan_pdf_failed');");
  });

  it('is worded in all four languages', () => {
    for (const key of ['scan_pdf', 'scan_pdf_failed', 'scan_pdf_too_large', 'scan_pdf_not_pdf', 'scan_pdf_open_failed', 'scan_pdf_again', 'scan_note_pdf']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain('scan_pdf: "Importer un PDF"');
  });
});
