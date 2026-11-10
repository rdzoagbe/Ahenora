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
    expect(API).toContain('? { image_base64: imagesBase64[0] }');
    expect(API).toContain(": { images_base64: imagesBase64, ...(readToken ? { read_token: readToken } : {}) },");
  });

  it('reads the parts so far together with the new one', () => {
    expect(SPENDING).toContain('const pictures = [...parts, ...added];');
    expect(SPENDING).toContain("await readReceipt(() => api.scanReceipt(pictures, scan?.read_token), pictures, 'photo', previous);");
  });

  it('sends the token from the earlier read, so the rest is not a second scan', () => {
    expect(API).toContain('read_token?: string;');
    expect(SPENDING).toContain('api.scanReceipt(pictures, scan?.read_token)');
  });

  it('keeps what the person already decided in the review', () => {
    expect(SPENDING).toContain('const previous = scan ? { scan, keep, shop, amount, when } : undefined;');
    expect(SPENDING).toContain('setKeep(result.items.map((i) => !i.unsure && !untickedBefore.has(i.name)));');
    expect(SPENDING).toContain("setShop(previous && previous.shop !== (previous.scan.shop || '') ? previous.shop : (result.shop || ''));");
  });

  it('says a failed part by the button, not at the top of the screen', () => {
    expect(SPENDING).toContain('testID="exp-scan-review-error"');
    expect(SPENDING).toContain('{scanError && !scan ? <Text style={styles.scanErr}>{scanError}</Text> : null}');
  });

  it('offers the rest only while there is room, the same three as the server', () => {
    expect(SERVER).toContain('RECEIPT_MAX_PARTS = 3');
    expect(SPENDING).toContain('const RECEIPT_MAX_PARTS = 3;');
    expect(SPENDING).toContain('parts.length > 0 && parts.length < (scan.max_parts ?? RECEIPT_MAX_PARTS)');
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

describe('the scanner', () => {
  it('shoots a long receipt in pages, up to what one receipt can be read from', () => {
    expect(SPENDING).toContain("where: '/expenses/scan-receipt', allowsEditing: true, scanner: { maxPages: room },");
    expect(SPENDING).toContain('const pages = await pickReceiptPages(source, RECEIPT_MAX_PARTS);');
    expect(SPENDING).toContain('await readReceipt(() => api.scanReceipt(pages), pages, \'photo\');');
  });

  it('adds only as many pages as there is room for, and says when an iPhone gave more', () => {
    expect(SPENDING).toContain('const room = (scan?.max_parts ?? RECEIPT_MAX_PARTS) - parts.length;');
    expect(SPENDING).toContain('setPagesCapped(picked.pages.length > room ? room : 0);');
    expect(SPENDING).toContain('return picked.pages.slice(0, room);');
    expect((I18N.match(/^\s*exp_scan_pages_capped:/gm) || []).length).toBe(4);
  });
});

describe('a receipt as a file', () => {
  it('reads a PDF as a PDF and a picture as a photo', () => {
    expect(API).toContain('body: { pdf_base64: pdfBase64 }');
    expect(SPENDING).toContain("if (kind === 'pdf') await readReceipt(() => api.scanReceiptPdf(base64), [], 'file');");
    expect(SPENDING).toContain("else await readReceipt(() => api.scanReceipt([base64]), [base64], 'file');");
  });

  it('says a file it cannot use in the sheet\'s own words', () => {
    expect(SPENDING).toContain("setScanError(t('scan_file_open_failed'));");
    expect(SPENDING).toContain("t(from === 'file' ? 'scan_file_too_large' : 'exp_scan_photos_too_large')");
    expect(SPENDING).toContain("t(from === 'file' ? 'scan_file_not_supported' : 'scan_photo_open_failed')");
  });
});

describe('what the review says', () => {
  it('fills the sum of the lines when no total was read, and says so', () => {
    expect(SPENDING).toContain('const figure = r.total ?? r.lines_total;');
    expect(SPENDING).toContain("t('exp_scan_no_total', { lines: money(scan.lines_total) })");
  });

  it('shows the mismatch only against a printed total, never against a missing one', () => {
    expect(SPENDING).toContain('{scan.reconciles === false ? (');
  });

  it('says lines it could not read apart from lines past the limit', () => {
    expect(SPENDING).toContain("t('exp_scan_missed', { n: scan.skipped ?? 0 })");
    expect(SPENDING).toContain("t('exp_scan_left_out', { n: scan.left_out ?? 0 })");
  });

  it('is worded in all four languages', () => {
    for (const key of ['exp_scan_file', 'exp_scan_no_total', 'exp_scan_missed', 'exp_scan_parts',
      'exp_scan_add_part', 'exp_scan_add_part_hint', 'exp_scan_left_out', 'exp_scan_photos_too_large']) {
      expect((I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(I18N).toContain("exp_scan_add_part: 'Ajouter la suite du ticket'");
  });
});
