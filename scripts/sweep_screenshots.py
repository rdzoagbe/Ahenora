"""Photograph every screen of the web build, seeded, for a person to look at.

Not a pass/fail harness: a set of images to review. The app renders the same
components on Android, iOS and the web, so a wrong name, a clipped line or an
untranslated string seen here is seen everywhere.

Three things the first version could not see, each of which hid real bugs:

  BELOW THE FOLD. The web layout pins the app to the viewport
  (`body > div:first-child { position: fixed }`), so Playwright's full_page
  screenshot captures the visible window and nothing more — every shot
  stopped at the tab bar. A tall viewport makes the app itself render taller,
  which is the only way to see the bottom of a screen without stitching.

  WHAT IS BEHIND A TAP. Sheets and modals are where most of the app's typing
  happens, and none of them were ever photographed.

  THE OTHER TWO APPS. Kid mode and the teen screen are separate surfaces with
  their own layouts, and neither had ever been looked at.

Usage:  python3 scripts/sweep_screenshots.py <web-port> <api-port> <out-dir>
Requires serve_web.py on <web-port> and e2e_backend.py on <api-port>.
"""
import asyncio
import json
import os
import sys
import urllib.request
import uuid

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(__file__))
from e2e_browser import launch_chromium  # noqa: E402

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
OUT = sys.argv[3]

# A phone's width, and enough height that a long screen fits in one frame.
PHONE_W = 390
TALL_H = 2400

ROUTES = [
    "feed", "calendar", "kids", "kitchen", "vault", "settings", "account",
    "chat", "search", "expenses", "gift-pot", "santa", "pricing", "metrics",
    "terms", "privacy", "delete-account", "onboarding",
]
LOGGED_OUT = ["", "auth"]

# Everything a tap opens. (route, testID to press, name for the file).
# Skipped rather than failed when a control is not on screen: this is a
# camera, not a gate, and one missing button must not cost the other forty
# pictures.
# (route, [taps to get there], testID to press, name for the file).
#
# The middle list is why seven of these were reported "skipped" on every run
# and therefore never photographed: they live behind an expander. A camera
# that quietly declines to photograph a third of the rooms is not much of a
# camera, and "skipped" in a summary nobody reads is how it stayed that way.
MODALS = [
    ("feed", [], "feed-open-add", "add-card"),
    ("feed", [], "feed-household-open", "household"),
    ("kids", [], "kids-add-child", "add-child"),
    # A child's controls live on that child's page, so the child card has to be
    # opened first — and its testID carries the member id, hence the selector.
    ("kids", ["css:[data-testid^='child-']", "kids-show-more"], "kids-add-chore", "add-chore"),
    ("kids", ["css:[data-testid^='child-']", "kids-show-more"], "kids-add-reward", "add-reward"),
    ("kids", ["css:[data-testid^='child-']", "kids-show-more"], "kids-add-routine", "add-routine"),
    ("kids", ["css:[data-testid^='child-']", "kids-show-more"], "kids-assign-task", "assign-task"),
    ("calendar", [], "calendar-add-event", "add-event"),
    ("calendar", [], "calendar-sync-card-button", "calendar-sync"),
    ("expenses", [], "exp-add-open", "add-expense"),
    ("settings", ["settings-household-toggle"], "invite-coparent", "invite-coparent"),
    ("settings", ["settings-household-toggle"], "invite-helper", "invite-helper"),
    # The Sunday brief is deliberately absent. It only renders for a household
    # with the weekly-brief entitlement, and the admin-household check the
    # sweep relies on is cached for 60s — so it is unreachable here for timing
    # reasons rather than because anything is wrong. Its reachability is
    # guarded instead by src/__tests__/bundledAssets.test.ts, which is where it
    # was found unreachable in the first place.
    ("santa", [], "santa-add-name", "santa-name"),
]


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})}, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


SEED_FAILURES: list = []


