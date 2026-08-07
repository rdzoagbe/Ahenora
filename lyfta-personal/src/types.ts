// ─── Core domain types ───────────────────────────────────────────────────────
// Everything lives on-device. IDs are strings so we never worry about a server.

export type MuscleGroup =
  | 'Chest'
  | 'Back'
  | 'Shoulders'
  | 'Biceps'
  | 'Triceps'
  | 'Legs'
  | 'Glutes'
  | 'Core'
  | 'Cardio'
  | 'Other';

export type Equipment =
  | 'Barbell'
  | 'Dumbbell'
  | 'Machine'
  | 'Cable'
  | 'Bodyweight'
  | 'Kettlebell'
  | 'Band'
  | 'Other';

export interface Exercise {
  id: string;
  name: string;
  muscle: MuscleGroup;
  equipment: Equipment;
  /** Seeded exercises ship with the app; custom ones are user-created. */
  custom: boolean;
  /** How the exercise is measured. Most lifts are weight×reps. */
  tracks: 'weightReps' | 'bodyweightReps' | 'duration';
}

/**
 * A set is one entry in the log. `type` mirrors Lyfta's set kinds — warmups and
 * dropsets are excluded from PR/volume math so a light warm-up never masquerades
 * as a personal record.
 */
export type SetType = 'normal' | 'warmup' | 'dropset' | 'failure';

export interface WorkoutSet {
  id: string;
  type: SetType;
  /** kg (or lb — the app is unit-agnostic; you pick one and stay with it). */
  weight: number;
  reps: number;
  /** Seconds, only used by duration-tracked exercises. */
  seconds?: number;
  done: boolean;
}

export interface LoggedExercise {
  /** Local id for this instance within the workout. */
  id: string;
  exerciseId: string;
  sets: WorkoutSet[];
  note?: string;
}

export interface Workout {
  id: string;
  /** ISO timestamp of when the session started. */
  startedAt: string;
  /** ISO timestamp of when it was finished; absent while in progress. */
  endedAt?: string;
  title: string;
  entries: LoggedExercise[];
  note?: string;
}

export interface Settings {
  /** Label only — the app stores raw numbers and never converts. */
  unit: 'kg' | 'lb';
  /** Default rest timer length in seconds. */
  restSeconds: number;
  appearance: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  unit: 'kg',
  restSeconds: 90,
  appearance: 'system',
};
