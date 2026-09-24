"""Serve the exported web build the way GitHub Pages does.

The harnesses fetch http://127.0.0.1:<port>/Ahenora/app/<screen>, which
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
PREFIX = "/Ahenora/"  # legacy project-page prefix, still stripped for old links


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DOCS, **k)

    def translate_path(self, path):
        # Strip the project-page prefix: on Pages the repo name is part of
        # every URL, and the export is built expecting exactly that.
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith(PREFIX):
            path = "/" + clean[len(PREFIX):]
        # Custom-domain shape: ahenora.com serves docs/ at the root, so the
        # app lives at /app directly — no repo-name prefix to strip.
        resolved = super().translate_path(path)
        # Clean URLs: /feed is a file called feed.html.
        if (not os.path.exists(resolved) and not resolved.endswith("/")
                and os.path.exists(resolved + ".html")):
            return resolved + ".html"
        return resolved

    def send_error(self, code, message=None, explain=None):
        # An address with no file gets docs/404.html, with a 404 status — which
        # is what GitHub Pages does. Python's stock error page stood in for it,
        # so nothing run here could see what the real site does with an
        # unknown address. That is how share links (/app/pot/<code>) could send
        # every guest to a sign-in screen with every harness still green.
        page = os.path.join(DOCS, "404.html")
        if code == 404 and self.command in ("GET", "HEAD") and os.path.exists(page):
            with open(page, "rb") as fh:
                body = fh.read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command == "GET":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, *a):
        pass  # a harness run would otherwise bury its own output


if __name__ == "__main__":
    port = int(sys.argv[1])
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