def try_(method, path, body=None, token=None, label=""):
    """Seeding is best effort — one screen's content must not stop the sweep
    from photographing the others — but a failure is RECORDED and reported at
    the end, not left as one line scrolling past.

    The seed that creates a dated card had been failing with a 400 since this
    file was written. Every sweep photographed an empty calendar and every
    sweep looked fine, because a screen with nothing in it has nothing in it to
    look wrong. That is the whole failure mode this sweep exists to catch,
    happening to the sweep itself.
    """
    try:
        return api(method, path, body, token)
    except Exception as exc:  # noqa: BLE001
        SEED_FAILURES.append(f"{label or path}: {exc}")
        print(f"seed FAILED {label or path}: {exc}")
        return None


def seed():
    """A household with two parents, three children, a teen, and enough
    content that no screen is photographed empty."""
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Roland Sweep", "email": "e2e-admin@sim.test",
                                       "password": "password123"})
    tok = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    inv = api("POST", "/family/invite", {"email": f"keigh-{run}@sim.test",
                                         "relationship": "Co-parent"}, tok)
    b = api("POST", "/auth/register", {"name": "Keigh Sweep", "email": f"keigh-{run}@sim.test",
                                       "password": "password123",
                                       "invite_token": inv["invite"]["token"]})
    tok_b = b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_b)
    api("PATCH", "/auth/language", {"language": "fr"}, tok_b)

    for kid in ("Arielle", "Jonael", "Isaiah"):
        try_("POST", "/family/members", {"name": kid, "role": "Child", "age": 8}, tok, "child")
    try_("POST", "/shopping/bulk", {"names": ["Rice", "Beans", "Milk", "Bread"]}, tok, "shopping")
    try_("POST", "/cards", {"type": "TASK", "title": "Book the dentist", "shared": True}, tok, "card")
    # APPOINTMENT, not EVENT. There is no EVENT card type — POST /cards has
    # refused this call with 400 since the sweep was written, `try_` swallowed
    # it into one line of output, and the calendar has therefore been
    # photographed empty in every sweep ever run. The screens looked fine
    # because there was nothing in them to look wrong.
    try_("POST", "/cards", {"type": "APPOINTMENT", "title": "Swimming lesson",
                            "shared": True,
                            "due_date": "2026-09-12T16:00:00Z"}, tok, "dated card")
    try_("POST", "/cards", {"type": "TASK", "title": "Private: passport renewal",
                            "shared": False}, tok, "private card")
    try_("POST", "/handoff-notes", {"text": "Isaiah has a cold, keep him warm."}, tok, "handoff")
    try_("POST", "/family/chat/adults", {"text": "Can you pick up the kids Friday?"}, tok_b, "chat")

    # --- the teen's own app ------------------------------------------------
    teen_tok = None
    t_inv = try_("POST", "/family/invite",
                 {"email": f"teen-{run}@sim.test", "is_teen": True, "age": 15}, tok, "teen invite")
    if t_inv and t_inv.get("invite", {}).get("token"):
        teen = try_("POST", "/auth/register",
                    {"name": "Ama Sweep", "email": f"teen-{run}@sim.test",
                     "password": "password123",
                     "invite_token": t_inv["invite"]["token"]}, label="teen register")
        if teen:
            teen_tok = teen["session_token"]

    # --- kid mode ----------------------------------------------------------
    # Needs a PIN on a grown-up and on the child, then a swap into their view.
    kid_tok = None
    members = try_("GET", "/family/members", token=tok, label="members") or []
    parent = next((m for m in members if m.get("is_me")), None)
    child = next((m for m in members if (m.get("role") or "").lower() == "child"), None)
    if parent and child:
        try_("PUT", f"/family/members/{parent['member_id']}/pin", {"pin": "1234"}, tok, "parent pin")
        try_("PUT", f"/family/members/{child['member_id']}/pin", {"pin": "4321"}, tok, "child pin")
        kid = try_("POST", "/kid/session",
                   {"member_id": child["member_id"], "pin": "4321"}, tok, "kid session")
        if kid:
            kid_tok = kid["session_token"]

    return tok, tok_b, teen_tok, kid_tok


async def _context(browser, token, scheme, extra_init=""):
    ctx = await browser.new_context(
        viewport={"width": PHONE_W, "height": TALL_H},
        color_scheme=scheme, device_scale_factor=2)
    page = await ctx.new_page()

    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(
            f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json",
                         body=await resp.body())

    await page.route("**/api/**", route)
    init = extra_init + (f"localStorage.setItem('coo_session_token','{token}');" if token else "")
    if init:
        await page.add_init_script(init)
    return ctx, page


