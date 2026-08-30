#!/usr/bin/env bash
# Entrypoint for the sakuda image. Refuses to start without the encryption
# key (headers stored on disk are AES-encrypted with it — losing the key
# makes them permanently unreadable). With no arguments it hands off to the
# Nitro server; with arguments (e.g. `docker run sakuda nuclei -version`) it
# execs them instead, so the image doubles as a diagnostic shell for the
# tools it bundles.
set -euo pipefail

if [[ -z "${SAKUDA_ENCRYPTION_KEY:-}" ]]; then
  echo "SAKUDA_ENCRYPTION_KEY is required (base64 of 32 random bytes): docker run -e SAKUDA_ENCRYPTION_KEY=\$(openssl rand -base64 32) ..." >&2
  exit 1
fi

mkdir -p "${SAKUDA_DATA_DIR}/scans"

if [[ $# -gt 0 ]]; then
  exec "$@"
fi

exec node /app/.output/server/index.mjs
