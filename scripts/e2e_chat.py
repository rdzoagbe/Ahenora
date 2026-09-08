"""Two people, two browsers, one conversation.

The chat had no browser harness at all, and the two things a chat is FOR are
exactly the two things a single session cannot prove:

  A message arrives while you are looking at the screen. Until 2026-09-08 it
  did not — the thread loaded once and never again, so the only way to read a
  reply was to tap its notification. Every test passed the whole time, because
  every test only ever had one person in the room.

  The sender is told it was read. `read_by` had been recorded since the chat
  was written and shown to nobody; the sender could never tell whether what
  they sent about Friday had landed.

So this opens Roland's browser and Keigh's browser at the same time, on the
same thread, and watches what happens in one when the other types — with no
reloads anywhere. A reload would prove nothing: reloading is the bug.

Usage:  python3 scripts/e2e_chat.py <web_port> <api_port>
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

# The screen polls every 4s. Twice that, so a slow CI runner is not a failure.
LIVE_WAIT = 9000


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})}, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def seed():
    """Two parents in one household — the adults' thread is theirs alone."""
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Roland Chat", "email": f"rc-{run}@sim.test",
                                       "password": "password123"})
    api("POST", "/auth/complete-onboarding", {}, a["session_token"])
    inv = api("POST", "/family/invite",
              {"email": f"kc-{run}@sim.test", "relationship": "Co-parent"}, a["session_token"])
    b = api("POST", "/auth/register",
            {"name": "Keigh Chat", "email": f"kc-{run}@sim.test", "password": "password123",
             "invite_token": inv["invite"]["token"]})
    api("POST", "/auth/complete-onboarding", {}, b["session_token"])
    return a["session_token"], b["session_token"]


async def persona(browser, token):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})
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
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    return ctx, page


async def open_thread(page):
    await page.goto(f"{WEB}/chat", wait_until="domcontentloaded")
    await page.wait_for_timeout(2500)
    # A household with two adults opens straight into their room on some
    # layouts and onto a list of conversations on others; take whichever.
    if await page.get_by_test_id("chat-input").count() == 0:
        entry = page.get_by_test_id("chat-thread-adults")
        if await entry.count():
            await entry.first.click()
            await page.wait_for_timeout(1500)
    await page.wait_for_selector("[data-testid='chat-input']", timeout=15000)


async def say(page, text):
    await page.get_by_test_id("chat-input").fill(text)
    await page.get_by_test_id("chat-send").click()
    await page.wait_for_timeout(1200)


