"""The money screen, in a real browser.

Every other harness covers what a family does. This one covers what the FOUNDER
reads, and it is the only screen in the app where being misread costs money
rather than time.

It had no browser coverage at all. The billing log is built from webhooks, and
the worst failures there are the quiet ones: a row that says the wrong thing
about a payment, or the one row that needs a person looking exactly like the
eleven receipts above it.

So the whole path is driven for real — a genuine RevenueCat webhook is POSTed
at the real endpoint with the real shared secret, the real handler stores it,
and the real admin screen renders it:

  * a RENEWAL is tagged with the plan it granted
  * a BILLING_ISSUE, which changes nobody's plan, does NOT claim anything was
    "applied" — it says the plan is unchanged, the word the server's own log
    uses for the same event
  * a BILLING_ISSUE is visually distinct from the receipts around it, because
    a warning shaped exactly like a receipt gets scrolled past
  * an EXPIRATION is NOT flagged: by then the plan has already dropped and
    there is nothing to act on

Usage:  python3 scripts/e2e_billing_screen.py <web_port> <api_port>
"""
import asyncio, json, sys, time, urllib.error, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

# Matches scripts/e2e_backend.py, which sets it for exactly this purpose.
RC_SECRET = "e2e-gating-live"


def api(m, p, b=None, t=None, auth=None):
    headers = {"Content-Type": "application/json"}
    if t:
        headers["Authorization"] = f"Bearer {t}"
    if auth:
        headers["Authorization"] = auth
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers=headers, method=m)
    try:
        with urllib.request.urlopen(r, timeout=20) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{m} {p} -> {e.code}: {e.read().decode()[:300]}") from None


def webhook(event_type, user_id, product="ahenora_executive_monthly"):
    """A real RevenueCat event at the real endpoint, with the real secret."""
    now_ms = int(time.time() * 1000)
    return api("POST", "/billing/revenuecat-webhook", {
        "event": {
            "type": event_type,
            "app_user_id": user_id,
            "product_id": product,
            "purchased_at_ms": now_ms,
            "expiration_at_ms": now_ms + 30 * 86400 * 1000,
        },
    }, auth=f"Bearer {RC_SECRET}")


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
    # The owner must be the admin identity: this screen is admin-only, and a
    # harness that logged in as anybody else would measure the empty state.
    owner = api("POST", "/auth/register", {
        "name": "Admin Sim", "email": "e2e-admin@sim.test",
        "password": "password123"})
    tok = owner["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    uid = owner["user"]["user_id"]

    # Three real events, in the order a household would produce them.
    webhook("RENEWAL", uid)
    webhook("BILLING_ISSUE", uid)
    webhook("EXPIRATION", uid)

    log = api("GET", "/admin/billing-events?limit=40", None, tok)
    types = [e.get("event_type") for e in log.get("events") or []]
    r["all_three_events_were_stored"] = all(
        x in types for x in ("RENEWAL", "BILLING_ISSUE", "EXPIRATION"))
    # The premise of the whole screen: these are matched to a household, so
    # none of them is a payment that reached nobody.
    r["none_of_them_reached_nobody"] = all(
        e.get("matched") for e in log.get("events") or [])

    by_type = {e.get("event_type"): e for e in log.get("events") or []}
    r["the_renewal_carries_a_plan"] = bool((by_type.get("RENEWAL") or {}).get("plan"))
    # The reason the tag needs a fallback at all.
    r["the_billing_issue_carries_no_plan"] = not (by_type.get("BILLING_ISSUE") or {}).get("plan")

    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx = await b.new_context(viewport={"width": 412, "height": 915})
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
        await page.goto(f"{WEB}/metrics", wait_until="domcontentloaded")
        # Wait for the rows themselves rather than sleeping a fixed time and
        # hoping: this page loads a dozen separate reports.
        try:
            await page.wait_for_selector("text=BILLING_ISSUE", timeout=25000)
        except Exception:
            pass
        await page.wait_for_timeout(800)

        body = await page.inner_text("body")
        r["the_screen_lists_the_events"] = "BILLING_ISSUE" in body and "RENEWAL" in body

        # --- the wording ---------------------------------------------------
        # Scoped to the event rows, not the whole page: a word searched for
        # across every chart and caption on a long screen finds it somewhere
        # eventually, and then the check is measuring the page's vocabulary
        # rather than the rows'.
        rows_text = "\n".join(await page.locator(
            '[data-testid="billing-at-risk"], [data-testid="billing-row"]').all_inner_texts())
        r["the_probe_found_the_rows"] = "BILLING_ISSUE" in rows_text
        # "applied" beside a failed payment reads as though it were resolved.
        r["no_row_claims_a_failed_payment_was_applied"] = "applied" not in rows_text.lower()
        r["it_says_the_plan_is_unchanged_instead"] = "plan unchanged" in rows_text

        # --- the tint --------------------------------------------------------
        # Exactly the rows that need a person, and no others. Counted in the
        # DOM rather than eyeballed, because "it looked amber" is how a tint
        # that is applied to everything passes review.
        at_risk = await page.locator('[data-testid="billing-at-risk"]').count()
        r["one_row_is_flagged"] = at_risk == 1

        async def row_text(i):
            return await page.locator('[data-testid="billing-at-risk"]').nth(i).inner_text()

        flagged = await row_text(0) if at_risk else ""
        r["the_flagged_row_is_the_billing_issue"] = "BILLING_ISSUE" in flagged
        # The two that must NOT be flagged, for opposite reasons: a renewal is
        # a receipt, and an expiration is already done.
        r["the_renewal_is_not_flagged"] = "RENEWAL" not in flagged
        r["the_expiration_is_not_flagged"] = "EXPIRATION" not in flagged

        # And it is actually tinted, not merely tagged — the point is that it
        # cannot be scrolled past in a column of identical rows.
        painted = await page.evaluate("""
          () => {
            const el = document.querySelector('[data-testid="billing-at-risk"]');
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
              bg: s.backgroundColor,
              stripe: parseFloat(s.borderLeftWidth) || 0,
            };
          }
        """)
        r["the_flagged_row_is_painted"] = bool(
            painted and painted["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"))
        r["and_carries_a_stripe"] = bool(painted and painted["stripe"] >= 2)

        # It must line up with the rows around it: a tinted row indented from
        # the untinted ones reads as a rendering bug, not as emphasis.
        aligned = await page.evaluate("""
          () => {
            const flagged = document.querySelector('[data-testid="billing-at-risk"]');
            if (!flagged) return null;
            const label = flagged.querySelector('div, span');
            const rows = [...document.querySelectorAll('div')].filter(
              (d) => d !== flagged && /RENEWAL/.test(d.textContent || '')
                     && (d.textContent || '').length < 120);
            if (!label || !rows.length) return null;
            const a = label.getBoundingClientRect().left;
            const b = Math.min(...rows.map((d) => d.getBoundingClientRect().left));
            return Math.abs(a - b);
          }
        """)
        # Null means the probe found nothing to compare — reported as a
        # failure rather than a pass, so the check cannot pass by measuring
        # nothing.
        r["it_lines_up_with_the_other_rows"] = aligned is not None and aligned <= 2

        # Scroll the flagged row into view before the shot. The billing log
        # sits a long way down a page of charts, so a viewport screenshot
        # taken where the page loads is a picture of the wrong thing — and a
        # screenshot nobody can check is not evidence.
        try:
            await page.locator('[data-testid="billing-at-risk"]').first.scroll_into_view_if_needed()
            await page.wait_for_timeout(400)
        except Exception:
            pass
        await page.screenshot(path="billing_screen.png", full_page=False)
        r["no_js_errors_on_the_money_screen"] = not errs

        # --- and again in DARK, which is the theme this screen is read in ----
        #
        # The tint is built from theme-aware tokens on the argument that dark
        # is where a founder actually looks at this. An argument is not a
        # measurement: a literal gold would be invisible on the dark card, and
        # every check above would still pass, because they all run in light.
        dark = await b.new_context(viewport={"width": 412, "height": 915})
        dpage = await dark.new_page()
        derrs = []
        dpage.on("pageerror", lambda e: derrs.append(str(e)))

        async def droute(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await dark.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await dpage.route("**/api/**", droute)
        await dpage.add_init_script(
            f"localStorage.setItem('coo_session_token','{tok}');"
            "localStorage.setItem('coo_appearance_mode_minimal_light_v5','dark');")
        await dpage.goto(f"{WEB}/metrics", wait_until="domcontentloaded")
        try:
            await dpage.wait_for_selector('[data-testid="billing-at-risk"]', timeout=25000)
        except Exception:
            pass
        await dpage.wait_for_timeout(800)

        painted_dark = await dpage.evaluate("""
          () => {
            const el = document.querySelector('[data-testid="billing-at-risk"]');
            const plain = document.querySelector('[data-testid="billing-row"]');
            if (!el || !plain) return null;
            const s = getComputedStyle(el);
            const card = getComputedStyle(plain).backgroundColor;
            return { bg: s.backgroundColor, stripe: parseFloat(s.borderLeftWidth) || 0,
                     plain: card };
          }
        """)
        r["the_dark_page_rendered_both_kinds_of_row"] = painted_dark is not None
        r["the_flagged_row_is_painted_in_dark_too"] = bool(
            painted_dark and painted_dark["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"))
        # And painted DIFFERENTLY from an ordinary row: a tint that resolves to
        # the same colour as the card is a tint that is not there.
        r["and_differs_from_an_ordinary_row"] = bool(
            painted_dark and painted_dark["bg"] != painted_dark["plain"])
        r["and_keeps_its_stripe_in_dark"] = bool(
            painted_dark and painted_dark["stripe"] >= 2)

        try:
            await dpage.locator('[data-testid="billing-at-risk"]').first.scroll_into_view_if_needed()
            await dpage.wait_for_timeout(400)
        except Exception:
            pass
        await dpage.screenshot(path="billing_screen_dark.png", full_page=False)
        r["no_js_errors_in_dark"] = not derrs

        await b.close()


asyncio.run(main())
