"""Find a Chromium the harnesses can drive, wherever they are running.

Every harness used to hardcode /opt/pw-browsers/chromium — the path in one
particular development sandbox. That worked for months and then failed all
nine at once the moment they ran in CI, where Playwright installs its browser
somewhere else entirely. A path baked into nine files is nine copies of an
assumption about the machine.

Resolution order, most specific first:
  1. PW_CHROMIUM        — an explicit override, for an unusual machine
  2. PLAYWRIGHT_BROWSERS_PATH/chromium — the pre-installed sandbox layout
  3. Playwright's own   — a normal `playwright install`, which is CI
"""
import os

from playwright.async_api import Browser, Playwright


def _explicit_path():
    override = os.environ.get("PW_CHROMIUM", "").strip()
    if override and os.path.exists(override):
        return override
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    if root:
        candidate = os.path.join(root, "chromium")
        if os.path.exists(candidate):
            return candidate
    return None


async def launch_chromium(pw: Playwright, **kwargs) -> Browser:
    """Launch Chromium, letting Playwright locate it unless we know better."""
    path = _explicit_path()
    if path:
        return await pw.chromium.launch(executable_path=path, **kwargs)
    return await pw.chromium.launch(**kwargs)
