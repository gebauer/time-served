#!/usr/bin/env bash
# Time Served backend test runner.
# Starts a throwaway PocketBase (temp data dir), applies pb_migrations,
# loads pb_hooks and runs the e2e suite in tests/e2e.mjs against it.
#
# Requirements: bash, curl, unzip, node >= 20 on PATH.
set -euo pipefail
cd "$(dirname "$0")"

PB_VERSION="0.39.5"
PORT="${PORT:-8097}"
PB_URL="http://127.0.0.1:${PORT}"

# Download the PocketBase binary if it is not here yet (gitignored).
if [[ ! -x ./pocketbase ]]; then
  echo "Downloading PocketBase v${PB_VERSION}..."
  curl -fsSL -o pb.zip \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
  unzip -o pb.zip pocketbase >/dev/null
  rm pb.zip
fi

DATA_DIR="$(mktemp -d)"
LOG_FILE="${DATA_DIR}/pb.log"

cleanup() {
  [[ -n "${PB_PID:-}" ]] && kill "${PB_PID}" 2>/dev/null || true
  wait "${PB_PID:-}" 2>/dev/null || true
  rm -rf "${DATA_DIR}"
}
trap cleanup EXIT

./pocketbase serve \
  --dir "${DATA_DIR}" \
  --hooksDir ./pb_hooks \
  --migrationsDir ./pb_migrations \
  --http "127.0.0.1:${PORT}" >"${LOG_FILE}" 2>&1 &
PB_PID=$!

# wait for health
for i in $(seq 1 50); do
  if curl -fsS "${PB_URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${PB_PID}" 2>/dev/null; then
    echo "PocketBase failed to start:" >&2
    cat "${LOG_FILE}" >&2
    exit 1
  fi
  sleep 0.2
done

if ! curl -fsS "${PB_URL}/api/health" >/dev/null 2>&1; then
  echo "PocketBase did not become healthy:" >&2
  cat "${LOG_FILE}" >&2
  exit 1
fi

PB_URL="${PB_URL}" node tests/e2e.mjs
STATUS=$?

if [[ ${STATUS} -ne 0 ]]; then
  echo "--- PocketBase log ---" >&2
  cat "${LOG_FILE}" >&2
fi
exit ${STATUS}
