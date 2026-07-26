---
name: dark-pdf
description: >
  Bake a dark-mode "night" look into any PDF, reproducing exactly how
  alphaXiv renders papers on a black background. Use when the user wants a
  dark / inverted / black-background version of a PDF for comfortable screen
  reading. Applies alphaXiv's CSS filter -- invert(88.8%) hue-rotate(180deg)
  contrast() -- to every page and writes a new PDF. White backgrounds become
  dark gray and text becomes light, while figures/photos keep their real
  colors (the hue-rotate cancels invert's hue flip).
metadata:
  short-description: "Turn a PDF dark like alphaXiv (invert + hue-rotate)"
---

# dark-pdf

Produce a dark-background copy of a PDF, identical to alphaXiv's dark viewer.

**Skill dir:** the directory that contains this `SKILL.md` (e.g. once installed,
`.claude/skills/dark-pdf/`). Everything runs from there; `cd` into that directory
and use `./run.sh`. All paths below are relative to it.

## How it works

alphaXiv serves a **normal white PDF** and renders it with PDF.js, then applies
this CSS to each rendered page in dark mode (from `client-only-lazy-*.css`):

```css
.dark .pdfViewer .page { filter: invert(88.8%) hue-rotate(180deg) contrast(); }
```

A CSS `filter` transforms the **rendered pixels**, so baking it into a file
means: rasterize each page, apply the same math, repackage as a PDF. That is
exactly what `darkpdf.py` does, matching the browser's per-channel formulas:

- `invert(0.888)` -> `c' = 0.888 + c*(1 - 2*0.888)` (white#fff -> ~#1d1d1d, black -> ~#e2e2e2)
- `hue-rotate(180deg)` -> luma-preserving 3x3 color matrix (keeps figures looking natural)
- `contrast()` -> no argument means `contrast(1)`, i.e. identity

Because it rasterizes, the output is images, not selectable text, and larger
than the source. That is inherent to baking a pixel filter (the browser never
changes the file; it filters at display time).

## Usage

```bash
cd .claude/skills/dark-pdf   # the skill dir (wherever this SKILL.md lives)
./run.sh input.pdf                 # -> input.dark.pdf
./run.sh input.pdf out.pdf         # explicit output
./run.sh in.pdf out.pdf --dpi 200  # sharper, larger
./run.sh in.pdf out.pdf --invert 1.0        # pure-black background
./run.sh in.pdf out.pdf --quality 60        # smaller JPEG pages
./run.sh in.pdf out.pdf --quality 0         # lossless PNG pages (much larger)
```

`./run.sh` bootstraps a local venv (PyMuPDF + numpy) on first run via
`./setup.sh`. No system installs; nothing global is touched.

### Flags

| flag | default | meaning |
|------|---------|---------|
| `--dpi` | `150` | raster resolution; higher = sharper + bigger |
| `--invert` | `0.888` | invert amount 0..1 (alphaXiv uses 0.888; `1.0` = pure black) |
| `--hue` | `180` | hue-rotate degrees |
| `--contrast` | `1.0` | contrast multiplier (`1.0` = no-op, matches alphaXiv) |
| `--quality` | `80` | JPEG quality for pages; `0` = lossless PNG |

## Notes / limits

- Output pages are **images** -> no text selection, search, or copy. Keep the
  original if you need the text layer.
- Size scales with `--dpi`. For the 34-page alphaXiv sample: ~8 MB at 150 dpi,
  ~12 MB at 200. Drop `--dpi` or `--quality` to shrink.
- Page dimensions and count are preserved, so print size is unchanged.

## Files

- `darkpdf.py` -- the converter (all filter math + CLI)
- `run.sh` -- entrypoint; auto-runs setup, then `darkpdf.py`
- `setup.sh` -- creates `.venv` and installs `requirements.txt`
- `requirements.txt` -- PyMuPDF, numpy
