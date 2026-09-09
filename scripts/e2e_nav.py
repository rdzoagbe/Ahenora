"""The bar: five places in one pill, and no drawer left holding anything.

Two jobs. The first is that every destination is reachable — the More button
is gone, so anything it used to open has to be reachable some other way, for a
parent and for a helper alike. The second is measurement: five labels in a bar
that used to hold four is arithmetic that works on paper, and the three worst
faults this app has shipped were things that passed on paper and looked wrong
in a photograph. So the labels are measured, in a real browser, at the widest
phone and the narrowest.
"""
import asyncio, json, sys, time, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

SEATS = ["feed", "calendar", "kids", "kitchen", "vault"]
LABELS = ["Feed", "Calendar", "Family", "Kitchen", "Vault"]

def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res: return json.loads(res.read().decode() or "{}")


# Does every seat's contents actually sit inside the seat?
#
# This took three tries, and the two wrong ones are worth writing down.
#
#   1. Checking the label for TRUNCATION (scrollWidth > clientWidth) catches
#      nothing: nothing in the bar sets a width on the label, so it grows to
#      fit its text and is never cut off.
#   2. Checking the SEAT's box against the pill catches nothing either: the
#      seat is flex:1, so it always measures exactly its share of the pill,
#      whatever is inside it.
#
# What actually breaks is the box BETWEEN them — the tabItem, which carries
# the focused seat's accent pill and the seat's padding. It sizes to its
# contents and nothing clips it, so when a label or a padding grows too large
# it silently spills over its neighbours: with the padding cranked to 22pt the
# five accent pills overlapped by 12pt each and both checks above still
# reported everything fine.
#
# So: measure the tabItem against its seat, and the labels too, which is the
# same test written for a longer word rather than a fatter padding.
MEASURE_JS = """
(el) => {
  const seat = el.getBoundingClientRect();
  const boxes = [];
  const inner = el.firstElementChild;
  if (inner) boxes.push({ what: 'seat contents', node: inner });
  for (const n of el.querySelectorAll('*')) {
    if (n.children.length || !n.textContent.trim()) continue;
    boxes.push({ what: n.textContent.trim(), node: n });
  }
  return boxes.map(({ what, node }) => {
    const b = node.getBoundingClientRect();
    return {
      what,
      cut: node.scrollWidth - node.clientWidth,
      spill: Math.max(seat.left - b.left, b.right - seat.right),
    };
  });
}
"""

async def measure_bar(p):
    """Every seat's boxes, with how far each is cut off or spilling out."""
    out = {}
    for name in SEATS:
        loc = p.locator(f'[data-testid="tab-{name}"]')
        out[name] = await loc.evaluate(MEASURE_JS) if await loc.count() == 1 else None
    return out


def bad_boxes(measured):
    """Whatever the browser could not fit inside its seat, either way."""
    bad = []
    for seat, nodes in measured.items():
        if nodes is None:
            bad.append(f"{seat}: no such seat")
            continue
        for n in nodes:
            if n["cut"] > 1:
                bad.append(f"{seat}: \"{n['what']}\" cut off by {n['cut']:.0f}pt")
            elif n["spill"] > 1:
                bad.append(f"{seat}: \"{n['what']}\" spills {n['spill']:.0f}pt out of its seat")
    return bad


