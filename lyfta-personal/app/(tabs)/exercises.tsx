import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search, Trash2, X } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { AppText, Badge, Button, Card } from '../../src/components/ui';
import { Equipment, MuscleGroup } from '../../src/types';

const MUSCLES: MuscleGroup[] = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Cardio', 'Other',
];
const EQUIPMENT: Equipment[] = [
  'Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'Other',
];

export default function ExercisesScreen() {
  const { theme, exercises, addExercise, deleteExercise } = useStore();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, query]);

  const onDelete = (id: string, name: string) => {
    Alert.alert('Delete exercise?', `"${name}" will be removed from your library. Past workouts keep their logged sets.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteExercise(id) },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
          gap: 8,
        }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <AppText variant="label">{exercises.length} in your library</AppText>
                <AppText variant="title">Exercises</AppText>
              </View>
              <Pressable
                onPress={() => setAdding((v) => !v)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: adding ? theme.colors.bgSoft : theme.colors.accent,
                }}
              >
                {adding ? (
                  <X color={theme.colors.text} size={22} />
                ) : (
                  <Plus color={theme.colors.onAccent} size={22} />
                )}
              </Pressable>
            </View>

            {adding ? <AddForm onDone={() => setAdding(false)} onCreate={addExercise} /> : null}

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
        }
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="body" style={{ fontWeight: '700' }}>
                {item.name}
              </AppText>
              <AppText variant="soft">{item.muscle} · {item.equipment}</AppText>
            </View>
            {item.custom ? (
              <>
                <Badge text="Custom" color={theme.colors.accentInk} />
                <Pressable onPress={() => onDelete(item.id, item.name)} hitSlop={8} style={{ padding: 4 }}>
                  <Trash2 color={theme.colors.textSoft} size={18} />
                </Pressable>
              </>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}

function AddForm({
  onDone,
  onCreate,
}: {
  onDone: () => void;
  onCreate: (e: { name: string; muscle: MuscleGroup; equipment: Equipment; tracks: 'weightReps' | 'bodyweightReps' | 'duration' }) => void;
}) {
  const { theme } = useStore();
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup>('Chest');
  const [equipment, setEquipment] = useState<Equipment>('Barbell');

  const tracks: 'weightReps' | 'bodyweightReps' | 'duration' =
    muscle === 'Cardio' ? 'duration' : equipment === 'Bodyweight' ? 'bodyweightReps' : 'weightReps';

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, muscle, equipment, tracks });
    setName('');
    onDone();
  };

  return (
    <Card style={{ gap: 12 }}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Exercise name"
        placeholderTextColor={theme.colors.textSoft}
        style={{
          color: theme.colors.text,
          fontSize: 17,
          fontWeight: '700',
          backgroundColor: theme.colors.bgSoft,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 12,
        }}
      />
      <ChipRow label="Muscle" options={MUSCLES} value={muscle} onChange={setMuscle} />
      <ChipRow label="Equipment" options={EQUIPMENT} value={equipment} onChange={setEquipment} />
      <Button title="Add to library" onPress={save} disabled={!name.trim()} />
    </Card>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { theme } = useStore();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt) => {
          const on = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
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
                {opt}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
