/**
 * "Who sees this" answered once, for the card and its vault copy alike.
 *
 * The sheet used to answer it for the card only: a scanned letter filed in
 * the vault went in private whatever the pills said, so "Everyone" shared the
 * task and hid the paper behind it. Roland: "I need to be able to choose who
 * I share the doc with." Three answers now, and one function turns the answer
 * into what each call needs, so the two halves cannot disagree.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sharingPayload, sharingIsIncomplete, shareModeOf } from '../sharing';

describe('one answer, two payloads', () => {
  it('everyone: shared card, shared document, no list', () => {
    expect(sharingPayload('everyone', [])).toEqual({ shared: true, vaultVisibility: 'shared' });
  });
  it('just me: private card, private document', () => {
    expect(sharingPayload('me', ['m2'])).toEqual({ shared: false, vaultVisibility: 'private' });
  });
  it('these people: shared and narrowed, on both', () => {
    expect(sharingPayload('chosen', ['m2', 'm3'])).toEqual({
      shared: true, visible_to_members: ['m2', 'm3'], vaultVisibility: 'selected',
    });
  });
  it('the list handed out is a copy, not the state', () => {
    const picked = ['m2'];
    const out = sharingPayload('chosen', picked);
    out.visible_to_members!.push('m9');
    expect(picked).toEqual(['m2']);
  });
});

describe('"these people" with nobody picked is not a decision', () => {
  it('is refused rather than filed as everyone or just me', () => {
    expect(sharingIsIncomplete('chosen', [])).toBe(true);
    expect(sharingIsIncomplete('chosen', ['m2'])).toBe(false);
    expect(sharingIsIncomplete('everyone', [])).toBe(false);
    expect(sharingIsIncomplete('me', [])).toBe(false);
  });
});

describe('an existing card reopens in the mode it was saved in', () => {
  it('reads the chosen list first, then the household flag', () => {
    expect(shareModeOf({ shared: true, chosen_visible_to: ['u_k'] })).toBe('chosen');
    expect(shareModeOf({ shared: true, chosen_visible_to: [] })).toBe('everyone');
    expect(shareModeOf({ shared: false })).toBe('me');
    expect(shareModeOf(null)).toBe('everyone');
  });
});

describe('the sheet actually uses it', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'AddCardModal.tsx'), 'utf8');
  it('offers the third answer', () => {
    expect(src).toContain('testID="share-chosen"');
    expect(src).toContain("t('addcard_share_choose')");
  });
  it('sends the same decision to the card and to the vault copy', () => {
    expect(src).toContain('const sharing = sharingPayload(shareMode, chosenIds);');
    expect(src).toContain('shared: sharing.shared,');
    expect(src).toContain('visibility: sharing.vaultVisibility,');
    expect(src).toContain('visible_to_members: sharing.visible_to_members,');
  });
  it('refuses to save "these people" with nobody picked', () => {
    expect(src).toContain('if (sharingIsIncomplete(shareMode, chosenIds)) {');
  });
  it('only offers people who can actually see something', () => {
    // A young child has no account; a chip for them would share with nobody.
    expect(src).toContain('members.filter((m) => m.has_account && !m.is_me)');
  });
});

describe('the strings exist in every language', () => {
  const i18n = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');
  for (const key of ['addcard_share_choose', 'addcard_share_choose_title', 'addcard_share_choose_empty',
                     'addcard_share_chosen_hint', 'vault_selected', 'vault_selected_hint', 'vault_selected_empty']) {
    it(key, () => {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    });
  }
});

describe('the Vault tab offers the same third answer on an upload', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'vault.tsx'), 'utf8');
  it('has a "some people" chip and shows the people to pick', () => {
    expect(src).toContain("(['private', 'shared', 'selected'] as VaultVisibility[])");
    expect(src).toContain('testID={`vault-share-with-${m.member_id}`}');
    expect(src).toContain('members.filter((m) => m.has_account && !m.is_me)');
  });
  it('sends the list with the upload, and refuses an empty one', () => {
    expect(src).toContain("visible_to_members: visibility === 'selected' ? chosenIds : undefined");
    expect(src).toContain("if (visibility === 'selected' && chosenIds.length === 0) {");
  });
  it('labels a narrowed document as such in the list', () => {
    expect(src).toContain("d.visibility === 'selected' ? (");
  });
});
