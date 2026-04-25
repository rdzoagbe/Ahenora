import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Card, CardType, FamilyMember } from '../../src/api';
import { useStore } from '../../src/store';

type NewCardState = {
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
};

const initialNewCard: NewCardState = {
  type: 'TASK',
  title: '',
  description: '',
  assignee: '',
  dueDate: '',
};

function parseDueDate(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  // Supports YYYY-MM-DD or YYYY-MM-DD HH:mm
  const normalized =
    trimmed.length === 10 ? `${trimmed}T09:00:00` : trimmed.replace(' ', 'T');

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function formatDue(value?: string | null): string {
  if (!value) return 'No due date';

  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'No due date';
  }
}

export default function FeedScreen() {
  const { user } = useStore();

  const [cards, setCards] = useState<Card[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewCardState>(initialNewCard);
  const [saving, setSaving] = useState(false);

  const children = useMemo(
    () => members.filter((member) => member.role.toLowerCase() === 'child'),
    [members]
  );

  const openCards = useMemo(
    () => cards.filter((card) => card.status !== 'DONE'),
    [cards]
  );

  const doneCards = useMemo(
    () => cards.filter((card) => card.status === 'DONE'),
    [cards]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [nextCards, nextMembers] = await Promise.all([
        api.listCards(),
        api.familyMembers(),
      ]);

      setCards(nextCards);
      setMembers(nextMembers);
    } catch (error: any) {
      console.log('Feed load failed:', error);
      Alert.alert('Feed error', error?.message || 'Could not load tasks.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetCreateForm = () => {
    setForm(initialNewCard);
    setShowCreate(false);
    setSaving(false);
  };

  const createCard = async () => {
    const title = form.title.trim();

    if (!title) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }

    const dueDate = parseDueDate(form.dueDate);

    if (form.dueDate.trim() && !dueDate) {
      Alert.alert(
        'Invalid due date',
        'Use YYYY-MM-DD or YYYY-MM-DD HH:mm, for example 2026-05-01 17:30.'
      );
      return;
    }

    try {
      setSaving(true);

      const created = await api.createCard({
        type: form.type,
        title,
        description: form.description.trim() || null,
        assignee: form.assignee || null,
        due_date: dueDate,
        source: 'MANUAL',
        recurrence: 'none',
        reminder_minutes: dueDate ? 60 : 0,
      });

      setCards((current) => [created, ...current]);
      resetCreateForm();
    } catch (error: any) {
      console.log('Create card failed:', error);
      Alert.alert('Create failed', error?.message || 'Could not create this task.');
      setSaving(false);
    }
  };

  const toggleCardStatus = async (card: Card) => {
    const nextStatus = card.status === 'DONE' ? 'OPEN' : 'DONE';

    setCards((current) =>
      current.map((item) =>
        item.card_id === card.card_id ? { ...item, status: nextStatus } : item
      )
    );

    try {
      const updated = await api.updateCard(card.card_id, { status: nextStatus });

      setCards((current) =>
        current.map((item) => (item.card_id === card.card_id ? updated : item))
      );

      if (nextStatus === 'DONE' && card.type === 'TASK' && card.assignee) {
        Alert.alert(
          'Task complete',
          `${card.assignee} should receive stars if they are a child member.`
        );
      }
    } catch (error: any) {
      console.log('Update card failed:', error);
      Alert.alert('Update failed', error?.message || 'Could not update this task.');
      load();
    }
  };

  const deleteCard = async (card: Card) => {
    Alert.alert('Delete task?', card.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setCards((current) =>
            current.filter((item) => item.card_id !== card.card_id)
          );

          try {
            await api.deleteCard(card.card_id);
          } catch (error: any) {
            console.log('Delete card failed:', error);
            Alert.alert('Delete failed', error?.message || 'Could not delete this task.');
            load();
          }
        },
      },
    ]);
  };

  const renderCard = (card: Card) => {
    const isDone = card.status === 'DONE';

    return (
      <View key={card.card_id} style={[styles.card, isDone && styles.cardDone]}>
        <View style={styles.cardTop}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{card.type}</Text>
          </View>
          <Text style={styles.dueText}>{formatDue(card.due_date)}</Text>
        </View>

        <Text style={[styles.cardTitle, isDone && styles.doneText]}>
          {card.title}
        </Text>

        {card.description ? (
          <Text style={styles.description}>{card.description}</Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            Assigned: {card.assignee || 'Unassigned'}
          </Text>
          <Text style={styles.metaText}>Status: {card.status}</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={() => toggleCardStatus(card)}
            style={[styles.primaryButton, isDone && styles.secondaryButton]}
          >
            <Text style={styles.primaryButtonText}>
              {isDone ? 'Reopen' : 'Mark done'}
            </Text>
          </Pressable>

          <Pressable onPress={() => deleteCard(card)} style={styles.deleteButton}>
            <Text style={styles.deleteButtonText}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const firstName = (user?.name || 'there').split(' ')[0];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#fff"
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Household COO</Text>
            <Text style={styles.title}>Hello, {firstName}</Text>
            <Text style={styles.subtitle}>
              Create, assign, complete, and track household tasks.
            </Text>
          </View>

          <Pressable onPress={() => setShowCreate(true)} style={styles.newButton}>
            <Text style={styles.newButtonText}>+ New task</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{openCards.length}</Text>
            <Text style={styles.statLabel}>Open</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{doneCards.length}</Text>
            <Text style={styles.statLabel}>Done</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{children.length}</Text>
            <Text style={styles.statLabel}>Kids</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
        ) : cards.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No tasks yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap “New task” to create your first household card.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Open tasks</Text>
            {openCards.length === 0 ? (
              <Text style={styles.mutedText}>Nothing open right now.</Text>
            ) : (
              openCards.map(renderCard)
            )}

            {doneCards.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Completed</Text>
                {doneCards.map(renderCard)}
              </>
            ) : null}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={resetCreateForm}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <View style={styles.sheet}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetScroll}
            >
              <Text style={styles.sheetTitle}>Create a task</Text>

              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {(['TASK', 'SIGN_SLIP', 'RSVP'] as CardType[]).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setForm((current) => ({ ...current, type }))}
                    style={[
                      styles.chip,
                      form.type === type && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        form.type === type && styles.chipTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Title</Text>
              <TextInput
                value={form.title}
                onChangeText={(title) =>
                  setForm((current) => ({ ...current, title }))
                }
                placeholder="Example: Take out recycling"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
                returnKeyType="next"
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                value={form.description}
                onChangeText={(description) =>
                  setForm((current) => ({ ...current, description }))
                }
                placeholder="Optional details"
                placeholderTextColor="rgba(255,255,255,0.35)"
                multiline
                style={[styles.input, styles.textArea]}
                textAlignVertical="top"
              />

              <Text style={styles.label}>Assign to</Text>
              <View style={styles.typeRow}>
                <Pressable
                  onPress={() => setForm((current) => ({ ...current, assignee: '' }))}
                  style={[styles.chip, !form.assignee && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, !form.assignee && styles.chipTextActive]}
                  >
                    Unassigned
                  </Text>
                </Pressable>

                {children.map((child) => (
                  <Pressable
                    key={child.member_id}
                    onPress={() =>
                      setForm((current) => ({
                        ...current,
                        assignee: child.name,
                      }))
                    }
                    style={[
                      styles.chip,
                      form.assignee === child.name && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        form.assignee === child.name && styles.chipTextActive,
                      ]}
                    >
                      {child.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Due date</Text>
              <TextInput
                value={form.dueDate}
                onChangeText={(dueDate) =>
                  setForm((current) => ({ ...current, dueDate }))
                }
                placeholder="YYYY-MM-DD or YYYY-MM-DD HH:mm"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
              />

              <View style={styles.sheetActions}>
                <Pressable onPress={resetCreateForm} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={createCard}
                  disabled={saving}
                  style={[styles.saveButton, saving && { opacity: 0.5 }]}
                >
                  <Text style={styles.saveButtonText}>
                    {saving ? 'Saving...' : 'Create'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080910',
  },
  scroll: {
    padding: 20,
    paddingBottom: 32,
  },
  header: {
    gap: 18,
    marginTop: 10,
    marginBottom: 22,
  },
  kicker: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  newButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  newButtonText: {
    color: '#080910',
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  statNumber: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
    fontSize: 12,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
    marginTop: 8,
    fontWeight: '700',
  },
  mutedText: {
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 16,
  },
  emptyCard: {
    borderRadius: 24,
    padding: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  emptySubtitle: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cardDone: {
    opacity: 0.72,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(249,115,22,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.35)',
  },
  badgeText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '800',
  },
  dueText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  doneText: {
    textDecorationLine: 'line-through',
    color: 'rgba(255,255,255,0.55)',
  },
  description: {
    color: 'rgba(255,255,255,0.65)',
    marginTop: 8,
    lineHeight: 20,
  },
  metaRow: {
    gap: 4,
    marginTop: 12,
  },
  metaText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#10B981',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  primaryButtonText: {
    color: '#08110e',
    fontWeight: '800',
  },
  deleteButton: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    marginLeft: 'auto',
  },
  deleteButtonText: {
    color: '#FCA5A5',
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#11131c',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetScroll: {
    paddingBottom: 28,
  },
  sheetTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 16,
  },
  label: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 12,
    fontWeight: '700',
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  chipText: {
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '800',
    fontSize: 12,
  },
  chipTextActive: {
    color: '#080910',
  },
  input: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    color: '#fff',
  },
  textArea: {
    minHeight: 82,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  cancelButton: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cancelButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  saveButton: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: '#fff',
  },
  saveButtonText: {
    color: '#080910',
    fontWeight: '900',
  },
});
