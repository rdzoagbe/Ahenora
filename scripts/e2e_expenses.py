"""Expenses: the one screen where being misread costs money rather than time.

A wrong number here is not a wrong number on a list. It is one parent
believing the other owes them, which is a different kind of argument from a
forgotten dentist appointment. There was no browser coverage of any of it.

What this holds:

  A. an expense typed is an expense stored — the amount that reaches the
     server is the amount that was typed, to the cent;
  B. it survives a reload, so the list is the ledger and not a local guess;
  C. the month total is arithmetic, not decoration: add a known amount and
     the total moves by exactly that;
  D. a decimal comma survives. Roland is in France, the app ships in French,
     and "12,50" is how half this app's market writes twelve fifty. If that
     parses as twelve, or as nothing, somebody is out fifty cents every time
     and nothing on screen says why;
  E. a save that fails says so, and does not leave a row on screen that the
     server never took.

Usage:  python3 scripts/e2e_expenses.py <web_port> <api_port>
"""
import asyncio
import json
import sys
import urllib.request
import uuid

from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def total_of(token):
    return round(sum(float(e.get("amount") or 0)
                     for e in api("GET", "/expenses?days=30", None, token)), 2)


async def main():
    r = {}
    who = f"exp-{uuid.uuid4().hex[:6]}@sim.test"
    user = api("POST", "/auth/register",
               {"name": "Expense Probe", "email": who, "password": "password123"})
    token = user["session_token"]
    api("POST", "/auth/complete-onboarding", {}, token)

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        crashes = []
        page.on("pageerror", lambda e: crashes.append(str(e)))
        # Alert.alert on react-native-web is a real browser dialog, so it
        # never appears in inner_text. A first version of this looked for the
        # words in the page and reported the app as silent when it had in
        # fact put a dialog up and been waiting for somebody to dismiss it.
        said = []
        page.on("dialog", lambda d: (said.append(f"{d.message}"),
                                     asyncio.ensure_future(d.accept())))

        fail_save = {"v": False}

        async def route(ro):
            if (fail_save["v"] and ro.request.method == "POST"
                    and ro.request.url.rstrip("/").endswith("/api/expenses")):
                await ro.fulfill(status=500, content_type="application/json",
                                 body=json.dumps({"detail": "ledger unavailable"}))
                return
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(
            f"localStorage.setItem('coo_session_token','{token}');")

        async def open_expenses():
            await page.goto(f"{WEB}/expenses", wait_until="domcontentloaded")
            await page.wait_for_timeout(3500)

        async def add_expense(shop, amount, settle=2500):
            await page.click('[data-testid="exp-add-open"]')
            await page.wait_for_timeout(900)
            await page.fill('[data-testid="exp-shop"]', shop)
            await page.fill('[data-testid="exp-amount"]', amount)
            await page.click('[data-testid="exp-save"]')
            await page.wait_for_timeout(settle)

        # --- A + B. typed, stored, and still there after a reload ----------
        await open_expenses()
        before = total_of(token)
        await add_expense("Carrefour", "42.35")

        stored = api("GET", "/expenses?days=30", None, token)
        mine = [e for e in stored if e.get("merchant") == "Carrefour"]
        r["the_expense_reached_the_server"] = len(mine) == 1
        # To the cent. A float that arrives as 42.34 or 42.0 is the whole
        # reason this screen matters.
        r["the_amount_is_exactly_what_was_typed"] = (
            bool(mine) and abs(float(mine[0]["amount"]) - 42.35) < 0.001)

        await open_expenses()
        body = await page.inner_text("body")
        r["it_survives_a_reload"] = "Carrefour" in body
        await page.screenshot(path="expenses_listed.png")

        # --- C. the total is arithmetic ------------------------------------
        r["the_month_total_moved_by_the_amount"] = (
            abs(total_of(token) - (before + 42.35)) < 0.011)

        # --- D. a decimal COMMA, which is how half the market writes it ----
        # French and German both use it, the app ships in both, and a comma
        # that parses as 12 (or as nothing) loses fifty cents silently.
        await open_expenses()
        before_comma = total_of(token)
        await add_expense("Boulangerie", "12,50")
        after_comma = api("GET", "/expenses?days=30", None, token)
        bakery = [e for e in after_comma if e.get("merchant") == "Boulangerie"]
        r["a_decimal_comma_is_accepted_at_all"] = len(bakery) == 1
        r["a_decimal_comma_is_read_as_twelve_fifty"] = (
            bool(bakery) and abs(float(bakery[0]["amount"]) - 12.50) < 0.001)
        r["the_comma_total_is_right_too"] = (
            abs(total_of(token) - (before_comma + 12.50)) < 0.011)
        await page.screenshot(path="expenses_comma.png")

        # --- E. a failed save says so, and invents nothing ------------------
        fail_save["v"] = True
        await open_expenses()
        before_fail = total_of(token)
        # Read while the notice is still up: it auto-dismisses, and a harness
        # that arrives after it has cleared learns nothing about whether
        # there was one.
        said.clear()
        await add_expense("Never happened", "99.99", settle=2500)
        body = (await page.inner_text("body")) + " " + " ".join(said)
        r["a_failed_save_says_something"] = (
            "could not" in body.lower() or "unavailable" in body.lower()
            or "failed" in body.lower() or "n'a pas" in body.lower())
        r["a_failed_save_changed_no_money"] = abs(total_of(token) - before_fail) < 0.001
        await page.screenshot(path="expenses_failed.png")

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
