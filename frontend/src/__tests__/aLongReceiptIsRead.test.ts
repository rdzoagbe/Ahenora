/**
 * A long receipt on the Dépenses screen: in parts, or as a file, and said
 * honestly when no total was read (tests/test_a_long_receipt_is_read.py is
 * the server's side).
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const SPENDING = fs.readFileSync(path.join(root, 'src', 'components', 'SpendingView.tsx'), 'utf8');
const API = fs.readFileSync(path.join(root, 'src', 'api.ts'), 'utf8');
const I18N = fs.readFileSync(path.join(root, 'src', 'i18n.ts'), 'utf8');
const SERVER = fs.readFileSync(path.join(root, '..', 'backend', 'server.py'), 'utf8');

describe('a receipt in parts', () => {
  it('sends one photo as before, and several as one receipt', () => {
    expect(API).toContain('body: imagesBase64.length === 1 ? { image_base64: imagesBase64[0] } : { images_base64: imagesBase64 }');
  });

  it('reads the parts so far together with the new one', () => {
    expect(SPENDING).toContain('const pictures = [...parts, base64];');
    expect(SPENDING).toContain('await readReceipt(() => api.scanReceipt(pictures), pictures);');
  });

  it('offers the rest only while there is room, the same three as the server', () => {
    expect(SERVER).toContain('RECEIPT_MAX_PARTS = 3');
    expect(SPENDING).toContain('const RECEIPT_MAX_PARTS = 3;');
    expect(SPENDING).toContain('parts.length > 0 && parts.length < RECEIPT_MAX_PARTS');
  });

  it('keeps the review it had when the next part could not be read', () => {
    // The review is only replaced inside the success path.
    const body = SPENDING.slice(SPENDING.indexOf('const readReceipt = useCallback'), SPENDING.indexOf('const pickReceiptPhoto'));
    expect(body.indexOf('setScan(result);')).toBeLessThan(body.indexOf('} catch (e: any) {'));
  });

  it('forgets the parts when the receipt is saved or put away', () => {
    expect(SPENDING).toContain('setScan(null); setKeep([]); setParts([]);');
    expect(SPENDING).toMatch(/setScan\(null\);\s*setParts\(\[\]\);/);
  });
});

describe('a receipt as a file', () => {
  it('reads a PDF as a PDF and a picture as a photo', () => {
    expect(API).toContain('body: { pdf_base64: pdfBase64 }');
    expect(SPENDING).toContain("if (kind === 'pdf') await readReceipt(() => api.scanReceiptPdf(base64), []);");
    expect(SPENDING).toContain('else await readReceipt(() => api.scanReceipt([base64]), [base64]);');
  });

  it('says a file it cannot use in the sheet\'s own words', () => {
    expect(SPENDING).toContain("setScanError(t('scan_file_open_failed'));");
    expect(SPENDING).toContain("e?.status === 413 ? t('scan_file_too_large')");
  });
});

describe('what the review says', () => {
  it('fills the sum of the lines when no total was read, and says so', () => {
    expect(SPENDING).toContain('const figure = result.total ?? result.lines_total;');
    expect(SPENDING).toContain("t('exp_scan_no_total', { lines: money(scan.lines_total) })");
  });

  it('shows the mismatch only against a printed total, never against a missing one', () => {
    expect(SPENDING).toContain('{scan.reconciles === false ? (');
  });

  it('says how many lines it could not read', () => {
    expect(SPENDING).toContain("t('exp_scan_missed', { n: (scan.skipped ?? 0) + (scan.left_out ?? 0) })");
  });

  it('is worded in all four languages', () => {
    for (const key of ['exp_scan_file', 'exp_scan_no_total', 'exp_scan_missed', 'exp_scan_parts',
      'exp_scan_add_part', 'exp_scan_add_part_hint']) {
      expect((I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(I18N).toContain("exp_scan_add_part: 'Ajouter la suite du ticket'");
  });
});
