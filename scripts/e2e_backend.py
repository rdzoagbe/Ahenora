"""Run the REAL backend/server.py on localhost with the in-memory database.

Usage: python3 scripts/e2e_backend.py [port]

Every route handler executes its actual production code; only the storage
layer is swapped (scripts/fake_mongo.py). Used by e2e_journey.py.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

# Billing "live": gates enforce exactly as in production (no free window).
os.environ.setdefault("RC_WEBHOOK_SECRET", "e2e-gating-live")

import server  # noqa: E402
from fake_mongo import FakeDatabase  # noqa: E402

server.db = FakeDatabase()
# A fixed tester identity the journey can bring into a household to flip it
# premium — exercising the household-level admin elevation end to end.
server.ADMIN_EMAILS = set(server.ADMIN_EMAILS) | {"e2e-admin@sim.test"}

# Every new household starts with the whole app for fourteen days. Most
# harnesses test what a household on Free sees (a paywall, a locked kitchen),
# so their households start on Free: a trial that ends the moment it starts.
# The harnesses that test the trial itself ask for it.
if os.environ.get("E2E_NEW_HOUSEHOLD_TRIAL") != "1":
    server.TRIAL_DAYS = 0

# The browser harnesses exercise the children's side on a household that has
# not paid (stars, chores, kid mode). Free became a plan for adults on
# 2026-09-29, with households that already had children keeping them for a
# notice period; the harness households are treated as those, whatever the
# date the run happens on, so no harness starts failing on the day the
# notice period ends. The new rules have their own unit tests.
from datetime import datetime, timezone  # noqa: E402
server.NEW_FREE_FROM = datetime(2999, 1, 1, tzinfo=timezone.utc)
server.LEGACY_FREE_UNTIL = datetime(2999, 1, 1, tzinfo=timezone.utc)

if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8990
    uvicorn.run(server.app, host="127.0.0.1", port=port, log_level="warning")
