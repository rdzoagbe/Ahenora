"""The week is the currency: a parent fills a missed day, then cashes it in.

Two things this proves, both of which are invisible from the outside and
silently wrong when broken:

  1. Back-dating. A parent taps Tuesday and gives a star; the ledger has to
     record it against Tuesday, not against the day the parent happened to be
     holding the phone. Without this a missed day stays missed and the weekly
     meter can never fill — which makes the whole meter feel rigged.
  2. Claiming. A full week buys one of the reward ideas, and buys it with the
     week rather than with the saved balance. The bank must come out the other
     side untouched, because a child who watches their savings drop for a
     Friday pizza has been punished for a good week.

Usage:  python3 scripts/e2e_week.py <web_port> <api_port>
"""
import asyncio, datetime, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def persona(browser, token):
    ctx = await browser.new_context(viewport={"width": 412, "height": 915})
    page = await ctx.new_page()

    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(
            f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())

    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    return page


def week_days_utc():
    """This week, Monday first — the same boundary the server rolls on."""
    now = datetime.datetime.now(datetime.timezone.utc)
    monday = (now - datetime.timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return [monday + datetime.timedelta(days=i) for i in range(7)]


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Roland W", "email": f"rw-{run}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    ama = api("POST", "/family/members", {"name": "Ama", "role": "Child",
                                          "starting_stars": 30}, tok)
    mid = ama["member_id"]

    days = week_days_utc()
    today_index = datetime.datetime.now(datetime.timezone.utc).weekday()
    # A day already gone by. On a Monday there isn't one, and the row is right
    # to offer nothing — so the back-dating half only asserts when it applies.
    past = days[0] if today_index > 0 else None

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        page = await persona(br, tok)
        await page.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)
        # The Family tab now opens on a roster of everyone; a child's week, stars
        # and rewards live on their own page. Tap into Ama to reach the detail.
        await page.click(f'[data-testid="child-{mid}"]')
        await page.wait_for_timeout(1500)
        # A child's page now leads with the daily two (give stars, today's
        # chores); the week, rewards and history live behind one More door.
        await page.click('[data-testid="kids-show-more"]')
        await page.wait_for_timeout(900)

        body = await page.inner_text("body")
        # Against the target the SERVER reports, not a number typed here. This
        # read "50" — the old fixed target — and went on passing after the
        # default moved to 35, because some other number on the page happened
        # to contain "50". An assertion that cannot fail is not an assertion.
        member_now = [m for m in api("GET", "/family/members", None, tok)
                      if m["member_id"] == mid][0]
        target = int(member_now.get("weekly_target") or 0)
        r["shows_the_week_target"] = bool(target) and str(target) in body
        # Read off the chip itself rather than the whole page: "Pizza night is
        # somewhere in the body" was true whether or not it carried a price.
        idea_text = await page.inner_text('[data-testid="ri_pizza"]')
        r["ideas_have_no_star_prices"] = ("Pizza" in idea_text
                                          and not any(c.isdigit() for c in idea_text))
        # The arithmetic that answers "how does the week add up?" — it was true
        # from the start and stated nowhere, which is what made the target
        # look arbitrary.
        r["says_how_the_week_adds_up"] = "7 a day" in body
        # Two currencies, one price between them.
        #
        # This used to assert that the priced list was GONE — the week having
        # become the only currency. The list is back, deliberately: without it
        # the Feed counted rewards nobody could see, and no household could ever
        # create a first one. What must not come back is the confusion that
        # removed it, which was never the list itself but the same treat carrying
        # two prices at once — a meter above and a star cost a few rows below,
        # rarely agreeing.
        #
        # So the rule is now the one worth keeping: the week's ideas are free
        # (asserted above — they show no cost), and the saved-up list is the
        # only thing on the page that names a price.
        r["saved_up_list_is_reachable"] = "Saved up for" in body

        if past:
            key = f"{past.year}-{past.month - 1}-{past.day}"
            await page.click(f'[data-testid="week-day-{key}"]')
            await page.wait_for_timeout(400)
            await page.click('[data-testid="quick-add-qa_bed"]')
            await page.wait_for_timeout(2500)
            rows = api("GET", f"/family/members/{mid}/star-history", None, tok)
            stamped = [x for x in rows if x.get("awarded_for")]
            r["backdated_star_lands_on_the_chosen_day"] = bool(stamped) and \
                stamped[0]["awarded_for"][:10] == past.strftime("%Y-%m-%d")
        else:
            r["backdated_star_lands_on_the_chosen_day"] = True

        # The loyalty-card rule: a treat is claimable BEFORE the week is full.
        # Deliberately do not fill to 50 — claim straight from a partial week.
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)
        # Reload drops back to the roster — tap into Ama's page again.
        await page.click(f'[data-testid="child-{mid}"]')
        await page.wait_for_timeout(1500)
        # A child's page now leads with the daily two (give stars, today's
        # chores); the week, rewards and history live behind one More door.
        await page.click('[data-testid="kids-show-more"]')
        await page.wait_for_timeout(900)
        member = [m for m in api("GET", "/family/members", None, tok)
                  if m["member_id"] == mid][0]
        bank_before = member["stars"]
        r["claiming_below_fifty_is_the_test"] = int(member.get("week_earned", 0)) < 50
        await page.click('[data-testid="ri_pizza"]')
        await page.wait_for_timeout(2500)

        weekly = [x for x in api("GET", "/redemptions", None, tok) if x.get("weekly")]
        r["claiming_a_treat_records_it"] = len(weekly) == 1
        r["the_treat_costs_no_saved_stars"] = bool(weekly) and weekly[0]["cost_stars"] == 0

        after = [m for m in api("GET", "/family/members", None, tok)
                 if m["member_id"] == mid][0]
        r["the_bank_is_untouched"] = after["stars"] == bank_before
        r["the_week_reads_as_claimed"] = after.get("week_claimed") is True

        await page.screenshot(path="week_currency.png")
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