async def shoot(browser, token, look, routes, scheme="light", extra_init="", modals=()):
    ctx, page = await _context(browser, token, scheme, extra_init)
    errors, skipped = {}, []
    for r in routes:
        errs = []
        page.on("pageerror", lambda e, s=errs: s.append(str(e)[:200]))
        await page.goto(f"{WEB}/{r}", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        name = (r or "index").replace("/", "_")
        await page.screenshot(path=os.path.join(OUT, f"{look}__{name}.png"))
        if errs:
            errors[f"{look}/{name}"] = errs

    for route_name, opens, test_id, label in modals:
        try:
            await page.goto(f"{WEB}/{route_name}", wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)
            for opener in opens:
                # WAIT for the control rather than asking whether it is there
                # yet. A fixed 2s pause then `if count()` is a race the slower
                # screens lose, and losing it looked exactly like the control
                # not existing — which is how four of the kids modals reported
                # themselves missing when they were merely late.
                selector = (opener[4:] if opener.startswith("css:")
                            else f"[data-testid='{opener}']")
                try:
                    await page.wait_for_selector(selector, timeout=8000)
                except Exception:  # noqa: BLE001
                    skipped.append(f"{label} (opener {opener} never appeared on {route_name})")
                    break
                await page.locator(selector).first.click(timeout=4000)
                await page.wait_for_timeout(900)
            target = page.get_by_test_id(test_id)
            if await target.count() == 0:
                skipped.append(f"{label} (no {test_id} on {route_name})")
                continue
            await target.first.click(timeout=4000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=os.path.join(OUT, f"{look}__modal-{label}.png"))
        except Exception as exc:  # noqa: BLE001
            skipped.append(f"{label}: {type(exc).__name__}")
    await ctx.close()
    return errors, skipped


async def main():
    os.makedirs(OUT, exist_ok=True)
    tok, tok_b, teen_tok, kid_tok = seed()
    errors, skipped = {}, []

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)

        passes = [
            ("out-light", None, LOGGED_OUT, "light", "", ()),
            ("en-light", tok, ROUTES, "light", "", MODALS),
            ("en-dark", tok, ROUTES, "dark",
             "localStorage.setItem('coo_appearance_mode_minimal_light_v5','dark');", MODALS),
            ("fr-light", tok_b, ROUTES, "light", "", MODALS),
        ]
        if teen_tok:
            passes.append(("teen", teen_tok, ["teen"], "light", "", ()))
            passes.append(("teen-dark", teen_tok, ["teen"], "dark",
                           "localStorage.setItem('coo_appearance_mode_minimal_light_v5','dark');", ()))
        else:
            skipped.append("teen screens (no teen account)")
        if kid_tok:
            passes.append(("kid", kid_tok, ["kid"], "light", "", ()))
            passes.append(("kid-dark", kid_tok, ["kid"], "dark",
                           "localStorage.setItem('coo_appearance_mode_minimal_light_v5','dark');", ()))
        else:
            skipped.append("kid mode (no child session)")

        for look, token, routes, scheme, init, modals in passes:
            errs, skips = await shoot(browser, token, look, routes, scheme, init, modals)
            errors.update(errs)
            skipped.extend(skips)
        await browser.close()

    print(json.dumps({
        "shots": len(os.listdir(OUT)),
        "pageerrors": errors,
        "seed_failures": SEED_FAILURES,
        "skipped": skipped,
    }, indent=1))
    # A screen photographed without its content is a photograph of nothing, and
    # a modal never opened is a room never looked at. Both are worth an exit
    # code: this is still a camera, but a camera that says when the lens cap
    # was on.
    if SEED_FAILURES or errors or skipped:
        print(f"\nINCOMPLETE  {len(SEED_FAILURES)} seed failure(s), "
              f"{len(errors)} screen(s) with JavaScript errors, "
              f"{len(skipped)} modal(s) not photographed")
        return 1
    print("\nCOMPLETE  every screen seeded, opened and photographed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