async def main():
    import uuid
    r = {}
    u = api("POST", "/auth/register", {"name": "Nav Probe", "email": f"nav-{uuid.uuid4().hex[:6]}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    # A carer in the same household, invited and accepted through the real
    # endpoints rather than by writing is_helper into a document — the flag has
    # to arrive the way a real grandparent's does.
    #
    # Helper accounts are a paid feature and this fixture runs with billing
    # live, so the household is elevated the way the journey harness does it:
    # a fixed admin identity joins. The elevation is cached for 60 seconds and
    # the cache was already populated by the invite above, so the wait is
    # unavoidable — but it is spent running the parent's checks rather than
    # sleeping, and only the remainder is slept for below.
    admin_inv = api("POST", "/family/invite",
                    {"email": "e2e-admin@sim.test", "relationship": "Admin"}, tok)
    api("POST", "/auth/register",
        {"name": "Admin Sim", "email": "e2e-admin@sim.test", "password": "password123",
         "invite_token": admin_inv["invite"]["token"]})
    elevated_at = time.monotonic()


    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        p = await ctx.new_page()
        errs = []
        p.on("pageerror", lambda e: errs.append(str(e)))

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await p.route("**/api/**", route)
        await p.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        await p.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await p.wait_for_timeout(3000)
        bar = await p.inner_text("body")

        # Every tab spells its name under the icon — a bar you have to tap to
        # learn is doing half its job. The five places are Feed · Calendar ·
        # Family · Kitchen · Vault, in one pill. Messaging moved into the
        # Family Hub (open a member to chat), so there is no Messages seat.
        r["active_tab_named"] = "Feed" in bar
        r["all_five_tabs_named"] = all(w in bar for w in LABELS)
        seat_counts = {n: await p.locator(f'[data-testid="tab-{n}"]').count() for n in SEATS}
        r["every_seat_present"] = all(c == 1 for c in seat_counts.values())
        if not r["every_seat_present"]:
            print(f"seat counts: {seat_counts}")
        # More is gone entirely, not moved: the vault took a seat and the rest
        # of the drawer moved onto the account screen.
        r["no_more_button"] = await p.locator('[data-testid="tab-more"]').count() == 0
        r["no_raised_plus_in_the_bar"] = await p.locator('[data-testid="tab-add"]').count() == 0
        await p.screenshot(path="nav_feed.png")

        # --- the measurement ------------------------------------------------
        bad_390 = bad_boxes(await measure_bar(p))
        r["every_label_fits_its_seat_at_390"] = not bad_390
        if bad_390:
            print(f"at 390: {bad_390}")

        # Option A in one number: the pill is the whole bar. It used to share
        # the 350pt between the insets with a 62pt More button and a 10pt gap,
        # leaving 278pt — which is why a fifth seat did not fit before and
        # does now. If something ever moves back in beside it, this is the
        # check that notices.
        pill_geom = await p.evaluate("""
          () => {
            const seats = [...document.querySelectorAll('[data-testid^="tab-"]')];
            if (seats.length !== 5) return null;
            const pill = seats[0].parentElement.getBoundingClientRect();
            return { w: pill.width, left: pill.left, right: pill.right, vw: window.innerWidth };
          }
        """)
        r["pill_spans_the_whole_bar"] = bool(pill_geom) and (
            abs(pill_geom["w"] - (pill_geom["vw"] - 40)) < 1
            and pill_geom["left"] >= 19 and pill_geom["right"] <= pill_geom["vw"] - 19)
        if not r["pill_spans_the_whole_bar"]:
            print(f"pill geometry: {pill_geom}")

        # The narrowest phone we support. This is where the arithmetic in
        # src/navGeometry.ts is actually load-bearing.
        await p.set_viewport_size({"width": 320, "height": 700})
        await p.wait_for_timeout(1500)
        bad_320 = bad_boxes(await measure_bar(p))
        r["every_label_fits_its_seat_at_320"] = not bad_320
        if bad_320:
            print(f"at 320: {bad_320}")
        await p.screenshot(path="nav_narrow.png")
        await p.set_viewport_size({"width": 390, "height": 844})
        await p.wait_for_timeout(1200)

        # --- the vault is a place now ---------------------------------------
        await p.click('[data-testid="tab-vault"]')
        await p.wait_for_timeout(3000)
        r["seat_reaches_vault"] = "Vault" in await p.inner_text("body")
        await p.screenshot(path="nav_vault.png")

        # --- and everything the drawer held still has a door -----------------
        # Your portrait in the Feed header opens your account; settings and the
        # hand-over live there. Two taps, the same as More cost, from a door
        # that says whose account it is.
        await p.click('[data-testid="tab-feed"]')
        await p.wait_for_timeout(2500)
        await p.click('[data-testid="feed-portrait"]')
        await p.wait_for_timeout(2500)
        r["portrait_reaches_account"] = await p.locator('[data-testid="account-settings"]').count() == 1
        r["account_offers_hand_over"] = await p.locator('[data-testid="account-hand-over"]').count() == 1

        # A row's subtitle is the only thing that says what is behind it, and
        # a subtitle that ends in "…" says less than no subtitle at all. This
        # has now shipped twice — "app versi…" on the Settings hub, "plan and
        # lang…" here — so it is measured rather than eyeballed, on every row,
        # in whatever language the bundle is built in.
        clipped_rows = await p.evaluate("""
          () => {
            const rows = [...document.querySelectorAll('[data-testid^="account-"]')];
            const bad = [];
            for (const row of rows) {
              for (const n of row.querySelectorAll('*')) {
                if (n.children.length || !n.textContent.trim()) continue;
                if (n.scrollWidth - n.clientWidth > 1) bad.push(n.textContent.trim());
              }
            }
            return bad;
          }
        """)
        r["no_account_row_truncated"] = not clipped_rows
        if clipped_rows:
            print(f"truncated account rows: {clipped_rows}")

        # The badge under your name has to be true. It used to be the word
        # OWNER, hard-coded, under everyone's — see tests/test_who_am_i_badge.py
        # and the helper's side of this further down.
        acct = await p.inner_text("body")
        r["founder_is_told_they_are_the_owner"] = "OWNER" in acct
        r["nothing_claims_an_unverified_account_is_verified"] = "VERIFIED" not in acct
        await p.screenshot(path="nav_account.png")

        await p.click('[data-testid="account-settings"]')
        await p.wait_for_timeout(3000)
        # Settings is a hub of group rows; "Household" is a group header,
        # visible without opening anything.
        r["account_reaches_settings"] = "Household" in await p.inner_text("body")

        # The daily tabs still load. Assert a page-UNIQUE element on each — not a
        # word that also lives in the always-visible bottom bar (a body-text
        # check for a tab label passes even if the screen rendered nothing); a
        # per-screen testID is real content that only appears once it mounted.
        await p.goto(f"{WEB}/calendar", wait_until="domcontentloaded")
        await p.wait_for_timeout(2200)
        r["tab_calendar_ok"] = await p.locator('[data-testid="prev-month"]').count() >= 1

        await p.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await p.wait_for_timeout(2200)
        r["tab_kids_ok"] = await p.locator('[data-testid="family-manage-members"]').count() >= 1

        await p.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await p.wait_for_timeout(2200)
        # All three Kitchen views must be reachable without opening anything.
        r["tab_kitchen_ok"] = all([
            await p.locator('[data-testid="kitchen-tab-shop"]').count() >= 1,
            await p.locator('[data-testid="kitchen-tab-meal"]').count() >= 1,
            await p.locator('[data-testid="kitchen-tab-spend"]').count() >= 1,
        ])

        # --- and the same bar, seen by a helper -------------------------------
        # A grandparent or a nanny is a full member of the household in every
        # way except the private papers: /api/vault is behind
        # require_full_member, so a vault seat in their bar would be a door
        # onto a screen of 403s. They get four seats, and an account screen
        # that offers Settings but not the hand-over (leaving kid mode needs a
        # parent PIN they do not hold). This is the half of the change that
        # nothing else looks at — the app is fine for a parent and quietly
        # broken for a carer, which is exactly the shape of bug that ships.
        await asyncio.sleep(max(0, 62 - (time.monotonic() - elevated_at)))
        helper_email = f"gran-{uuid.uuid4().hex[:6]}@sim.test"
        inv = api("POST", "/family/invite", {"email": helper_email, "relationship": "Grandma",
                                             "is_helper": True}, tok)
        h = api("POST", "/auth/register",
                {"name": "Gran", "email": helper_email, "password": "password123",
                 "invite_token": inv["invite"]["token"]})
        helper_tok = h["session_token"]
        api("POST", "/auth/complete-onboarding", {}, helper_tok)
        # The flag has to arrive the way a real grandparent's does. If it did
        # not, every check below would pass for the wrong reason.
        r["invited_carer_is_a_helper"] = bool(api("GET", "/auth/me", None, helper_tok).get("is_helper"))

        hctx = await ctx.browser.new_context(viewport={"width": 390, "height": 844})
        hp = await hctx.new_page()
        herrs = []
        hp.on("pageerror", lambda e: herrs.append(str(e)))

        async def hroute(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await hctx.request.fetch(f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await hp.route("**/api/**", hroute)
        await hp.add_init_script(f"localStorage.setItem('coo_session_token','{helper_tok}');")

        await hp.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await hp.wait_for_timeout(3500)
        r["helper_has_no_vault_seat"] = await hp.locator('[data-testid="tab-vault"]').count() == 0
        r["helper_keeps_the_other_four"] = all(
            [await hp.locator(f'[data-testid="tab-{n}"]').count() == 1
             for n in SEATS if n != "vault"])
        bad_helper = bad_boxes({n: await hp.locator(f'[data-testid="tab-{n}"]').evaluate(MEASURE_JS)
                                for n in SEATS if n != "vault"})
        r["helper_labels_fit_too"] = not bad_helper
        if bad_helper:
            print(f"helper bar: {bad_helper}")

        await hp.click('[data-testid="feed-portrait"]')
        await hp.wait_for_timeout(2500)
        r["helper_reaches_settings"] = await hp.locator('[data-testid="account-settings"]').count() == 1
        r["helper_is_not_offered_hand_over"] = await hp.locator('[data-testid="account-hand-over"]').count() == 0
        # The whole point of the badge fix, seen by the person it was wrong for.
        hacct = await hp.inner_text("body")
        r["helper_is_not_told_they_own_the_household"] = "OWNER" not in hacct
        r["helper_is_told_they_are_a_carer"] = "CARER" in hacct
        await hp.screenshot(path="nav_helper.png")
        r["no_js_errors_for_the_helper"] = not herrs
        await hctx.close()

        r["no_js_errors"] = not errs
        await b.close()

    for k, v in r.items(): print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)

asyncio.run(main())
