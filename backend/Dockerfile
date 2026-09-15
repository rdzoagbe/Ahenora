FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# The recovery tools, and ONLY those two files out of scripts/.
#
# They are here so the restore drill can be run where MONGO_URL already lives,
# with nothing to install and no production connection string pasted into a
# laptop shell. docs/runbooks/restore-drill.md told people to run it in a
# Railway shell for weeks while the image contained neither file — the drill
# had never been run, so nothing found out. tests/test_the_recovery_tools_ship.py
# now fails if they stop shipping.
#
# Not `COPY scripts/`: the rest of that directory is browser harnesses and test
# doubles, which have no business in a production image. Both files need only
# pymongo and motor, already installed above.
COPY scripts/mongo_backup.py scripts/restore_drill.py ./scripts/

RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

ENV PORT=8080
EXPOSE $PORT

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT}