import { LoggedExercise, Workout, WorkoutSet } from './types';

// ─── Strength math ───────────────────────────────────────────────────────────

/**
 * Epley estimated one-rep max: w * (1 + reps/30). It's the same formula Lyfta
 * and most trackers use for a single "how strong am I" number that lets you
 * compare a heavy triple against a lighter set of ten.
 */
export function estimatedOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** A set counts toward records/volume only if it's real, finished, and loaded. */
export function isWorkingSet(set: WorkoutSet): boolean {
  return set.done && set.type !== 'warmup' && set.weight > 0 && set.reps > 0;
}

/** Total load moved in one logged exercise: Σ weight × reps over working sets. */
export function exerciseVolume(entry: LoggedExercise): number {
  return entry.sets.reduce(
    (sum, s) => (isWorkingSet(s) ? sum + s.weight * s.reps : sum),
    0
  );
}

/** Total load moved across a whole workout. */
export function workoutVolume(workout: Workout): number {
  return workout.entries.reduce((sum, e) => sum + exerciseVolume(e), 0);
}

/** Best estimated 1RM reached for one exercise inside a single workout. */
export function bestOneRepMaxInEntry(entry: LoggedExercise): number {
  return entry.sets.reduce(
    (best, s) =>
      isWorkingSet(s) ? Math.max(best, estimatedOneRepMax(s.weight, s.reps)) : best,
    0
  );
}

/** Heaviest weight (any rep count) lifted for one exercise in a workout. */
export function topWeightInEntry(entry: LoggedExercise): number {
  return entry.sets.reduce(
    (best, s) => (isWorkingSet(s) ? Math.max(best, s.weight) : best),
    0
  );
}

export interface ExercisePoint {
  date: string; // ISO
  oneRepMax: number;
  topWeight: number;
  volume: number;
}

export interface PersonalRecords {
  bestOneRepMax: number;
  bestTopWeight: number;
  bestVolume: number; // best single-session volume for this exercise
}

/**
 * Walk every finished workout and pull the per-session progression for one
 * exercise, oldest first. This is what the Progress chart draws.
 */
export function exerciseProgress(
  workouts: Workout[],
  exerciseId: string
): ExercisePoint[] {
  const points: ExercisePoint[] = [];
  for (const w of workouts) {
    if (!w.endedAt) continue;
    for (const entry of w.entries) {
      if (entry.exerciseId !== exerciseId) continue;
      const orm = bestOneRepMaxInEntry(entry);
      const top = topWeightInEntry(entry);
      const vol = exerciseVolume(entry);
      if (orm === 0 && top === 0 && vol === 0) continue;
      points.push({
        date: w.endedAt,
        oneRepMax: Math.round(orm * 10) / 10,
        topWeight: top,
        volume: vol,
      });
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export function personalRecords(points: ExercisePoint[]): PersonalRecords {
  return {
    bestOneRepMax: points.reduce((m, p) => Math.max(m, p.oneRepMax), 0),
    bestTopWeight: points.reduce((m, p) => Math.max(m, p.topWeight), 0),
    bestVolume: points.reduce((m, p) => Math.max(m, p.volume), 0),
  };
}
