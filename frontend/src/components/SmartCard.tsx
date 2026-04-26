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
  const size = 19;

  if (type === 'SIGN_SLIP') return <FileSignature color={color} size={size} />;
  if (type === 'RSVP') return <Mail color={color} size={size} />;

  return <ListTodo color={color} size={size} />;
}

function SourceIcon({ source, color }: { source: string; color: string }) {
  const size = 13;

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
  const { t, lang, theme } = useStore();
  const color = TYPE_COLOR[card.type] || theme.colors.success;
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
        <View style={[styles.typePill, { borderColor: `${color}66`, backgroundColor: `${color}1F` }]}>
          <TypeIcon type={card.type} color={color} />

          <Text style={[styles.typeText, { color }]}>
            {card.type === 'SIGN_SLIP' ? t('sign_slip') : card.type === 'RSVP' ? t('rsvp') : t('task')}
          </Text>
        </View>

        {dueLabel ? (
          <View
            style={[
              styles.duePill,
              {
                backgroundColor: overdue ? 'rgba(239,68,68,0.16)' : theme.colors.bgSoft,
                borderColor: overdue ? 'rgba(239,68,68,0.42)' : theme.colors.cardBorder,
              },
            ]}
          >
            <CalendarClock color={overdue ? '#FCA5A5' : theme.colors.textSoft} size={14} />
            <Text style={[styles.due, { color: overdue ? '#FCA5A5' : theme.colors.textMuted }]}>{dueLabel}</Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.title, { color: isDone ? theme.colors.textSoft : theme.colors.text }, isDone && styles.titleDone]} numberOfLines={3}>
        {card.title}
      </Text>

      {card.description ? (
        <Text style={[styles.desc, { color: theme.colors.textMuted }]} numberOfLines={3}>
          {card.description}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <SourceIcon source={card.source} color={theme.colors.textSoft} />
          <Text style={[styles.metaText, { color: theme.colors.textSoft }]}>{sourceLabel}</Text>

          {card.assignee ? (
            <>
              <Text style={[styles.metaDot, { color: theme.colors.textSoft }]}>·</Text>
              <Text style={[styles.metaText, { color: theme.colors.textSoft }]}>{card.assignee}</Text>
            </>
          ) : null}

          {card.recurrence && card.recurrence !== 'none' ? (
            <>
              <Text style={[styles.metaDot, { color: theme.colors.textSoft }]}>·</Text>
              <Repeat color={theme.colors.textSoft} size={12} />
              <Text style={[styles.metaText, { color: theme.colors.textSoft }]}>{t(`rec_${card.recurrence}`)}</Text>
            </>
          ) : null}

          {card.reminder_minutes && card.reminder_minutes > 0 ? (
            <>
              <Text style={[styles.metaDot, { color: theme.colors.textSoft }]}>·</Text>
              <Bell color={theme.colors.textSoft} size={12} />
              <Text style={[styles.metaText, { color: theme.colors.textSoft }]}> 
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
            {
              borderColor: `${color}88`,
              backgroundColor: isDone ? color : `${color}18`,
            },
          ]}
        >
          <CheckCircle2 color={isDone ? '#08111F' : color} size={18} />
          <Text style={[styles.doneText, { color: isDone ? '#08111F' : color }]}>{actionLabel}</Text>
        </PressScale>

        <PressScale
          testID={`delete-${card.card_id}`}
          onPress={onDelete}
          style={[styles.deleteBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
        >
          <Trash2 color={theme.colors.textSoft} size={18} />
        </PressScale>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18, borderRadius: 26 },
  glowBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    opacity: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
    gap: 8,
  },
  typeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  duePill: {
    maxWidth: '54%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  due: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    lineHeight: 27,
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  titleDone: {
    textDecorationLine: 'line-through',
  },
  desc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  meta: { marginBottom: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  metaText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  metaDot: { marginHorizontal: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doneBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1,
  },
  doneText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  deleteBtn: {
    marginLeft: 'auto',
    minWidth: 46,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    borderWidth: 1,
  },
});
