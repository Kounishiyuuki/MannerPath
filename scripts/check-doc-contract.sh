#!/usr/bin/env bash
set -euo pipefail
required=(
  AGENTS.md
  docs/PRODUCT_REQUIREMENTS.md
  docs/TECH_STACK.md
  docs/ARCHITECTURE.md
  docs/DATA_POLICY.md
  docs/API.md
  docs/OPERATIONS.md
)
for f in "${required[@]}"; do
  test -s "$f" || { echo "missing required contract: $f" >&2; exit 1; }
done
echo "MannerPath contract files present."
python3 scripts/test-device-release-matrix.py
# Release preflight failure fixtures; nothing else runs them and the Build 3 checklist relies on --distribution.
python3 scripts/test-apple-beta-preflight.py
python3 scripts/test-store-copy.py
