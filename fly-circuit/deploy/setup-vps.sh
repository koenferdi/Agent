#!/usr/bin/env bash
# Zet Fly Circuit Lab op een Ubuntu/Debian-VPS.
# Draaien met: sudo bash deploy/setup-vps.sh
set -euo pipefail

RED=$'\e[31m'; YEL=$'\e[33m'; GRN=$'\e[32m'; DIM=$'\e[2m'; OFF=$'\e[0m'
say(){ printf '%s\n' "$*"; }
step(){ printf '\n%s==> %s%s\n' "$GRN" "$*" "$OFF"; }
warn(){ printf '%s!  %s%s\n' "$YEL" "$*" "$OFF"; }
die(){ printf '%s%s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }

# Zonder dit vangnet stopt het script bij een fout zonder iets te zeggen.
on_error(){ printf '%s\n' "${RED}Afgebroken op regel $2 (exitcode $1).${OFF}" >&2; }
trap 'on_error $? $LINENO' ERR

[[ $EUID -eq 0 ]] || die "Draai dit met sudo: sudo bash deploy/setup-vps.sh"
command -v apt-get >/dev/null || die "Dit script is voor Ubuntu/Debian."

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-root}"
PORT="${FLY_PORT:-8000}"
SERVICE="flylab"
ENVFILE="/etc/${SERVICE}.env"

[[ -f "$DIR/app.py" ]] || die "app.py niet gevonden in $DIR. Sta je in de goede map?"

say ""
say "  Fly Circuit Lab installeren op deze server"
say "  ${DIM}map:       $DIR${OFF}"
say "  ${DIM}gebruiker: $RUN_USER${OFF}"
say "  ${DIM}poort:     $PORT (alleen op 127.0.0.1)${OFF}"
say ""

# ---------------------------------------------------------------- keuze
say "  Hoe wil je erbij kunnen?"
say ""
say "    1) Met een domeinnaam  ${GRN}(aanbevolen)${OFF}"
say "       Caddy regelt automatisch HTTPS. Alleen poort 80 en 443 open."
say "       Je hebt een (sub)domein nodig dat naar dit IP-adres wijst."
say ""
say "    2) Zonder domein, via een SSH-tunnel"
say "       Er gaat geen enkele poort open. Je zet vanaf je telefoon of"
say "       laptop een tunnel op naar 127.0.0.1:$PORT en opent hem daar."
say ""
read -rp "  Keuze [1/2]: " CHOICE
CHOICE="${CHOICE:-1}"

DOMAIN=""
if [[ "$CHOICE" == "1" ]]; then
  read -rp "  Domeinnaam (bv. vlieg.jouwdomein.nl): " DOMAIN
  [[ -n "$DOMAIN" ]] || die "Zonder domeinnaam kan optie 1 niet."
  [[ "$DOMAIN" =~ ^[a-zA-Z0-9.-]+$ ]] || die "Dat ziet er niet uit als een domeinnaam."
elif [[ "$CHOICE" != "2" ]]; then
  die "Onbekende keuze."
fi

