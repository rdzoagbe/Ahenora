/**
 * Every picture in the app comes through pickPicture, and the gallery asks
 * for no permission. Why, and what went wrong before: see pickPicture.ts.
 * Reported from a real phone, 2026-11-10: "when I choose from gallery it
 * doesn't upload the images".
 */
import fs from 'fs';
import path from 'path';

let mockOS = 'android';
const mockCameraPermission = jest.fn();
const mockLibraryPermission = jest.fn();
const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockReadAsString = jest.fn();
const mockReport = jest.fn();

jest.mock('react-native', () => ({ Platform: { get OS() { return mockOS; } } }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...a: unknown[]) => mockCameraPermission(...a),
  requestMediaLibraryPermissionsAsync: (...a: unknown[]) => mockLibraryPermission(...a),
  launchCameraAsync: (...a: unknown[]) => mockLaunchCamera(...a),
  launchImageLibraryAsync: (...a: unknown[]) => mockLaunchLibrary(...a),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (...a: unknown[]) => mockReadAsString(...a),
  EncodingType: { Base64: 'base64' },
}), { virtual: true });
jest.mock('../api', () => ({ reportPictureProblem: (...a: unknown[]) => mockReport(...a) }));
const mockScanPages = jest.fn();
jest.mock('../documentScanner', () => ({ scanDocumentPages: (...a: unknown[]) => mockScanPages(...a) }));

import { pickPicture } from '../pickPicture';

const chosen = (asset: Record<string, unknown>) => ({ canceled: false, assets: [{ uri: 'file:///cache/p.jpg', ...asset }] });

beforeEach(() => {
  mockOS = 'android';
  [mockCameraPermission, mockLibraryPermission, mockLaunchCamera, mockLaunchLibrary, mockReadAsString, mockReport, mockScanPages]
    .forEach((m) => m.mockReset());
  mockCameraPermission.mockResolvedValue({ granted: true });
});

describe('the gallery', () => {
  it('opens without asking for any permission', async () => {
    mockLaunchLibrary.mockResolvedValue(chosen({ base64: 'AAAA', fileName: 'liste.jpg' }));
    await expect(pickPicture('library', { where: '/shopping/scan' }))
      .resolves.toEqual({ base64: 'AAAA', fileName: 'liste.jpg', pages: ['AAAA'], dropped: 0 });
    expect(mockLibraryPermission).not.toHaveBeenCalled();
    expect(mockCameraPermission).not.toHaveBeenCalled();
  });

  it('reads the picker\'s cached copy when no contents came back with the picture', async () => {
    mockLaunchLibrary.mockResolvedValue(chosen({ base64: null }));
    mockReadAsString.mockResolvedValue('BBBB');
    await expect(pickPicture('library', { where: '/shopping/scan' })).resolves.toMatchObject({ base64: 'BBBB' });
    expect(mockReadAsString).toHaveBeenCalledWith('file:///cache/p.jpg', { encoding: 'base64' });
  });

  it('never sends a file path up as if it were the picture: no contents is "unreadable", and reported', async () => {
    mockLaunchLibrary.mockResolvedValue(chosen({ base64: null }));
    mockReadAsString.mockRejectedValue(new Error('ENOENT'));
    await expect(pickPicture('library', { where: '/vision/extract' })).resolves.toEqual({ problem: 'unreadable' });
    expect(mockReport).toHaveBeenCalledWith('/vision/extract', 'library: ENOENT');
  });

  it('a picker that fails is "unreadable", reported, never thrown as a network error', async () => {
    mockLaunchLibrary.mockRejectedValue(new Error('picker crashed'));
    await expect(pickPicture('library', { where: '/vault' })).resolves.toEqual({ problem: 'unreadable' });
    expect(mockReport).toHaveBeenCalledWith('/vault', 'library: picker crashed');
  });

  it('a cancelled pick is nothing, and nothing is reported', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickPicture('library', { where: '/vault' })).resolves.toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('on the web, takes the data URL the browser hands back', async () => {
    mockOS = 'web';
    mockLaunchLibrary.mockResolvedValue(chosen({ base64: null, uri: 'data:image/png;base64,CCCC' }));
    await expect(pickPicture('library', { where: '/shopping/scan' })).resolves.toMatchObject({ base64: 'CCCC' });
    expect(mockReadAsString).not.toHaveBeenCalled();
  });
});

