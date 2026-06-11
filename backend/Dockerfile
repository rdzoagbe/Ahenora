FROM python:3.11-slim

WORKDIR /app

<<<<<<< HEAD
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
=======
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
>>>>>>> origin/main

RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

ENV PORT=8080
EXPOSE $PORT

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT}
