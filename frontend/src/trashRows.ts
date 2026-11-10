/**
 * How Recently deleted is laid out (app/trash.tsx): one row per thing, and one
 * row for everything a single delete took (a cleared list), which opens onto
 * its items so any one of them can come back alone.
 */
import type { TrashEntry } from './api';

/** One row on the screen: a single thing, or everything one delete removed. */
export type TrashRow =
  | { key: string; single: TrashEntry }
  | { key: string; batch: string; entries: TrashEntry[] };

/** Entries of the same batch become one row, placed where its newest was. */
export function trashRows(entries: TrashEntry[]): TrashRow[] {
  const rows: TrashRow[] = [];
  const batches = new Map<string, Extract<TrashRow, { batch: string }>>();
  for (const entry of entries) {
    if (!entry.batch_id) {
      rows.push({ key: entry.trash_id, single: entry });
      continue;
    }
    const existing = batches.get(entry.batch_id);
    if (existing) {
      existing.entries.push(entry);
    } else {
      const row = { key: entry.batch_id, batch: entry.batch_id, entries: [entry] };
      batches.set(entry.batch_id, row);
      rows.push(row);
    }
  }
  // A batch of one is just a thing.
  return rows.map((r) => ('batch' in r && r.entries.length === 1 ? { key: r.entries[0].trash_id, single: r.entries[0] } : r));
}

/** Whole days left before the server erases it, never below 0. */
export function daysLeft(expiresAt: string, now = Date.now()): number {
  const ms = Date.parse(expiresAt) - now;
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 86_400_000));
}
