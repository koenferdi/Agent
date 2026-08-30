#!/usr/bin/env bash
# Toon of wijzig het wachtwoord van de Validatiedesk.
#   sudo bash deploy/wachtwoord.sh            -> toont het huidige wachtwoord
#   sudo bash deploy/wachtwoord.sh nieuwwoord -> stelt een nieuw wachtwoord in
set -euo pipefail

UNIT=/etc/systemd/system/validatiedesk.service
GRN=$'\e[32m'; YEL=$'\e[33m'; DIM=$'\e[2m'; OFF=$'\e[0m'

[[ $EUID -eq 0 ]] || { echo "Draai dit met sudo."; exit 1; }
[[ -f "$UNIT" ]] || { echo "Service niet gevonden. Draai eerst deploy/setup-vps.sh"; exit 1; }

CURRENT=$(grep '^Environment=HUB_PASSWORD=' "$UNIT" | sed 's/^Environment=HUB_PASSWORD=//')

if [[ $# -eq 0 ]]; then
  echo ""
  echo "  Huidig wachtwoord: ${GRN}${CURRENT}${OFF}"
  echo ""
  echo "  ${DIM}Wijzigen: sudo bash deploy/wachtwoord.sh 'jouw-nieuwe-wachtwoord'${OFF}"
  echo ""
  exit 0
fi

NEW="$1"
if [[ ${#NEW} -lt 8 ]]; then
  echo "${YEL}Kies er een van minstens 8 tekens.${OFF}"; exit 1
fi
if [[ "$NEW" == *"|"* ]]; then
  echo "${YEL}Geen | in het wachtwoord gebruiken.${OFF}"; exit 1
fi

# Regel vervangen zonder de rest van de unit aan te raken
python3 - "$UNIT" "$NEW" <<'PY'
import sys
unit, new = sys.argv[1], sys.argv[2]
lines = open(unit).read().splitlines(True)
out = []
for l in lines:
    if l.startswith("Environment=HUB_PASSWORD="):
        out.append("Environment=HUB_PASSWORD=" + new + "\n")
    else:
        out.append(l)
open(unit, "w").write("".join(out))
PY

chmod 600 "$UNIT"
systemctl daemon-reload
systemctl restart validatiedesk
sleep 1

if systemctl is-active --quiet validatiedesk; then
  echo ""
  echo "  ${GRN}Wachtwoord gewijzigd.${OFF} Je moet opnieuw inloggen op al je apparaten."
  echo ""
else
  echo "  De service startte niet opnieuw. Kijk met: journalctl -u validatiedesk -n 20"
  exit 1
fi
