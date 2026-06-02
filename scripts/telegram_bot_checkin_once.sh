#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${CHECKIN_PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
PYTHON_BIN="${PROJECT_ROOT}/.venv-embykeeper/bin/python"
SCRIPT_PATH="${PROJECT_ROOT}/scripts/telegram_bot_checkin.py"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python interpreter not found: ${PYTHON_BIN}" >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_PATH}" ]]; then
  echo "script not found: ${SCRIPT_PATH}" >&2
  exit 1
fi

exec "${PYTHON_BIN}" "${SCRIPT_PATH}" "$@"
