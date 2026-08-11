# dark-pdf

Turn any PDF into a real dark-mode PDF, right in your browser — using
[alphaXiv](https://www.alphaxiv.org)'s night-reading colour maths, but written
into the file instead of painted over it.

**Live:** https://revantg.github.io/dark-pdf/

## What it does

alphaXiv serves normal white PDFs, renders them with PDF.js, and applies this
CSS to each page in dark mode:

```css
/* verbatim from alphaXiv's stylesheet — the empty contrast() is theirs,
   and is simply ignored by the browser, so it acts as contrast(1) */
.dark .pdfViewer .page { filter: invert(88.8%) hue-rotate(180deg) contrast(); }
```

White backgrounds become dark gray, black text becomes light, and figures keep
their real colours because `hue-rotate(180deg)` cancels the hue flip that
`invert` introduces.

That filter is a *view-only* effect — it lives in the browser and disappears the
moment you download the file. This tool takes the same colour maths and applies
it to the **PDF itself**, so the file you save is genuinely dark and opens dark
anywhere: Preview, Acrobat, your e-reader.

Crucially it is **not** a screenshot. Text stays real text and images stay real
images.

## Features

- **Real dark PDF out** — not a stack of flattened page images.
- **Text stays selectable**, searchable and copyable.
- **Images are untouched** — figures and photos are never re-encoded.
- **Live preview** of the first 3 pages, rendered from the actual output bytes.
- **Tweakable** invert / hue-rotate / contrast.
- **Presets:** alphaXiv, Pure black, Sepia night.
- **Before / after** toggle and split-slider compare.
- **100% local** — files never leave your browser; there is no server.

## How it works

The transform happens at the PDF **content-stream** level, using
[pdf-lib](https://pdf-lib.js.org/):

1. **Recolour the drawing operators.** Every page's content stream is tokenised
   and the fill/stroke colour operators (`g`/`G`, `rg`/`RG`, `k`/`K`, plus
   device-space `sc`/`scn`) are rewritten through the same invert + hue-rotate
   matrix the CSS filter uses. The tokeniser skips `(…)` and `<…>` strings,
   comments and `BI…ID…EI` inline image data, and round-trips bytes as latin1,
   so binary content is never corrupted.
2. **Add a dark background.** A dark rectangle is inserted *underneath* the
   existing content (via `wrapContentStreams`), and the transformed default
   colour is set up front so text that relies on the default black graphics
   state still comes out light.

Text-drawing operators and image XObjects are left completely alone — that is
why text stays selectable and figures survive byte-for-byte.

The preview renders the **transformed bytes**, so what you see is exactly what
downloads. Built with vanilla HTML/CSS/JS +
[PDF.js](https://mozilla.github.io/pdf.js/) and
[pdf-lib](https://pdf-lib.js.org/) from a CDN — no build step.

### Limitations

Colour lives in more places than page content streams. This tool does not
recolour raster images (by design), nor colours inside patterns, shadings,
ExtGState, Form XObjects or annotation appearance streams. Non-device colour
spaces (Indexed, Separation, ICCBased, DeviceN) are deliberately left alone,
since inverting their operands numerically would produce wrong colours. Expect
the occasional element to stay light on heavily designed PDFs.

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
