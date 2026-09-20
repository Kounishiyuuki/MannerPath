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
