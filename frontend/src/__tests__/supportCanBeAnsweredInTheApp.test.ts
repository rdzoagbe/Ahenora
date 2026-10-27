/**
 * A support message is answered from the admin screen.
 *
 * Roland, 2026-10-27, on "Cancel subscription after trial" in the support
 * inbox: "I need to be able to respond to this too. If possible in the app."
 * The server half is pinned by tests/test_support_can_be_answered_in_the_app.py;
 * this pins the screen:
 *
 *  - every support message has a Reply that opens a box on the ticket, with
 *    Send, and Send & mark handled while it is open;
 *  - what was answered is listed on the ticket;
 *  - a failed send says so in the screen's own words and keeps the draft —
 *    the server's detail string goes to the log, never to the screen;
 *  - the client calls the reply route with the message and the close flag.
 */
import fs from 'fs';
import path from 'path';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('app', 'metrics.tsx');
const api = read('src', 'api.ts');
const replies = screen.slice(screen.indexOf('function TicketReplies'), screen.indexOf('function FoundingFamilies'));

describe('the support inbox can answer', () => {
  it('puts the reply box on each ticket', () => {
    expect(screen).toMatch(/<TicketReplies\s+ticket=\{tk\}/);
    expect(replies).toContain("testID={`ticket-reply-open-${ticket.ticket_id}`}");
    expect(replies).toContain("testID={`ticket-reply-send-${ticket.ticket_id}`}");
    expect(replies).toContain('Send & mark handled');
  });

  it('lists what was answered', () => {
    expect(replies).toContain('replies.map((r) =>');
    expect(replies).toContain('replied · ${lastSeenLabel(r.at)}');
  });

  it('keeps the draft when a send fails, and never shows the server detail', () => {
    const failure = replies.slice(replies.indexOf('} catch (e: any) {'), replies.indexOf('} finally {'));
    expect(failure).toContain("logger.warn('support reply failed', e?.message || e)");
    expect(failure).toContain('Your reply is still here.');
    expect(failure).not.toMatch(/setError\([^)]*e\?\.message/);
    expect(failure).not.toContain('setDraft(');
  });

  it('only clears the box after the server says it went', () => {
    const success = replies.slice(replies.indexOf('const out = await api.replySupportTicket'), replies.indexOf('} catch (e: any) {'));
    expect(success).toContain('onUpdated(out.ticket);');
    expect(success).toContain("setDraft('');");
  });

  it('calls the reply route with the message and the close flag', () => {
    expect(api).toMatch(/replySupportTicket: \(ticketId: string, message: string, close = false\)/);
    expect(api).toContain('`/admin/support-tickets/${encodeURIComponent(ticketId)}/reply`');
    expect(api).toContain("{ method: 'POST', body: { message, close } }");
  });
});
