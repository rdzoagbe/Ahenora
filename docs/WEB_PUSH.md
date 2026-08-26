# Web Push — browser notifications when the tab is closed

Native Android gets push through Expo/RevenueCat. **Web Push** is the web-app
equivalent: a notification that shows up even when the Ahenora tab is closed,
on a laptop or an iPhone-in-Safari. It rides the same server code path as the
Android push — anything that calls `send_push_to_user` now also reaches a
subscribed browser.

**It stays OFF until the VAPID keys are set.** Until then the web app just uses
the in-app bell, exactly as before.

## How it works
- A **service worker** (`frontend/public/sw.js`, served at `/app/sw.js`) receives
  the push and shows the notification; tapping it focuses/opens the app.
- The browser subscribes via the **Push API**, authenticated with a **VAPID**
  keypair. The public key is handed to the app by `/api/notifications/web-config`;
  the private key signs each send.
- The message body is **encrypted per RFC 8291** on the server (no third-party
  push library — done with `cryptography`, proven by a round-trip test).

## Turning it on (one-time)

1. **Generate a VAPID keypair** (run once, keep the output):
   ```
   python3 backend/webpush.py
   ```
   It prints `VAPID_PRIVATE_KEY=…` and `VAPID_PUBLIC_KEY=…`.

2. **Set three variables in Railway** (backend service → Variables), then redeploy:
   ```
   VAPID_PUBLIC_KEY=<the public key>
   VAPID_PRIVATE_KEY=<the private key>          # secret
   VAPID_SUBJECT=mailto:support@ahenora.com     # a contact the push service can reach
   ```

3. **Verify:** open `https://<backend>/api/notifications/web-config` — it should
   report `{"enabled": true, "vapid_public_key": "…"}`.

That's the whole setup — no frontend env, no key in the app bundle (the web app
fetches the public key from the backend at runtime).

## How a user turns it on
Browser notifications turn on when the user flips **Push notifications** in
Settings on the web — that tap triggers the browser's permission prompt (browsers
require a real gesture) and subscribes. A returning, already-permitted browser
re-subscribes silently on sign-in. Sign-out drops the subscription.

## Verifying delivery (needs a real browser)
The encryption + signature are unit-tested (`tests/test_webpush.py`), but actual
delivery to a closed tab can only be confirmed in a browser against a live push
service (FCM / Mozilla). After the Railway vars are set: on ahenora.com, turn
Push notifications on in Settings, accept the browser prompt, then have someone
assign you a task — the notification should appear even with the tab closed.

## Notes
- iOS Safari supports Web Push only for a site **added to the Home Screen** (PWA
  installed). In a plain Safari tab, iOS does not deliver background web push —
  that's an Apple limitation, not ours. Android/desktop Chrome, Firefox and Edge
  work in a normal tab.
- A subscription the push service reports as gone (404/410) is pruned
  automatically, so dead browsers don't pile up.
