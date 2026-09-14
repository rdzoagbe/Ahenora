"""The meal planner, and the promise it is sold on.

"Plan dinners, share the list" is on the pricing page. Nothing checked that
the list actually changes.

The planner is a paid feature, so this BUYS it the way a family does — a real
RevenueCat webhook at the real endpoint, with the real secret. A harness that
reaches into the database to grant itself entitlements is not testing the
thing that gates them.

What this holds:

  A. a free household is refused by the SERVER, and the screen it gets is
     still a screen. A gate that fails open is a refund conversation; one
     that fails ugly is a support conversation;
  B. buying it opens the planner;
  C. a meal planned is a meal on the screen, through a reload — the plan is
     the plan, not a local guess;
  D. "add it all to the shopping list" ACTUALLY ADDS IT, and adds what the
     meal needs rather than something adjacent;
  E. pressing it twice does not add it twice. A list with milk on it three
     times is how a family stops trusting the list, and it is the single
     most likely way this breaks.

Two things learned the hard way, written down because they cost an hour:

  * Kitchen opens on the shopping LIST. The planner is behind the Meals tab,
    and reading the default view reports a planned meal as missing when it is
    one tap away.
  * A loading overlay covers the tab bar while the screen loads. This WAITS
    for it to clear rather than forcing a click past it — a harness that
    clicks through an overlay stops noticing when the overlay is the bug,
    which is exactly what it was: that overlay used to be labelled "Loading
    Vault..." on the Kitchen screen.

Usage:  python3 scripts/e2e_meals.py <web_port> <api_port>
"""
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
RC_SECRET = os.environ.get("RC_WEBHOOK_SECRET", "e2e-gating-live")

# Is the Meals tab the top element at its own centre? True once the loading
# overlay has gone. Asked of the page rather than guessed at with a sleep.
TAB_IS_CLICKABLE = """
() => {
  const t = document.querySelector('[data-testid="kitchen-tab-meal"]');
  if (!t) return false;
  const r = t.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!top && (t === top || t.contains(top));
}
"""


def api(method, path, body=None, token=None, auth=None):
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = auth
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} {path} -> {exc.code}") from None


def buy_the_plan(user_id):
    """A real RevenueCat event at the real endpoint — the door a paying
    family comes through, not a shortcut around it."""
    now_ms = int(time.time() * 1000)
    return api("POST", "/billing/revenuecat-webhook", {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": user_id,
            "product_id": "ahenora_executive_monthly",
            "purchased_at_ms": now_ms,
            "expiration_at_ms": now_ms + 30 * 86400 * 1000,
        },
    }, auth=f"Bearer {RC_SECRET}")


def shopping_names(token):
    return sorted(i.get("name", "") for i in api("GET", "/shopping", None, token))


async def main():
    r = {}
    who = f"meals-{uuid.uuid4().hex[:6]}@sim.test"
    account = api("POST", "/auth/register",
                  {"name": "Meal Probe", "email": who, "password": "password123"})
    token = account["session_token"]
    user_id = account["user"]["user_id"]
    api("POST", "/auth/complete-onboarding", {}, token)

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        crashes = []
        page.on("pageerror", lambda e: crashes.append(str(e)))
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        # Proxy every API call through Playwright so the page sees them as
        # SAME-ORIGIN. Without this the browser calls :8801 from :8800, the
        # auth check fails on the cross-origin boundary, and the app bounces
        # to the landing page about six seconds in — which presents as the
        # Meals tab "disappearing" and cost an hour before the page was asked
        # what it was actually doing. Every other harness here does the same.
        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length",
                                              "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(
            f"localStorage.setItem('coo_session_token','{token}');")

        async def open_meals_tab():
            await page.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
            await page.wait_for_selector('[data-testid="kitchen-tab-meal"]',
                                         timeout=30000)
            # Wait for the overlay to lift, then click. Never force.
            await page.wait_for_function(TAB_IS_CLICKABLE, timeout=30000)
            await page.click('[data-testid="kitchen-tab-meal"]')
            await page.wait_for_timeout(2500)

        # --- A. a free household is refused, and still gets a screen -------
        await page.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)
        free_body = await page.inner_text("body")
        try:
            api("POST", "/meals/suggest-ai", {"days": 3}, token)
            r["a_free_household_is_refused_by_the_server"] = False
        except RuntimeError as exc:
            r["a_free_household_is_refused_by_the_server"] = "402" in str(exc)
        r["the_free_screen_is_still_a_screen"] = len(free_body) > 200 and not crashes
        await page.screenshot(path="meals_free.png")

        # --- B. buying it opens the planner ---------------------------------
        buy_the_plan(user_id)
        sub = api("GET", "/subscription", None, token)
        r["buying_it_opened_the_planner"] = (
            sub.get("plan") == "executive"
            and bool((sub.get("limits") or {}).get("meal_planner")))

        # --- C. a planned meal is on the screen, through a reload ----------
        api("POST", "/meals", {"day": "Monday", "title": "Poulet roti",
                               "ingredients": ["chicken", "potatoes"]}, token)
        await open_meals_tab()
        body = await page.inner_text("body")
        r["a_planned_meal_is_on_the_screen"] = "Poulet" in body
        await page.screenshot(path="meals_planned.png")

        # --- D. the claim the feature is sold on ----------------------------
        before = shopping_names(token)
        api("POST", "/meals/sync-shopping", {}, token)
        after = shopping_names(token)
        r["syncing_adds_something"] = len(after) > len(before)
        r["it_adds_what_the_meal_needs"] = any(
            "chicken" in n.lower() or "potato" in n.lower() for n in after)

        # --- E. twice is not double -----------------------------------------
        api("POST", "/meals/sync-shopping", {}, token)
        r["syncing_twice_does_not_duplicate"] = shopping_names(token) == after

        r["no_js_errors"] = not crashes
        if crashes:
            r["first_js_error"] = crashes[0][:200]
        await browser.close()

    print(json.dumps(r, indent=2))
    ok = all(v for k, v in r.items() if k != "first_js_error")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
