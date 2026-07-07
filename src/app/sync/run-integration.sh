#!/usr/bin/env bash
# J10 sync integration-test runner.
# Boots a throwaway PocketBase (J7's binary/migrations/hooks, same bootstrap as
# server/test.sh), runs the vitest integration suite with PB_TEST_URL set,
# tears everything down. Without PB_TEST_URL the suite self-skips, so this
# script is the ONLY intended way to run it.
#
# Requirements: bash, curl, unzip, node >= 20 + pnpm on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVER_DIR="${ROOT}/server"

PB_VERSION="0.39.5"
PORT="${PORT:-8098}"
PB_URL="http://127.0.0.1:${PORT}"

cd "${SERVER_DIR}"

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

for _ in $(seq 1 50); do
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

cd "${ROOT}"
STATUS=0
PB_TEST_URL="${PB_URL}" pnpm vitest run src/app/sync/__integration__/sync.integration.test.ts || STATUS=$?

if [[ ${STATUS} -ne 0 ]]; then
  echo "--- PocketBase log ---" >&2
  cat "${LOG_FILE}" >&2
fi
exit ${STATUS}
