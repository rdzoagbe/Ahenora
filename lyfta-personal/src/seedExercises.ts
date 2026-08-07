import { Exercise } from './types';

// A small, opinionated starter library — the lifts most people actually log.
// You add your own from the Exercises tab; these just mean the app is useful
// the moment it opens. (Lyfta ships 1,400 with GIFs; for "just for me" a clean
// ~60 you'll actually use beats a wall of exercises you won't.)

type Seed = Omit<Exercise, 'id' | 'custom'>;

const SEED: Seed[] = [
  // Chest
  { name: 'Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Incline Barbell Bench Press', muscle: 'Chest', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Dumbbell Bench Press', muscle: 'Chest', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Incline Dumbbell Press', muscle: 'Chest', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Cable Fly', muscle: 'Chest', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Chest Press Machine', muscle: 'Chest', equipment: 'Machine', tracks: 'weightReps' },
  { name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight', tracks: 'bodyweightReps' },
  { name: 'Dip', muscle: 'Chest', equipment: 'Bodyweight', tracks: 'bodyweightReps' },

  // Back
  { name: 'Deadlift', muscle: 'Back', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Barbell Row', muscle: 'Back', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Pendlay Row', muscle: 'Back', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Dumbbell Row', muscle: 'Back', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Lat Pulldown', muscle: 'Back', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Seated Cable Row', muscle: 'Back', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight', tracks: 'bodyweightReps' },
  { name: 'Chin-Up', muscle: 'Back', equipment: 'Bodyweight', tracks: 'bodyweightReps' },
  { name: 'Face Pull', muscle: 'Back', equipment: 'Cable', tracks: 'weightReps' },

  // Shoulders
  { name: 'Overhead Press', muscle: 'Shoulders', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Seated Dumbbell Press', muscle: 'Shoulders', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Arnold Press', muscle: 'Shoulders', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Lateral Raise', muscle: 'Shoulders', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Rear Delt Fly', muscle: 'Shoulders', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Cable Lateral Raise', muscle: 'Shoulders', equipment: 'Cable', tracks: 'weightReps' },

  // Biceps
  { name: 'Barbell Curl', muscle: 'Biceps', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Hammer Curl', muscle: 'Biceps', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Incline Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Cable Curl', muscle: 'Biceps', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Preacher Curl', muscle: 'Biceps', equipment: 'Machine', tracks: 'weightReps' },

  // Triceps
  { name: 'Close-Grip Bench Press', muscle: 'Triceps', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Triceps Pushdown', muscle: 'Triceps', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Overhead Cable Extension', muscle: 'Triceps', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Skullcrusher', muscle: 'Triceps', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Dumbbell Kickback', muscle: 'Triceps', equipment: 'Dumbbell', tracks: 'weightReps' },

  // Legs
  { name: 'Back Squat', muscle: 'Legs', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Front Squat', muscle: 'Legs', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Leg Press', muscle: 'Legs', equipment: 'Machine', tracks: 'weightReps' },
  { name: 'Romanian Deadlift', muscle: 'Legs', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Leg Extension', muscle: 'Legs', equipment: 'Machine', tracks: 'weightReps' },
  { name: 'Leg Curl', muscle: 'Legs', equipment: 'Machine', tracks: 'weightReps' },
  { name: 'Walking Lunge', muscle: 'Legs', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Bulgarian Split Squat', muscle: 'Legs', equipment: 'Dumbbell', tracks: 'weightReps' },
  { name: 'Standing Calf Raise', muscle: 'Legs', equipment: 'Machine', tracks: 'weightReps' },

  // Glutes
  { name: 'Hip Thrust', muscle: 'Glutes', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Glute Bridge', muscle: 'Glutes', equipment: 'Barbell', tracks: 'weightReps' },
  { name: 'Cable Kickback', muscle: 'Glutes', equipment: 'Cable', tracks: 'weightReps' },

  // Core
  { name: 'Plank', muscle: 'Core', equipment: 'Bodyweight', tracks: 'duration' },
  { name: 'Hanging Leg Raise', muscle: 'Core', equipment: 'Bodyweight', tracks: 'bodyweightReps' },
  { name: 'Cable Crunch', muscle: 'Core', equipment: 'Cable', tracks: 'weightReps' },
  { name: 'Russian Twist', muscle: 'Core', equipment: 'Bodyweight', tracks: 'bodyweightReps' },
  { name: 'Ab Wheel Rollout', muscle: 'Core', equipment: 'Other', tracks: 'bodyweightReps' },

  // Cardio
  { name: 'Treadmill Run', muscle: 'Cardio', equipment: 'Machine', tracks: 'duration' },
  { name: 'Rowing Machine', muscle: 'Cardio', equipment: 'Machine', tracks: 'duration' },
  { name: 'Stationary Bike', muscle: 'Cardio', equipment: 'Machine', tracks: 'duration' },
  { name: 'Incline Walk', muscle: 'Cardio', equipment: 'Machine', tracks: 'duration' },
];

/** Deterministic ids so the same seed lift keeps the same id across installs. */
export function seedExercises(): Exercise[] {
  return SEED.map((s, i) => ({
    ...s,
    id: `seed-${i}`,
    custom: false,
  }));
}
