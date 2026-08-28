#!/usr/bin/env bash
# Zet de Validatiedesk op een Ubuntu-VPS. Draaien met: sudo bash deploy/setup-vps.sh
set -euo pipefail

RED=$'\e[31m'; YEL=$'\e[33m'; GRN=$'\e[32m'; DIM=$'\e[2m'; OFF=$'\e[0m'
say(){ printf '%s\n' "$*"; }
step(){ printf '\n%s==> %s%s\n' "$GRN" "$*" "$OFF"; }
warn(){ printf '%s!  %s%s\n' "$YEL" "$*" "$OFF"; }
die(){ printf '%s%s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Draai dit met sudo: sudo bash deploy/setup-vps.sh"
command -v apt-get >/dev/null || die "Dit script is voor Ubuntu/Debian."

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-root}"
PORT="${PORT:-4317}"

say ""
say "  Validatiedesk installeren op deze server"
say "  ${DIM}map:      $DIR${OFF}"
say "  ${DIM}gebruiker: $RUN_USER${OFF}"
say ""

# ---------------------------------------------------------------- keuze
say "  Hoe wil je de hub bereikbaar maken?"
say ""
say "    1) Met een domeinnaam  ${GRN}(aanbevolen)${OFF}"
say "       Caddy regelt automatisch HTTPS. Alleen poort 80 en 443 open."
say "       Je hebt een domein nodig dat naar dit IP-adres wijst."
say ""
say "    2) Alleen het IP-adres, zonder HTTPS"
say "       Poort $PORT gaat open. Je wachtwoord gaat onversleuteld over"
say "       het internet. Alleen doen als je even niets anders hebt."
say ""
read -rp "  Keuze [1/2]: " CHOICE
CHOICE="${CHOICE:-1}"

DOMAIN=""
if [[ "$CHOICE" == "1" ]]; then
  read -rp "  Domeinnaam (bv. hub.jouwdomein.nl): " DOMAIN
  [[ -n "$DOMAIN" ]] || die "Zonder domeinnaam kan optie 1 niet."
elif [[ "$CHOICE" != "2" ]]; then
  die "Onbekende keuze."
else
  warn "Zonder HTTPS reist je wachtwoord leesbaar over het internet."
  read -rp "  Toch doorgaan? [j/N]: " OK
  [[ "$OK" =~ ^[jJyY]$ ]] || die "Afgebroken."
fi

# ---------------------------------------------------------------- wachtwoord
if [[ -n "${HUB_PASSWORD:-}" ]]; then
  PASSWORD="$HUB_PASSWORD"
  say "  Wachtwoord overgenomen uit HUB_PASSWORD."
else
  PASSWORD="$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 14)"
fi

# ---------------------------------------------------------------- node
step "Node installeren"
if command -v node >/dev/null && [[ "$(node -v | tr -d 'v' | cut -d. -f1)" -ge 18 ]]; then
  say "  Node $(node -v) staat er al."
else
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  say "  Node $(node -v) geinstalleerd."
fi

# ---------------------------------------------------------------- service
step "Service aanmaken"
BIND="127.0.0.1"
[[ "$CHOICE" == "2" ]] && BIND="0.0.0.0"

sed -e "s|__USER__|$RUN_USER|g" \
    -e "s|__DIR__|$DIR|g" \
    -e "s|__HOST__|$BIND|g" \
    -e "s|__PORT__|$PORT|g" \
    -e "s|__PASSWORD__|$PASSWORD|g" \
    "$DIR/deploy/hub.service" > /etc/systemd/system/validatiedesk.service
chmod 600 /etc/systemd/system/validatiedesk.service   # wachtwoord staat erin

systemctl daemon-reload
systemctl enable --now validatiedesk >/dev/null 2>&1 || systemctl enable --now validatiedesk
sleep 2
systemctl is-active --quiet validatiedesk \
  || die "De service start niet. Kijk met: journalctl -u validatiedesk -n 40"
say "  Service draait."

# ---------------------------------------------------------------- caddy
if [[ "$CHOICE" == "1" ]]; then
  step "Caddy installeren voor HTTPS"
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" \
      "$DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  say "  Caddy draait. Het certificaat komt binnen een minuut binnen."
fi

# ---------------------------------------------------------------- firewall
step "Firewall instellen"
if ! command -v ufw >/dev/null; then apt-get install -y -qq ufw >/dev/null; fi
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
if [[ "$CHOICE" == "1" ]]; then
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw delete allow "$PORT"/tcp >/dev/null 2>&1 || true
  say "  Open: 22 (ssh), 80 en 443. Poort $PORT blijft dicht."
else
  ufw allow "$PORT"/tcp >/dev/null
  say "  Open: 22 (ssh) en $PORT."
fi
ufw --force enable >/dev/null
say "  Firewall aan."

# ---------------------------------------------------------------- klaar
IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
URL=$([[ "$CHOICE" == "1" ]] && echo "https://$DOMAIN" || echo "http://$IP:$PORT")

say ""
say "  ${GRN}Klaar.${OFF}"
say ""
say "  Openen op je telefoon:  $URL"
say "  Wachtwoord:             $PASSWORD"
say ""
say "  ${DIM}Bewaar dat wachtwoord. Kwijt? Dan staat het in:${OFF}"
say "  ${DIM}  sudo grep HUB_PASSWORD /etc/systemd/system/validatiedesk.service${OFF}"
say ""
say "  Handige commando's:"
say "    sudo systemctl status validatiedesk     ${DIM}# draait hij?${OFF}"
say "    sudo systemctl restart validatiedesk    ${DIM}# herstarten${OFF}"
say "    sudo journalctl -u validatiedesk -f     ${DIM}# meekijken${OFF}"
say ""
if [[ "$CHOICE" == "2" ]]; then
  warn "Zonder HTTPS is je verbinding niet versleuteld. Regel een domein"
  warn "en draai dit script opnieuw met optie 1 zodra je er een hebt."
  say ""
fi
