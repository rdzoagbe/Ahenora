/**
 * "Annuler" after a delete: the thing went to Recently deleted, and one tap
 * brings it back. The server says where it went (a trash id, or the batch id
 * of a cleared list); with neither, there is nothing to undo and the toast is
 * a plain confirmation.
 *
 * Asked for on 2026-11-10 ("if I mistakenly deleted my list I can restore
 * recently deleted"); the bin itself is app/trash.tsx.
 */
import { api } from './api';
import { apiErrorText } from './apiError';
import type { ToastTone } from './components/AppToast';

type ShowToast = (message: string, tone?: ToastTone, action?: { label: string; onPress: () => void }) => void;
type Translate = (key: string, params?: Record<string, string | number>) => string;

export type UndoRefs = {
  trashIds?: (string | null | undefined)[];
  batchIds?: (string | null | undefined)[];
};

/** Restore what `refs` name: every single item, and every batch. */
export async function restoreRefs(refs: UndoRefs): Promise<void> {
  const trashIds = (refs.trashIds ?? []).filter((x): x is string => !!x);
  const batchIds = (refs.batchIds ?? []).filter((x): x is string => !!x);
  await Promise.all([
    ...trashIds.map((id) => api.restoreTrash(id)),
    ...batchIds.map((id) => api.restoreTrashBatch(id)),
  ]);
}

export function hasUndo(refs: UndoRefs): boolean {
  return [...(refs.trashIds ?? []), ...(refs.batchIds ?? [])].some(Boolean);
}

/** Space the plan has no room for: a Coffre document cannot come back. */
export function restoreErrorText(e: unknown, t: Translate): string {
  const err = e as { status?: number; planLimit?: { feature?: string } };
  if (err?.status === 402 && err?.planLimit?.feature === 'vault_storage') return t('trash_no_space');
  return apiErrorText(e, t, 'trash_restore_failed');
}

export function offerUndo(
  showToast: ShowToast,
  t: Translate,
  message: string,
  refs: UndoRefs,
  onRestored: () => void,
  /** Only when everything came back: undo what the delete did besides. */
  onUndone?: () => Promise<unknown> | void,
): void {
  if (!hasUndo(refs)) {
    showToast(message, 'success');
    return;
  }
  let pressed = false;
  showToast(message, 'success', {
    label: t('trash_undo'),
    onPress: async () => {
      // One tap is one undo; the toast stays a few seconds more.
      if (pressed) return;
      pressed = true;
      try {
        await restoreRefs(refs);
        await Promise.resolve(onUndone?.()).catch(() => undefined);
        showToast(t('trash_restored'), 'success');
      } catch (e) {
        showToast(restoreErrorText(e, t), 'error');
      } finally {
        // Whatever came back (all, some or none), the screen reads it again.
        onRestored();
      }
    },
  });
}
