"""
Backend tier-gating / subscription tests for Household COO.
Run: python /app/backend_test_tier.py
"""
import json
import sys
import time
import requests

BASE = "https://ai-household.preview.emergentagent.com/api"
TOKEN = "test_session_1776435744337"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

results = []


def rec(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name} :: {detail}")
    results.append((name, ok, detail))


def test_get_subscription_initial():
    r = requests.get(f"{BASE}/subscription", headers=HEADERS, timeout=30)
    ok = r.status_code == 200
    if not ok:
        rec("GET /subscription initial", False, f"HTTP {r.status_code} body={r.text[:300]}")
        return None
    data = r.json()
    # Field presence & values
    checks = []
    checks.append(("plan_is_village", data.get("plan") == "village"))
    checks.append(("grandfathered_false", data.get("grandfathered") is False))
    checks.append(("price_monthly_0", abs(float(data.get("price_monthly", -1)) - 0.0) < 0.01))
    checks.append(("price_yearly_0", abs(float(data.get("price_yearly", -1)) - 0.0) < 0.01))
    checks.append(("ai_scans_used_0", int(data.get("ai_scans_used", -1)) == 0))
    checks.append(("members_count_3", int(data.get("members_count", 0)) == 3))
    limits = data.get("limits") or {}
    for k in ("max_members", "ai_scans_per_month", "vault_bytes", "weekly_brief", "multi_property"):
        checks.append((f"limits.{k}_present", k in limits))
    checks.append(("billing_cycle_present", data.get("billing_cycle") in ("monthly", "yearly")))

    all_ok = all(v for _, v in checks)
    detail = ", ".join([f"{k}={v}" for k, v in checks]) + f" | plan={data.get('plan')}, grandfathered={data.get('grandfathered')}, billing={data.get('billing_cycle')}, members={data.get('members_count')}"
    rec("Step 1: GET /subscription initial (village, not grandfathered)", all_ok, detail)
    return data


def test_change_to_village():
    r = requests.post(
        f"{BASE}/subscription/change",
        headers=HEADERS,
        json={"plan": "village", "billing_cycle": "monthly"},
        timeout=30,
    )
    ok = r.status_code == 200
    if not ok:
        rec("Step 2: POST /subscription/change -> village", False, f"HTTP {r.status_code} body={r.text[:300]}")
        return None
    d = r.json()
    ok2 = d.get("plan") == "village" and d.get("grandfathered") is False and abs(float(d.get("price_monthly", -1)) - 0.0) < 0.001
    rec("Step 2: POST /subscription/change -> village", ok2, f"plan={d.get('plan')}, grandfathered={d.get('grandfathered')}, price_monthly={d.get('price_monthly')}")
    return d


def test_brief_blocked_village():
    r = requests.post(f"{BASE}/brief/weekly", headers=HEADERS, timeout=60)
    if r.status_code != 402:
        rec("Step 3: POST /brief/weekly gated 402 on village", False, f"HTTP {r.status_code} body={r.text[:300]}")
        return
    try:
        body = r.json()
    except Exception:
        rec("Step 3: POST /brief/weekly gated 402 on village", False, f"non-JSON body={r.text[:300]}")
        return
    detail = body.get("detail", {})
    ok = (
        isinstance(detail, dict)
        and detail.get("error") == "plan_limit"
        and detail.get("feature") == "weekly_brief"
        and detail.get("current_plan") == "village"
        and "Executive" in (detail.get("message") or "")
    )
    rec("Step 3: POST /brief/weekly gated 402 on village", ok, f"detail={json.dumps(detail)[:300]}")


def test_family_invite_blocked_village():
    r = requests.post(
        f"{BASE}/family/invite",
        headers=HEADERS,
        json={"email": "test402@example.com"},
        timeout=30,
    )
    if r.status_code != 402:
        rec("Step 4: POST /family/invite gated 402 on village", False, f"HTTP {r.status_code} body={r.text[:300]}")
        return
    try:
        body = r.json()
    except Exception:
        rec("Step 4: POST /family/invite gated 402 on village", False, f"non-JSON body={r.text[:300]}")
        return
    detail = body.get("detail", {})
    ok = (
        isinstance(detail, dict)
        and detail.get("error") == "plan_limit"
        and detail.get("feature") == "family_members"
        and int(detail.get("limit", -1)) == 3
    )
    rec("Step 4: POST /family/invite gated 402 on village", ok, f"detail={json.dumps(detail)[:300]}")


