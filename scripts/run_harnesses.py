"""Run every browser harness against a freshly exported build.

Nine harnesses now exist, and until this script they only protected the app
when somebody remembered to run them by hand. That is not protection, it is
a habit — and habits are exactly what a verification suite is supposed to
replace. This is what CI invokes.

Each harness gets its own fresh backend so a failure in one cannot poison the
next, and so the order they run in never changes the result.

Usage:  python3 scripts/run_harnesses.py [--only nav,kid] [--web-port N]
"""
import argparse
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# Ordered cheapest-first: a broken export or a dead route shows up in seconds
# rather than after the slowest harness has finished.
HARNESSES = [
    "e2e_pages.py",
    "e2e_nav.py",
    "e2e_activity.py",
    "e2e_search.py",
    "e2e_handoff.py",
    "e2e_kid.py",
    "e2e_contrast.py",
    "e2e_offline.py",
    "e2e_journey.py",
]


def wait_for(url: str, timeout: float = 60.0, need_ok: bool = False) -> bool:
    """Wait for a URL to answer.

    need_ok matters more than it looks. A missing web export still answers —
    with 404 — so treating "answered at all" as ready let the run continue and
    fail nine harnesses with nine confusing messages instead of one clear one.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as res:
                return res.status < 400
        except urllib.error.HTTPError as e:
            if not need_ok:
                return True      # a backend answering 4xx is up
            if e.code == 404:    # the file genuinely is not there
                return False
            return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated harness names")
    ap.add_argument("--web-port", type=int, default=8800)
    ap.add_argument("--api-port", type=int, default=8801)
    args = ap.parse_args()

    wanted = HARNESSES
    if args.only:
        names = {n.strip().replace("e2e_", "").replace(".py", "")
                 for n in args.only.split(",") if n.strip()}
        wanted = [h for h in HARNESSES
                  if h.replace("e2e_", "").replace(".py", "") in names]
        if not wanted:
            print(f"no harness matches {args.only!r}; known: "
                  f"{[h.replace('e2e_', '').replace('.py', '') for h in HARNESSES]}")
            return 2

    web = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "serve_web.py"), str(args.web_port), ROOT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_for(f"http://127.0.0.1:{args.web_port}/Household-COO/app/feed",
                    timeout=20, need_ok=True):
        print("No web build at docs/app. Run, from frontend/:\n"
              "  npx expo export --platform web --output-dir ../docs/app --clear")
        web.kill()
        return 1

    results, api_port = {}, args.api_port
    try:
        for harness in wanted:
            # A fresh backend per harness: shared state between them would
            # make a failure depend on what ran before it, which is the
            # least debuggable kind of failure there is.
            api_port += 1
            api = subprocess.Popen(
                [sys.executable, os.path.join(HERE, "e2e_backend.py"), str(api_port)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            name = harness.replace("e2e_", "").replace(".py", "")
            if not wait_for(f"http://127.0.0.1:{api_port}/api/health"):
                print(f"--- {name}: backend never came up")
                results[name] = False
                api.kill()
                continue

            print(f"\n=== {name} " + "=" * (60 - len(name)))
            started = time.time()
            proc = subprocess.run(
                [sys.executable, os.path.join(HERE, harness),
                 str(args.web_port), str(api_port)],
                cwd=ROOT)
            results[name] = proc.returncode == 0
            print(f"--- {name}: {'PASS' if results[name] else 'FAIL'} "
                  f"({time.time() - started:.0f}s)")
            api.terminate()
            try:
                api.wait(timeout=10)
            except subprocess.TimeoutExpired:
                api.kill()
    finally:
        web.terminate()
        try:
            web.wait(timeout=10)
        except subprocess.TimeoutExpired:
            web.kill()

    print("\n" + "=" * 68)
    for name, ok in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    failed = [n for n, ok in results.items() if not ok]
    print("=" * 68)
    if failed:
        print(f"{len(failed)} of {len(results)} harnesses failed: {', '.join(failed)}")
        return 1
    print(f"all {len(results)} harnesses passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
