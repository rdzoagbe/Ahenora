/**
 * A list that stops short says so, and the rest can be reached.
 *
 * The server pages the chat, past shopping trips and saved meal plans
 * (tests/test_a_list_that_stops_short_says_so.py). The app's half: a way
 * back on each screen, and the cancelled-but-kept count in the sync summary.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const LANGS = ['en', 'es', 'fr', 'de'] as const;
const table = (lang: string) => (TRANSLATIONS as unknown as Record<string, Record<string, string>>)[lang];

describe('the chat reaches last month', () => {
  const thread = read('components', 'ChatThread.tsx');
  const api = read('api.ts');

  it('asks the server for the page before the oldest message on screen', () => {
    expect(thread).toContain('const res = await load(undefined, oldest);');
    expect(thread).toContain('testID="chat-load-earlier"');
    expect(thread).toContain("if (!delta) setHasMore(res.has_more === true);");
    expect(api).toContain('chatGet: (thread: string, since?: string, before?: string)');
    expect(api).toContain('teenChatGet: (since?: string, before?: string)');
    expect(read('..', 'app', 'conversation.tsx')).toContain('api.chatGet(thread, since, before)');
  });

  it('keeps the reader where they were when a page lands above them', () => {
    expect(thread).toContain('maintainVisibleContentPosition={{ minIndexForVisible: 0 }}');
  });
});

describe('past trips and saved plans go back', () => {
  const kitchen = read('..', 'app', '(tabs)', 'kitchen.tsx');

  it('offer "Show older" on a full page and stop on a short one', () => {
    expect(kitchen).toContain('testID="shop-history-older"');
    expect(kitchen).toContain('testID="saved-plans-older"');
    expect(kitchen).toContain('if (more.length < HISTORY_PAGE) setHistEnd(true);');
    expect(kitchen).toContain('if (more.length < HISTORY_PAGE) setPlansEnd(true);');
    expect(read('api.ts')).toContain('listShoppingHistory: (before?: string)');
    expect(read('api.ts')).toContain('listSavedPlans: (before?: string)');
  });
});

describe('a cancelled meeting that is kept is said', () => {
  it('in the sync summary', () => {
    expect(read('..', 'app', '(tabs)', 'calendar.tsx')).toContain("if (r.cancelled_kept) parts.push(t('cal_cancelled_kept', { n: r.cancelled_kept }));");
  });
});

describe('every new sentence exists in all four languages', () => {
  it.each(LANGS)('%s', (lang) => {
    for (const k of ['chat_load_earlier', 'kitchen_show_older', 'cal_cancelled_kept']) {
      expect([lang, k, typeof table(lang)[k]]).toEqual([lang, k, 'string']);
    }
    expect(table(lang).cal_cancelled_kept).toContain('{n}');
  });
});
