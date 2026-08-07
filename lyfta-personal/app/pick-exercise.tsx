import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import { useStore } from '../src/store';
import { AppText, Badge } from '../src/components/ui';
import { MuscleGroup } from '../src/types';

const MUSCLES: (MuscleGroup | 'All')[] = [
  'All',
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Legs',
  'Glutes',
  'Core',
  'Cardio',
];

export default function PickExercise() {
  const { theme, exercises, addExerciseToWorkout } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'All'>('All');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises
      .filter((e) => (muscle === 'All' ? true : e.muscle === muscle))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, query, muscle]);

  const pick = (id: string) => {
    addExerciseToWorkout(id);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingBottom: 8,
          gap: 12,
        }}
      >
        <AppText variant="heading" style={{ flex: 1, fontSize: 20 }}>
          Add exercise
        </AppText>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <X color={theme.colors.textSoft} size={24} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: theme.colors.bgSoft,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Search color={theme.colors.textSoft} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            placeholderTextColor={theme.colors.textSoft}
            autoCorrect={false}
            style={{ flex: 1, paddingVertical: 12, color: theme.colors.text, fontSize: 15 }}
          />
        </View>
      </View>

      {/* Muscle filter */}
      <FlatList
        horizontal
        data={MUSCLES}
        keyExtractor={(m) => m}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
        renderItem={({ item }) => {
          const on = item === muscle;
          return (
            <Pressable
              onPress={() => setMuscle(item)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
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
                {item}
              </AppText>
            </Pressable>
          );
        }}
      />

      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <AppText variant="soft" style={{ textAlign: 'center', paddingVertical: 40 }}>
            No exercises match. Add custom ones from the Exercises tab.
          </AppText>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => pick(item.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.cardBorder,
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
            }}
          >
            <View style={{ flex: 1 }}>
              <AppText variant="body" style={{ fontWeight: '700' }}>
                {item.name}
              </AppText>
              <AppText variant="soft">{item.muscle} · {item.equipment}</AppText>
            </View>
            {item.custom ? <Badge text="Custom" color={theme.colors.accentInk} /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}
