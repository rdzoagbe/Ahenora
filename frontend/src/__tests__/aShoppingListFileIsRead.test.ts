/**
 * A shopping list sent as a FILE — a PDF, or a JPG/PNG that is not in the
 * photo gallery — goes through the same scan sheet as a photo of one
 * (tests/test_a_pdf_shopping_list_is_read.py is the server's side).
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

import {
  bareBase64, decodedSize, isHeic, kindOf, plainlyUnsupported, pickListFile,
  IMAGE_MAX_BYTES, LIST_FILE_TYPES, PDF_MAX_BYTES,
} from '../pickListFile';

const root = path.join(__dirname, '..', '..', '..');
const kitchen = fs.readFileSync(path.join(root, 'frontend', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.ts'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'frontend', 'src', 'i18n.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend', 'server.py'), 'utf8');

const PDF_B64 = 'JVBERi0xLjQK';
const JPEG_B64 = '/9j/4AAQSkZJRg';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg';

const picked = (asset: Record<string, unknown>) =>
  mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/f', size: 2000, ...asset }] });

beforeEach(() => {
  mockGetDocument.mockReset();
  mockReadAsString.mockReset();
});

describe('what the file is', () => {
  it('is read from its first bytes, not its name', () => {
    expect(kindOf(PDF_B64)).toBe('pdf');
    expect(kindOf(JPEG_B64)).toBe('image');
    expect(kindOf(PNG_B64)).toBe('image');
    expect(kindOf('UEsDBBQ')).toBeNull(); // a .docx (zip)
  });

  it('finds a PDF header after a few stray bytes, as the server does', () => {
    expect(kindOf('77u/DQolUERGLTEuNwo=')).toBe('pdf');
  });

  it('knows an HEIC by its content, when the provider said neither type nor name', () => {
    expect(kindOf('AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWlj')).toBe('heic');
  });

  it('counts bytes exactly, padding and all, so a file at the limit is not refused', () => {
    expect(decodedSize('QQ==')).toBe(1);
    expect(decodedSize('QUI=')).toBe(2);
    expect(decodedSize('QUJD')).toBe(3);
    const atLimit = 'A'.repeat(Math.ceil((PDF_MAX_BYTES * 4) / 3) - 1) + '=';
    expect(decodedSize(atLimit)).toBeLessThanOrEqual(PDF_MAX_BYTES);
  });

  it('turns away only what is plainly something else before reading it', () => {
    expect(plainlyUnsupported('liste.pdf', null)).toBe(false);
    expect(plainlyUnsupported('liste.JPG', '')).toBe(false);
    expect(plainlyUnsupported('liste', 'image/png')).toBe(false);
    expect(plainlyUnsupported('Liste courses', null)).toBe(false);
    expect(plainlyUnsupported('Liste courses', 'application/octet-stream')).toBe(false);
    expect(plainlyUnsupported('liste.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
  });

  it('knows an iPhone HEIC photo, which belongs in the gallery', () => {
    expect(isHeic('IMG_0042.HEIC', null)).toBe(true);
    expect(isHeic('photo', 'image/heic')).toBe(true);
    expect(isHeic('photo.jpg', 'image/jpeg')).toBe(false);
  });

  it('strips a data URL down to the base64 the server expects', () => {
    expect(bareBase64('data:application/pdf;base64,JVBERi0x')).toBe('JVBERi0x');
    expect(bareBase64('JVBERi0x')).toBe('JVBERi0x');
  });

  it('holds the same limits as the server', () => {
    expect(server).toContain('SHOPPING_PDF_MAX_BYTES = 5 * 1024 * 1024');
    expect(PDF_MAX_BYTES).toBe(5 * 1024 * 1024);
    // 14 MB of base64 on the server is 10.5 MB of file; 10 MB leaves room.
    expect(server).toContain('MAX_IMAGE_B64_CHARS = 14 * 1024 * 1024');
    expect(IMAGE_MAX_BYTES).toBeLessThanOrEqual((14 * 1024 * 1024 * 3) / 4);
  });
});

describe('picking one', () => {
  it('offers PDFs and JPG/PNG pictures, one at a time, without reading them yet', async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    await pickListFile();
    expect(mockGetDocument.mock.calls[0][0]).toMatchObject({ type: LIST_FILE_TYPES, multiple: false, base64: false });
    expect(LIST_FILE_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
  });

  it('a PDF comes back as a PDF', async () => {
    picked({ name: 'l.pdf', mimeType: 'application/pdf' });
    mockReadAsString.mockResolvedValue(PDF_B64);
    await expect(pickListFile()).resolves.toEqual({ kind: 'pdf', base64: PDF_B64 });
    expect(mockReadAsString).toHaveBeenCalledWith('file:///cache/f', { encoding: 'base64' });
  });

  it('a JPG or PNG comes back as a picture', async () => {
    picked({ name: 'liste.jpg', mimeType: 'image/jpeg' });
    mockReadAsString.mockResolvedValue(JPEG_B64);
    await expect(pickListFile()).resolves.toEqual({ kind: 'image', base64: JPEG_B64 });
    picked({ name: 'liste.png', mimeType: 'image/png' });
    mockReadAsString.mockResolvedValue(PNG_B64);
    await expect(pickListFile()).resolves.toEqual({ kind: 'image', base64: PNG_B64 });
  });

  it('a file with no type and no name is recognised by what is inside', async () => {
    picked({ name: 'Liste courses', mimeType: null });
    mockReadAsString.mockResolvedValue(PDF_B64);
    await expect(pickListFile()).resolves.toEqual({ kind: 'pdf', base64: PDF_B64 });
  });

  it('a file called .pdf that is something else inside is not supported', async () => {
    picked({ name: 'liste.pdf', mimeType: 'application/pdf' });
    mockReadAsString.mockResolvedValue('UEsDBBQ');
    await expect(pickListFile()).resolves.toEqual({ problem: 'not_supported' });
  });

  it('an iPhone HEIC photo is sent to the gallery, before reading', async () => {
    picked({ name: 'IMG_0042.HEIC', mimeType: 'image/heic' });
    await expect(pickListFile()).resolves.toEqual({ problem: 'heic' });
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it('a heavy file is turned away before it is read', async () => {
    picked({ name: 'big.jpg', mimeType: 'image/jpeg', size: IMAGE_MAX_BYTES + 1 });
    await expect(pickListFile()).resolves.toEqual({ problem: 'too_large' });
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it('a file named PDF over the PDF limit is turned away before it is read', async () => {
    picked({ name: 'catalogue.pdf', mimeType: 'application/pdf', size: PDF_MAX_BYTES + 1 });
    await expect(pickListFile()).resolves.toEqual({ problem: 'too_large' });
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it('an HEIC with no type and no name is sent to the gallery too', async () => {
    picked({ name: 'IMG_1234', mimeType: 'application/octet-stream' });
    mockReadAsString.mockResolvedValue('AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWlj');
    await expect(pickListFile()).resolves.toEqual({ problem: 'heic' });
  });

  it('a PDF keeps the tighter limit, measured on what was read', async () => {
    picked({ name: 'big.pdf', mimeType: 'application/pdf', size: undefined });
    mockReadAsString.mockResolvedValue(PDF_B64 + 'A'.repeat(Math.ceil((PDF_MAX_BYTES * 4) / 3) + 8));
    await expect(pickListFile()).resolves.toEqual({ problem: 'too_large' });
  });

  it('a cancelled pick is nothing, not an error', async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickListFile()).resolves.toBeNull();
  });
});

describe('the scan sheet', () => {
  it('offers "Import a file" beside the camera and the gallery, and says what it takes', () => {
    const gallery = kitchen.indexOf('testID="scan-gallery"');
    const file = kitchen.indexOf('testID="scan-file"');
    expect(kitchen.indexOf('testID="scan-camera"')).toBeGreaterThan(0);
    expect(file).toBeGreaterThan(gallery);
    expect(kitchen).toContain('onPress={pickScanFile}');
    expect(kitchen).toContain("<Text style={styles.scanFileHint}>{t('scan_file_hint')}</Text>");
  });

  it('sends a PDF to the PDF reader and a picture to the photo reader, into one review', () => {
    expect(api).toContain('body: { pdf_base64: pdfBase64 }');
    expect(kitchen).toContain("if (kind === 'pdf') await readScan('pdf', () => api.scanShoppingPdf(base64));");
    expect(kitchen).toContain("else await readScan('image_file', () => api.scanShoppingList(base64));");
    expect(kitchen).toMatch(/const \{ items, left_out: leftOut \} = await read\(\);\s*setScanItems\(items\.map\(\(i\) => \(\{ \.\.\.i, checked: !i\.unsure \}\)\)\);/);
  });

  it('says when a long list went past the limit, instead of dropping the rest quietly', () => {
    expect(kitchen).toContain('setScanLeftOut(leftOut ?? 0);');
    expect(kitchen).toContain("t('scan_left_out', { n: scanLeftOut })");
  });

  it('after a file, offers another file rather than another photo, and says "your file"', () => {
    expect(kitchen).toContain("t(scanSource === 'photo' ? 'scan_retake' : 'scan_file_again')");
    expect(kitchen).toContain("scanSource === 'image_file' ? 'scan_note_file' : 'scan_note'");
  });

  it('a file that would not open is not told as "no connection"', () => {
    expect(kitchen).toMatch(/picked = await pickListFile\(\);\s*\} catch \(e: any\) \{[\s\S]{0,300}setScanError\(t\('scan_file_open_failed'\)\);/);
  });

  it('the server\'s "cannot open it" and "too large" are said as such', () => {
    expect(kitchen).toContain("setScanError(t(e.status === 413 ? 'scan_file_too_large' : 'scan_file_not_supported'));");
  });

  it('an empty allowance closes the sheet for a file exactly as for a photo', () => {
    expect(kitchen).toContain("scanFailed(e, kind === 'pdf' ? 'scan_pdf_failed' : 'scan_failed');");
    expect(kitchen).toContain("scanFailed(e, 'scan_failed');");
  });

  it('is worded in all four languages', () => {
    for (const key of ['scan_file', 'scan_file_hint', 'scan_file_too_large', 'scan_file_not_supported', 'scan_file_heic',
      'scan_file_open_failed', 'scan_file_again', 'scan_pdf_failed', 'scan_note_pdf', 'scan_note_file', 'scan_left_out']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain('scan_file: "Importer un fichier"');
  });
});
