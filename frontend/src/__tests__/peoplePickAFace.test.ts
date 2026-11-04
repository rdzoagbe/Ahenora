/**
 * People pick a 3D face.
 *
 * Roland, 2026-11-03/04: the drawn heads did not look good next to the app's
 * paintings, the 3D faces he made in Google Gemini on his own account did.
 * This pins the set, the stored value, the picker and the provenance record.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const faces = read('src', 'faces.ts');
const avatar = read('src', 'components', 'PersonAvatar.tsx');
const member = read('app', 'member.tsx');
const DIR = path.join(__dirname, '..', '..', 'assets', 'images', 'faces');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const entries = [...faces.matchAll(/\{ id: '([a-z-]+)', group: '([a-z]+)', src: require\('\.\.\/assets\/images\/faces\/(face-[a-z-]+\.webp)'\) \}/g)]
  .map((m) => ({ id: m[1], group: m[2], file: m[3] }));

describe('the faces', () => {
  it('are 24, each with its own file on disk, named after its id', () => {
    expect(entries).toHaveLength(24);
    entries.forEach((e) => {
      expect(e.file).toBe(`face-${e.id}.webp`);
      expect(fs.existsSync(path.join(DIR, e.file))).toBe(true);
    });
  });

  it('never share an id, because a stored picture points at one', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('cover every group a household has', () => {
    const count = (g: string) => entries.filter((e) => e.group === g).length;
    expect([count('adults'), count('children'), count('teens'), count('elders')]).toEqual([12, 6, 2, 4]);
  });

  it('include the faces families asked to see themselves in', () => {
    const ids = entries.map((e) => e.id);
    ['woman-hijab', 'man-turban', 'man-locs', 'woman-braids', 'girl-puffs', 'grandma-headscarf', 'woman-grey-bob']
      .forEach((id) => expect(ids).toContain(id));
  });

  it('are small enough to ship over the air', () => {
    const total = entries.reduce((sum, e) => sum + fs.statSync(path.join(DIR, e.file)).size, 0);
    expect(total).toBeLessThan(400 * 1024);
  });

  it('carry a record of where they came from', () => {
    const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
    expect(readme).toMatch(/Google Gemini/);
    expect(readme).toMatch(/his own Google account/);
    expect(readme).toMatch(/Never rename or remove an id/);
  });
});

describe('a stored picture', () => {
  it('is face:<id>, so a photo URL and an older drawing still read as what they are', () => {
    expect(faces).toContain("export const FACE_PREFIX = 'face:';");
    expect(avatar).toContain('const face = faceFor(avatar);');
    expect(avatar).toContain('const illus = face ? null : parseAvatar(avatar);');
  });

  it('a drawing chosen before still renders on its owner', () => {
    expect(avatar).toMatch(/if \(illus\) \{\s*return \(/);
  });
});

describe('the picker', () => {
  it('offers the faces in groups, and the initial, and nothing else', () => {
    expect(avatar).toContain('faceGroupOrder(forChild).map((g) =>');
    expect(avatar).toContain("testID={`avatar-${id ? `face-${id}` : 'none'}`}");
    expect(avatar).not.toMatch(/AVATAR_KINDS\.map/);
    expect(avatar).not.toMatch(/avatar-tone-/);
  });

  it("shows a child's own faces first on a child's page", () => {
    expect(faces).toContain("return forChild ? ['children', 'teens', 'adults', 'elders']");
    expect(member).toContain('forChild={showsStars}');
  });
});

describe('every new string exists in all four languages', () => {
  it.each(['avatar_group_adults', 'avatar_group_children', 'avatar_group_teens', 'avatar_group_elders', 'avatar_face_n'])('%s', (key) => {
    LANGS.forEach((lang) => {
      expect(`${lang}.${key}: ${(TRANSLATIONS[lang] as Record<string, string>)[key] ?? ''}`).not.toMatch(/: $/);
    });
  });
});
