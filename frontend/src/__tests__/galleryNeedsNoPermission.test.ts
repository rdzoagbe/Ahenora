/**
 * Choosing a picture from the gallery asks for no permission.
 *
 * expo-image-picker documents launchImageLibraryAsync as requiring
 * MEDIA_LIBRARY "on iOS 10 only"; on Android it opens the system photo
 * picker (PickVisualMedia), which needs none. Asking anyway was not harmless:
 * on Android 12 and older requestMediaLibraryPermissionsAsync asks for
 * READ_EXTERNAL_STORAGE, which this app removes on purpose (app.json
 * blockedPermissions), so it could never be granted and every gallery button
 * stopped there — shown as "no connection", because the thrown permission
 * message carried no HTTP status. Reported from a real phone, 2026-11-10:
 * "when I choose from gallery it doesn't upload the images".
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(d.name) ? [full] : [];
  });
}

describe('the gallery', () => {
  it('is never gated on a media-library permission, anywhere in the app', () => {
    const offenders = [...sources(path.join(root, 'src')), ...sources(path.join(root, 'app'))]
      .filter((f) => fs.readFileSync(f, 'utf8').includes('requestMediaLibraryPermissionsAsync'));
    expect(offenders).toEqual([]);
  });

  it('is right to: the app removes the storage permission that request would need', () => {
    const app = JSON.parse(read('app.json'));
    expect(app.expo.android.blockedPermissions).toEqual(expect.arrayContaining([
      'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.READ_MEDIA_IMAGES']));
    const picker = read('node_modules', 'expo-image-picker', 'build', 'ImagePicker.d.ts');
    expect(picker).toContain('Requires `Permissions.MEDIA_LIBRARY` on iOS 10 only.');
  });
});

describe('the shopping-list photo', () => {
  const kitchen = read('app', '(tabs)', 'kitchen.tsx');

  it('never gives up in silence when no picture data came back', () => {
    expect(kitchen).toContain("if (!base64) throw new Error('no picture data');");
    expect(kitchen).toContain("setScanError(t('scan_photo_open_failed'));");
  });

  it('reads the cached copy when the picker returned none', () => {
    expect(kitchen).toMatch(/if \(!base64 && asset\.uri && Platform\.OS !== 'web'\) \{[\s\S]{0,300}readAsStringAsync\(asset\.uri/);
  });

  it('says a refused camera permission as such, not as "no connection"', () => {
    expect(kitchen).toMatch(/if \(!p\.granted\) \{\s*setScanError\(t\('cam_camera_permission_denied'\)\);\s*return;/);
  });

  it('leaves a trace in the admin panel when a photo could not be got or read', () => {
    expect(kitchen).toContain('reportScanProblem(source, e?.message || String(e));');
    expect(kitchen).toContain("if (e?.status && e.status !== 402) reportScanProblem(`${source} read`, `status ${e.status}`);");
  });
});
