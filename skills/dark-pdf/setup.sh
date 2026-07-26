#!/usr/bin/env bash
# Create the skill's isolated venv and install deps. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"

PY="${DARKPDF_PYTHON:-}"
if [[ -z "$PY" ]]; then
  # PyMuPDF ships wheels for 3.12/3.13, not always 3.14 -- prefer a supported one.
  for cand in python3.12 python3.13 python3.11 python3; do
    if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
  done
fi
[[ -n "$PY" ]] || { echo "no python found" >&2; exit 1; }

if [[ ! -x .venv/bin/python ]]; then
  echo "creating venv with $PY ..." >&2
  "$PY" -m venv .venv
fi
./.venv/bin/python -m pip install --quiet --upgrade pip
./.venv/bin/python -m pip install --quiet -r requirements.txt
echo "ok: $(./.venv/bin/python -c 'import fitz,numpy;print("PyMuPDF",fitz.pymupdf_version,"numpy",numpy.__version__)')" >&2
