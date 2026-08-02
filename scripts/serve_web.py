"""Serve the exported web build the way GitHub Pages does.

The harnesses fetch http://127.0.0.1:<port>/Household-COO/app/<screen>, which
is the real production shape: a project page served under a repo-name prefix,
with clean URLs (no .html). Python's stock http.server does neither, and the
difference is not cosmetic — expo-router resolves routes from the path, so a
server that 404s /feed or serves it from the wrong prefix tests nothing.

Usage:  python3 scripts/serve_web.py <port> [repo_root]
"""
import http.server
import os
import sys

ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2
                       else os.path.join(os.path.dirname(__file__), ".."))
DOCS = os.path.join(ROOT, "docs")
PREFIX = "/Household-COO/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DOCS, **k)

    def translate_path(self, path):
        # Strip the project-page prefix: on Pages the repo name is part of
        # every URL, and the export is built expecting exactly that.
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith(PREFIX):
            path = "/" + clean[len(PREFIX):]
        resolved = super().translate_path(path)
        # Clean URLs: /feed is a file called feed.html.
        if (not os.path.exists(resolved) and not resolved.endswith("/")
                and os.path.exists(resolved + ".html")):
            return resolved + ".html"
        return resolved

    def log_message(self, *a):
        pass  # a harness run would otherwise bury its own output


if __name__ == "__main__":
    port = int(sys.argv[1])
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
