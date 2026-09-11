"""A child's key facts, and the wall down the middle of them.

The claim this exists to prove, in a real browser rather than in a serialiser
test: a nanny opening a child's page sees the allergy, and does not see the
health number. Both halves matter and they fail in opposite directions — a
carer who cannot read the allergy cannot do the job, and a permanent
identifier that spreads one account further than it must is the kind of
mistake you cannot take back.

Also held: the record does not ride along with /family/members, which every
screen fetches and helpers fetch too.
"""
import asyncio, json, sys, urllib.error, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

ALLERGY = "Peanuts — EpiPen in the blue bag"
HEALTH_NO = "NHS 123 456 7890"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    try:
        with urllib.request.urlopen(r, timeout=20) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{m} {p} -> {e.code}: {e.read().decode()[:300]}") from None


async def open_as(b, token, path):
    ctx = await b.new_context(viewport={"width": 390, "height": 844})
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    async def route(ro):
        p = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(f"{API}/{p}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    await page.goto(f"{WEB}{path}", wait_until="domcontentloaded")
    await page.wait_for_timeout(3200)
    return page, errs


async def main():
    r = {}
    try:
        await run(r)
    except Exception as e:
        print(f"stopped at: {type(e).__name__}: {str(e).splitlines()[0]}")
        r["ran_to_the_end"] = False
    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if r and all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if r and all(r.values()) else 1)


async def run(r):
    import uuid, asyncio as aio
    tag = uuid.uuid4().hex[:6]
    parent = api("POST", "/auth/register", {"name": "Roland Sim", "email": f"rec-p-{tag}@sim.test",
                                            "password": "password123"})
    tok_p = parent["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_p)

    # Helper accounts are a paid feature; the household is elevated the way the
    # other harnesses do it, and the 60s admin cache is waited out while the
    # parent's own checks run.
    admin_inv = api("POST", "/family/invite",
                    {"email": "e2e-admin@sim.test", "relationship": "Admin"}, tok_p)
    api("POST", "/auth/register",
        {"name": "Admin Sim", "email": "e2e-admin@sim.test", "password": "password123",
         "invite_token": admin_inv["invite"]["token"]})
    import time
    elevated_at = time.monotonic()

    child = api("POST", "/family/members", {"name": "Ama Sim", "role": "child"}, tok_p)
    member_id = child["member_id"]

    async with async_playwright() as pw:
        b = await launch_chromium(pw)

        # --- the parent fills it in -----------------------------------------
        page_p, errs_p = await open_as(b, tok_p, f"/member?id={member_id}&name=Ama%20Sim&role=child")
        r["the_form_is_there"] = await page_p.locator('[data-testid="record-allergies"]').count() == 1
        await page_p.fill('[data-testid="record-allergies"]', ALLERGY)
        await page_p.click('[data-testid="record-school_name"]')
        await page_p.fill('[data-testid="record-school_name"]', "St Mary's")
        await page_p.click('[data-testid="record-medical_number"]')
        await page_p.fill('[data-testid="record-medical_number"]', HEALTH_NO)
        await page_p.click('[data-testid="record-insurance_policy"]')
        await page_p.wait_for_timeout(2200)

        stored = api("GET", f"/family/members/{member_id}/record", None, tok_p)
        r["what_the_parent_typed_was_kept"] = (
            stored.get("allergies") == ALLERGY and stored.get("school_name") == "St Mary's")
        r["the_parent_sees_the_health_number"] = stored.get("medical_number") == HEALTH_NO
        r["the_parent_is_not_told_anything_is_hidden"] = stored.get("private_hidden") is False
        await page_p.screenshot(path="record_parent.png")

        # --- the nanny -------------------------------------------------------
        await aio.sleep(max(0, 62 - (time.monotonic() - elevated_at)))
        nanny_email = f"rec-n-{tag}@sim.test"
        inv = api("POST", "/family/invite",
                  {"email": nanny_email, "relationship": "Nanny", "is_helper": True}, tok_p)
        nanny = api("POST", "/auth/register",
                    {"name": "Esi Sim", "email": nanny_email, "password": "password123",
                     "invite_token": inv["invite"]["token"]})
        tok_n = nanny["session_token"]
        api("POST", "/auth/complete-onboarding", {}, tok_n)
        r["the_invited_carer_is_a_helper"] = bool(
            api("GET", "/auth/me", None, tok_n).get("is_helper"))

        seen = api("GET", f"/family/members/{member_id}/record", None, tok_n)
        r["the_carer_is_given_the_allergy"] = seen.get("allergies") == ALLERGY
        r["the_carer_is_not_given_the_health_number"] = "medical_number" not in seen
        r["the_health_number_is_nowhere_in_that_answer"] = HEALTH_NO not in json.dumps(seen)
        r["the_carer_is_told_something_is_hidden"] = seen.get("private_hidden") is True
        r["the_carer_may_not_edit"] = seen.get("can_edit") is False

        page_n, errs_n = await open_as(b, tok_n, f"/member?id={member_id}&name=Ama%20Sim&role=child")
        body_n = await page_n.inner_text("body")
        r["the_carer_reads_the_allergy_on_screen"] = ALLERGY in body_n
        r["the_health_number_is_not_on_their_screen"] = HEALTH_NO not in body_n
        r["their_screen_says_a_drawer_is_closed"] = "Hidden from helpers" in body_n
        # Read-only: the values are text, not fields they can type into.
        r["their_screen_offers_no_input"] = await page_n.evaluate("""
          () => {
            const el = document.querySelector('[data-testid="record-allergies"]');
            return !!el && el.tagName.toLowerCase() !== 'input'
                        && el.tagName.toLowerCase() !== 'textarea';
          }
        """)
        await page_n.screenshot(path="record_carer.png")

        # --- and it does not ride along with the members list -----------------
        members = json.dumps(api("GET", "/family/members", None, tok_n))
        r["the_members_list_carries_none_of_it"] = (
            ALLERGY not in members and HEALTH_NO not in members and "record" not in members)

        r["no_js_errors_for_the_parent"] = not errs_p
        r["no_js_errors_for_the_carer"] = not errs_n
        await b.close()

asyncio.run(main())
