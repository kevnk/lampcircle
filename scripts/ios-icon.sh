#!/bin/sh
# Remakes the iPhone and iPad icon set from docs/brand/logo.png: the mark on a full-bleed cream square with no alpha.
# iOS rounds the corners itself. Needs only sips, which comes with macOS. Run from the repo root: sh scripts/ios-icon.sh
set -eu
out=src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The mark keeps its alpha and fills 78% of the width, as in public/apple-touch-icon.png. docs/brand/README.md lists the crop.
# The sips canvas is Display P3. It converts the logo's colors itself but reads the fill as P3, so #F4ECDF becomes cream (#F6ECDD) below.
cat > "$tmp/compose.js" <<'EOF'
const canvas = new Canvas(1024, 1024);
canvas.fillStyle = '#F4ECDF';
canvas.fillRect(0, 0, 1024, 1024);
canvas.drawImage(sips.images[0], 400, 117, 736, 583, 112, 195.5, 800, 633);
new Output(canvas, 'master', 'public.png').addToQueue();
EOF
sips --js "$tmp/compose.js" -o "$tmp" docs/brand/logo.png > /dev/null
sips -m '/System/Library/ColorSync/Profiles/sRGB Profile.icc' "$tmp/master.public.png" --out "$tmp/srgb.png" > /dev/null

# PPM has no alpha channel, so this round trip drops it and leaves every color alone. The App Store refuses an icon with alpha.
sips -s format pbm "$tmp/srgb.png" --out "$tmp/flat.ppm" > /dev/null
sips -s format png "$tmp/flat.ppm" --out "$tmp/master.png" > /dev/null

# The names and sizes in Contents.json.
while read -r name size; do
  sips -z "$size" "$size" "$tmp/master.png" --out "$out/$name" > /dev/null
done <<'EOF'
AppIcon-20x20@1x.png 20
AppIcon-20x20@2x.png 40
AppIcon-20x20@2x-1.png 40
AppIcon-20x20@3x.png 60
AppIcon-29x29@1x.png 29
AppIcon-29x29@2x.png 58
AppIcon-29x29@2x-1.png 58
AppIcon-29x29@3x.png 87
AppIcon-40x40@1x.png 40
AppIcon-40x40@2x.png 80
AppIcon-40x40@2x-1.png 80
AppIcon-40x40@3x.png 120
AppIcon-60x60@2x.png 120
AppIcon-60x60@3x.png 180
AppIcon-76x76@1x.png 76
AppIcon-76x76@2x.png 152
AppIcon-83.5x83.5@2x.png 167
AppIcon-512@2x.png 1024
EOF
