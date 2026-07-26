#!/usr/bin/env bash
# Run the dark-pdf converter, auto-bootstrapping the venv on first use.
# Usage: ./run.sh <input.pdf> [output.pdf] [--dpi N] [--invert A] [--hue D] [--contrast K]
set -euo pipefail
cd "$(dirname "$0")"

[[ -x .venv/bin/python ]] || ./setup.sh
exec ./.venv/bin/python darkpdf.py "$@"
