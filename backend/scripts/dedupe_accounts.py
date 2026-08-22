#!/usr/bin/env python3
"""One-off cleanup for duplicate user rows created by the pre-linking Google
sign-in.

Before PR #411, "Continue with Google" looked accounts up by google_sub only, so
signing in with Google for an inbox that already had an email/password account
minted a SECOND, passwordless row (in its own empty, auto-created family). That
duplicate could then shadow the real account at email login. The app now links
instead of duplicating, so no NEW duplicates form — this folds up the ones that
already exist.

What it does per email that has more than one row:
  • keeps the real account (prefers the one with a password; then the oldest);
  • links the duplicate's google_sub onto the keeper if the keeper has none;
  • deletes the duplicate row, its sessions, and its own member row — and its
    solo family ONLY when that family is an empty shell (no cards, expenses,
    vault, rewards, extra members, …). A duplicate whose family holds real data
    is never touched; it is listed for MANUAL REVIEW instead.
It also lowercases any email stored with mixed casing.

SAFE BY DEFAULT: dry-run unless you pass --apply. Reuses the app's own DB
connection (MONGO_URL / DB_NAME), so run it in the backend's environment, e.g. a
Railway one-off shell:

    python backend/scripts/dedupe_accounts.py            # report only
    python backend/scripts/dedupe_accounts.py --apply    # make the changes

Run it AFTER the PR #411 backend deploy, and re-running it is harmless (idempotent).
"""
import argparse
import asyncio
import os
import sys

# family_id-scoped collections whose presence means a family was really used.
# A duplicate's family is only deletable when every one of these is empty for it.
CONTENT_COLLECTIONS = [
    "cards", "expenses", "vault", "shopping_list", "meals", "meal_plans_saved",
    "routines", "chores", "rewards", "redemptions", "allowances", "allowance_txns",
    "announcements", "carpools", "handoff_notes", "templates", "star_transactions",
    "calendar_contacts", "chore_logs", "routine_logs", "messages",
]


def _keeper_sort_key(u):
    # Password accounts first (the real sign-up), then oldest created_at.
    return (0 if u.get("password_hash") else 1, str(u.get("created_at") or ""))


async def _family_is_empty_shell(db, family_id):
    """True when a family has no real content and at most one member — i.e. the
    hollow family auto-created for a duplicate account, safe to delete."""
    if not family_id:
        return False
    members = 0
    async for _ in db["family_members"].find({"family_id": family_id}):
        members += 1
        if members > 1:
            return False
    for coll in CONTENT_COLLECTIONS:
        if await db[coll].find_one({"family_id": family_id}):
            return False
    return True


async def run(db, apply=False, log=print):
    """Core logic against a db-like object. Returns a summary dict."""
    groups = {}
    async for u in db["users"].find({}):
        email = (u.get("email") or "").strip().lower()
        if not email:
            continue
        groups.setdefault(email, []).append(u)

    dup_groups = {e: us for e, us in groups.items() if len(us) > 1}
    log(f"{len(groups)} distinct emails; {len(dup_groups)} have duplicate rows.")

    summary = {"normalized": 0, "linked": 0, "removed": 0, "manual": 0}

    # Lowercase any mixed-case stored emails (safe, and it makes future lookups hit).
    for email, us in groups.items():
        for u in us:
            if u.get("email") != email:
                log(f"[normalize] {u['user_id']}: {u.get('email')!r} -> {email!r}")
                summary["normalized"] += 1
                if apply:
                    await db["users"].update_one({"user_id": u["user_id"]}, {"$set": {"email": email}})

    for email in sorted(dup_groups):
        rows = sorted(dup_groups[email], key=_keeper_sort_key)
        keeper, dups = rows[0], rows[1:]
        log(f"\n=== {email}: {len(rows)} rows — keep {keeper['user_id']} "
            f"(password={bool(keeper.get('password_hash'))}, family={keeper.get('family_id')})")
        for d in dups:
            same_family = d.get("family_id") == keeper.get("family_id")
            gs = d.get("google_sub")

            if gs and not keeper.get("google_sub"):
                log(f"   • link google_sub {gs} -> keeper {keeper['user_id']}")
                summary["linked"] += 1
                if apply:
                    await db["users"].update_one(
                        {"user_id": keeper["user_id"]}, {"$set": {"google_sub": gs}})
                keeper["google_sub"] = gs

            removable = same_family or await _family_is_empty_shell(db, d.get("family_id"))
            if removable:
                log(f"   • remove duplicate {d['user_id']}"
                    + ("" if same_family else f" + empty family {d.get('family_id')}"))
                summary["removed"] += 1
                if apply:
                    await db["users"].delete_one({"user_id": d["user_id"]})
                    await db["user_sessions"].delete_many({"user_id": d["user_id"]})
                    await db["family_members"].delete_many({"user_id": d["user_id"]})
                    if not same_family:
                        await db["families"].delete_one({"family_id": d.get("family_id")})
                        await db["family_members"].delete_many({"family_id": d.get("family_id")})
            else:
                log(f"   • MANUAL REVIEW: duplicate {d['user_id']} family "
                    f"{d.get('family_id')} holds real data — not touched")
                summary["manual"] += 1

    log("\n--- summary ---")
    log(f"emails normalized : {summary['normalized']}")
    log(f"google links added: {summary['linked']}")
    log(f"duplicates removed: {summary['removed']}")
    log(f"need manual review: {summary['manual']}")
    log("\nDRY RUN — nothing was changed. Re-run with --apply to execute."
        if not apply else "\nAPPLIED.")
    return summary


async def _main(apply):
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
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
