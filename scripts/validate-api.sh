#!/usr/bin/env bash
# Backend validation. See docs/AGENT_WORKFLOWS.md.
set -euo pipefail
cd "$(dirname "$0")/../services/api"
npm run typecheck
npm test
