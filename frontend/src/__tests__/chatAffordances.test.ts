/**
 * The ways into a message, and the words around them.
 *
 * Roland's report after using the new chat for a day:
 *
 *   "the reply doesn't say if you're replying to text or the emojies"
 *
 * Holding a message opened one sheet containing six emoji and a Reply button
 * with nothing between them, so the emoji read as "reply with this emoji"
 * rather than "react". A feature nobody can tell apart from a different
 * feature is not finished, and no test could have caught it because every
 * test knew what the buttons meant.
 *
 *   "can we add a slide to answer like the WhatsApp function"
 *
 * Holding is discoverable and reaches every action; dragging is the gesture
 * people already have in their thumbs. Both, not one.
 *
 * These are source-level on purpose: they are rules about what this component
 * must offer, which survive any refactor of how it renders.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'ChatThread.tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

describe('the hold menu says which half is which', () => {
  it('labels the emoji as reacting, not replying', () => {
    expect(SRC).toContain("t('chat_react_label')");
    expect(SRC).toContain("t('chat_actions_label')");
  });

  it('separates the two halves visually as well as in words', () => {
    expect(SRC).toContain('styles.sheetRule');
  });

  it('has those words in every language the app ships', () => {
    // Four locales; an unlabelled sheet in French is the same bug again.
    expect((I18N.match(/chat_react_label:/g) || []).length).toBe(4);
    expect((I18N.match(/chat_actions_label:/g) || []).length).toBe(4);
  });
});

describe('two ways to answer a message', () => {
  it('drags to reply', () => {
    expect(SRC).toContain('Gesture.Pan()');
    expect(SRC).toContain('onSwipeReply');
  });

  it('only to the right', () => {
    // Dragging left is how a row is deleted or dismissed elsewhere on both
    // platforms; answering somebody must not share that gesture.
    expect(SRC).toContain('if (e.translationX <= 0)');
  });

  it('lets a vertical scroll stay a scroll', () => {
    // Without this the list becomes unscrollable: every drag down the thread
    // is read as the start of a reply.
    expect(SRC).toContain('.failOffsetY(');
  });

  it('still offers the long press, which is the only route to the rest', () => {
    expect(SRC).toContain('onLongPress={() => onHold(item)}');
  });

  it('shows what the drag is going to do while you are doing it', () => {
    expect(SRC).toContain('swipeHint');
  });

  it('gives each row its own animation rather than one shared value', () => {
    // A single Animated.Value shared by every row would drag the whole thread
    // sideways at once. This is why the row is its own component.
    expect(SRC).toContain('function MessageRow(');
    expect(SRC).toMatch(/const dx = useRef\(new Animated\.Value\(0\)\)/);
  });

  it('tells a screen reader about both routes', () => {
    expect(SRC).toContain("accessibilityHint={t('chat_reply_hint')}");
    expect(I18N).toContain('Swipe right to reply, or press and hold for more');
  });
});

describe('a chat is read at arm’s length', () => {
  it('sets message text at a size meant for a phone, not a screenshot', () => {
    const found = SRC.match(/msgText: \{[^}]*fontSize: (\d+(?:\.\d+)?)/);
    expect(found).not.toBeNull();
    expect(Number(found![1])).toBeGreaterThanOrEqual(16);
  });

  it('gives the text room to breathe', () => {
    const found = SRC.match(/msgText: \{[^}]*lineHeight: (\d+(?:\.\d+)?)/);
    expect(Number(found![1])).toBeGreaterThanOrEqual(22);
  });

  it('never disables the reader’s own font scaling', () => {
    // Someone who has made system text bigger has already told us what they
    // need; an allowFontScaling={false} anywhere here would overrule them.
    expect(SRC).not.toContain('allowFontScaling={false}');
  });
});

describe('the update banner names the right shop', () => {
  it('has an App Store sentence as well as a Play Store one, in every language', () => {
    // The LINK was made platform-aware when an iPhone was being sent to Google
    // Play. The sentence beside it still said "Play Store" — the same bug
    // wearing the other half of the costume.
    expect((I18N.match(/update_store_body:/g) || []).length).toBe(4);
    expect((I18N.match(/update_store_body_ios:/g) || []).length).toBe(4);
  });

  it('picks between them by platform', () => {
    const notice = readFileSync(
      join(__dirname, '..', 'components', 'UpdateNotice.tsx'), 'utf8');
    expect(notice).toContain("Platform.OS === 'ios' ? 'update_store_body_ios' : 'update_store_body'");
  });

  it('no iOS string mentions the Play Store', () => {
    for (const line of I18N.split('\n')) {
      if (line.includes('update_store_body_ios')) {
        expect(line).not.toMatch(/Play Store/);
      }
    }
  });
});
