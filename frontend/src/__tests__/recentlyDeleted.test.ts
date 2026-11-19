/**
 * Recently deleted, the app's side (tests/test_recently_deleted.py is the
 * server's). Asked for on 2026-11-10: "if I mistakenly deleted my list I can
 * restore recently deleted without putting back all the list, and it should
 * be the same for any place where we have data stored".
 */
import fs from 'fs';
import path from 'path';

const mockRestore = jest.fn();
const mockRestoreBatch = jest.fn();
jest.mock('../api', () => ({
  api: {
    restoreTrash: (...a: unknown[]) => mockRestore(...a),
    restoreTrashBatch: (...a: unknown[]) => mockRestoreBatch(...a),
  },
}));
jest.mock('../apiError', () => ({ apiErrorText: (_e: unknown, t: (k: string) => string, k: string) => t(k) }));

import { daysLeft, trashRows } from '../trashRows';
import { offerUndo, restoreErrorText } from '../trashUndo';
import type { TrashEntry } from '../api';
import { TRANSLATIONS } from '../i18n';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const t = (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k);

const entry = (id: string, batch: string | null = null): TrashEntry => ({
  trash_id: id, kind: 'shopping_item', label: id, deleted_by_name: 'Roland',
  deleted_at: '2026-11-10T10:00:00+00:00', expires_at: '2026-12-10T10:00:00+00:00', batch_id: batch,
});

beforeEach(() => { mockRestore.mockReset(); mockRestoreBatch.mockReset(); });

describe('the rows', () => {
  it('shows a cleared list as one row, where its newest item was, with all its items', () => {
    const rows = trashRows([entry('a'), entry('b1', 'B'), entry('c'), entry('b2', 'B')]);
    expect(rows.map((r) => r.key)).toEqual(['a', 'B', 'c']);
    const batch = rows[1] as { entries: TrashEntry[] };
    expect(batch.entries.map((e) => e.trash_id)).toEqual(['b1', 'b2']);
  });

  it('shows a batch of one as just that thing', () => {
    expect(trashRows([entry('only', 'B')])).toEqual([{ key: 'only', single: entry('only', 'B') }]);
  });

  it('counts whole days left, never below none', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    expect(daysLeft('2026-12-10T10:00:00+00:00', now)).toBe(30);
    expect(daysLeft('2026-11-10T11:00:00+00:00', now)).toBe(1);
    expect(daysLeft('2026-11-09T10:00:00+00:00', now)).toBe(0);
    expect(daysLeft('not a date', now)).toBe(0);
  });
});

