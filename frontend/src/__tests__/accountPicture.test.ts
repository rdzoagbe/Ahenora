/**
 * Your own picture, on your own profile.
 *
 * "Keigh can't modify hers on the iPhone." She could not modify it anywhere.
 * The picker existed and worked — on /member, reachable only by going to the
 * Family tab and opening your own row. The screen you land on by tapping your
 * own portrait showed a grey circle with your initial in it, and offered
 * nothing. There was no route from a person to their own picture.
 *
 * Not an iPhone bug. It only looked like one because that is the phone
 * somebody tried it on.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ACCOUNT = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'account.tsx'), 'utf8');

describe('the account screen lets you set your own picture', () => {
  it('offers the picker', () => {
    expect(ACCOUNT).toContain('AvatarPicker');
    expect(ACCOUNT).toContain('account-picture');
  });

  it('shows the picture you have, not just an initial', () => {
    expect(ACCOUNT).toContain('<PersonAvatar');
  });

  it('still falls back to the initial while the roster is loading', () => {
    // A blank hole where a face goes is worse than a letter.
    expect(ACCOUNT).toMatch(/me \?[\s\S]{0,240}styles\.avatarText/);
  });

  it('saves against your own row, found by is_me', () => {
    // Not by name: two people in a household can share one.
    expect(ACCOUNT).toContain('rows.find((m) => m.is_me)');
    expect(ACCOUNT).toContain('api.updateFamilyMember(me.member_id');
  });

  it('puts the picture back if the save fails', () => {
    // It answers the tap immediately, so a failure that left the new picture
    // on screen would be the app lying about what it had stored.
    expect(ACCOUNT).toMatch(/catch[\s\S]{0,200}avatar: before/);
  });

  it('says why in the reader’s language, not the server’s', () => {
    expect(ACCOUNT).toContain('apiErrorText(e, t,');
  });
});
