import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrendingUp, Trophy } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { AppText, Card, EmptyState } from '../../src/components/ui';
import { LineChart } from '../../src/components/LineChart';
import { exerciseProgress, personalRecords, ExercisePoint } from '../../src/metrics';
import { formatDate, formatVolume, formatWeight } from '../../src/format';

type Metric = 'oneRepMax' | 'topWeight' | 'volume';
const METRICS: { key: Metric; label: string }[] = [
  { key: 'oneRepMax', label: 'Est. 1RM' },
  { key: 'topWeight', label: 'Top set' },
  { key: 'volume', label: 'Volume' },
];

export default function ProgressScreen() {
  const { theme, exercises, workouts, settings } = useStore();
  const insets = useSafeAreaInsets();
  const [metric, setMetric] = useState<Metric>('oneRepMax');

  // Only exercises that actually have logged progress are worth showing.
  const tracked = useMemo(() => {
    return exercises
      .map((e) => ({ exercise: e, points: exerciseProgress(workouts, e.id) }))
      .filter((t) => t.points.length > 0)
      .sort((a, b) => b.points.length - a.points.length);
  }, [exercises, workouts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tracked.find((t) => t.exercise.id === selectedId) ?? tracked[0] ?? null;

  if (tracked.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <AppText variant="label">Your numbers</AppText>
        <AppText variant="title">Progress</AppText>
        <EmptyState
          icon={<TrendingUp color={theme.colors.textSoft} size={40} />}
          title="Nothing to chart yet"
          subtitle="Log a few workouts with weights and reps, then come back to watch your strength climb."
        />
      </ScrollView>
    );
  }

  const points = selected?.points ?? [];
  const prs = personalRecords(points);
  const values = points.map((p) => p[metric]);
  const unit = settings.unit;

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        gap: 14,
      }}
    >
      <View>
        <AppText variant="label">Your numbers</AppText>
        <AppText variant="title">Progress</AppText>
      </View>

      {/* Exercise picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {tracked.map((t) => {
          const on = t.exercise.id === selected?.exercise.id;
          return (
            <Pressable
              key={t.exercise.id}
              onPress={() => setSelectedId(t.exercise.id)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 999,
                backgroundColor: on ? theme.colors.accent : theme.colors.bgSoft,
              }}
            >
              <AppText
                style={{
                  color: on ? theme.colors.onAccent : theme.colors.textMuted,
                  fontWeight: '700',
                  fontSize: 13,
                }}
              >
                {t.exercise.name}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* PR cards */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PrCard label="Best 1RM" value={formatWeight(prs.bestOneRepMax, unit)} />
        <PrCard label="Top set" value={formatWeight(prs.bestTopWeight, unit)} />
        <PrCard label="Best volume" value={formatVolume(prs.bestVolume, unit)} />
      </View>

      {/* Chart */}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {METRICS.map((m) => {
            const on = m.key === metric;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMetric(m.key)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 10,
                  alignItems: 'center',
                  backgroundColor: on ? theme.colors.accentSoft : 'transparent',
                }}
              >
                <AppText
                  style={{
                    color: on ? theme.colors.accentInk : theme.colors.textSoft,
                    fontWeight: '700',
                    fontSize: 13,
                  }}
                >
                  {m.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <LineChart values={values} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="soft">{formatDate(points[0].date)}</AppText>
          <AppText variant="soft">{points.length} sessions</AppText>
          <AppText variant="soft">{formatDate(points[points.length - 1].date)}</AppText>
        </View>
      </Card>

      {/* Session-by-session log */}
      <Card style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Trophy color={theme.colors.accentInk} size={16} />
          <AppText variant="heading" style={{ fontSize: 16 }}>
            Session history
          </AppText>
        </View>
        {[...points].reverse().map((p, i) => (
          <SessionRow key={`${p.date}-${i}`} point={p} unit={unit} best={prs} />
        ))}
      </Card>
    </ScrollView>
  );
}

function PrCard({ label, value }: { label: string; value: string }) {
  const { theme } = useStore();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.card,
        borderColor: theme.colors.cardBorder,
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
        gap: 4,
      }}
    >
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label}
      </AppText>
      <AppText variant="heading" style={{ fontSize: 17 }}>
        {value}
      </AppText>
    </View>
  );
}

function SessionRow({
  point,
  unit,
  best,
}: {
  point: ExercisePoint;
  unit: string;
  best: { bestOneRepMax: number; bestTopWeight: number };
}) {
  const { theme } = useStore();
  const isPr = point.oneRepMax >= best.bestOneRepMax && best.bestOneRepMax > 0;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderTopColor: theme.colors.cardBorder,
        borderTopWidth: 1,
      }}
    >
      <AppText variant="muted" style={{ flex: 1 }}>
        {formatDate(point.date)}
      </AppText>
      <AppText variant="body" style={{ width: 92, textAlign: 'right' }}>
        {formatWeight(point.topWeight, unit)}
      </AppText>
      <View style={{ width: 74, alignItems: 'flex-end' }}>
        {isPr ? (
          <Trophy color={theme.colors.warning} size={15} />
        ) : (
          <AppText variant="soft">{formatWeight(point.oneRepMax, unit)}</AppText>
        )}
      </View>
    </View>
  );
}
