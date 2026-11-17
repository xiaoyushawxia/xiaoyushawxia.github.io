#!/bin/sh
# Stamp today's date onto every local CSS/JS reference (?v=YYYYMMDDhhmm) so that
# browsers fetch the new files right after a deploy instead of mixing a fresh
# page with a stylesheet cached for up to ten minutes by GitHub Pages.
#
# Run from the repository root after changing anything under assets/css or
# assets/js, then commit as usual:
#     sh scripts/bump-assets.sh
set -e
v=$(date +%Y%m%d%H%M)   # date and time, so two deploys on one day still differ
for f in *.html; do
  # Works with both BSD (macOS) and GNU sed.
  sed -E -i.bak \
    -e "s#(href=\"\.?/assets/css/[^\"?]+\.css)(\?v=[0-9]+)?\"#\1?v=$v\"#g" \
    -e "s#(src=\"\.?/assets/js/[^\"?]+\.js)(\?v=[0-9]+)?\"#\1?v=$v\"#g" \
    "$f"
  rm -f "$f.bak"
done
echo "Asset version set to $v"
