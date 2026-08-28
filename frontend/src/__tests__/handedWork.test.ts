import { isHandedWorkForToday, handedWorkForToday } from '../handedWork';
import type { Card } from '../api';

const NOW = new Date('2026-08-28T19:00:00.000Z');

function card(over: Partial<Card>): Card {
  return {
    card_id: 'c1', type: 'TASK', title: 'Another test', status: 'OPEN',
    recurrence: 'none', due_date: null, shared: true,
  } as unknown as Card;
}
function make(over: Partial<Card>): Card {
  return { ...card({}), ...over } as Card;
}

describe('what handed-to-you work belongs on today', () => {
  it("hides a recurring chore's next occurrence until it comes round", () => {
    // The report: completing a recurring task spawns tomorrow's instance with
    // the same title, and it appeared straight away — looking exactly like the
    // task refusing to be completed.
    const tomorrow = make({ recurrence: 'daily', due_date: '2026-08-29T19:00:00.000Z' });
    expect(isHandedWorkForToday(tomorrow, NOW)).toBe(false);
  });

  it('shows a recurring chore once it is actually due', () => {
    const today = make({ recurrence: 'daily', due_date: '2026-08-28T21:00:00.000Z' });
    expect(isHandedWorkForToday(today, NOW)).toBe(true);
  });

  it('shows a recurring chore that is overdue', () => {
    const late = make({ recurrence: 'weekly', due_date: '2026-08-20T09:00:00.000Z' });
    expect(isHandedWorkForToday(late, NOW)).toBe(true);
  });

  it('keeps a one-off task handed to you even when it is due next week', () => {
    // The opposite failure, already reported once: an assigned task due next
    // week showed nowhere on the Feed and only on the Calendar.
    const nextWeek = make({ recurrence: 'none', due_date: '2026-09-04T09:00:00.000Z' });
    expect(isHandedWorkForToday(nextWeek, NOW)).toBe(true);
  });

  it('keeps undated work, recurring or not', () => {
    expect(isHandedWorkForToday(make({ recurrence: 'none', due_date: null }), NOW)).toBe(true);
    expect(isHandedWorkForToday(make({ recurrence: 'daily', due_date: null }), NOW)).toBe(true);
  });

  it('never lists anything already done', () => {
    expect(isHandedWorkForToday(make({ status: 'DONE' } as Partial<Card>), NOW)).toBe(false);
  });

  it('keeps work whose date cannot be read rather than hiding it', () => {
    const broken = make({ recurrence: 'daily', due_date: 'not-a-date' });
    expect(isHandedWorkForToday(broken, NOW)).toBe(true);
  });

  it('filters a list and preserves its order', () => {
    const rows = [
      make({ card_id: 'a', recurrence: 'daily', due_date: '2026-08-29T19:00:00.000Z' }),
      make({ card_id: 'b', recurrence: 'none', due_date: '2026-09-04T09:00:00.000Z' }),
      make({ card_id: 'c', recurrence: 'daily', due_date: '2026-08-28T08:00:00.000Z' }),
    ];
    expect(handedWorkForToday(rows, NOW).map((c) => c.card_id)).toEqual(['b', 'c']);
  });
});
