import React, { useMemo } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronRight, History as HistoryIcon } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { AppText, Card, EmptyState } from '../../src/components/ui';
import { elapsedSeconds, formatDate, formatDuration, formatVolume } from '../../src/format';
import { workoutVolume } from '../../src/metrics';

export default function HistoryScreen() {
  const { theme, workouts, settings } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const totals = useMemo(
    () => ({
      count: workouts.length,
      volume: workouts.reduce((s, w) => s + workoutVolume(w), 0),
    }),
    [workouts]
  );

  return (
    <FlatList
      data={workouts}
      keyExtractor={(w) => w.id}
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        gap: 10,
      }}
      ListHeaderComponent={
        <View style={{ marginBottom: 6 }}>
          <AppText variant="label">All time</AppText>
          <AppText variant="title">History</AppText>
          {workouts.length > 0 ? (
            <AppText variant="soft" style={{ marginTop: 4 }}>
              {totals.count} workouts · {formatVolume(totals.volume, settings.unit)} lifted
            </AppText>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon={<HistoryIcon color={theme.colors.textSoft} size={40} />}
          title="No history yet"
          subtitle="Finished workouts show up here, newest first."
        />
      }
      renderItem={({ item }) => {
        const setCount = item.entries.reduce((n, e) => n + e.sets.length, 0);
        const duration = elapsedSeconds(item.startedAt, item.endedAt);
        return (
          <Pressable onPress={() => router.push(`/workout/${item.id}`)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="heading">{item.title}</AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <CalendarDays color={theme.colors.textSoft} size={13} />
                  <AppText variant="soft">
                    {formatDate(item.endedAt ?? item.startedAt)} · {item.entries.length} exercises ·{' '}
                    {setCount} sets
                  </AppText>
                </View>
                <AppText variant="soft">
                  {formatDuration(duration)} · {formatVolume(workoutVolume(item), settings.unit)}
                </AppText>
              </View>
              <ChevronRight color={theme.colors.textSoft} size={20} />
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
