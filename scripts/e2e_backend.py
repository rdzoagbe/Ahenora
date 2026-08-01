"""Run the REAL backend/server.py on localhost with the in-memory database.

Usage: python3 scripts/e2e_backend.py [port]

Every route handler executes its actual production code; only the storage
layer is swapped (scripts/fake_mongo.py). Used by e2e_journey.py.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

import server  # noqa: E402
from fake_mongo import FakeDatabase  # noqa: E402

server.db = FakeDatabase()

if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8990
    uvicorn.run(server.app, host="127.0.0.1", port=port, log_level="warning")