describe('"Annuler" after a delete', () => {
  it('offers to undo when the server filed it, and brings back the thing and the batch', async () => {
    const showToast = jest.fn();
    const onRestored = jest.fn();
    offerUndo(showToast, t, 'Deleted', { trashIds: ['t1', null], batchIds: ['B'] }, onRestored);
    const [message, tone, action] = showToast.mock.calls[0];
    expect([message, tone, action.label]).toEqual(['Deleted', 'success', 'trash_undo']);
    await action.onPress();
    expect(mockRestore).toHaveBeenCalledWith('t1');
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockRestoreBatch).toHaveBeenCalledWith('B');
    expect(showToast).toHaveBeenLastCalledWith('trash_restored', 'success');
    expect(onRestored).toHaveBeenCalled();
  });

  it('undoes once however often it is tapped', async () => {
    const showToast = jest.fn();
    offerUndo(showToast, t, 'Deleted', { trashIds: ['t1'] }, jest.fn());
    const { onPress } = showToast.mock.calls[0][2];
    await Promise.all([onPress(), onPress()]);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('undoes what the delete did besides only once everything is back', async () => {
    const onUndone = jest.fn();
    const showToast = jest.fn();
    offerUndo(showToast, t, 'Cleared', { batchIds: ['B'] }, jest.fn(), onUndone);
    await showToast.mock.calls[0][2].onPress();
    expect(onUndone).toHaveBeenCalledTimes(1);

    mockRestoreBatch.mockRejectedValue({ status: 500 });
    const failed = jest.fn();
    const showToast2 = jest.fn();
    offerUndo(showToast2, t, 'Cleared', { batchIds: ['B'] }, jest.fn(), failed);
    await showToast2.mock.calls[0][2].onPress();
    expect(failed).not.toHaveBeenCalled();
  });

  it('takes the dated copy of the plan away when "Tout retirer" is undone', () => {
    const kitchen = read('app', '(tabs)', 'kitchen.tsx');
    expect(kitchen).toContain('const gone = await api.deleteSavedPlan(snapshotId as string);');
    expect(kitchen).toContain('if (gone?.trash_id) await api.purgeTrash(gone.trash_id);');
  });

  it('shows the expense toast on screen inside Cuisine', () => {
    expect(read('app', '(tabs)', 'kitchen.tsx')).toContain('<SpendingView embedded showToast={showToast} />');
  });

  it('is a plain confirmation when there is nothing to undo', () => {
    const showToast = jest.fn();
    offerUndo(showToast, t, 'Deleted', { trashIds: [undefined] }, jest.fn());
    expect(showToast).toHaveBeenCalledWith('Deleted', 'success');
  });

  it('says so when it could not come back, and still reads the screen again', async () => {
    mockRestore.mockRejectedValue({ status: 402, planLimit: { feature: 'vault_storage' } });
    const showToast = jest.fn();
    const onRestored = jest.fn();
    offerUndo(showToast, t, 'Deleted', { trashIds: ['t1'] }, onRestored);
    await showToast.mock.calls[0][2].onPress();
    expect(showToast).toHaveBeenLastCalledWith('trash_no_space', 'error');
    expect(onRestored).toHaveBeenCalled();
  });

  it('names a full Coffre apart from any other failure', () => {
    expect(restoreErrorText({ status: 402, planLimit: { feature: 'vault_storage' } }, t)).toBe('trash_no_space');
    expect(restoreErrorText({ status: 500 }, t)).toBe('trash_restore_failed');
  });

  it('stays on screen long enough to be tapped', () => {
    expect(read('src', 'hooks', 'useToast.ts')).toContain('ACTION_TOAST_MS = 6000');
  });
});

describe('every place that deletes', () => {
  it('offers "Annuler" on the shopping list, meals, Coffre, completed items and expenses', () => {
    const kitchen = read('app', '(tabs)', 'kitchen.tsx');
    expect((kitchen.match(/offerUndo\(/g) || []).length).toBeGreaterThanOrEqual(7);
    for (const file of [['app', '(tabs)', 'vault.tsx'], ['app', 'history.tsx'], ['src', 'components', 'SpendingView.tsx']]) {
      expect(read(...file)).toContain('offerUndo(showToast, t,');
    }
  });

  it('passes the toast\'s button through wherever "Annuler" is offered', () => {
    for (const file of [['app', '(tabs)', 'kitchen.tsx'], ['app', '(tabs)', 'vault.tsx'], ['app', 'history.tsx'],
      ['src', 'components', 'SpendingView.tsx'], ['app', 'trash.tsx']]) {
      expect(read(...file)).toMatch(/<AppToast[^>]*action=\{toast\?\.action/);
    }
  });

  it('no longer says a delete cannot be undone', () => {
    const i18n = read('src', 'i18n.ts');
    for (const key of ['vault_delete_doc_message', 'set_delete_card_msg']) {
      const lines = i18n.split('\n').filter((l) => new RegExp(`^\\s*${key}:`).test(l));
      expect(lines).toHaveLength(4);
      for (const line of lines) expect(line).not.toMatch(/undone|deshacer|annul|rückgängig/i);
    }
  });
});

describe('the screen', () => {
  it('is reached from Settings and registered as a route', () => {
    const settings = read('app', '(tabs)', 'settings.tsx');
    expect(settings).toContain('testID="settings-trash"');
    expect(settings).toContain("router.push('/trash' as never)");
    expect(read('app', '_layout.tsx')).toContain('<Stack.Screen name="trash" />');
  });

  it('restores one thing, a whole cleared list, or erases, and asks before erasing', () => {
    const screen = read('app', 'trash.tsx');
    expect(screen).toContain('api.restoreTrash(entry.trash_id)');
    expect(screen).toContain('api.restoreTrashBatch(row.batch)');
    expect(screen).toContain("Alert.alert(t('trash_erase_q')");
    expect(screen).toContain("Alert.alert(t('trash_empty_all_q')");
  });

  it('is worded in all four languages', () => {
    const i18n = read('src', 'i18n.ts');
    const keys = ['trash_title', 'trash_sub', 'trash_empty', 'trash_restore', 'trash_erase', 'trash_erase_q',
      'trash_erase_body', 'trash_empty_all', 'trash_empty_all_q', 'trash_empty_all_body', 'trash_restored',
      'trash_restore_failed', 'trash_erase_failed', 'trash_no_space', 'trash_undo', 'trash_moved_one', 'trash_moved_n', 'trash_by',
      'trash_days_left', 'trash_day_left', 'trash_batch', 'trash_batch_meal', 'trash_settings_row',
      'trash_kind_shopping_item', 'trash_kind_card', 'trash_kind_vault_doc', 'trash_kind_expense',
      'trash_kind_meal', 'trash_kind_saved_plan'];
    for (const key of keys) {
      expect([key, (i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length]).toEqual([key, 4]);
    }
  });

  it('has a name for every kind the server files', () => {
    const server = read('..', 'backend', 'server.py');
    const block = server.slice(server.indexOf('TRASH_KINDS = {'), server.indexOf('def _trash_private_to'));
    const kinds = [...block.matchAll(/^ {4}"([a-z_]+)": \{/gm)].map((m) => m[1]);
    expect(kinds.length).toBe(6);
    for (const kind of kinds) expect(read('src', 'i18n.ts')).toContain(`trash_kind_${kind}:`);
  });
});

describe('the policy change is said in the app', () => {
  // The policy promises: "We will announce material changes in the app".
  const notice = read('src', 'components', 'PolicyNotice.tsx');

  it('announces the date the policy was updated', () => {
    const policy = JSON.parse(read('..', 'legal', 'privacy.json'));
    expect(policy.updated).toBe('10 November 2026');
    expect(notice).toContain("export const POLICY_NOTICE_ID = '2026-11-10';");
    const dated = { en: '10 November 2026', es: '10 de noviembre de 2026',
      fr: '10 novembre 2026', de: '10. November 2026' } as const;
    for (const [lang, date] of Object.entries(dated)) {
      expect([lang, TRANSLATIONS[lang as keyof typeof dated].policy_notice_body.includes(date)]).toEqual([lang, true]);
    }
    const i18n = read('src', 'i18n.ts');
    for (const key of ['policy_notice_title', 'policy_notice_body', 'policy_notice_read', 'policy_notice_ok']) {
      expect([key, (i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length]).toEqual([key, 4]);
    }
  });

  it('says what people can do about it: erase for good, at any time', () => {
    // WP260 rev.01 para. 31: explain the likely impact of the change.
    const said = { en: 'erase anything there for good, at any time',
      es: 'borrar allí cualquier cosa definitivamente, en cualquier momento',
      fr: 'effacer définitivement ce que vous voulez, à tout moment',
      de: 'jederzeit endgültig löschen' } as const;
    for (const [lang, words] of Object.entries(said)) {
      expect([lang, TRANSLATIONS[lang as keyof typeof said].policy_notice_body.includes(words)]).toEqual([lang, true]);
    }
  });

  it('stays until acknowledged, links to the policy, and is on Home', () => {
    expect(notice).toContain('AsyncStorage.setItem(POLICY_NOTICE_KEY, POLICY_NOTICE_ID)');
    expect(notice).toContain("router.push('/privacy' as never)");
    expect(read('app', '(tabs)', 'feed.tsx')).toContain('<PolicyNotice />');
  });
});

