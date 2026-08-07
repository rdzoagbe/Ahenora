import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import {
  Exercise,
  LoggedExercise,
  Settings,
  SetType,
  Workout,
  WorkoutSet,
} from './types';
import * as storage from './storage';
import { makeId } from './format';
import { AppTheme, resolveTheme } from './theme';

// ─── Store ───────────────────────────────────────────────────────────────────
// One context holds all app state. Every mutation writes through to AsyncStorage
// immediately, so there's no "save" button anywhere and no way to lose work.

interface StoreValue {
  ready: boolean;
  theme: AppTheme;

  exercises: Exercise[];
  workouts: Workout[]; // finished workouts, newest first
  active: Workout | null; // in-progress session, if any
  settings: Settings;

  // Exercise library
  addExercise: (e: Omit<Exercise, 'id' | 'custom'>) => Exercise;
  deleteExercise: (id: string) => void;
  exerciseById: (id: string) => Exercise | undefined;

  // Session lifecycle
  startWorkout: (title?: string) => void;
  discardWorkout: () => void;
  finishWorkout: () => void;
  setWorkoutTitle: (title: string) => void;
  setWorkoutNote: (note: string) => void;

  // Session contents
  addExerciseToWorkout: (exerciseId: string) => void;
  removeEntry: (entryId: string) => void;
  addSet: (entryId: string) => void;
  updateSet: (entryId: string, setId: string, patch: Partial<WorkoutSet>) => void;
  removeSet: (entryId: string, setId: string) => void;
  cycleSetType: (entryId: string, setId: string) => void;

  // History
  deleteWorkout: (id: string) => void;

  // Settings
  updateSettings: (patch: Partial<Settings>) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const SET_TYPE_ORDER: SetType[] = ['normal', 'warmup', 'dropset', 'failure'];

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [ready, setReady] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [active, setActive] = useState<Workout | null>(null);
  const [settings, setSettings] = useState<Settings>({
    unit: 'kg',
    restSeconds: 90,
    appearance: 'system',
  });

