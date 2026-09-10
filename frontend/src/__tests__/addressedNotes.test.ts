/**
 * A handover has to be impossible to miss, and only for the person it names.
 *
 * The strip carrying someone's name is the only thing in this app that says a
 * person owes somebody an answer. Its whole value is that it is seen without
 * being looked for — which is exactly what was lost the first time it was
 * built: it landed inside the Household section, which is COLLAPSED by
 * default, so a handover addressed to you was visible only if you already
 * went hunting for it. Everything else about the feature worked; the point of
 * it did not. The browser harness caught it, and this keeps it caught cheaply.
 *
 * The asymmetry is deliberate and is what these tests pin: the composer is two
 * taps down inside Household, because writing a note is something you choose
 * to do; the strip is top-level, because reading one is not.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const FEED = readFileSync(join(ROOT, 'app', '(tabs)', 'feed.tsx'), 'utf8');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

describe('a handover waiting on you', () => {
  it('sits above the day, not inside a section you have to open', () => {
    // The bug, in one comparison. Household is collapsed by default
    // (showHousehold starts false), so anything rendered inside it is
    // invisible until tapped.
    const strip = FEED.indexOf('notesForMe.map');
    const household = FEED.indexOf('{showHousehold ? (');
    expect(strip).toBeGreaterThan(-1);
    expect(household).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(household);
  });

  it('is above the capture bar, the first thing on the Feed', () => {
    expect(FEED.indexOf('notesForMe.map'))
      .toBeLessThan(FEED.indexOf('style={styles.addBar}'));
  });

  it('shows only what is addressed to you and not yet taken on', () => {
    // Both halves matter: without for_me the whole household gets a strip
    // asking them to answer for someone else; without the acked check it
    // never leaves the screen.
    const memo = FEED.slice(FEED.indexOf('const notesForMe'),
                            FEED.indexOf('const notesForMe') + 260);
    expect(memo).toMatch(/n\.for_me/);
    expect(memo).toMatch(/!n\.acked_at/);
  });

  it('trusts the server about whose note it is', () => {
    // for_me is computed in public_handoff_note against the viewer's user id.
    // A client deciding it by name puts the acknowledge button in front of the
    // wrong person the moment a household has two people sharing one.
    expect(SERVER).toMatch(/"for_me": bool\(viewer_id and for_user_id and viewer_id == for_user_id\)/);
    expect(FEED).not.toMatch(/for_me\s*=\s*[^=]/);
  });

  it('gives the commitment a full-size target', () => {
    // 44 is the floor for a tap, and this is the one that commits you to
    // something. The chips above it are 36 — picking a recipient is not.
    const btn = FEED.slice(FEED.indexOf('noteAckBtn: {'), FEED.indexOf('noteAckBtn: {') + 260);
    expect(btn).toMatch(/height: 44/);
  });
});

describe('who can be given one', () => {
  it('offers only people who could pick one up', () => {
    // A child has no account; a teen lives behind their own screen and
    // require_user refuses their token. Neither could ever acknowledge.
    const picker = FEED.slice(FEED.indexOf('const noteRecipients'),
                              FEED.indexOf('const noteRecipients') + 320);
    expect(picker).toMatch(/m\.has_account/);
    expect(picker).toMatch(/!m\.is_me/);
    expect(picker).toMatch(/!== 'teen'/);
  });

  it('is refused server-side too, by name', () => {
    // The picker is a courtesy, not a gate: a client that offered the wrong
    // person would otherwise create a note nobody can ever take on, and the
    // sender would read "not yet" forever.
    expect(SERVER).toContain('async def _note_recipient');
    expect(SERVER).toMatch(/teen view and cannot pick up a note/);
    expect(SERVER).toMatch(/has no account, so nobody could pick this up/);
  });

  it('leaves the household note exactly as it was', () => {
    // Everyone is the default and stays first, so a household that never
    // touches the picker keeps the notes it already had.
    expect(FEED).toMatch(/useState<string \| null>\(null\)/);
    expect(FEED).toMatch(/\.\.\.\(noteFor \? \{ member_id: noteFor \} : \{\}\)/);
    expect(SERVER).toMatch(/elif not for_user_id:\s*\n\s*await send_coparent_alert/);
  });
});
