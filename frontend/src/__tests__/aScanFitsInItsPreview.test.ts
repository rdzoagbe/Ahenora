/**
 * A scanned page shows whole in the vault preview.
 *
 * The preview drew the image in a fixed 3:4 box in "cover" mode. A photograph
 * with table around the page still showed the page; a scan cropped tightly to
 * the page lost its top and bottom. Roland: "I can not open it to see the
 * entire doc."
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const VAULT = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'vault.tsx'), 'utf8');

describe('the vault preview', () => {
  it('scales the page to fit rather than cropping it', () => {
    const img = VAULT.slice(VAULT.indexOf('testID="preview-image"'), VAULT.indexOf('testID="preview-image"') + 300);
    expect(img).toContain('resizeMode="contain"');
    // No fixed shape: a portrait letter, a landscape receipt and a square
    // photo all fit, each at its own proportion.
    expect(VAULT).not.toMatch(/previewImg: \{[^}]*aspectRatio/);
  });

  it('offers the phone viewer, where pinch-to-zoom lives, on an image too', () => {
    const block = VAULT.slice(VAULT.indexOf('isImageDoc(preview) ? ('), VAULT.indexOf('isPdfDoc(preview) && !pdfFailed'));
    expect(block).toContain('testID="preview-open-ext"');
    expect(block).toContain('openDoc(preview)');
  });
});
