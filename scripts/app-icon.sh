#!/bin/sh
# Remakes the Mac app's icons in src-tauri/icons from docs/brand/logo.png: the mark on a cream rounded square,
# sized to the macOS icon grid (an 824 px tile in a 1024 px canvas). Needs ImageMagick 7 and npm install.
# Run from the repo root: sh scripts/app-icon.sh
set -eu
cream='#F6ECDD'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The mark (lantern, bars and ring) without the wordmark, alpha kept. docs/brand/README.md lists the crops.
magick docs/brand/logo.png -crop 736x583+400+117 +repage "$tmp/mark.png"

# The tile, with the soft shadow Mac icons sit on, then the mark at 76% of the tile's width.
magick -size 1024x1024 xc:none \
  \( -size 1024x1024 xc:none -fill 'rgba(16,40,58,0.28)' -draw 'roundrectangle 100,112 923,935 185,185' -blur 0x14 \) -composite \
  -fill "$cream" -draw 'roundrectangle 100,100 923,923 185,185' \
  \( "$tmp/mark.png" -filter Lanczos -resize 626x \) -gravity center -geometry +0-6 -composite "$tmp/icon.png"

npx tauri icon "$tmp/icon.png" -o src-tauri/icons
rm -rf src-tauri/icons/android src-tauri/icons/ios
