/**
 * A record that failed to load must not look like a record that is empty.
 *
 * `member.tsx` rendered the whole health section as `{record ? (...) : null}`.
 * Three different situations produced the same nothing: still loading, failed
 * to load, and loaded-but-blank. The only trace of a failure was a log line.
 *
 * On this screen that is the worst of the three to get wrong. The record holds
 * allergies, medication and a doctor's number, and the person most likely to
 * open it is a carer checking one specific thing before giving a child food.
 * "No allergy recorded" and "the request did not come back" must not look
 * alike, because one of them means it is safe to proceed.
 *
 * The Feed already had this right — a tappable panel with an icon and a retry
 * — which is why this follows its shape rather than inventing another. (I had
 * this backwards during the review: I reported the Feed as the silent one,
 * because I grepped for `errorMessage` and its state is called `loadError`.
 * The Feed was already the best of the five. This screen was the gap.)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MEMBER = readFileSync(
  join(__dirname, '..', '..', 'app', 'member.tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('the three states are told apart', () => {
  it('tracks loading, ready and failed rather than a bare null', () => {
    expect(MEMBER).toContain(
      "useState<'loading' | 'ready' | 'failed'>('loading')");
  });

  it('marks a failed load as failed instead of only logging it', () => {
    // The whole bug: the catch wrote to the log and left the UI identical to
    // a household that simply has nothing recorded.
    expect(MEMBER).toMatch(/catch[\s\S]{0,160}setRecordState\('failed'\)/);
  });

  it('says so on screen, in a panel that offers a way out', () => {
    expect(MEMBER).toContain("recordState === 'failed'");
    expect(MEMBER).toContain('testID="record-retry"');
    expect(MEMBER).toContain('onPress={loadRecord}');
    expect(MEMBER).toContain("t('rec_load_failed')");
  });

  it('shows a spinner while it is still coming, not an empty section', () => {
    expect(MEMBER).toContain("recordState === 'loading' && !record");
  });

  it('does not show the record and the failure at the same time', () => {
    // A stale record left on screen under a "could not load" banner is worse
    // than either alone — it invites acting on data that may have moved.
    expect(MEMBER).toContain("record && recordState !== 'failed'");
  });

  it('has the words in every language the app ships', () => {
    expect(inEveryLanguage('rec_load_failed')).toBe(4);
  });
});

describe('a failed save falls back to something true', () => {
  it('re-reads the server copy, and says so if the re-read also fails', () => {
    // The code already re-fetched after a failed vaccination save, with the
    // reason written down: "a field left showing what we failed to save is a
    // date the parent believes is recorded and is not." That recovery
    // swallowed its own failure, so the harm it described still happened —
    // silently, with a date on screen that nobody stored.
    expect(MEMBER).toMatch(
      /getMemberRecord\(id\)[\s\S]{0,260}catch[\s\S]{0,200}setRecordState\('failed'\)/);
    expect(MEMBER).not.toContain('api.getMemberRecord(id).then(setRecord).catch(() => {});');
  });
});
