"""Choosing when something is due.

For as long as the app has existed, a due date was TYPED. The sheet offered
Today / Tomorrow / Weekend and, for anything else, two text fields wanting
"YYYY-MM-DD" and "HH:mm". A parent reported it, and they were right: nobody
knows what next Tuesday's date is without going to look.

So this is a calendar you tap, and a row of the times a family task actually
lands on. What is held here is mostly what a screenshot would not tell you.

The one that matters most is the WIDTH of the selected day. PressScale splits
its style: layout keys go on the Pressable AND are copied onto the inner
animated view, so a percentage width is applied twice — 14.28% of 14.28% — and
the cell collapses to a 2%-wide sliver. With no background painted on it that
is invisible, which is how it survived the first pass: every day was there,
every day was tappable, and the selected one rendered as a thin orange bar.
A check that only asked "is the cell present" would have passed.

Usage:  python3 scripts/e2e_duedate.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.error, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    try:
        with urllib.request.urlopen(r, timeout=20) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{m} {p} -> {e.code}: {e.read().decode()[:300]}") from None


async def main():
    r = {}
    try:
        await run(r)
    except Exception as e:
        print(f"stopped at: {type(e).__name__}: {str(e).splitlines()[0]}")
    for k, v in r.items():
        print(f"{k}: {v}")
    ok = bool(r) and all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


async def run(r):
    run_id = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Roland W",
                                       "email": f"due-{run_id}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))

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

        await page.click('[data-testid="feed-open-add"]')
        await page.wait_for_timeout(1200)
        # The due row is below the fold on a phone; the composer scrolls.
        await page.evaluate("""
          () => { const d=[...document.querySelectorAll('div')]
                    .find(x=>x.scrollHeight>x.clientHeight+60 && x.clientHeight<700);
                  if (d) d.scrollTop = d.scrollHeight; }
        """)
        await page.wait_for_timeout(400)
        await page.locator('text=No deadline').first.click()
        await page.wait_for_timeout(1200)

        # --- it is a calendar, not a text box -----------------------------
        r["a_month_is_on_screen"] = await page.locator(
            '[data-testid="due-month-label"]').count() == 1
        days = await page.locator('[data-testid^="due-day-"]').count()
        r["a_full_month_of_days_is_tappable"] = days >= 28
        r["both_month_arrows_are_there"] = (
            await page.locator('[data-testid="due-month-prev"]').count() == 1
            and await page.locator('[data-testid="due-month-next"]').count() == 1)
        # Typing is still reachable, but it is no longer what you meet first.
        r["typing_is_not_the_default"] = await page.locator(
            '[data-testid="due-date-input"]').count() == 0
        r["but_typing_is_still_offered"] = await page.locator(
            '[data-testid="due-toggle-typing"]').count() == 1

        # --- the selected day is actually PAINTED, not a sliver ------------
        painted = await page.evaluate("""
          () => {
            const cells=[...document.querySelectorAll('[data-testid^="due-day-"]')];
            const box=(e)=>e.getBoundingClientRect();
            const widths=cells.map(e=>Math.round(box(e).width));
            // By PAINT, not by an ARIA attribute. accessibilityState is the
            // React Native API and it is right for iOS and Android, but React
            // Native Web does not surface it: the day carries aria-label, role
            // and tabindex, and no aria-selected. Asserting on it here passed
            // nothing and proved nothing. What a browser can see is the fill.
            // The element OR anything inside it: PressScale paints the fill on
            // its inner animated view, so the cell that carries the testID
            // reads transparent however orange it looks.
            const painted=(e)=>{const bg=getComputedStyle(e).backgroundColor;
                                return bg && bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent';};
            const filled=(e)=>[e, ...e.querySelectorAll('*')].some(painted);
            const sel=cells.find(filled);
            return { minWidth: Math.min(...widths), selWidth: sel?Math.round(box(sel).width):0,
                     selHeight: sel?Math.round(box(sel).height):0,
                     // Exactly one, or the grid is lying about what is set.
                     announced: cells.filter(filled).length === 1 };
          }
        """)
        # A collapsed cell measured 8px. A real one is a circle around 40.
        r["exactly_one_day_looks_chosen"] = painted["announced"]
        r["every_day_cell_has_real_width"] = painted["minWidth"] >= 32
        r["the_selected_day_is_a_circle_not_a_sliver"] = (
            painted["selWidth"] >= 32 and painted["selHeight"] >= 32)

        # --- the time you will save is the time you can see ----------------
        shown = await page.evaluate("""
          () => {
            const chips=[...document.querySelectorAll('[data-testid^="due-time-"]')];
            // Same trap: compare the painted descendant, not the testID node.
            const bgOf=(e)=>{const k=[e, ...e.querySelectorAll('*')]
                .map(x=>getComputedStyle(x).backgroundColor)
                .find(b=>b && b!=='rgba(0, 0, 0, 0)' && b!=='transparent');
              return k || '';};
            const counts={};
            chips.forEach(e=>{const b=bgOf(e); counts[b]=(counts[b]||0)+1;});
            const common=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
            const sel=chips.find(e=>bgOf(e)!==common);
            if(!sel) return null;
            const r=sel.getBoundingClientRect();
            return { label: sel.textContent.trim(), left: Math.round(r.left),
                     right: Math.round(r.right), onScreen: r.left >= 0 && r.right <= 390 };
          }
        """)
        r["a_time_is_actually_chosen"] = bool(shown)
        # Without the auto-scroll the row opens on 07:00 while 18:00 is the
        # value that will be saved — a sheet showing a time it does not mean.
        r["and_it_is_scrolled_into_view"] = bool(shown and shown["onScreen"])

        # --- tapping a day and saving reaches the card ---------------------
        target = await page.evaluate("""
          () => { const e=[...document.querySelectorAll('[data-testid^="due-day-"]')][20];
                  return e ? e.getAttribute('data-testid') : null; }
        """)
        r["there_was_a_day_to_tap"] = bool(target)
        chosen = (target or "").replace("due-day-", "")
        await page.click(f'[data-testid="{target}"]')
        await page.wait_for_timeout(300)
        await page.locator('text=Use this date').first.click()
        await page.wait_for_timeout(1200)

        r["the_sheet_closed_after_choosing"] = await page.locator(
            '[data-testid="due-month-label"]').count() == 0
        body = await page.inner_text("body")
        r["the_composer_stopped_saying_no_deadline"] = "No deadline" not in body

        # And the date that reaches the server is the day that was tapped.
        title = f"Dentist {run_id}"
        await page.fill('input[placeholder="Title"]', title)
        await page.wait_for_timeout(200)
        await page.click('[data-testid="save-add-card"]')
        await page.wait_for_timeout(2500)
        cards = api("GET", "/cards", None, tok)
        mine = [c for c in cards if title in (c.get("title") or "")]
        r["the_card_was_created"] = len(mine) == 1
        r["it_carries_the_day_that_was_tapped"] = bool(
            mine and (mine[0].get("due_date") or "").startswith(chosen))

        r["no_js_errors"] = not errs
        await page.screenshot(path="due_picker.png")
        await b.close()


asyncio.run(main())
