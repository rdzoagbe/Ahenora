"""The capture bar decides where a typed line goes.

It used to be a button: tap it, a composer opens, you type, you save — and
every line became a card, because a card was the only thing it could make. So
"ajoute du lait à la liste" became a task about milk while the shopping list
and the meal planner sat two taps further in. The most capable parts of the app
were the hardest to reach.

The bar is now a field that routes. The whole risk of that is a wrong guess: a
task that lands in the shopping list is a task somebody has to go and find. So
the rule is a card unless the line explicitly asks for something else, and the
most valuable assertions below are the ones that check nothing was re-routed.

Usage:  python3 scripts/e2e_capture.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Roland W", "email": f"cap-{run}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": 412, "height": 915})
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
        await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
        await page.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)

        async def type_line(text):
            await page.fill('[data-testid="feed-capture-input"]', text)
            await page.click('[data-testid="feed-capture-send"]')
            await page.wait_for_timeout(2500)

        r["the_bar_is_typeable"] = await page.locator(
            '[data-testid="feed-capture-input"]').count() == 1

        # On the Feed the bar IS the add — there is no second ＋ competing with
        # it. The picker still exists for the other tabs, reached from their own
        # header; it must not be sitting on the Feed as well.
        r["the_feed_has_no_competing_plus"] = await page.locator(
            '[data-testid="tab-add"]').count() == 0
        r["and_no_picker_is_open"] = await page.locator(
            '[data-testid="quickadd-primary"]').count() == 0
        # The long-hand composer stays one tap away for anything the bar should
        # not be guessing at.
        r["the_long_hand_composer_is_one_tap_away"] = await page.locator(
            '[data-testid="feed-open-add"]').count() == 1

        # --- the shopping list -------------------------------------------
        await type_line("add milk and bread to the list")
        shopping = [i["name"].lower() for i in api("GET", "/shopping", None, tok)]
        r["an_explicit_list_line_reaches_the_shopping_list"] = (
            "milk" in shopping and "bread" in shopping)
        cards_after_shopping = api("GET", "/cards", None, tok)
        r["and_makes_no_card"] = not any(
            "milk" in (c.get("title") or "").lower() for c in cards_after_shopping)

        # --- the meal planner, which is Premium ----------------------------
        # A free household must not be handed a 402 and lose what they typed:
        # the line becomes a task that still says exactly what they meant.
        await type_line("Dinner Thursday: roast chicken")
        free_cards = api("GET", "/cards", None, tok)
        r["a_free_household_keeps_the_meal_line_as_a_task"] = any(
            "roast chicken" in (c.get("title") or "").lower() for c in free_cards)
        r["and_nothing_is_lost_to_a_paywall"] = not api("GET", "/meals", None, tok)

        # --- a plain task --------------------------------------------------
        await type_line("Sign the school slip Thursday")
        cards = api("GET", "/cards", None, tok)
        slip = [c for c in cards if "school slip" in (c.get("title") or "").lower()]
        r["a_plain_line_becomes_a_task"] = len(slip) == 1
        # The words are kept exactly as typed. Quietly rewriting somebody's
        # title to strip the date they wrote is how a note stops being theirs.
        r["it_keeps_the_words_as_typed"] = bool(slip) and slip[0]["title"] == "Sign the school slip Thursday"
        r["and_picks_up_the_date"] = bool(slip) and bool(slip[0].get("due_date"))

        # --- what must NOT be re-routed -------------------------------------
        # "Make a list of who is coming" is a task ABOUT a list. Reading it as
        # a shopping line would put "who is coming" in the groceries and lose
        # the task — the exact failure this whole design is timid about.
        await type_line("Make a list of who is coming")
        cards = api("GET", "/cards", None, tok)
        shopping2 = [i["name"].lower() for i in api("GET", "/shopping", None, tok)]
        r["a_task_about_a_list_stays_a_task"] = any(
            "who is coming" in (c.get("title") or "").lower() for c in cards)
        r["and_does_not_reach_the_groceries"] = not any(
            "who is coming" in n for n in shopping2)

        # A dinner with no day is an event to remember, not a menu to plan.
        await type_line("Dinner with Marc")
        cards = api("GET", "/cards", None, tok)
        meals2 = api("GET", "/meals", None, tok)
        r["a_dinner_with_no_day_stays_a_task"] = any(
            "dinner with marc" in (c.get("title") or "").lower() for c in cards)
        r["and_does_not_reach_the_menu"] = not any(
            "marc" in (m.get("title") or "").lower() for m in meals2)

        await page.screenshot(path="capture_bar.png")
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
