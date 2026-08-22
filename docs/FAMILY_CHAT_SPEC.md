# Family chat — spec (delivers teen chat #26 + family messages #25)

Messaging inside a household, built so **parents can talk to everyone — each
other and each teen — without ever breaking the teen privacy promise** ("teens
see nothing of the family's business").

## Threads

| Thread key      | Who's in it                          | Who can reach it |
|-----------------|--------------------------------------|------------------|
| `adults`        | Parents / co-parents                 | `require_full_member` (parents only — teens and helpers excluded) |
| `<teen_user_id>`| The parents **and** that one teen    | Parents via `require_full_member`; the teen via `require_teen`, **scoped to their own id only** |

- A teen only ever sees **their own** thread — never `adults`, never another
  teen's thread. The server forces the teen's thread key to their own user id;
  it never trusts a client-supplied key.
- A parent sees `adults` + one thread per teen in **their** family (verified
  server-side).
- Helpers are not in chat in slice 1 (parent chat is `require_full_member`,
  which 403s them). Parent↔helper threads are a later slice.

## Data model — `messages` collection
`{ message_id, family_id, thread, sender_user_id, sender_kind ('parent'|'teen'),
   sender_name, text, created_at, read_by: [user_id, …] }`

- `thread` is `'adults'` or a teen's user id.
- Unread for a viewer = messages in the thread where `sender_user_id != viewer`
  and `viewer not in read_by`. Marking a thread read appends the viewer to
  `read_by` on its messages.
- Text only, sanitized, length-capped (2000). No family data is ever joined —
  the collection stands alone, so a teen reading their thread still can't reach
  the calendar, vault, or anyone else.

## Endpoints

**Parent side — `require_full_member`**
- `GET  /api/family/chat/threads` → the `adults` thread + one per teen, each
  with last message, timestamp, and unread count.
- `GET  /api/family/chat/{thread}` → messages (thread validated: `adults`, or a
  teen in this family).
- `POST /api/family/chat/{thread}` → send.
- `POST /api/family/chat/{thread}/read` → mark read.

**Teen side — `require_teen`**
- `GET  /api/teen/chat` → the teen's own thread only.
- `POST /api/teen/chat` → send (thread forced to their user id).
- `POST /api/teen/chat/read` → mark read.

## Notifications
- Teen sends → push to each parent/co-parent.
- Parent sends to a teen thread → push to that teen.
- Parent sends to `adults` → push to the other adults.

## Security tests (the point)
- A teen token can only read/write **their own** thread; naming `adults` or
  another teen's id is refused / silently scoped away.
- A teen token is refused by every parent chat route (`require_full_member`
  rides `require_user`, which already 403s teens).
- A helper token is refused by the parent chat routes.
- A parent can reach `adults` and only teens in their own family.

## Out of slice 1 → later
Media/attachments, typing indicators, edit/delete, parent↔helper threads,
per-message reactions.
