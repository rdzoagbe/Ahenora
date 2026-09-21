/**
 * The app's side of the handover contract.
 *
 * The rule "an adult invitation must hand something over" lives in the screens,
 * not on the wire, so that a client which has not yet picked up this build can
 * still invite somebody. These pin the parts of that rule which are testable
 * without a device: what the client sends, and the shape it expects back.
 */
import * as fs from 'fs';
import * as path from 'path';

const API = path.join(__dirname, '..', 'api.ts');
const PICKER = path.join(__dirname, '..', 'components', 'HandoverPicker.tsx');
const SETTINGS = path.join(__dirname, '..', '..', 'app', '(tabs)', 'settings.tsx');
const SERVER = path.join(__dirname, '..', '..', '..', 'backend', 'server.py');

const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('The client asks the server for what it may hand over', () => {
  it('calls the candidates route the backend actually serves', () => {
    expect(read(API)).toContain("'/family/invite/handover-candidates'");
    expect(read(SERVER)).toContain('@app.get("/api/family/invite/handover-candidates")');
  });

  it('registers that route before the catch-all token route', () => {
    // Both live under /api/family/invite/. FastAPI matches in registration
    // order, so if the {token} route were declared first, asking for the
    // candidates would be read as a lookup of an invitation whose token is
    // the literal string "handover-candidates" — a 404 that looks like the
    // household simply has nothing to give.
    const src = read(SERVER);
    const candidates = src.indexOf('@app.get("/api/family/invite/handover-candidates")');
    const token = src.indexOf('@app.get("/api/family/invite/{token}")');
    expect(candidates).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(-1);
    expect(candidates).toBeLessThan(token);
  });

  it('sends the chosen card with an emailed invitation', () => {
    expect(read(API)).toContain('body.handover_card_id = opts.handover_card_id');
  });

  it('sends it with a shared link too', () => {
    // Phone and link invitations are adult invitations as much as email is;
    // a handover that only rode on email would be a rule with a hole in it.
    expect(read(API)).toMatch(/createInviteLink[\s\S]{0,400}handover_card_id/);
  });
});

describe('The screen is where the requirement lives', () => {
  const settings = read(SETTINGS);

  it('refuses to send an emailed invitation with nothing chosen', () => {
    expect(settings).toContain("setInviteResult(t('handover_required'))");
  });

  it('applies the same rule to the phone invitation', () => {
    const guards = settings.match(/handoverPossible && !handoverCardId/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it('stops requiring a choice when the household has nothing to give', () => {
    // A household made five minutes ago has no cards. Requiring a handover
    // there would be an invitation nobody could send.
    expect(settings).toContain('onAvailability={setHandoverPossible}');
    expect(settings).toContain('handoverPossible && !handoverCardId');
  });

  it('forgets the choice once the invitation is sent', () => {
    // Otherwise the next invitation silently re-promises the same card, which
    // by then belongs to the person who accepted the first one.
    expect(settings).toMatch(/setInviteEmail\('''?\)[\s\S]{0,120}setHandoverCardId\(null\)/);
  });
});

describe('The picker never blocks the invitation on its own failure', () => {
  const picker = read(PICKER);

  it('treats an empty list as "no choice required"', () => {
    expect(picker).toContain('onAvailability?.(rows.length > 0)');
  });

  it('treats a failed load the same way rather than as a wall', () => {
    expect(picker).toMatch(/catch[\s\S]{0,400}onAvailability\?\.\(false\)/);
  });

  it('lets a mis-tap be undone in one tap', () => {
    expect(picker).toContain('chosen ? onChange(null, null)');
  });
});

describe('Every door out of the invite sheet obeys the same rule', () => {
  const settings = read(SETTINGS);

  it('guards email, phone AND link, not just the first two', () => {
    // The link was the one door without the guard, so the requirement could
    // be walked around simply by choosing Link. Found in review.
    const guards = settings.match(/handoverPossible && !handoverCardId/g) || [];
    expect(guards.length).toBe(3);
  });

  it('spends the choice on every path that creates an invitation', () => {
    // Otherwise a second invitation from the same open sheet silently
    // re-promises the same card to two people, and only the first can have it.
    const spent = settings.match(/setHandoverCardId\(null\)/g) || [];
    expect(spent.length).toBe(3);
  });
});
