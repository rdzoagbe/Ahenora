"""Screenshot the main screens for a visual UI/UX review — button alignment and
neatness, the things a passing harness does not judge. Seeds a realistic
household so screens are not bare, then captures each at phone widths."""
import asyncio, json, os, subprocess, sys, time, urllib.request, uuid
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_browser import launch_chromium

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
WEB_PORT, API_PORT = 8990, 8899

def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"http://127.0.0.1:{API_PORT}/api{p}",
        data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res: return json.loads(res.read().decode() or "{}")

def wait(url, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3); return True
        except Exception: time.sleep(0.5)
    return False

async def main():
    web = subprocess.Popen([sys.executable, os.path.join(HERE, "serve_web.py"), str(WEB_PORT), ROOT],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bk = subprocess.Popen([sys.executable, os.path.join(HERE, "e2e_backend.py"), str(API_PORT)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait(f"http://127.0.0.1:{API_PORT}/api/health"), "backend down"
        assert wait(f"http://127.0.0.1:{WEB_PORT}/app/feed"), "web down"

        # ---- seed a household -------------------------------------------------
        me = api("POST", "/auth/register", {"name": "Roland", "email": f"r-{uuid.uuid4().hex[:6]}@sim.test", "password": "password123"})
        tok = me["session_token"]
        api("POST", "/auth/complete-onboarding", {}, tok)
        # children so the Family Hub shows a Kids group and a member page opens
        for nm, st in [("Kwesi", 12), ("Ama", 7)]:
            try: api("POST", "/family/members", {"name": nm, "starting_stars": st}, tok)
            except Exception as e: print("member seed:", e)
        # a spread of cards: assigned, dated, undated, a sign-slip
        cards = [
            {"type": "TASK", "title": "School run", "assignee": "Kwesi", "due_date": "2026-08-25T08:00:00Z", "shared": True},
            {"type": "SIGN_SLIP", "title": "Sign the permission slip", "due_date": "2026-08-24T18:00:00Z", "shared": True},
            {"type": "TASK", "title": "Book the dentist", "shared": True},
            {"type": "EVENT", "title": "Parents' evening", "due_date": "2026-08-28T18:30:00Z", "shared": True},
        ]
        for c in cards:
            try: api("POST", "/cards", c, tok)
            except Exception as e: print("card seed:", e)
        # shopping seed — so the List footer (Select items / Clear all) renders
        for it in ["Milk", "Bread", "Eggs", "Onion", "Carrots"]:
            try: api("POST", "/shopping", {"name": it}, tok)
            except Exception as e: print("shop seed:", e)
        for ex in [{"merchant": "Aldi", "amount": 47.30, "category": "Groceries", "spent_on": "2026-08-12"},
                   {"merchant": "Carrefour", "amount": 31.90, "category": "Groceries", "spent_on": "2026-08-04"}]:
            try: api("POST", "/expenses", ex, tok)
            except Exception as e: print("exp seed:", e)
        # alternating custody on — so the Calendar week tints + legend and the
        # Feed's "· with you / at their dad's" line render for a visual check
        try: api("PUT", "/family/custody", {"enabled": True, "our_weeks": "even", "away_label": "leur papa"}, tok)
        except Exception as e: print("custody seed:", e)

        async with async_playwright() as pw:
            b = await launch_chromium(pw)

            async def shot(name, path, width=390, taps=None, wait_ms=2600):
                ctx = await b.new_context(viewport={"width": width, "height": 900}, device_scale_factor=2)
                pg = await ctx.new_page()
                async def route(ro):
                    seg = ro.request.url.split("/api/", 1)[1]
                    resp = await ctx.request.fetch(f"http://127.0.0.1:{API_PORT}/api/{seg}", method=ro.request.method,
                        headers={k: v for k, v in ro.request.headers.items() if k.lower() not in ("host","content-length","origin","referer")},
                        data=ro.request.post_data)
                    await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
                await pg.route("**/api/**", route)
                await pg.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
                await pg.goto(f"http://127.0.0.1:{WEB_PORT}/app{path}", wait_until="domcontentloaded")
                await pg.wait_for_timeout(wait_ms)
                for sel in (taps or []):
                    try:
                        await pg.click(sel, timeout=3000); await pg.wait_for_timeout(1400)
                    except Exception as e: print(f"tap {sel} on {name}:", e)
                await pg.screenshot(path=os.path.join(OUT, name), full_page=True)
                await ctx.close()
                print("shot", name)

            await shot("01_feed.png", "/feed")
            await shot("02_calendar.png", "/calendar")
            await shot("03_family.png", "/kids")
            await shot("04_kitchen_list.png", "/kitchen")
            await shot("05_kitchen_spending.png", "/kitchen", taps=['[data-testid="kitchen-tab-spend"]'])
            await shot("06_kitchen_meals.png", "/kitchen", taps=['[data-testid="kitchen-tab-meal"]'])
            await shot("07_settings.png", "/settings")
            await shot("08_addcard.png", "/feed", taps=['[data-testid="tab-add"]'], wait_ms=2600)
            await shot("09_feed_320.png", "/feed", width=320)
            await shot("10_kitchen_spend_320.png", "/kitchen", width=320, taps=['[data-testid="kitchen-tab-spend"]'])
            await shot("11_calendar_320.png", "/calendar", width=320)
            await b.close()
    finally:
        web.terminate(); bk.terminate()

asyncio.run(main())
print("done ->", OUT)
