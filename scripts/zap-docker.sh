#!/usr/bin/env bash
# Dev-only wrapper: runs zap.sh inside the official ZAP image so contributors
# do not need a local ZAP install. The zap engine (server/engines/zap/runZap.ts)
# sets SAKUDA_ZAP_HOST_WORKDIR to the scan's work dir on the host; this script
# mounts that dir at /zap/wrk inside the container, so set in .env:
#   SAKUDA_ZAP_CMD=./scripts/zap-docker.sh
#   SAKUDA_ZAP_WORKDIR=/zap/wrk
#   SAKUDA_ZAP_LOCALHOST_ALIAS=host.docker.internal
#
# Limitation: SIGKILL of this script's docker client does not stop the
# container; SIGTERM is proxied to it and runCommand sends SIGTERM first, so
# graceful shutdown works but a forced kill of the wrapper alone will not.
set -euo pipefail

: "${SAKUDA_ZAP_HOST_WORKDIR:?set by the sakuda zap engine}"

exec docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  --shm-size="${SAKUDA_ZAP_SHM_SIZE:-1g}" \
  -e "JAVA_TOOL_OPTIONS=${JAVA_TOOL_OPTIONS:-}" \
  -v "${SAKUDA_ZAP_HOST_WORKDIR}:/zap/wrk:rw" \
  "${SAKUDA_ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.17.0}" zap.sh "$@"
