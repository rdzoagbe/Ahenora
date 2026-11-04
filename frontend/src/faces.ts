import type { ImageSourcePropType } from 'react-native';

/**
 * The 3D faces a person picks for their picture.
 *
 * Roland, 2026-11-03: the drawn heads did not look good next to the app's
 * paintings, and the 3D faces he made did. He generated them with Google
 * Gemini on his own account (provenance in assets/images/faces/README.md);
 * each sheet was cut into one face per file at 384 px.
 *
 * Stored on a member as `face:<id>`, so a photo URL still reads as a URL and
 * a drawing chosen before this (`illus:…`) still renders as it was. The ids
 * are permanent: a stored value must never point at nothing.
 */
export const FACE_PREFIX = 'face:';

export type FaceGroup = 'adults' | 'children' | 'teens' | 'elders';

export type Face = { id: string; group: FaceGroup; src: ImageSourcePropType };

export const FACES: Face[] = [
  { id: 'woman-curls', group: 'adults', src: require('../assets/images/faces/face-woman-curls.webp') },
  { id: 'man-beard', group: 'adults', src: require('../assets/images/faces/face-man-beard.webp') },
  { id: 'woman-hijab', group: 'adults', src: require('../assets/images/faces/face-woman-hijab.webp') },
  { id: 'man-bald-beard', group: 'adults', src: require('../assets/images/faces/face-man-bald-beard.webp') },
  { id: 'woman-long-hair', group: 'adults', src: require('../assets/images/faces/face-woman-long-hair.webp') },
  { id: 'man-locs', group: 'adults', src: require('../assets/images/faces/face-man-locs.webp') },
  { id: 'woman-red-bun', group: 'adults', src: require('../assets/images/faces/face-woman-red-bun.webp') },
  { id: 'man-turban', group: 'adults', src: require('../assets/images/faces/face-man-turban.webp') },
  { id: 'woman-braids', group: 'adults', src: require('../assets/images/faces/face-woman-braids.webp') },
  { id: 'man-glasses', group: 'adults', src: require('../assets/images/faces/face-man-glasses.webp') },
  { id: 'woman-grey-bob', group: 'adults', src: require('../assets/images/faces/face-woman-grey-bob.webp') },
  { id: 'man-grey-curls', group: 'adults', src: require('../assets/images/faces/face-man-grey-curls.webp') },
  { id: 'girl-puffs', group: 'children', src: require('../assets/images/faces/face-girl-puffs.webp') },
  { id: 'boy-cap', group: 'children', src: require('../assets/images/faces/face-boy-cap.webp') },
  { id: 'girl-braid', group: 'children', src: require('../assets/images/faces/face-girl-braid.webp') },
  { id: 'boy-headphones', group: 'children', src: require('../assets/images/faces/face-boy-headphones.webp') },
  { id: 'girl-bob', group: 'children', src: require('../assets/images/faces/face-girl-bob.webp') },
  { id: 'boy-curls', group: 'children', src: require('../assets/images/faces/face-boy-curls.webp') },
  { id: 'teen-girl', group: 'teens', src: require('../assets/images/faces/face-teen-girl.webp') },
  { id: 'teen-boy', group: 'teens', src: require('../assets/images/faces/face-teen-boy.webp') },
  { id: 'grandma-bun', group: 'elders', src: require('../assets/images/faces/face-grandma-bun.webp') },
  { id: 'grandpa-moustache', group: 'elders', src: require('../assets/images/faces/face-grandpa-moustache.webp') },
  { id: 'grandma-headscarf', group: 'elders', src: require('../assets/images/faces/face-grandma-headscarf.webp') },
  { id: 'grandpa-glasses', group: 'elders', src: require('../assets/images/faces/face-grandpa-glasses.webp') },
];

/** The groups in the order the picker shows them: a child's own face first on a child's page. */
export function faceGroupOrder(forChild: boolean): FaceGroup[] {
  return forChild ? ['children', 'teens', 'adults', 'elders'] : ['adults', 'elders', 'teens', 'children'];
}

export function faceValue(id: string): string {
  return `${FACE_PREFIX}${id}`;
}

/** The face a stored value names, or null for anything else (a drawing, a photo URL, nothing). */
export function faceFor(value?: string | null): Face | null {
  if (!value || !value.startsWith(FACE_PREFIX)) return null;
  const id = value.slice(FACE_PREFIX.length);
  return FACES.find((f) => f.id === id) ?? null;
}
