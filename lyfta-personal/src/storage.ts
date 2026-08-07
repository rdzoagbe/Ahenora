import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, Exercise, Settings, Workout } from './types';
import { seedExercises } from './seedExercises';

// ─── Persistence ─────────────────────────────────────────────────────────────
// Three keys, three JSON blobs. That's the whole "database". For a personal
// tracker this is plenty: the entire log of a lifetime of training is a few
// hundred KB of JSON, and it stays on the device, offline, private.

const KEYS = {
  exercises: 'lyfta.exercises.v1',
  workouts: 'lyfta.workouts.v1',
  settings: 'lyfta.settings.v1',
  active: 'lyfta.active.v1',
} as const;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadExercises(): Promise<Exercise[]> {
  const stored = await readJson<Exercise[] | null>(KEYS.exercises, null);
  if (stored && stored.length > 0) {
    // Merge any seed lifts added in a newer app version without clobbering the
    // user's custom exercises or edits.
    const byId = new Map(stored.map((e) => [e.id, e]));
    for (const seed of seedExercises()) {
      if (!byId.has(seed.id)) byId.set(seed.id, seed);
    }
    return Array.from(byId.values());
  }
  const seeded = seedExercises();
  await writeJson(KEYS.exercises, seeded);
  return seeded;
}

export async function saveExercises(exercises: Exercise[]): Promise<void> {
  await writeJson(KEYS.exercises, exercises);
}

export async function loadWorkouts(): Promise<Workout[]> {
  return readJson<Workout[]>(KEYS.workouts, []);
}

export async function saveWorkouts(workouts: Workout[]): Promise<void> {
  await writeJson(KEYS.workouts, workouts);
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeJson(KEYS.settings, settings);
}

/**
 * The in-progress workout is persisted separately so that closing the app
 * mid-session — or the phone dying between sets — never loses the set you just
 * logged. It's promoted into the workouts list only when you finish.
 */
export async function loadActive(): Promise<Workout | null> {
  return readJson<Workout | null>(KEYS.active, null);
}

export async function saveActive(workout: Workout | null): Promise<void> {
  if (workout == null) {
    await AsyncStorage.removeItem(KEYS.active);
  } else {
    await writeJson(KEYS.active, workout);
  }
}

/** Everything, as one object — used by the Settings "export my data" action. */
export async function exportAll(): Promise<string> {
  const [exercises, workouts, settings] = await Promise.all([
    loadExercises(),
    loadWorkouts(),
    loadSettings(),
  ]);
  return JSON.stringify({ exercises, workouts, settings }, null, 2);
}
