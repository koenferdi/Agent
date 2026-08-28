#!/bin/bash
# Dubbelklik dit om de hub ook op je telefoon te kunnen openen.
# Telefoon en computer moeten op hetzelfde wifi-netwerk zitten.
cd "$(dirname "$0")" || exit 1

if ! command -v node > /dev/null 2>&1; then
  echo ""
  echo "  Node is niet geinstalleerd."
  echo "  Haal het op bij https://nodejs.org (kies de LTS-versie)."
  echo ""
  echo "  Druk op Enter om te sluiten."
  read -r
  exit 1
fi

HOST=0.0.0.0 node hub/server.mjs

echo ""
echo "  Druk op Enter om dit venster te sluiten."
read -r
