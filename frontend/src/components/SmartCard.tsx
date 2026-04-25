import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  CheckCircle2,
  FileSignature,
  Mail,
  ListTodo,
  Trash2,
  Sparkles,
  Mic,
  Camera,
  Edit3,
  Repeat,
  Bell,
  CalendarClock,
} from 'lucide-react-native';

import { GlassCard } from './GlassCard';
import { PressScale } from './PressScale';
import { Card } from '../api';
import { useStore } from '../store';
import { formatCompactDue, isOverdue } from '../utils/date';

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: '#F97316',
  RSVP: '#6366F1',
  TASK: '#10B981',
};

function TypeIcon({ type, color }: { type: string; color: string }) {
  const size = 18;

  if (type === 'SIGN_SLIP') return <FileSignature color={color} size={size} />;
  if (type === 'RSVP') return <Mail color={color} size={size} />;

  return <ListTodo color={color} size={size} />;
}

function SourceIcon({ source }: { source: string }) {
  const color = 'rgba(255,255,255,0.55)';
  const size = 12;

  if (source === 'AI') return <Sparkles color={color} size={size} />;
  if (source === 'VOICE') return <Mic color={color} size={size} />;
  if (source === 'CAMERA') return <Camera color={color} size={size} />;

  return <Edit3 color={color} size={size} />;
}

interface Props {
  card: Card;
  onComplete: () => void;
  onDelete: () => void;
}

export function SmartCard({ card, onComplete, onDelete }: Props) {
  const { t, lang } = useStore();
  const color = TYPE_COLOR[card.type];
  const isDone = card.status === 'DONE';
  const overdue = !isDone && isOverdue(card.due_date);
  const dueLabel = formatCompactDue(card.due_date, lang);

  const actionLabel = useMemo(() => {
    if (isDone) return t('done');
    if (card.type === 'SIGN_SLIP') return lang === 'es' ? 'Firmar' : 'Mark signed';
    if (card.type === 'RSVP') return lang === 'es' ? 'Confirmar' : 'Send RSVP';

    return t('mark_done');
  }, [card.type, isDone, lang, t]);

  const sourceLabel = useMemo(() => {
    if (card.source === 'AI') return t('source_ai');
    if (card.source === 'VOICE') return t('source_voice');
    if (card.source === 'CAMERA') return t('source_camera');

    return t('source_manual');
  }, [card.source, t]);

  return (
    <GlassCard testID={`card-${card.card_id}`} style={styles.wrap}>
      <View style={[styles.glowBar, { backgroundColor: overdue ? '#EF4444' : color }]} />

      <View style={styles.row}>
        <View style={[styles.typePill, { borderColor: `${color}55`, backgroundColor: `${color}22` }]}>
          <TypeIcon type={card.type} color={color} />

          <Text style={[styles.typeText, { color }]}>
            {card.type === 'SIGN_SLIP' ? t('sign_slip') : card.type === 'RSVP' ? t('rsvp') : t('task')}
          </Text>
        </View>

        {dueLabel ? (
          <View style={[styles.duePill, overdue && styles.duePillOverdue]}>
            <CalendarClock color={overdue ? '#FCA5A5' : 'rgba(255,255,255,0.65)'} size={12} />
            <Text style={[styles.due, overdue && styles.dueOverdue]}>{dueLabel}</Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.title, isDone && styles.titleDone]} numberOfLines={3}>
        {card.title}
      </Text>

      {card.description ? (
        <Text style={styles.desc} numberOfLines={3}>
          {card.description}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <SourceIcon source={card.source} />
          <Text style={styles.metaText}>{sourceLabel}</Text>

          {card.assignee ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText}>{card.assignee}</Text>
            </>
          ) : null}

          {card.recurrence && card.recurrence !== 'none' ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Repeat color="rgba(255,255,255,0.55)" size={11} />
              <Text style={styles.metaText}>{t(`rec_${card.recurrence}`)}</Text>
            </>
          ) : null}

          {card.reminder_minutes && card.reminder_minutes > 0 ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Bell color="rgba(255,255,255,0.55)" size={11} />
              <Text style={styles.metaText}>
                {card.reminder_minutes >= 1440
                  ? `${Math.round(card.reminder_minutes / 1440)}d`
                  : card.reminder_minutes >= 60
                  ? `${Math.round(card.reminder_minutes / 60)}h`
                  : `${card.reminder_minutes}m`}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <PressScale
          testID={`complete-${card.card_id}`}
          onPress={onComplete}
          style={[
            styles.doneBtn,
            isDone && styles.doneBtnActive,
            { borderColor: `${color}66` },
          ]}
        >
          <CheckCircle2 color={isDone ? '#0b0b0b' : color} size={16} />
          <Text style={[styles.doneText, { color: isDone ? '#0b0b0b' : color }]}>
            {actionLabel}
          </Text>
        </PressScale>

        <PressScale testID={`delete-${card.card_id}`} onPress={onDelete} style={styles.deleteBtn}>
          <Trash2 color="rgba(255,255,255,0.55)" size={16} />
        </PressScale>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  glowBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    opacity: 0.9,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
    gap: 6,
  },
  typeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  duePill: {
    maxWidth: '54%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 9999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  duePillOverdue: {
    backgroundColor: 'rgba(239,68,68,0.13)',
    borderColor: 'rgba(239,68,68,0.35)',
  },
  due: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
  },
  dueOverdue: {
    color: '#FCA5A5',
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    lineHeight: 23,
    color: '#FFFFFF',
    marginBottom: 6,
  },
  titleDone: {
    color: 'rgba(255,255,255,0.45)',
    textDecorationLine: 'line-through',
  },
  desc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 14,
  },
  meta: { marginBottom: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  metaDot: { color: 'rgba(255,255,255,0.3)', marginHorizontal: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9999,
    borderWidth: 1,
  },
  doneBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  doneText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  deleteBtn: {
    marginLeft: 'auto',
    padding: 9,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
