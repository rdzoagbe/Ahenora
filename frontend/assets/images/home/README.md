# Home pictures: brief and record

The picture at the top of Home changes with the household (agreed with Roland
on 2026-10-31). Each scene has a day version (light mode) and a night version
(dark mode). Until a file is here and wired in `src/homeHeroArt.ts`, Home shows
the stand-in drawing made in code for scenes with children, and no picture for
the others.

## Rights: read before adding a file

Only add a picture the household holds the rights to use in an app it sells.

- **Made with an AI tool:** make it yourself, in your own account. The tool's
  terms decide whether commercial use is allowed. Checked on 2026-10-31:
  - OpenAI Terms of Use (effective 1 January 2026): "you … own the Output.
    We hereby assign to you all our right, title, and interest, if any, in and
    to Output."
  - Google Terms of Service: "Google won't claim ownership over that content."
- **Copyright:** the US Copyright Office (Part 2 report, 29 January 2025)
  protects AI outputs only where a human author determined sufficient
  expressive elements, "but not the mere provision of prompts". The pictures
  can be used, but a competitor copying them could not be stopped.
- **Never** name another app, brand or living artist in a prompt.
- **Commissioned art:** keep the signed contract that assigns full commercial
  rights.

Fill in the record table below for every file before it is committed.

## Files

Landscape 3:2, the largest size the tool offers, saved as WebP or PNG.

| Scene (`HeroScene`) | Shown to | Day file | Night file |
|---|---|---|---|
| `family` | two adults or more, with children | `home-family-light.webp` | `home-family-dark.webp` |
| `children` | one adult with children (right for a mum or a dad) | `home-children-light.webp` | `home-children-dark.webp` |
| `mum` | chosen in Settings (the choice is built once the pictures exist) | `home-mum-light.webp` | `home-mum-dark.webp` |
| `dad` | chosen in Settings (the choice is built once the pictures exist) | `home-dad-light.webp` | `home-dad-dark.webp` |
| `grandparent` | a grandparent with grandchildren | `home-grandparent-light.webp` | `home-grandparent-dark.webp` |
| `couple` | two adults, no children | `home-couple-light.webp` | `home-couple-dark.webp` |
| `solo` | one person | `home-solo-light.webp` | `home-solo-dark.webp` |

## Prompts

Start every image with the style, then add one people line. For the night
version, add the night line too.

```
STYLE:
Warm, modern storybook illustration, soft painterly digital style, gentle
light, warm palette of terracotta, peach, cream and soft green plants, cosy
home. Everyone smiling and relaxed. Landscape 3:2. Keep the people in the
middle; nothing important in the top fifth or the bottom sixth. The top edge
fades into plain cream #FAF6F1. No text, no logo, no watermark.

NIGHT:
Same scene in the evening, warm lamp light, a window with stars, and the top
edge fades into very dark brown #15120F instead.

PEOPLE:
family      A mother and father with two girls and a boy, reading a picture book on a sofa.
children    A girl and a boy playing happily together on a living-room rug with books and toys.
mum         A mother with a girl and a boy, reading a picture book on a sofa.
dad         A father with a girl and a boy, reading a picture book on a sofa.
grandparent A grandmother with a granddaughter and a grandson, reading on a sofa.
couple      A couple without children, cooking together in a warm kitchen.
solo        One adult on their own, relaxing on a sofa with a cup of tea and a notebook.
```

## Record

| File | Tool | Account | Date | Prompt used | Edits made by hand |
|---|---|---|---|---|---|
| | | | | | |
