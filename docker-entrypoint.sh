#!/bin/sh
# Wait for the backend to become healthy, then start the Next.js server.
# podman-compose 1.6 does not enforce `depends_on: condition: service_healthy`,
# so the frontend retries the health endpoint itself before serving.
set -e

BACKEND_URL="${BACKEND_HEALTH_URL:-http://backend:8000/api/health}"
RETRIES="${BACKEND_HEALTH_RETRIES:-60}"
DELAY="${BACKEND_HEALTH_DELAY:-2}"

i=0
until [ "$i" -ge "$RETRIES" ]; do
	if wget -q -O /dev/null "$BACKEND_URL" 2>/dev/null ||
		curl -fsS -o /dev/null "$BACKEND_URL" 2>/dev/null; then
		echo "[entrypoint] backend healthy at $BACKEND_URL"
		exec node server.js
	fi
	i=$((i + 1))
	echo "[entrypoint] waiting for backend ($i/$RETRIES)..."
	sleep "$DELAY"
done

echo "[entrypoint] backend not reachable after ${RETRIES} attempts; starting anyway" >&2
exec node server.js
