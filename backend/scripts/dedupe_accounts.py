#!/usr/bin/env python3
"""CLI wrapper for the duplicate-account cleanup (see backend/dedupe_core.py).

Before PR #411, "Continue with Google" looked accounts up by google_sub only, so
signing in with Google for an inbox that already had an email/password account
minted a SECOND, passwordless row in its own empty family. The app now links
instead of duplicating; this folds up the ones already created.

Most people should just use the admin endpoint instead (no setup):
    GET  /api/admin/dedupe-accounts               -> dry-run report (JSON)
    POST /api/admin/dedupe-accounts {"confirm":"APPLY"} -> apply
Run this CLI only if you prefer the terminal, in the backend's own environment
(so MONGO_URL / DB_NAME and the deps are present):

    python backend/scripts/dedupe_accounts.py            # report only
    python backend/scripts/dedupe_accounts.py --apply    # make the changes

Safe by default (dry-run), idempotent, and it never deletes a family that holds
real data — those are listed for manual review.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dedupe_core import run  # noqa: E402  (path set above)


async def _main(apply):
    import server
    db = server.get_db()
    if db is None:
        print("No database configured (MONGO_URL unset). Run this in the backend's environment.")
        sys.exit(1)
    await run(db, apply=apply)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge duplicate accounts from pre-linking Google sign-in.")
    parser.add_argument("--apply", action="store_true", help="Make changes (default is a dry run).")
    args = parser.parse_args()
    asyncio.run(_main(args.apply))