async def main():
    tok_a, tok_b = seed()
    fails = []

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx_a, roland = await persona(browser, tok_a)
        ctx_b, keigh = await persona(browser, tok_b)

        await open_thread(roland)
        await open_thread(keigh)

        # --- 1. it arrives without touching anything ------------------------
        first = f"Can you get the kids Friday? {uuid.uuid4().hex[:5]}"
        await say(roland, first)
        try:
            # Keigh's browser has not been reloaded, clicked, or navigated.
            await keigh.get_by_text(first, exact=False).first.wait_for(timeout=LIVE_WAIT)
        except Exception:  # noqa: BLE001
            fails.append("a message sent by one person never appeared in the other's "
                         "open conversation")

        # --- 2. the sender is told it was read ------------------------------
        # Keigh's screen has it on display, so it is read by definition.
        #
        # Waiting for the TEXT, not the element. The receipt appears the
        # instant Roland sends — reading "Sent" — so waiting for it to exist
        # and then reading it once tests only that sending works. What matters
        # is that it CHANGES, on a screen nobody has touched.
        last = ""
        for _ in range(int(LIVE_WAIT / 500)):
            receipt = roland.get_by_test_id("chat-receipt")
            if await receipt.count():
                last = (await receipt.first.inner_text() or "").strip().lower()
                if "seen" in last or "vu" in last:
                    break
            await roland.wait_for_timeout(500)
        else:
            fails.append("the sender's receipt never turned to seen "
                         f"(stuck showing {last!r})")

        # --- 3. it works in the other direction too -------------------------
        reply = f"Yes, I finish early {uuid.uuid4().hex[:5]}"
        await say(keigh, reply)
        try:
            await roland.get_by_text(reply, exact=False).first.wait_for(timeout=LIVE_WAIT)
        except Exception:  # noqa: BLE001
            fails.append("a reply never appeared in the sender's open conversation")

        # --- 4. nothing is shown twice (before any quoting muddies counting) -
        # The sent message is added locally AND comes back from the next poll.
        # Appending rather than merging shows every message you send twice,
        # which is the obvious way to build this and is wrong.
        await roland.wait_for_timeout(6000)
        for page, text, who in ((keigh, reply, "sender"), (roland, first, "sender")):
            count = await page.get_by_text(text, exact=False).count()
            if count != 1:
                fails.append(f"{who}'s own message is on screen {count} times, not once")

        # --- 5. holding a message offers what to do with it -----------------
        # Performed as the gesture, not posted through the API: whether a long
        # press is reachable at all on a real page is half of what can be
        # wrong here, and it is invisible to every unit test.
        async def hold(page, text):
            """Long-press the bubble containing `text`. True if the sheet opened."""
            box = await page.get_by_text(text, exact=False).first.bounding_box()
            if not box:
                return False
            await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.mouse.down()
            await page.wait_for_timeout(900)          # past the long-press delay
            await page.mouse.up()
            await page.wait_for_timeout(600)
            return await page.get_by_test_id("chat-actions").count() > 0

        answer = f"Friday works {uuid.uuid4().hex[:5]}"
        if not await hold(keigh, first):
            fails.append("holding a message offered nothing to do with it")
        else:
            await keigh.get_by_test_id("chat-action-reply").first.click()
            await keigh.wait_for_timeout(600)
            if await keigh.get_by_test_id("chat-replying-to").count() == 0:
                fails.append("choosing Reply did not show what was being answered")
            else:
                await say(keigh, answer)
                # The quote must reach the OTHER person's screen, live, with
                # the line it answers attached.
                try:
                    await roland.get_by_text(answer, exact=False).first.wait_for(
                        timeout=LIVE_WAIT)
                    if await roland.get_by_text(first, exact=False).count() < 2:
                        fails.append("the reply arrived without the message it answers")
                except Exception:  # noqa: BLE001
                    fails.append("a reply never reached the other screen")
                if await keigh.get_by_test_id("chat-replying-to").count():
                    fails.append("sending a reply left the composer still quoting it — "
                                 "every later message would quote the same old line")

        # --- 6. reacting, and the other screen seeing it ---------------------
        if not await hold(keigh, first):
            fails.append("could not reopen the actions to react")
        elif await keigh.get_by_test_id("chat-react-\U0001f44d").count() == 0:
            fails.append("holding a message offered no way to react to it")
        else:
            await keigh.get_by_test_id("chat-react-\U0001f44d").first.click()
            await keigh.wait_for_timeout(800)
            if await keigh.get_by_test_id("chat-actions").count():
                fails.append("reacting left the sheet open over the conversation")
            try:
                await roland.get_by_test_id("chat-reaction-\U0001f44d").first.wait_for(
                    timeout=LIVE_WAIT)
            except Exception:  # noqa: BLE001
                fails.append("a reaction never reached the other person's open screen")

        # --- 7. correcting what you sent ------------------------------------
        # Roland's own message, held, then Edit. The correction has to reach
        # Keigh's open screen carrying its permanent marker — an edit she only
        # sees after reopening would be a silent rewrite of what she read.
        # A fresh message, deliberately: the reply in step 5 quotes `first`,
        # and that quote keeps the ORIGINAL wording on purpose — so counting
        # occurrences of `first` after an edit would be asking the wrong
        # question.
        typo = f"Dentist on Thurdsay {uuid.uuid4().hex[:5]}"
        fixed = typo.replace("Thurdsay", "Thursday")
        await say(roland, typo)
        await roland.wait_for_timeout(500)
        if not await hold(roland, typo):
            fails.append("could not reopen the actions on your own message")
        elif await roland.get_by_test_id("chat-action-edit").count() == 0:
            fails.append("a message you just sent offered no way to correct it")
        else:
            await roland.get_by_test_id("chat-action-edit").first.click()
            await roland.wait_for_timeout(600)
            if await roland.get_by_test_id("chat-editing").count() == 0:
                fails.append("choosing Edit did not show what was being corrected")
            await say(roland, fixed)
            try:
                await keigh.get_by_text(fixed, exact=False).first.wait_for(timeout=LIVE_WAIT)
            except Exception:  # noqa: BLE001
                fails.append("a correction never reached the other person's open screen")
            if await keigh.get_by_test_id("chat-edited").count() == 0:
                fails.append("the correction arrived with nothing saying it had been edited")
            if await keigh.get_by_text(typo, exact=False).count():
                fails.append("the old wording is still on screen after the correction")
            if await roland.get_by_test_id("chat-editing").count():
                fails.append("sending the correction left the composer still in edit mode")

        # --- 8. a conversation left open does not re-download itself --------
        # Only reachable with a cursor that can move past a read; without one
        # every poll ships the whole page again, forever, on a phone.
        polls = []

        async def watch(res):
            if "/family/chat/" in res.url and res.request.method == "GET":
                try:
                    polls.append(len((await res.json()).get("messages") or []))
                except Exception:  # noqa: BLE001
                    pass
        roland.on("response", lambda r: asyncio.ensure_future(watch(r)))
        await roland.wait_for_timeout(13000)      # three polls of a quiet thread
        if polls and sum(polls) > 0:
            fails.append(f"a quiet conversation kept re-sending its history: {polls}")

        await ctx_a.close()
        await ctx_b.close()
        await browser.close()

    if fails:
        print(f"FAIL  {len(fails)} problem(s) in the conversation:")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PASS  messages arrive live both ways, once each; the sender is told they "
          "landed; and a held message can be answered, reacted to or corrected")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
