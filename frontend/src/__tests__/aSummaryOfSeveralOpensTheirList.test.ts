/**
 * "Aujourd'hui · 2 choses encore en attente": tapping it opened the Feed,
 * which leads with today, so the two older jobs were nowhere in sight
 * (reported a third time on 2026-11-11). It now opens "À traiter", the list
 * of exactly them. scripts/e2e_digest_tap.py holds it in a browser through
 * the real tap path.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const FEED = fs.readFileSync(path.join(root, 'app', '(tabs)', 'feed.tsx'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');

describe('the Feed, opened by a summary of several things', () => {
  it('reads the cards again, then opens the list, with no card sheet under it', () => {
    const body = FEED.slice(FEED.indexOf('const attentionHandled = useRef(false);'),
      FEED.indexOf('// What the open list shows is what has been seen'));
    expect(body).toContain('load().finally(() => {');
    expect(body.indexOf('setSelectedCard(null);')).toBeLessThan(body.indexOf('setShowAlerts(true);'));
  });

  it('keeps the parameter while the list is open, and clears it when it closes', () => {
    // Clearing it on arrival meant the layout never saw it, and pushed the
    // tap again four times, reopening a list the reader had just closed.
    const body = FEED.slice(FEED.indexOf('const attentionHandled = useRef(false);'),
      FEED.indexOf('// What the open list shows is what has been seen'));
    expect(body).toContain("if (!showAlerts && attentionShown.current && openFromNotification === 'attention') {");
    expect(body.indexOf('router.setParams({ open: undefined }')).toBeGreaterThan(body.indexOf('// Closed: the parameter goes'));
  });

  it('marks as seen what the open list shows, including cards that arrive after', () => {
    expect(FEED).toContain('if (showAlerts) markAlertsSeen();');
  });
});

describe('the layout, holding a tapped notification', () => {
  it('counts the tap as arrived once its target was seen, even if a screen then clears it', () => {
    expect(LAYOUT).toContain('held.seen = true;');
    expect(LAYOUT).toContain('if (held.seen || (held.attempts > 0');
  });
});
