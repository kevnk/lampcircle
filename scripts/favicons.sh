#!/bin/sh
# Remakes the browser-tab icons in public/ from docs/brand/logo.png: favicon.ico, favicon.svg and favicon-96x96.png.
# Needs ImageMagick 7. Run from the repo root: sh scripts/favicons.sh
set -eu
cream='#F6ECDD'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The lantern alone, alpha kept. The box stops just short of the innermost sound bars, so no sliced bars show at the edges.
magick docs/brand/logo.png -crop 287x492+622+114 +repage "$tmp/lantern.png"

# A 1024 px master: the lantern at 90% height on an anti-aliased cream rounded square. Every size is made from it.
magick -size 1024x1024 xc:none -fill "$cream" -draw 'roundrectangle 0,0 1023,1023 224,224' \
  \( "$tmp/lantern.png" -filter Lanczos -resize x920 \) -gravity center -composite "$tmp/master.png"

# icon SIZE SHARPEN OUT: Lanczos down from the master, sharpen color only (not alpha, so the corners stay smooth),
# then paint fully transparent pixels cream. A browser that scales without premultiplied alpha then shows no dark fringe.
icon() {
  magick "$tmp/master.png" -filter Lanczos -resize "$1x$1" -channel RGB -unsharp "0x0.6+$2+0" +channel \
    -background "$cream" -alpha background -depth 8 -strip -define png:color-type=6 "$3"
}

icon 48 0.8 "$tmp/48.png"
icon 32 0.8 "$tmp/32.png"
icon 16 0.5 "$tmp/16.png" # more than this leaves a pale halo around the lantern
icon 96 0 public/favicon-96x96.png
icon 256 0 "$tmp/256.png"

# 32-bit entries with full alpha, largest first, as RealFaviconGenerator writes them. Chrome shows the 16 or 32 px
# frame as is when it matches the tab exactly, so those two carry the sharpening.
magick "$tmp/48.png" "$tmp/32.png" "$tmp/16.png" -define icon:format=bmp public/favicon.ico

# The raster wrapped in an SVG, for browsers that take an SVG icon (Firefox, Safari 26). They draw it at any size.
{
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
  printf '<image width="256" height="256" href="data:image/png;base64,%s"/></svg>\n' "$(base64 < "$tmp/256.png" | tr -d '\n')"
} > public/favicon.svg
