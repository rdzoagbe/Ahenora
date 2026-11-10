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

import { pickPicture } from '../pickPicture';

const chosen = (asset: Record<string, unknown>) => ({ canceled: false, assets: [{ uri: 'file:///cache/p.jpg', ...asset }] });

beforeEach(() => {
  mockOS = 'android';
  [mockCameraPermission, mockLibraryPermission, mockLaunchCamera, mockLaunchLibrary, mockReadAsString, mockReport]
    .forEach((m) => m.mockReset());
  mockCameraPermission.mockResolvedValue({ granted: true });
});

describe('the gallery', () => {
  it('opens without asking for any permission', async () => {
    mockLaunchLibrary.mockResolvedValue(chosen({ base64: 'AAAA', fileName: 'liste.jpg' }));
    await expect(pickPicture('library', { where: '/shopping/scan' }))
      .resolves.toEqual({ base64: 'AAAA', fileName: 'liste.jpg' });
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