describe('the camera', () => {
  it('asks for the camera, and a refusal is a named problem, not a thrown error', async () => {
    mockCameraPermission.mockResolvedValue({ granted: false });
    await expect(pickPicture('camera', { where: '/shopping/scan' })).resolves.toEqual({ problem: 'camera_denied' });
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it('passes the crop step and quality through', async () => {
    mockLaunchCamera.mockResolvedValue(chosen({ base64: 'DDDD' }));
    await pickPicture('camera', { where: '/expenses/scan-receipt', allowsEditing: true, quality: 0.6 });
    expect(mockLaunchCamera.mock.calls[0][0]).toMatchObject({ base64: true, allowsEditing: true, quality: 0.6 });
  });
});

describe('the document scanner', () => {
  it('frames the paper itself: pages come back read, top to bottom', async () => {
    mockScanPages.mockResolvedValue({ kind: 'scanned', uris: ['file:///s/1.jpg', 'file:///s/2.jpg'] });
    mockReadAsString.mockImplementation(async (uri: string) => (uri.endsWith('1.jpg') ? 'P1' : 'P2'));
    await expect(pickPicture('camera', { where: '/expenses/scan-receipt', scanner: { maxPages: 3 } }))
      .resolves.toEqual({ base64: 'P1', fileName: null, pages: ['P1', 'P2'], dropped: 0 });
    expect(mockScanPages).toHaveBeenCalledWith(3);
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it('keeps no more pages than asked, and counts the rest (an iPhone has no cap)', async () => {
    mockOS = 'ios';
    mockScanPages.mockResolvedValue({ kind: 'scanned', uris: ['a', 'b', 'c', 'd', 'e'] });
    mockReadAsString.mockImplementation(async (uri: string) => `P-${uri}`);
    await expect(pickPicture('camera', { where: '/expenses/scan-receipt', scanner: { maxPages: 3 } }))
      .resolves.toEqual({ base64: 'P-a', fileName: null, pages: ['P-a', 'P-b', 'P-c'], dropped: 2 });
    expect(mockReadAsString).toHaveBeenCalledTimes(3);   // the dropped pages are not even read
  });

  it("opens Android's scanner without asking for the app's own camera permission", async () => {
    mockCameraPermission.mockResolvedValue({ granted: false });
    mockScanPages.mockResolvedValue({ kind: 'scanned', uris: ['file:///s/1.jpg'] });
    mockReadAsString.mockResolvedValue('P1');
    await expect(pickPicture('camera', { where: '/shopping/scan', scanner: { maxPages: 1 } }))
      .resolves.toMatchObject({ pages: ['P1'] });
    expect(mockCameraPermission).not.toHaveBeenCalled();
  });

  it('backing out of the scanner is nothing, and no second camera opens', async () => {
    mockScanPages.mockResolvedValue({ kind: 'cancelled' });
    await expect(pickPicture('camera', { where: '/shopping/scan', scanner: { maxPages: 1 } })).resolves.toBeNull();
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it('where there is no scanner, the plain camera opens as before', async () => {
    mockScanPages.mockResolvedValue({ kind: 'unavailable' });
    mockLaunchCamera.mockResolvedValue(chosen({ base64: 'CAM' }));
    await expect(pickPicture('camera', { where: '/shopping/scan', scanner: { maxPages: 1 } }))
      .resolves.toMatchObject({ base64: 'CAM', pages: ['CAM'], dropped: 0 });
  });

  it('asks an iPhone for the camera first, and a refusal is the named problem', async () => {
    mockOS = 'ios';
    mockCameraPermission.mockResolvedValue({ granted: false });
    await expect(pickPicture('camera', { where: '/shopping/scan', scanner: { maxPages: 1 } }))
      .resolves.toEqual({ problem: 'camera_denied' });
    expect(mockScanPages).not.toHaveBeenCalled();
  });

  it('is never used for the gallery, or on the web', async () => {
    mockLaunchLibrary.mockResolvedValue(chosen({ base64: 'LIB' }));
    await pickPicture('library', { where: '/shopping/scan', scanner: { maxPages: 1 } });
    mockOS = 'web';
    mockLaunchCamera.mockResolvedValue(chosen({ base64: null, uri: 'data:image/png;base64,WEB' }));
    await pickPicture('camera', { where: '/shopping/scan', scanner: { maxPages: 1 } });
    expect(mockScanPages).not.toHaveBeenCalled();
  });

  it('a scanned page that cannot be read is "unreadable", and reported', async () => {
    mockScanPages.mockResolvedValue({ kind: 'scanned', uris: ['file:///s/1.jpg'] });
    mockReadAsString.mockRejectedValue(new Error('gone'));
    await expect(pickPicture('camera', { where: '/shopping/scan', scanner: { maxPages: 1 } }))
      .resolves.toEqual({ problem: 'unreadable' });
    expect(mockReport).toHaveBeenCalledWith('/shopping/scan', 'camera: gone');
  });

  it('is what the shopping-list, recipe, receipt and Home cameras open', () => {
    const kitchen = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
    const camera = fs.readFileSync(path.join(__dirname, '..', 'components', 'CameraCaptureModal.tsx'), 'utf8');
    expect(kitchen).toContain("pickPicture(source, { where: '/shopping/scan', scanner: { maxPages: 1 } })");
    expect(kitchen).toContain("pickPicture(source, { where: '/meals/capture', scanner: { maxPages: 1 } })");
    expect(camera).toContain("pickPicture(source, { where: '/vision/extract', allowsEditing: true, scanner: { maxPages: 1 } })");
    // And says so when an iPhone shot more pages than are read.
    expect((kitchen.match(/if \(picked\.dropped > 0\) showToast\(t\('scan_first_page_only'\), 'info'\);/g) || []).length).toBe(2);
  });

  it('is only ever reached through the guarded wrapper', () => {
    const camera = fs.readFileSync(path.join(__dirname, '..', 'components', 'CameraCaptureModal.tsx'), 'utf8');
    expect(camera).not.toContain('scanDocument(');
  });
});

describe('the app', () => {
  const root = path.join(__dirname, '..', '..');
  const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(d.name) ? [full] : [];
  });
  const files = [...sources(path.join(root, 'src')), ...sources(path.join(root, 'app'))];

  it('never gates a picture on a media-library permission', () => {
    expect(files.filter((f) => fs.readFileSync(f, 'utf8').includes('requestMediaLibraryPermissionsAsync('))).toEqual([]);
  });

  it('opens the camera and the gallery in one place only', () => {
    const openers = files.filter((f) => /launch(Camera|ImageLibrary)Async\(/.test(fs.readFileSync(f, 'utf8')));
    expect(openers.map((f) => path.basename(f))).toEqual(['pickPicture.ts']);
  });
});
