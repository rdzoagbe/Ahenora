"""Run every browser harness against a freshly exported build.

Twelve harnesses now exist, and until this script they only protected the app
when somebody remembered to run them by hand. That is not protection, it is
a habit — and habits are exactly what a verification suite is supposed to
replace. This is what CI invokes.

Each harness gets its own fresh backend so a failure in one cannot poison the
next, and so the order they run in never changes the result.

Navigation waits on domcontentloaded, never networkidle. The app health-checks
every 30 seconds by design, so there is no such thing as an idle network here —
networkidle only ever worked by landing in the gaps between pings, and on a
loaded CI runner it eventually did not. Every harness follows its goto with an
explicit wait anyway; that is what gives the app time to render.

Export the web build with the matching backend URL before running this, or the
app will phone production from inside a test:

    cd frontend && EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8800 \\
      npx expo export --platform web --output-dir ../docs/app --clear

Usage:  python3 scripts/run_harnesses.py [--only nav,kid] [--web-port N]
"""
import argparse
import functools
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Unbuffered: subprocesses write straight to the shared descriptor, so a
# buffered print() here means every header lands at the end of the log,
# detached from the output it labels. That is precisely when logs are read.
print = functools.partial(print, flush=True)  # noqa: A001

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# Ordered cheapest-first: a broken export or a dead route shows up in seconds
# rather than after the slowest harness has finished.
HARNESSES = [
    # First, and cheap: a brand-new household with nothing in it. Every other
    # harness seeds content to exercise a feature, so day one — which is the
    # whole of a new family's first session — went unlooked-at for months.
    "e2e_firstrun.py",
    "e2e_pages.py",
    "e2e_nav.py",
    "e2e_quickadd.py",
    "e2e_activity.py",
    "e2e_search.py",
    "e2e_handoff.py",
    "e2e_kid.py",
    "e2e_week.py",
    "e2e_contrast.py",
    # Narrow phones: every other harness runs at 390 or wider, so the end of the
    # range where layouts actually break went unchecked.
    "e2e_smallscreen.py",
    "e2e_offline.py",
    "e2e_calendar.py",
    "e2e_webupdate.py",
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
    # Must match the port baked into the export's EXPO_PUBLIC_BACKEND_URL: the
    # bundle learns its backend at BUILD time, so a runner on a different port
    # would leave the app pointing somewhere that is not there.
    ap.add_argument("--web-port", type=int,
                    default=int(os.environ.get("HARNESS_WEB_PORT", "8800")))
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
    if not wait_for(f"http://127.0.0.1:{args.web_port}/app/feed",
                    timeout=20, need_ok=True):
        print("No web build at docs/app. Run, from frontend/:\n"
              "  npx expo export --platform web --output-dir ../docs/app --clear")
        web.kill()
        return 1

    results, detail, api_port = {}, {}, args.api_port
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
            # Captured as well as echoed: a failing harness's reasons are
            # hundreds of lines above the summary in a CI log, which meant
            # reading a failure took several round trips to find the one line
            # that mattered. Keep it and reprint it at the bottom.
            proc = subprocess.run(
                [sys.executable, os.path.join(HERE, harness),
                 str(args.web_port), str(api_port)],
                cwd=ROOT, capture_output=True, text=True)
            print(proc.stdout, end="")
            if proc.stderr:
                print(proc.stderr, end="")
            results[name] = proc.returncode == 0
            if not results[name]:
                detail[name] = (proc.stdout + proc.stderr).strip().splitlines()
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
        # Repeat the reasons here so the end of the log is enough to act on.
        for name in failed:
            lines = [ln for ln in detail.get(name, []) if "True" not in ln]
            print(f"\nwhy {name} failed:")
            for ln in lines[-25:]:
                print(f"    {ln}")
        print()
        print(f"{len(failed)} of {len(results)} harnesses failed: {', '.join(failed)}")
        return 1
    print(f"all {len(results)} harnesses passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
