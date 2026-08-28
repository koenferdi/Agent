#!/usr/bin/env bash
# Zet de site klaar om te uploaden naar je eigen server.
#
#   ./package.sh                → gebruikt de plaatshouder jouwdomein.nl
#   ./package.sh ai-dossier.nl  → vult je echte domein overal in
#
# Levert dist/ai-dossier/ plus een tar.gz met daarin:
#   site/       de map die je webroot wordt
#   nginx/      het serverblok met jouw domein er al in
#   installeer.sh  zet het op een Ubuntu-server neer
#   HOSTEN.md   de handleiding
set -euo pipefail
cd "$(dirname "$0")"

DOMEIN="${1:-jouwdomein.nl}"
DATUM="$(date +%F)"
UIT="dist/ai-dossier"

# sed -i werkt niet overal hetzelfde; dit wel
vervang() { sed "s|jouwdomein\.nl|${DOMEIN}|g" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }

rm -rf "$UIT"
mkdir -p "$UIT/site/assets" "$UIT/nginx"

cp index.html robots.txt sitemap.xml "$UIT/site/"
cp assets/styles.css assets/app.js "$UIT/site/assets/"
cp deploy/HOSTEN.md "$UIT/"

for f in "$UIT/site/index.html" "$UIT/site/robots.txt" "$UIT/site/sitemap.xml" "$UIT/HOSTEN.md"; do
  vervang "$f"
done
sed "s|<lastmod>.*</lastmod>|<lastmod>${DATUM}</lastmod>|" "$UIT/site/sitemap.xml" > "$UIT/site/sitemap.tmp"
mv "$UIT/site/sitemap.tmp" "$UIT/site/sitemap.xml"

cp deploy/nginx.conf "$UIT/nginx/${DOMEIN}.conf"
vervang "$UIT/nginx/${DOMEIN}.conf"

cp deploy/installeer.sh "$UIT/installeer.sh"
vervang "$UIT/installeer.sh"
chmod +x "$UIT/installeer.sh"

TAR="dist/ai-dossier-${DOMEIN}-${DATUM}.tar.gz"
rm -f "$TAR"
tar -czf "$TAR" -C dist ai-dossier

echo "Domein:  ${DOMEIN}"
echo "Map:     ${UIT}/"
echo "Pakket:  ${TAR}  ($(du -h "$TAR" | cut -f1))"
if [ "$DOMEIN" = "jouwdomein.nl" ]; then
  echo
  echo "Let op: je hebt geen domein meegegeven, dus overal staat nog jouwdomein.nl."
  echo "Draai ./package.sh <jouwdomein> opnieuw zodra je een domein hebt."
fi
