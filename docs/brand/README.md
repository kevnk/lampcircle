# Lampcircle brand

Everything in the app comes from one file: [logo.png](logo.png). The navy lantern, its amber sound bars and the cream light it throws give every color, shape and state. The app has a light mode and a dark mode, and both use the same three colors.

## The logo

`logo.png` is the source. It has a transparent background: only the lantern, bars, ring, disk and wordmark are solid.

**Rules**

- Use the logo file as it is. Do not redraw it, and do not put a glow or a box behind it.
- On a light background, use it unchanged. Cream (`#F6ECDD`) is its home.
- On a dark background, use it on a very dark color that is not black (the app uses `#121619`), with the wordmark recolored cream. The wordmark color is the only thing that may change.

**Files made from it** (all in `public/`)

| File | What it is | Where it is used |
| --- | --- | --- |
| `brand/logo.webp` | The whole logo, unchanged | Sidebar, light mode |
| `brand/logo-dark.webp` | The whole logo, wordmark in cream | Sidebar, dark mode |
| `brand/mark.webp` | The lantern, bars and ring, without the wordmark | Not in the app today. Use it where the mark appears without the wordmark |
| `favicon.ico` | The lantern on a cream rounded square, at 16, 32 and 48 px | Browser tab |
| `apple-touch-icon.png` | The mark on cream, 180 px | iPhone and iPad home screen |
| `icon-192.png`, `icon-512.png` | The mark on cream | Installed app (`manifest.webmanifest`) |
| `icon-maskable-512.png` | The mark on cream, inside the safe circle | Android adaptive icon |

To remake them, crop `logo.png` and keep its alpha channel. The mark is the box (400, 117)–(1136, 700). The whole logo is (161, 117)–(1374, 877).

## Color

Three colors from the logo, in every mode:

| Name | Value | From the logo |
| --- | --- | --- |
| Navy | `#10283A` | The lantern body and the wordmark |
| Amber | `#E8A24E` light, `#F0A64B` dark | The sound bars and the glass |
| Cream | `#F6ECDD` | The light on the disk and the flame |

The app uses roles, not raw colors. Each role has a light and a dark value, set in `src/index.css` and named in `tailwind.config.js`.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `page` | `#FBF7F1` | `#070D13` | Page background |
| `panel` | `#FFFFFF` | `#0D1822` | Cards, menus |
| `raised` | `#F3ECE1` | `#15263A` | Hover, quiet fills |
| `well` | `#FFFDF9` | `#08111A` | Text fields, the TAP pad |
| `side` | `#F6ECDD` | `#121619` | Sidebar, behind the logo |
| `line` | `#E7DDCD` | `#1E3243` | Hairlines |
| `edge` | `#B7AA96` | `#3A5873` | Button and control borders |
| `ink` | `#10283A` | `#F6ECDD` | Main text, playheads, Perform's big buttons |
| `muted` | `#5D6B77` | `#97A9B9` | Secondary text |
| `faint` | `#85898C` | `#677D90` | Disabled, decorative |
| `accent` | `#E8A24E` | `#F0A64B` | Amber fills: the next thing to do, what is playing |
| `amber` | `#94570F` | `#F5B35E` | Amber text and icons, dark enough to read on cream |
| `danger` | `#B4432B` | `#F2896C` | Errors, Delete, stopping the set |
| `lantern` | `#10283A` | `#1C3348` | Strong neutral buttons (Play, Mark) |

Checked contrast: main text is 12.9:1 or more in both modes, secondary text (and field placeholders) 4.6:1 or more, amber text 4.9:1 or more, and navy on amber 7:1. `faint` is only for disabled and decorative things.

**Section shades** go from quiet to strong. In light mode they darken toward the navy lantern. In dark mode they warm toward the lamplight, so the chorus glows most.

| Shade | Sections | Light | Dark |
| --- | --- | --- | --- |
| light | Intro, Tag, Outro | `#EDE3D3` | `#152739` |
| mid | Verse, Pre-chorus | `#CFD8E0` | `#24425C` |
| dark | Bridge, Instrumental | `#46617A` | `#7A532B` |
| black | Chorus | `#10283A` | `#EBCB97` |

## Type

**Montserrat** is the closest free match to the wordmark: a heavy, wide LAMP and a thin, round CIRCLE. It is the only typeface. It is self-hosted in `src/fonts/` so Perform keeps it with no network.

- **Headings:** extra bold with tight tracking, like LAMP.
- **Labels:** the `.caps` class: 11 px, semibold, uppercase, 0.2 em tracking, like the spaced-out CIRCLE.
- **Numbers:** the `.tabular` class, so bars, BPM and clocks do not jitter.

## Shape

- **Pills** for buttons, fields, chips and toggles. They echo the rounded sound bars and the circle.
- **Rounded cards** (`rounded-2xl`).
- **Sound bars** stand for rhythm: Perform's beat counter is a row of bars that light on each beat, with beat 1 tallest. The sidebar marks the current page with one amber bar.
- **Resting bars** fill empty lists and the loading screen: the logo's bars, quieted down and breathing slowly, with the short middle bar lit like an ember. They are drawn in code (`RestingBars` in `src/ui.tsx`), so they follow light and dark mode. Do not put the logo in empty states.
- **Glow** is only for things that are lit: the section playing, the pad sounding, the beat now, the current step, Perform's Start button, and any primary button on hover. It is never decoration.

## States

| State | Looks like | Examples |
| --- | --- | --- |
| Do this next | Amber fill, navy text | Download, Next: Transitions, Start |
| Playing or sounding | Amber fill, navy text, glow | Section tile, pad tile, key under the song |
| Coming next | 2 px amber outline | Queued section, suggested pad |
| Selected | Amber tint, amber ring, amber text | Tool, jump rule, Perform options |
| Perform's big actions | Ink fill: navy in light mode, cream in dark mode | Go to pad, Start on next bar |
| Waveform | Amber where it has played, quiet blue-gray where it has not | Map Song, Transitions |
| Danger | Coral text or outline | Delete, errors, Tap again to stop |

## Light and dark

The mode follows the device until someone picks one. The switch (Light, Dark, Auto) is at the bottom of the sidebar, and Perform has a sun and moon button in its header for changing it mid-set. `index.html` applies the saved mode before the first paint, so a dark room never sees a light flash. `src/theme.ts` keeps it in step after that.