def test_change_to_executive_yearly():
    r = requests.post(
        f"{BASE}/subscription/change",
        headers=HEADERS,
        json={"plan": "executive", "billing_cycle": "yearly"},
        timeout=30,
    )
    ok = r.status_code == 200
    if not ok:
        rec("Step 5: POST /subscription/change -> executive yearly", False, f"HTTP {r.status_code} body={r.text[:300]}")
        return
    d = r.json()
    ok2 = d.get("plan") == "executive" and d.get("billing_cycle") == "yearly"
    rec("Step 5: POST /subscription/change -> executive yearly", ok2, f"plan={d.get('plan')}, billing={d.get('billing_cycle')}")


def test_brief_unblocked_executive():
    t0 = time.time()
    r = requests.post(f"{BASE}/brief/weekly", headers=HEADERS, timeout=60)
    dt = time.time() - t0
    if r.status_code != 200:
        rec("Step 6: POST /brief/weekly on executive (200)", False, f"HTTP {r.status_code} body={r.text[:300]} took={dt:.1f}s")
        return
    try:
        d = r.json()
    except Exception:
        rec("Step 6: POST /brief/weekly on executive (200)", False, f"non-JSON body={r.text[:300]}")
        return
    brief = d.get("brief", "")
    ok = isinstance(brief, str) and len(brief) > 0
    rec("Step 6: POST /brief/weekly on executive (200)", ok, f"brief_len={len(brief)} took={dt:.1f}s")


def test_regression():
    # auth/me
    r = requests.get(f"{BASE}/auth/me", headers=HEADERS, timeout=15)
    rec("Step 7a: GET /auth/me", r.status_code == 200, f"HTTP {r.status_code}")

    # family/members with has_pin bools
    r = requests.get(f"{BASE}/family/members", headers=HEADERS, timeout=15)
    if r.status_code != 200:
        rec("Step 7b: GET /family/members", False, f"HTTP {r.status_code} body={r.text[:200]}")
    else:
        members = r.json()
        all_ok = isinstance(members, list) and len(members) >= 1 and all(isinstance(m.get("has_pin"), bool) for m in members)
        rec("Step 7b: GET /family/members (has_pin bool each)", all_ok, f"count={len(members)}; has_pin flags={[m.get('has_pin') for m in members]}")

    # /ai/assign
    r = requests.post(
        f"{BASE}/ai/assign",
        headers=HEADERS,
        json={"title": "Take Emma to ballet practice", "description": "Wednesday 4pm", "type": "TASK"},
        timeout=60,
    )
    if r.status_code != 200:
        rec("Step 7c: POST /ai/assign", False, f"HTTP {r.status_code} body={r.text[:200]}")
    else:
        d = r.json()
        assignee = d.get("assignee", None)
        ok = isinstance(assignee, str)  # empty string acceptable
        rec("Step 7c: POST /ai/assign", ok, f"assignee='{assignee}'")

    # /cards
    r = requests.get(f"{BASE}/cards", headers=HEADERS, timeout=15)
    if r.status_code != 200:
        rec("Step 7d: GET /cards", False, f"HTTP {r.status_code}")
    else:
        cards = r.json()
        rec("Step 7d: GET /cards", isinstance(cards, list), f"count={len(cards) if isinstance(cards, list) else 'n/a'}")


def test_cleanup_village_monthly():
    # Reset to the default free tier so the next run's "initial" state matches
    # the village default and this script stays idempotent.
    r = requests.post(
        f"{BASE}/subscription/change",
        headers=HEADERS,
        json={"plan": "village", "billing_cycle": "monthly"},
        timeout=30,
    )
    ok = r.status_code == 200
    if not ok:
        rec("Step 8: Cleanup -> village monthly", False, f"HTTP {r.status_code} body={r.text[:200]}")
        return
    d = r.json()
    ok2 = d.get("plan") == "village" and d.get("billing_cycle") == "monthly"
    rec("Step 8: Cleanup -> village monthly", ok2, f"final plan={d.get('plan')} billing={d.get('billing_cycle')}")


def main():
    print(f"BASE={BASE}\nToken={TOKEN[:20]}...\n")
    test_get_subscription_initial()
    test_change_to_village()
    test_brief_blocked_village()
    test_family_invite_blocked_village()
    test_change_to_executive_yearly()
    test_brief_unblocked_executive()
    test_regression()
    test_cleanup_village_monthly()

    print("\n===== SUMMARY =====")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    for name, ok, detail in results:
        print(f"  {'OK ' if ok else 'ERR'} {name}")
    print(f"\n{passed}/{total} passed")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
