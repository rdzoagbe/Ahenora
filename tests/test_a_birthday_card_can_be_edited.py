"""A birthday card can be edited like any other card.

A birthday repeats yearly, and the edit sheet always sends the repeat back
with the rest of the card. PATCH /api/cards/{id} checked the repeat against a
list that stopped at "monthly", so fixing a typo in a birthday's title came
back 400 "Invalid recurrence" — every edit to every birthday, refused. The
two routes now share RECURRENCE_VALUES.

Run with:  python3 -m unittest tests.test_a_birthday_card_can_be_edited -v
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    import server
    from fake_mongo import FakeDatabase
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com", "role": "parent"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ABirthdayCard(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages

        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet

        async def seed():
            await self.db["families"].insert_one({
                "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                "grandfathered": False, "updated_at": server.utcnow(),
                "ai_scans_used": 0, "ai_scans_period_start": server.utcnow(), "vault_bytes_used": 0,
            })
            await self.db["users"].insert_one({**ROLAND})
            await self.db["family_members"].insert_one({
                "member_id": "m_r", "family_id": "fam1", "user_id": "u_r",
                "name": "Roland", "role": "parent", "email": "r@x.com"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    def create(self, **kw):
        body = {"type": "BIRTHDAY", "title": "Efua's birtday", "recurrence": "yearly",
                "due_date": "2026-11-03T09:00:00Z", **kw}
        return asyncio.run(server.create_card(server.CardIn(**body), user=dict(ROLAND)))

    def patch(self, card_id, **kw):
        return asyncio.run(server.update_card(card_id, server.CardPatchIn(**kw), user=dict(ROLAND)))

    def test_fixing_a_typo_keeps_the_yearly_repeat(self):
        card = self.create()
        # The edit sheet resends the repeat it was given, so this is what a
        # title fix really sends.
        out = self.patch(card["card_id"], title="Efua's birthday", recurrence="yearly")
        self.assertEqual(out["title"], "Efua's birthday")
        self.assertEqual(out["recurrence"], "yearly")

    def test_every_repeat_a_card_can_be_made_with_it_can_be_edited_to(self):
        card = self.create()
        for value in sorted(server.RECURRENCE_VALUES):
            self.assertEqual(self.patch(card["card_id"], recurrence=value)["recurrence"], value, value)

    def test_a_made_up_repeat_is_still_refused(self):
        card = self.create()
        with self.assertRaises(HTTPException) as ctx:
            self.patch(card["card_id"], recurrence="fortnightly")
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
