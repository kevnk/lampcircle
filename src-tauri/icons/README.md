The app icon is the Lampcircle mark on a cream rounded square, cut from `docs/brand/logo.png` with its alpha kept.

`sh scripts/app-icon.sh` remakes every file here. Never redraw the logo; the rules are in `docs/brand/README.md`.

The iPhone and iPad icons are not made from these. Xcode reads them from `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset`, and `sh scripts/ios-icon.sh` remakes them.
