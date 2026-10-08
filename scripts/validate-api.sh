#!/usr/bin/env bash
# Backend validation. See docs/AGENT_WORKFLOWS.md.
set -euo pipefail
cd "$(dirname "$0")/../services/api"
# The suite exercises promotion v4 streaming export, which needs node:sqlite cursors (Node >=24).
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { echo "api-validate requires Node >=24 (found $(node --version))" >&2; exit 1; }
npm run typecheck
npm test