# ---------------------------------------------------------------- wachtwoord
# De app eist minimaal 20 tekens. Zes groepjes van vier geeft er 29.
if [[ -n "${FLY_PASSWORD:-}" ]]; then
  PASSWORD="$FLY_PASSWORD"
  [[ ${#PASSWORD} -ge 20 ]] || die "FLY_PASSWORD moet minstens 20 tekens hebben."
  say "  Wachtwoord overgenomen uit FLY_PASSWORD."
else
  # Geen "tr | head": head sluit de pijp, tr krijgt SIGPIPE en met
  # pipefail breekt het hele script daarop af. od leest een vast aantal
  # bytes en stopt uit zichzelf, dus daar kan niets dichtklappen.
  chars='abcdefghjkmnpqrstuvwxyz23456789'
  raw=''
  for byte in $(od -An -tu1 -N 24 /dev/urandom); do
    raw+="${chars:$((byte % ${#chars})):1}"
  done
  [[ ${#raw} -eq 24 ]] || die "Kon geen wachtwoord genereren."
  PASSWORD="${raw:0:4}-${raw:4:4}-${raw:8:4}-${raw:12:4}-${raw:16:4}-${raw:20:4}"
fi

# ---------------------------------------------------------------- python
step "Python en de omgeving klaarzetten"
if ! command -v python3 >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq python3 >/dev/null
fi
PYVER="$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
python3 -c 'import sys;sys.exit(0 if sys.version_info>=(3,10) else 1)' \
  || die "Python $PYVER is te oud. De app vraagt 3.10 of hoger."
apt-get install -y -qq python3-venv python3-pip curl >/dev/null
say "  Python $PYVER staat klaar."

# De venv is eigendom van de gebruiker die de service straks draait.
if [[ ! -x "$DIR/.venv/bin/python" ]]; then
  sudo -u "$RUN_USER" python3 -m venv "$DIR/.venv"
fi
sudo -u "$RUN_USER" "$DIR/.venv/bin/python" -m pip install -q --upgrade pip
sudo -u "$RUN_USER" "$DIR/.venv/bin/python" -m pip install -q -r "$DIR/requirements.txt"
say "  Flask, NumPy en Waitress geinstalleerd."

# ---------------------------------------------------------------- env-bestand
step "Wachtwoord wegzetten"
umask 077
{
  echo "FLY_PASSWORD=$PASSWORD"
  # Alleen achter een domein; bij een SSH-tunnel moet deze juist leeg blijven.
  if [[ "$CHOICE" == "1" ]]; then echo "FLY_PUBLIC_ORIGIN=https://$DOMAIN"; fi
} > "$ENVFILE"
chown root:root "$ENVFILE"
chmod 600 "$ENVFILE"
umask 022
say "  Staat in $ENVFILE, alleen leesbaar voor root."

# ---------------------------------------------------------------- service
step "Service aanmaken"
sed -e "s|__USER__|$RUN_USER|g" \
    -e "s|__DIR__|$DIR|g" \
    -e "s|__ENVFILE__|$ENVFILE|g" \
    -e "s|__PORT__|$PORT|g" \
    "$DIR/deploy/flylab.service" > "/etc/systemd/system/${SERVICE}.service"

systemctl daemon-reload
systemctl enable --now "$SERVICE" >/dev/null 2>&1 || systemctl enable --now "$SERVICE"
sleep 3
if ! systemctl is-active --quiet "$SERVICE"; then
  warn "De service start niet. De laatste regels:"
  journalctl -u "$SERVICE" -n 20 --no-pager | sed 's/^/    /'
  die "Afgebroken."
fi
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

  # Draait de hub al achter Caddy, dan mag die configuratie niet verdwijnen.
  BLOCK="$(sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" "$DIR/deploy/Caddyfile")"
  if [[ -s /etc/caddy/Caddyfile ]] && ! grep -q "^${DOMAIN} " /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup-$(date +%Y%m%d%H%M%S)"
    printf '\n%s\n' "$BLOCK" >> /etc/caddy/Caddyfile
    say "  Blok toegevoegd aan de bestaande Caddyfile (back-up gemaakt)."
  elif grep -q "^${DOMAIN} " /etc/caddy/Caddyfile 2>/dev/null; then
    warn "Er staat al een blok voor $DOMAIN in /etc/caddy/Caddyfile."
    warn "Controleer zelf of daar 'flush_interval -1' in staat, anders"
    warn "blijft de live-stream hangen."
  else
    printf '%s\n' "$BLOCK" > /etc/caddy/Caddyfile
    say "  Caddyfile geschreven."
  fi

  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || die "De Caddyfile klopt niet. Controleer /etc/caddy/Caddyfile."
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
fi
# Poort 8000 gaat nooit open: de app luistert sowieso alleen op loopback.
ufw delete allow "$PORT"/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null
say "  Poort $PORT blijft dicht. De app luistert alleen op 127.0.0.1."

# ---------------------------------------------------------------- controle
step "Controleren of hij antwoordt"
sleep 2
# Met een domein staat FLY_PUBLIC_ORIGIN aan en accepteert de app alleen
# die hostnaam. Caddy stuurt hem mee; deze controle moet dat nadoen.
HOSTHDR=()
if [[ "$CHOICE" == "1" ]]; then HOSTHDR=(-H "Host: $DOMAIN"); fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${HOSTHDR[@]}" \
        -u "fly:$PASSWORD" "http://127.0.0.1:$PORT/api/metrics" || echo 000)"
case "$CODE" in
  200) say "  De simulatie draait en levert data." ;;
  503) say "  De simulatie is net gestart en warmt op. Dat is goed." ;;
  401) warn "Onverwacht: 401. Het wachtwoord komt niet door." ;;
  400) warn "Onverwacht: 400. Controleer FLY_PUBLIC_ORIGIN in $ENVFILE." ;;
  *)   warn "Onverwacht antwoord ($CODE). Kijk met: journalctl -u $SERVICE -n 30" ;;
esac

# ---------------------------------------------------------------- klaar
say ""
say "  ${GRN}Klaar.${OFF}"
say ""
if [[ "$CHOICE" == "1" ]]; then
  say "  Openen:      https://$DOMAIN"
else
  say "  Zet eerst een tunnel op vanaf je eigen machine:"
  say "    ${DIM}ssh -N -L ${PORT}:127.0.0.1:${PORT} ${RUN_USER}@<ip-van-deze-server>${OFF}"
  say "  Openen:      http://127.0.0.1:$PORT"
fi
say "  Gebruiker:   fly"
say "  Wachtwoord:  $PASSWORD"
say ""
say "  ${DIM}Kwijt? Dan staat het in:${OFF}"
say "  ${DIM}  sudo grep FLY_PASSWORD $ENVFILE${OFF}"
say ""
say "  Handige commando's:"
say "    sudo systemctl status $SERVICE     ${DIM}# draait hij?${OFF}"
say "    sudo systemctl restart $SERVICE    ${DIM}# herstarten${OFF}"
say "    sudo journalctl -u $SERVICE -f     ${DIM}# meekijken${OFF}"
say ""
warn "Iedereen die dit wachtwoord heeft, deelt dezelfde simulatie:"
warn "schuiven aan de knoppen en resetten werkt voor alle kijkers."
say ""