  // Initial hydrate.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [ex, wk, act, st] = await Promise.all([
        storage.loadExercises(),
        storage.loadWorkouts(),
        storage.loadActive(),
        storage.loadSettings(),
      ]);
      if (!alive) return;
      setExercises(ex);
      setWorkouts(sortWorkouts(wk));
      setActive(act);
      setSettings(st);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Persist-through helpers. Each keeps state and disk in lockstep.
  const persistExercises = useCallback((next: Exercise[]) => {
    setExercises(next);
    void storage.saveExercises(next);
  }, []);

  const persistWorkouts = useCallback((next: Workout[]) => {
    const sorted = sortWorkouts(next);
    setWorkouts(sorted);
    void storage.saveWorkouts(sorted);
  }, []);

  const persistActive = useCallback((next: Workout | null) => {
    setActive(next);
    void storage.saveActive(next);
  }, []);

  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    void storage.saveSettings(next);
  }, []);

  // Guard so mutations on the active session are always applied to the latest
  // snapshot even inside rapidly-fired callbacks.
  const activeRef = useRef<Workout | null>(active);
  activeRef.current = active;

  const mutateActive = useCallback(
    (fn: (w: Workout) => Workout) => {
      const current = activeRef.current;
      if (!current) return;
      const next = fn(current);
      persistActive(next);
    },
    [persistActive]
  );

  // ── Exercise library ──
  const addExercise = useCallback(
    (e: Omit<Exercise, 'id' | 'custom'>): Exercise => {
      const created: Exercise = { ...e, id: makeId('ex'), custom: true };
      persistExercises([...exercises, created]);
      return created;
    },
    [exercises, persistExercises]
  );

  const deleteExercise = useCallback(
    (id: string) => {
      persistExercises(exercises.filter((e) => e.id !== id));
    },
    [exercises, persistExercises]
  );

  const exerciseById = useCallback(
    (id: string) => exercises.find((e) => e.id === id),
    [exercises]
  );

  // ── Session lifecycle ──
  const startWorkout = useCallback(
    (title?: string) => {
      if (activeRef.current) return; // never clobber a session in progress
      const now = new Date().toISOString();
      persistActive({
        id: makeId('wk'),
        startedAt: now,
        title: title?.trim() || defaultTitle(),
        entries: [],
      });
    },
    [persistActive]
  );

  const discardWorkout = useCallback(() => {
    persistActive(null);
  }, [persistActive]);

  const finishWorkout = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    // Drop empty entries and sets that were never completed, so history stays
    // honest about what actually happened.
    const cleaned: Workout = {
      ...current,
      endedAt: new Date().toISOString(),
      entries: current.entries
        .map((entry) => ({
          ...entry,
          sets: entry.sets.filter((s) => s.done),
        }))
        .filter((entry) => entry.sets.length > 0),
    };
    if (cleaned.entries.length === 0) {
      // Nothing was actually logged — treat finishing as discarding.
      persistActive(null);
      return;
    }
    persistWorkouts([cleaned, ...workouts]);
    persistActive(null);
  }, [persistActive, persistWorkouts, workouts]);

  const setWorkoutTitle = useCallback(
    (title: string) => mutateActive((w) => ({ ...w, title })),
    [mutateActive]
  );

  const setWorkoutNote = useCallback(
    (note: string) => mutateActive((w) => ({ ...w, note })),
    [mutateActive]
  );

  // ── Session contents ──
  const addExerciseToWorkout = useCallback(
    (exerciseId: string) => {
      // Prefill from the last time this lift was performed in *history* so the
      // first set already shows last session's numbers.
      const historyTemplate = lastSetFor(workouts, exerciseId);
      mutateActive((w) => {
        const entry: LoggedExercise = {
          id: makeId('le'),
          exerciseId,
          sets: [freshSet(w, exerciseId, historyTemplate)],
        };
        return { ...w, entries: [...w.entries, entry] };
      });
    },
    [mutateActive, workouts]
  );

  const removeEntry = useCallback(
    (entryId: string) =>
      mutateActive((w) => ({
        ...w,
        entries: w.entries.filter((e) => e.id !== entryId),
      })),
    [mutateActive]
  );

  const addSet = useCallback(
    (entryId: string) =>
      mutateActive((w) => ({
        ...w,
        entries: w.entries.map((e) => {
          if (e.id !== entryId) return e;
          // Prefill from the last set in this entry — the fastest way to log a
          // straight-sets working block.
          const last = e.sets[e.sets.length - 1];
          const set: WorkoutSet = last
            ? { ...last, id: makeId('set'), done: false, type: 'normal' }
            : freshSet(w, e.exerciseId, null);
          return { ...e, sets: [...e.sets, set] };
        }),
      })),
    [mutateActive, exercises]
  );

  const updateSet = useCallback(
    (entryId: string, setId: string, patch: Partial<WorkoutSet>) =>
      mutateActive((w) => ({
        ...w,
        entries: w.entries.map((e) =>
          e.id !== entryId
            ? e
            : {
                ...e,
                sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
              }
        ),
      })),
    [mutateActive]
  );

  const removeSet = useCallback(
    (entryId: string, setId: string) =>
      mutateActive((w) => ({
        ...w,
        entries: w.entries.map((e) =>
          e.id !== entryId
            ? e
            : { ...e, sets: e.sets.filter((s) => s.id !== setId) }
        ),
      })),
    [mutateActive]
  );

  const cycleSetType = useCallback(
    (entryId: string, setId: string) =>
      mutateActive((w) => ({
        ...w,
        entries: w.entries.map((e) =>
          e.id !== entryId
            ? e
            : {
                ...e,
                sets: e.sets.map((s) => {
                  if (s.id !== setId) return s;
                  const idx = SET_TYPE_ORDER.indexOf(s.type);
                  const next = SET_TYPE_ORDER[(idx + 1) % SET_TYPE_ORDER.length];
                  return { ...s, type: next };
                }),
              }
        ),
      })),
    [mutateActive]
  );

  // ── History ──
  const deleteWorkout = useCallback(
    (id: string) => persistWorkouts(workouts.filter((w) => w.id !== id)),
    [workouts, persistWorkouts]
  );

  // ── Settings ──
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => persistSettings({ ...settings, ...patch }),
    [settings, persistSettings]
  );

  const theme = useMemo(() => {
    // RN's ColorSchemeName can be 'unspecified'; narrow it to what we support.
    const normalized = system === 'dark' ? 'dark' : system === 'light' ? 'light' : null;
    return resolveTheme(settings.appearance, normalized);
  }, [settings.appearance, system]);

  const value: StoreValue = {
    ready,
    theme,
    exercises,
    workouts,
    active,
    settings,
    addExercise,
    deleteExercise,
    exerciseById,
    startWorkout,
    discardWorkout,
    finishWorkout,
    setWorkoutTitle,
    setWorkoutNote,
    addExerciseToWorkout,
    removeEntry,
    addSet,
    updateSet,
    removeSet,
    cycleSetType,
    deleteWorkout,
    updateSettings,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function sortWorkouts(list: Workout[]): Workout[] {
  return [...list].sort((a, b) =>
    (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt)
  );
}

function defaultTitle(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Late-night session';
  if (h < 12) return 'Morning session';
  if (h < 17) return 'Afternoon session';
  return 'Evening session';
}

/**
 * A new set, prefilled from (in order of preference) an earlier entry for the
 * same exercise in the current session, then a template from history — the
 * "same as last time" default that makes logging feel instant.
 */
function freshSet(
  workout: Workout,
  exerciseId: string,
  historyTemplate: WorkoutSet | null
): WorkoutSet {
  const priorEntry = [...workout.entries]
    .reverse()
    .find((e) => e.exerciseId === exerciseId);
  const template = priorEntry?.sets[priorEntry.sets.length - 1] ?? historyTemplate;
  return {
    id: makeId('set'),
    type: 'normal',
    weight: template?.weight ?? 0,
    reps: template?.reps ?? 0,
    done: false,
  };
}

/** The last working set recorded for an exercise across finished workouts. */
function lastSetFor(workouts: Workout[], exerciseId: string): WorkoutSet | null {
  for (const w of workouts) {
    // workouts is newest-first, so the first match is the most recent.
    const entry = w.entries.find((e) => e.exerciseId === exerciseId);
    const set = entry?.sets[entry.sets.length - 1];
    if (set) return set;
  }
  return null;
}
