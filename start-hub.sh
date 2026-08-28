#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node > /dev/null 2>&1; then
  echo ""
  echo "  Node is niet geinstalleerd. Haal het op bij https://nodejs.org (LTS)."
  echo ""
  exit 1
fi
exec node hub/server.mjs
