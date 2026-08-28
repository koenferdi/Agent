#!/usr/bin/env bash
# Bakt index.html, assets/styles.css en assets/app.js tot één bestand: dist/index.html.
# Alleen bedoeld om te previewen of te mailen — voor productie volstaat index.html + assets/.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist

awk '
  /<link rel="stylesheet" href="assets\/styles.css">/ {
    print "<style>"; while ((getline line < "assets/styles.css") > 0) print line; print "</style>"; next
  }
  /<script src="assets\/app.js"><\/script>/ {
    print "<script>"; while ((getline line < "assets/app.js") > 0) print line; print "</script>"; next
  }
  { print }
' index.html > dist/index.html

echo "Geschreven: dist/index.html ($(wc -c < dist/index.html) bytes)"
