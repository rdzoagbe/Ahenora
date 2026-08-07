import React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Trash2 } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { AppText, Badge, Button, Card } from '../../src/components/ui';
import { elapsedSeconds, formatDate, formatDuration, formatTime, formatVolume } from '../../src/format';
import { exerciseVolume, workoutVolume } from '../../src/metrics';
import { SetType } from '../../src/types';

const TYPE_LABEL: Record<SetType, string> = {
  normal: '',
  warmup: 'Warmup',
  dropset: 'Drop',
  failure: 'Failure',
};

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, workouts, exerciseById, deleteWorkout, settings } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const workout = workouts.find((w) => w.id === id);

  if (!workout) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <AppText variant="muted">Workout not found.</AppText>
        <Button title="Go back" kind="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const confirmDelete = () => {
    Alert.alert('Delete workout?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteWorkout(workout.id);
          router.back();
        },
      },
    ]);
  };

  const duration = elapsedSeconds(workout.startedAt, workout.endedAt);

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 32,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 6, marginLeft: -6 }}>
          <ChevronLeft color={theme.colors.text} size={26} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 6 }}>
          <Trash2 color={theme.colors.danger} size={20} />
        </Pressable>
      </View>

      <View>
        <AppText variant="title">{workout.title}</AppText>
        <AppText variant="soft" style={{ marginTop: 4 }}>
          {formatDate(workout.endedAt ?? workout.startedAt)} · {formatTime(workout.startedAt)}
        </AppText>
      </View>

      <Card style={{ flexDirection: 'row', gap: 8 }}>
        <SummaryStat label="Duration" value={formatDuration(duration)} />
        <SummaryStat label="Volume" value={formatVolume(workoutVolume(workout), settings.unit)} />
        <SummaryStat
          label="Sets"
          value={String(workout.entries.reduce((n, e) => n + e.sets.length, 0))}
        />
      </Card>

      {workout.note ? (
        <Card>
          <AppText variant="body">{workout.note}</AppText>
        </Card>
      ) : null}

      {workout.entries.map((entry) => {
        const ex = exerciseById(entry.exerciseId);
        return (
          <Card key={entry.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <AppText variant="heading" style={{ flex: 1 }}>
                {ex?.name ?? 'Exercise'}
              </AppText>
              <AppText variant="soft">{formatVolume(exerciseVolume(entry), settings.unit)}</AppText>
            </View>
            {entry.sets.map((set, i) => {
              const isDuration = ex?.tracks === 'duration';
              return (
                <View
                  key={set.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 }}
                >
                  <AppText variant="soft" style={{ width: 24 }}>
                    {i + 1}
                  </AppText>
                  <AppText variant="body" style={{ flex: 1 }}>
                    {isDuration
                      ? `${set.seconds ?? 0}s`
                      : `${set.weight} ${settings.unit} × ${set.reps}`}
                  </AppText>
                  {TYPE_LABEL[set.type] ? (
                    <Badge text={TYPE_LABEL[set.type]} color={theme.colors.accentInk} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        );
      })}
    </ScrollView>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}
