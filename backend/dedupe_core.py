"""Core logic for merging duplicate user rows left by the pre-linking Google
sign-in. Kept dependency-free (no server import, no motor) so both the CLI
(scripts/dedupe_accounts.py) and an admin endpoint in server.py can reuse it.

See scripts/dedupe_accounts.py for the full background."""

# Kept in step with _FAMILY_SCOPED_COLLECTIONS / _purge_user_account in
# server.py. They are duplicated rather than imported because server.py imports
# this module, and a cycle here would take the whole API down on boot.

# Rows keyed by the user themselves. A duplicate's row in each of these must go
# with the user: a stale notification_token keeps pushing to a real phone for an
# account that no longer exists, which is how a "cleanup" becomes a bug report.
USER_SCOPED_COLLECTIONS = [
    "user_sessions", "notification_tokens", "notification_settings",
    "password_resets", "family_members",
]

# Everything scoped to a family, for emptying the hollow one before deleting it.
# Deleting by family_id from a collection without the field is a harmless no-op,
# so erring long is safe here; erring short leaves orphans.
FAMILY_SCOPED_COLLECTIONS = [
    "activity", "allowance_txns", "allowances", "announcements", "calendar_contacts",
    "cards", "carpools", "chore_logs", "chores", "expenses", "family_invites",
    "family_members", "handoff_notes", "meal_plans_saved", "meals", "messages",
    "redemptions", "rewards", "routine_logs", "routines", "shopping_history",
    "shopping_list", "star_transactions", "templates", "vault",
]

# family_id-scoped collections whose presence means a family was really used.
# A duplicate's family is only deletable when every one of these is empty for it.
CONTENT_COLLECTIONS = [
    "cards", "expenses", "vault", "shopping_list", "meals", "meal_plans_saved",
    "routines", "chores", "rewards", "redemptions", "allowances", "allowance_txns",
    "announcements", "carpools", "handoff_notes", "templates", "star_transactions",
    "calendar_contacts", "chore_logs", "routine_logs", "messages",
]


def _family_carries_money(fam):
    """True if this family is or was a paying one. RevenueCat stamps rc_* on every
    subscriber event, so their presence outlives a lapsed plan — which is exactly
    when we least want to throw the row away."""
    if (fam.get("plan") or "village") != "village":
        return True
    return any(k.startswith("rc_") for k in fam)


def _keeper_sort_key(u):
    # Password accounts first (the real sign-up), then oldest created_at.
    return (0 if u.get("password_hash") else 1, str(u.get("created_at") or ""))


async def family_is_empty_shell(db, family_id):
    """True when a family has no real content and at most one member — i.e. the
    hollow family auto-created for a duplicate account, safe to delete.

    A family that has ever carried a paid plan is never a shell, however empty it
    looks. The subscription lives on the family document, so deleting one because
    it holds no chores would delete the record of somebody's money."""
    if not family_id:
        return False
    fam = await db["families"].find_one({"family_id": family_id})
    if fam and _family_carries_money(fam):
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
    """Merge duplicate accounts. Dry-run unless apply=True. Returns a summary
    dict; every action is also emitted through `log` for a human-readable report."""
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
        log(f"{email}: {len(rows)} rows — keep {keeper['user_id']} "
            f"(password={bool(keeper.get('password_hash'))}, family={keeper.get('family_id')})")
        for d in dups:
            same_family = d.get("family_id") == keeper.get("family_id")
            gs = d.get("google_sub")

            if gs and keeper.get("google_sub") and keeper["google_sub"] != gs:
                log(f"  - MANUAL REVIEW: duplicate {d['user_id']} carries a different "
                    f"google_sub than the keeper — not touched")
                summary["manual"] += 1
                continue

            # Decided BEFORE anything is linked, because whether the duplicate
            # goes away changes whether linking is safe at all.
            removable = same_family or await family_is_empty_shell(db, d.get("family_id"))

            if gs and not removable:
                # Google sign-in resolves an account by google_sub alone. Copying
                # the sub onto the keeper while the duplicate keeps its own would
                # leave TWO rows answering to one identity, and which household
                # the person lands in becomes whichever row the database returns
                # first. Today they at least land somewhere consistently; this
                # would turn that into a coin toss. A household with real content
                # in it is a decision for a person, not a script.
                log(f"  - MANUAL REVIEW: duplicate {d['user_id']} family "
                    f"{d.get('family_id')} holds real data AND carries the Google "
                    f"identity — linking it to the keeper would leave two accounts "
                    f"answering to one sign-in. Not touched.")
                summary["manual"] += 1
                continue

            if gs and not keeper.get("google_sub"):
                log(f"  - link google_sub {gs} -> keeper {keeper['user_id']}")
                summary["linked"] += 1
                if apply:
                    await db["users"].update_one(
                        {"user_id": keeper["user_id"]}, {"$set": {"google_sub": gs}})
                keeper["google_sub"] = gs

            if removable:
                log(f"  - remove duplicate {d['user_id']}"
                    + ("" if same_family else f" + empty family {d.get('family_id')}"))
                summary["removed"] += 1
                if apply:
                    for coll in USER_SCOPED_COLLECTIONS:
                        await db[coll].delete_many({"user_id": d["user_id"]})
                    await db["users"].delete_one({"user_id": d["user_id"]})
                    if not same_family:
                        for coll in FAMILY_SCOPED_COLLECTIONS:
                            await db[coll].delete_many({"family_id": d.get("family_id")})
                        await db["families"].delete_one({"family_id": d.get("family_id")})
            else:
                log(f"  - MANUAL REVIEW: duplicate {d['user_id']} family "
                    f"{d.get('family_id')} holds real data — not touched")
                summary["manual"] += 1

    log(f"summary: normalized={summary['normalized']} linked={summary['linked']} "
        f"removed={summary['removed']} manual_review={summary['manual']}")
    return summary
