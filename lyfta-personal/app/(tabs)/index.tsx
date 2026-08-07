import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import {
  Check,
  Dumbbell,
  Plus,
  Timer,
  Trash2,
  X,
} from 'lucide-react-native';
import { useStore } from '../../src/store';
import { AppText, Button, Card, EmptyState } from '../../src/components/ui';
import { elapsedSeconds, formatClock, formatDuration, formatVolume } from '../../src/format';
import { exerciseVolume, workoutVolume } from '../../src/metrics';
import { SetType, WorkoutSet } from '../../src/types';

const SET_TYPE_META: Record<SetType, { short: string; color: (t: any) => string }> = {
  normal: { short: '1', color: (t) => t.colors.textMuted },
  warmup: { short: 'W', color: (t) => t.colors.warning },
  dropset: { short: 'D', color: (t) => t.colors.accentInk },
  failure: { short: 'F', color: (t) => t.colors.danger },
};

export default function WorkoutScreen() {
  const { active, startWorkout } = useStore();
  return active ? <ActiveSession /> : <StartScreen onStart={() => startWorkout()} />;
}

// ─── Idle state: start a workout, glance at the week ──────────────────────────

function StartScreen({ onStart }: { onStart: () => void }) {
  const { theme, workouts } = useStore();
  const insets = useSafeAreaInsets();

  const week = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    const recent = workouts.filter(
      (w) => w.endedAt && new Date(w.endedAt).getTime() >= cutoff
    );
    return {
      count: recent.length,
      volume: recent.reduce((s, w) => s + workoutVolume(w), 0),
    };
  }, [workouts]);

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        paddingTop: insets.top + 24,
        gap: 16,
      }}
    >
      <AppText variant="label">Ready when you are</AppText>
      <AppText variant="title">Let's train.</AppText>

      <Card style={{ gap: 16, marginTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Stat label="This week" value={String(week.count)} suffix="workouts" />
          <View style={{ width: 1, backgroundColor: theme.colors.cardBorder }} />
          <Stat
            label="Volume"
            value={formatVolume(week.volume, '').trim() || '0'}
            suffix="lifted"
          />
        </View>
        <Button
          title="Start empty workout"
          onPress={onStart}
          icon={<Dumbbell color={theme.colors.onAccent} size={18} />}
        />
      </Card>

      {workouts.length === 0 ? (
        <EmptyState
          icon={<Dumbbell color={theme.colors.textSoft} size={40} />}
          title="No workouts yet"
          subtitle="Start a workout, add a few exercises, and log your sets. Everything stays on this device."
        />
      ) : (
        <AppText variant="soft" style={{ textAlign: 'center', marginTop: 8 }}>
          Your last session was {shortWhen(workouts[0].endedAt ?? workouts[0].startedAt)}.
        </AppText>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="title" style={{ fontSize: 24 }}>
        {value}
      </AppText>
      <AppText variant="soft">{suffix}</AppText>
    </View>
  );
}

function shortWhen(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// ─── Active session: the logging loop ─────────────────────────────────────────

function ActiveSession() {
  const {
    theme,
    active,
    settings,
    exerciseById,
    setWorkoutTitle,
    finishWorkout,
    discardWorkout,
    addSet,
    updateSet,
    removeSet,
    removeEntry,
    cycleSetType,
  } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useKeepAwake(); // don't let the screen sleep between sets

  // A once-a-second tick drives the elapsed clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Rest timer.
  const [rest, setRest] = useState<number | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRest = (seconds: number) => {
    if (restRef.current) clearInterval(restRef.current);
    setRest(seconds);
    restRef.current = setInterval(() => {
      setRest((r) => {
        if (r == null) return null;
        if (r <= 1) {
          if (restRef.current) clearInterval(restRef.current);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return null;
        }
        return r - 1;
      });
    }, 1000);
  };
  const stopRest = () => {
    if (restRef.current) clearInterval(restRef.current);
    setRest(null);
  };
  useEffect(() => () => {
    if (restRef.current) clearInterval(restRef.current);
  }, []);

  if (!active) return null;
  const elapsed = elapsedSeconds(active.startedAt);
  const totalVolume = workoutVolume(active);
  const doneSets = active.entries.reduce(
    (n, e) => n + e.sets.filter((s) => s.done).length,
    0
  );

  const confirmFinish = () => {
    if (doneSets === 0) {
      Alert.alert('Nothing logged', 'Mark at least one set as done, or discard this workout.');
      return;
    }
    Alert.alert('Finish workout?', `${doneSets} set${doneSets === 1 ? '' : 's'} logged.`, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', style: 'default', onPress: finishWorkout },
    ]);
  };

  const confirmDiscard = () => {
    Alert.alert('Discard workout?', 'This session will be deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discardWorkout },
    ]);
  };

  const onToggleDone = (entryId: string, set: WorkoutSet) => {
    const nowDone = !set.done;
    updateSet(entryId, set.id, { done: nowDone });
    if (nowDone) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      startRest(settings.restSeconds);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: insets.top + 12,
          paddingBottom: 140,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <TextInput
              value={active.title}
              onChangeText={setWorkoutTitle}
              placeholder="Workout title"
              placeholderTextColor={theme.colors.textSoft}
              style={{
                color: theme.colors.text,
                fontSize: 22,
                fontWeight: '800',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 2 }}>
              <AppText variant="soft">⏱ {formatDuration(elapsed)}</AppText>
              <AppText variant="soft">{formatVolume(totalVolume, settings.unit)}</AppText>
              <AppText variant="soft">{doneSets} sets</AppText>
            </View>
          </View>
          <Pressable onPress={confirmDiscard} hitSlop={8} style={{ padding: 6 }}>
            <X color={theme.colors.textSoft} size={22} />
          </Pressable>
        </View>

        {/* Exercises */}
        {active.entries.map((entry) => {
          const ex = exerciseById(entry.exerciseId);
          const isDuration = ex?.tracks === 'duration';
          return (
            <Card key={entry.id} style={{ gap: 10, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="heading">{ex?.name ?? 'Exercise'}</AppText>
                  <AppText variant="soft">
                    {ex ? `${ex.muscle} · ${ex.equipment}` : ''} ·{' '}
                    {formatVolume(exerciseVolume(entry), settings.unit)}
                  </AppText>
                </View>
                <Pressable onPress={() => removeEntry(entry.id)} hitSlop={8} style={{ padding: 6 }}>
                  <Trash2 color={theme.colors.textSoft} size={18} />
                </Pressable>
              </View>

              {/* Column header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 }}>
                <ColHead text="Set" width={40} />
                {isDuration ? (
                  <ColHead text="Time (s)" flex />
                ) : (
                  <>
                    <ColHead text={settings.unit} flex />
                    <ColHead text="Reps" flex />
                  </>
                )}
                <ColHead text="" width={44} />
              </View>

              {entry.sets.map((set, i) => (
                <SetRow
                  key={set.id}
                  index={i}
                  set={set}
                  isDuration={!!isDuration}
                  onCycleType={() => cycleSetType(entry.id, set.id)}
                  onChange={(patch) => updateSet(entry.id, set.id, patch)}
                  onToggleDone={() => onToggleDone(entry.id, set)}
                  onRemove={() => removeSet(entry.id, set.id)}
                />
              ))}

              <Button
                title="Add set"
                kind="secondary"
                onPress={() => addSet(entry.id)}
                icon={<Plus color={theme.colors.text} size={16} />}
                style={{ marginTop: 2 }}
              />
            </Card>
          );
        })}

        <Button
          title="Add exercise"
          kind={active.entries.length === 0 ? 'primary' : 'secondary'}
          onPress={() => router.push('/pick-exercise')}
          icon={
            <Plus
              color={active.entries.length === 0 ? theme.colors.onAccent : theme.colors.text}
              size={18}
            />
          }
        />

        {active.entries.length > 0 ? (
          <Button title="Finish workout" onPress={confirmFinish} style={{ marginTop: 4 }} />
        ) : null}
      </ScrollView>

      {/* Rest timer bar */}
      {rest != null ? (
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: insets.bottom + 16,
            backgroundColor: theme.colors.accent,
            borderRadius: 16,
            paddingVertical: 12,
            paddingHorizontal: 18,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Timer color={theme.colors.onAccent} size={20} />
          <AppText style={{ color: theme.colors.onAccent, fontWeight: '800', fontSize: 18 }}>
            {formatClock(rest)}
          </AppText>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => setRest((r) => (r == null ? r : r + 30))} hitSlop={8}>
            <AppText style={{ color: theme.colors.onAccent, fontWeight: '700' }}>+30s</AppText>
          </Pressable>
          <Pressable onPress={stopRest} hitSlop={8} style={{ marginLeft: 14 }}>
            <X color={theme.colors.onAccent} size={20} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ColHead({ text, width, flex }: { text: string; width?: number; flex?: boolean }) {
  return (
    <View style={{ width, flex: flex ? 1 : undefined, paddingHorizontal: 4 }}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {text}
      </AppText>
    </View>
  );
}

function SetRow({
  index,
  set,
  isDuration,
  onCycleType,
  onChange,
  onToggleDone,
  onRemove,
}: {
  index: number;
  set: WorkoutSet;
  isDuration: boolean;
  onCycleType: () => void;
  onChange: (patch: Partial<WorkoutSet>) => void;
  onToggleDone: () => void;
  onRemove: () => void;
}) {
  const { theme } = useStore();
  const meta = SET_TYPE_META[set.type];

  const cellStyle = {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: theme.colors.bgSoft,
    borderRadius: 10,
    paddingVertical: 10,
    textAlign: 'center' as const,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        opacity: set.done ? 1 : 0.96,
      }}
    >
      {/* Set number / type — tap to cycle warmup/drop/failure */}
      <Pressable
        onPress={onCycleType}
        onLongPress={onRemove}
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bgSoft,
        }}
      >
        <AppText style={{ color: meta.color(theme), fontWeight: '800' }}>
          {set.type === 'normal' ? index + 1 : meta.short}
        </AppText>
      </Pressable>

      {isDuration ? (
        <TextInput
          value={set.seconds ? String(set.seconds) : ''}
          onChangeText={(t) => onChange({ seconds: parseIntSafe(t), reps: 0, weight: 0 })}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={theme.colors.textSoft}
          style={cellStyle}
        />
      ) : (
        <>
          <TextInput
            value={set.weight ? String(set.weight) : ''}
            onChangeText={(t) => onChange({ weight: parseFloatSafe(t) })}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.colors.textSoft}
            style={cellStyle}
          />
          <TextInput
            value={set.reps ? String(set.reps) : ''}
            onChangeText={(t) => onChange({ reps: parseIntSafe(t) })}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={theme.colors.textSoft}
            style={cellStyle}
          />
        </>
      )}

      {/* Done toggle */}
      <Pressable
        onPress={onToggleDone}
        style={{
          width: 40,
          height: 40,
          marginLeft: 4,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: set.done ? theme.colors.success : theme.colors.bgSoft,
        }}
      >
        <Check
          color={set.done ? theme.colors.onAccent : theme.colors.textSoft}
          size={20}
          strokeWidth={3}
        />
      </Pressable>
    </View>
  );
}

function parseFloatSafe(t: string): number {
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function parseIntSafe(t: string): number {
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : 0;
}
