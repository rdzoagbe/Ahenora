"""Which Gemini model to call, and how to recover when one is retired.

The model name was hardcoded to gemini-1.5-flash, which Google has retired for
newer Cloud projects — including ours. Every AI call in production then fails
with NOT_FOUND at the API, and because each feature degrades gracefully, the
failures were invisible: scans fell back to a stub card, meal planning fell
back to the offline week, and nothing ever said why.

Model names must never be hardcoded again. The order of preference is:

1. whichever model already worked this process (proven beats preferred),
2. the GEMINI_MODEL environment variable, if set,
3. a built-in list, newest first.

A NOT_FOUND-style error moves on to the next candidate; any other error is a
real failure and is raised, because retrying a quota error against three
models would triple the pain for no benefit.

Stdlib-only, so the selection logic is covered by Backend CI rather than
verified by hand.
"""

from __future__ import annotations

# Newest first. When Google retires the front of this list, the fallback keeps
# the app alive on the next one while we update the default.
DEFAULT_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]


def model_candidates(env_value: str = "", remembered: str = "") -> list:
    """The models to try, in order, without duplicates.

    `remembered` is whatever answered successfully earlier in this process —
    it goes first because proven beats preferred. `env_value` is the operator's
    override and goes next. The defaults close the list.
    """
    ordered = []
    for name in [remembered, env_value, *DEFAULT_CANDIDATES]:
        name = (name or "").strip()
        if name and name not in ordered:
            ordered.append(name)
    return ordered


def is_model_not_found(error_text: str) -> bool:
    """True when an error means "this model does not exist for you" — the only
    condition under which trying the next candidate can help."""
    s = (error_text or "").lower()
    return (
        "not_found" in s
        or "not found" in s
        or "404" in s
        or "does not exist" in s
        or ("is not supported" in s and "model" in s)
        or "has been deprecated" in s
    )
