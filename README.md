# dark-pdf

Turn any PDF into a dark-mode version, right in your browser — reproducing
[alphaXiv](https://www.alphaxiv.org)'s exact night-reading filter.

**Live:** https://revantg.github.io/dark-pdf/

## What it does

alphaXiv serves normal white PDFs and renders them with PDF.js, then applies
this CSS to each page in dark mode:

```css
filter: invert(88.8%) hue-rotate(180deg) contrast();
```

White backgrounds become dark gray (`#1d1d1d`), black text becomes light, and
figures keep their real colors because `hue-rotate(180deg)` cancels the hue
flip that `invert` introduces.

This tool applies the same filter to a PDF **you** open, previews the pages
live, and lets you read in dark mode — all client-side.

## Features

- **Live preview** of the first 3 pages, updating instantly as you tweak.
- **Tweakable** invert / hue-rotate / contrast.
- **Presets:** alphaXiv, Pure black, Sepia night.
- **Before / after** toggle and split-slider compare.
- **Download keeps the original** — real text, selectable content, vector
  figures and diagrams are all preserved, exactly like alphaXiv.
- **100% local** — files never leave your browser; there is no server.

## How it works

Dark mode is a **view-only CSS filter** applied to each rendered page
(`.page { filter: invert(88.8%) hue-rotate(180deg) }`) — the same approach
alphaXiv uses. The filter is a display effect only; it is never baked into the
file. When you hit **Download**, you get the **original PDF untouched**, so
text, diagrams and vectors stay intact rather than being flattened to images.
Built with vanilla HTML/CSS/JS + [PDF.js](https://mozilla.github.io/pdf.js/)
from a CDN — no build step.

## Command-line skill

This repo also ships an **agent skill** (in [`skills/dark-pdf/`](skills/dark-pdf))
that bakes the same dark filter into a PDF from the command line — handy for
coding agents (Claude Code, Cursor, etc.) or your own terminal. Unlike the web
app it uses PyMuPDF to rasterize each page, so it batch-converts whole files
without a browser.

### Install with `npx skills`

Uses the [`skills`](https://github.com/vercel-labs/skills) CLI (requires
**Node ≥ 22.20**). No global install needed — `npx` fetches it on demand:

```bash
# Install into the current project (.claude/skills/dark-pdf/, etc.)
npx skills add revantg/dark-pdf

# …or install globally for all projects (~/.claude/skills/dark-pdf/)
npx skills add revantg/dark-pdf --global
```

The CLI reads [`skills/dark-pdf/SKILL.md`](skills/dark-pdf/SKILL.md) and links it
into your agent's skills directory. Manage it with:

```bash
npx skills list             # show installed skills
npx skills remove dark-pdf  # uninstall
```

### Run it

```bash
cd .claude/skills/dark-pdf        # wherever it was installed
./run.sh input.pdf                # -> input.dark.pdf
./run.sh input.pdf out.pdf --dpi 200 --invert 1.0
```

`./run.sh` bootstraps a local Python venv (PyMuPDF + numpy) on first run;
nothing global is touched. See [`skills/dark-pdf/SKILL.md`](skills/dark-pdf/SKILL.md)
for all flags.

## Local dev

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Credit

The effect is [alphaXiv](https://www.alphaxiv.org)'s. This is an independent
reimplementation for arbitrary PDFs.
