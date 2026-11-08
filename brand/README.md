# Mizo brand kit

**Mizo** comes from *la mise*, the daily deposit a collector takes from each client.
It is used for the admin dashboard and the mobile app.

## Logo

The mark is a rounded **m** with a **coin** above it: the mise dropping in.
In the wordmark, the coin is the dot of the **i**.

| File | Use |
|---|---|
| `svg/mizo-tile.svg` | Main mark: rounded terracotta tile. Favicon, avatars, splash |
| `svg/mizo-icon.svg` | Full-bleed square for app stores (the OS rounds the corners) |
| `svg/mizo-adaptive-fg.svg` | Android adaptive icon foreground; background `#D85A30` |
| `svg/mizo-glyph.svg` | The m and the coin alone, in `currentColor`, for UI and one-colour printing |
| `svg/mizo-wordmark-light.svg` | Wordmark on light backgrounds |
| `svg/mizo-wordmark-dark.svg` | Wordmark on dark backgrounds |
| `svg/mizo-wordmark-mono.svg` | Wordmark in a single colour (`currentColor`) |

PNG exports are in `png/`. In code, use `src/components/Brand.jsx` (web) or
`app/components/ui/MizoLogo.tsx` (app) rather than the image files.

- **Clear space:** keep at least the coin's diameter free around the mark, and the height of the *i* around the wordmark.
- **Minimum size:** 16 px for the tile, 14 px height for the wordmark.
- **Don't:** recolour the coin outside the palette, stretch the mark, add a shadow or outline, or type the name in another font in place of the wordmark.
- **Writing the name:** "Mizo" in text, "mizo" only in the drawn wordmark.

## Colours

| Name | Hex | Use |
|---|---|---|
| Latérite | `#D85A30` | Brand colour: the logo, icons, accents, fills with no text on them |
| Latérite fort | `#BB4721` | Buttons and chips with white text (5.2:1) |
| Latérite foncé | `#993C1D` | Text on light tinted backgrounds, pressed states |
| Latérite clair | `#FAE8E0` | Tinted backgrounds, badges |
| Pièce | `#FFC46B` | The coin. Accent only, never for text |
| Karité | `#3B6D11` | Success, withdrawals |
| Encre | `#1A1A18` | Text |
| Sable | `#F5F4F0` | App backgrounds |

Tile gradient: `#E26B3F` at the top to `#C94F27` at the bottom.

White text on Latérite has a contrast ratio of only 3.9:1, which passes only for large text (bold 18.7 px and up, or 24 px). Buttons and other fills that carry smaller white text use Latérite fort. Brand-coloured text on light backgrounds uses Latérite foncé.

## Typography

**Inter** for everything: 600 for headings, 400 or 500 for body text, tabular figures for amounts.
The wordmark is drawn, not typed. Don't rebuild it from a font.

## Tone

Plain French, and short sentences that an agent can read in the field.
Amounts are shown as `25 000 F`.
