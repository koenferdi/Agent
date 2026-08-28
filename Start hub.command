#!/bin/bash
# Dubbelklik dit bestand om de Validatiedesk te starten.
cd "$(dirname "$0")" || exit 1

if ! command -v node > /dev/null 2>&1; then
  echo ""
  echo "  Node is niet geinstalleerd."
  echo ""
  echo "  Haal het op bij https://nodejs.org (kies de LTS-versie),"
  echo "  installeer het, en dubbelklik dit bestand daarna opnieuw."
  echo ""
  echo "  Druk op Enter om te sluiten."
  read -r
  exit 1
fi

node hub/server.mjs

echo ""
echo "  Druk op Enter om dit venster te sluiten."
read -r
