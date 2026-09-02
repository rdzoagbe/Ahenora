/**
 * Scan a school letter, get an event you were actually told about.
 *
 * The scan already extracted the date and already knew the document was an
 * appointment card. It could not say so — the model was allowed only
 * SIGN_SLIP / RSVP / TASK, and the calendar reads APPOINTMENT — so the date
 * was found, shown, and then filed in the Feed where nobody was reminded.
 *
 * Now: the document goes to the Vault, the event joins the calendar's review
 * list, and one message says both things happened and where to go.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const MODAL = read('src', 'components', 'AddCardModal.tsx');
const CAMERA = read('src', 'components', 'CameraCaptureModal.tsx');
const CAPTURE = read('src', 'components', 'GlobalCapture.tsx');
const FEED = read('app', '(tabs)', 'feed.tsx');
const API = read('src', 'api.ts');
const I18N = read('src', 'i18n.ts');

describe('a scanned appointment', () => {
  it('is staged for review, not written straight to the calendar', () => {
    expect(MODAL).toContain('api.stageScannedEvent(');
    const branch = MODAL.slice(
      MODAL.indexOf('} else if (stagesAsEvent) {'),
      MODAL.indexOf('} else {', MODAL.indexOf('} else if (stagesAsEvent) {')));
    expect(branch.length).toBeGreaterThan(20);
    expect(branch).not.toContain('api.createCard(');
  });

  it('trusts the server on whether it is an event', () => {
    // The rule (event type AND a date) lives in one place and is tested there.
    // Re-deriving it here is how two answers to one question appear.
    expect(MODAL).toContain('!!initialDraft?.is_event');
  });

  it('never stages while editing an existing card', () => {
    expect(MODAL).toContain('const stagesAsEvent = !editCard &&');
  });

  it('needs a date before it can stage anything', () => {
    expect(MODAL).toMatch(/stagesAsEvent = !editCard && !!initialDraft\?\.is_event && !!dueDate/);
  });
});

describe('what the scan learned survives the trip to the sheet', () => {
  // Three screens build the draft. A field added to one and forgotten in the
  // others is silently dropped, and the feature looks broken at random.
  it.each([
    ['CameraCaptureModal', CAMERA],
    ['GlobalCapture', CAPTURE],
    ['feed', FEED],
  ])('%s carries is_event, expires_on and location', (_name, source) => {
    expect(source).toContain('is_event');
    expect(source).toContain('expires_on');
    expect(source).toContain('location');
  });
});

describe('the vault expiry finally has a producer', () => {
  it('the scan writes expires_on when it saves the document', () => {
    // /api/vault/expiry-alerts has existed for a while with nothing writing
    // this field, so it could only ever answer "nothing expiring soon".
    expect(MODAL).toContain('expiry_date: initialDraft?.expires_on || null');
    expect(API).toContain('expiry_date?: string | null');
  });
});

describe('the message says what happened and where to go', () => {
  it('covers the vault and the event together', () => {
    expect(MODAL).toContain('addcard_saved_vault_and_event_message');
  });

  it('still says something when the document was not filed', () => {
    // A letter worth an appointment but not worth keeping still produced an
    // event; saying nothing makes the scan look like it did nothing.
    expect(MODAL).toContain('addcard_saved_event_message');
  });

  it('both messages exist in all four languages', () => {
    for (const key of [
      'addcard_saved_vault_and_event_message',
      'addcard_saved_event_message',
    ]) {
      const hits = I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
      expect(`${key}:${hits.length}`).toBe(`${key}:4`);
    }
  });

  it('points at the calendar rather than just announcing a save', () => {
    const idx = I18N.indexOf('addcard_saved_vault_and_event_message');
    const line = I18N.slice(idx, I18N.indexOf('\n', idx));
    expect(line.toLowerCase()).toContain('calendar');
    expect(line.toLowerCase()).toMatch(/private|share/);
  });
});
