import type { ActivityEntry } from './api';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * The server stores what happened, not a sentence about it — so a French
 * co-parent reads a French feed and an English one reads English.
 *
 * Shared by Home and the completed-history screen, which lists the lines a
 * person hid from Home so they can be found again.
 */
export function activityPhrase(entry: ActivityEntry, t: TFunc): string {
  switch (entry.kind) {
    case 'task_done': return t('act_task_done', { subject: entry.subject });
    case 'task_created': return t('act_task_created', { subject: entry.subject });
    case 'task_assigned':
      return t('act_task_assigned', { subject: entry.subject, target: entry.target || '' });
    case 'stars_awarded':
      return t('act_stars_awarded', { n: String(entry.amount ?? 0), subject: entry.subject });
    case 'member_joined': return t('act_member_joined');
    case 'list_cleared': return t('act_list_cleared', { n: String(entry.amount ?? 0) });
    case 'week_planned': return t('act_week_planned');
    case 'doc_shared': return t('act_doc_shared', { subject: entry.subject });
    case 'pot_pledge':
      return t('act_pot_pledge', { amount: String(entry.amount ?? 0), subject: entry.subject });
    case 'santa_opened': return t('act_santa_opened');
    default: return '';
  }
}
