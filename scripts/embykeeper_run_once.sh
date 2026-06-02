#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${CHECKIN_PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
CONFIG_FILE="${PROJECT_ROOT}/data/embykeeper/config.toml"
BASE_DIR="${PROJECT_ROOT}/data/embykeeper/runtime"
EMBYKEEPER_BIN="${PROJECT_ROOT}/.venv-embykeeper/bin/embykeeper"

mkdir -p "${BASE_DIR}"

if [[ ! -x "${EMBYKEEPER_BIN}" ]]; then
  echo "emby-keeper is not installed at ${EMBYKEEPER_BIN}" >&2
  exit 1
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "emby-keeper config file not found: ${CONFIG_FILE}" >&2
  exit 1
fi

exec "${EMBYKEEPER_BIN}" "${CONFIG_FILE}" -c -i -o -B "${BASE_DIR}" "$@"
