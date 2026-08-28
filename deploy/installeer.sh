#!/usr/bin/env bash
# Zet AI-dossier neer op een Ubuntu-server met nginx.
# Draaien vanuit de uitgepakte map:   sudo ./installeer.sh
set -euo pipefail

DOMEIN="jouwdomein.nl"
WEBROOT="/var/www/${DOMEIN}"
HIER="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Draai dit met sudo: sudo ./installeer.sh" >&2
  exit 1
fi
if ! command -v nginx >/dev/null; then
  echo "nginx is niet geïnstalleerd. Eerst:  sudo apt install nginx" >&2
  exit 1
fi

echo "1/4  Bestanden naar ${WEBROOT}"
mkdir -p "${WEBROOT}"
cp -r "${HIER}/site/." "${WEBROOT}/"
chown -R www-data:www-data "${WEBROOT}"
find "${WEBROOT}" -type d -exec chmod 755 {} +
find "${WEBROOT}" -type f -exec chmod 644 {} +

echo "2/4  Serverblok installeren"
cp "${HIER}/nginx/${DOMEIN}.conf" "/etc/nginx/sites-available/${DOMEIN}.conf"
ln -sfn "/etc/nginx/sites-available/${DOMEIN}.conf" "/etc/nginx/sites-enabled/${DOMEIN}.conf"

echo "3/4  Configuratie controleren"
nginx -t

echo "4/4  nginx herladen"
systemctl reload nginx

echo
echo "Klaar. De site staat op http://${DOMEIN}/"
echo
echo "Https erbij (eenmalig):"
echo "  sudo apt install certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d ${DOMEIN} -d www.${DOMEIN}"
