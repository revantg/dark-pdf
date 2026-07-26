#!/usr/bin/env python3
"""Bake alphaXiv's dark-mode CSS filter into a PDF.

alphaXiv renders a normal (white) PDF with PDF.js and applies this CSS to each
rendered page in dark mode:

    filter: invert(88.8%) hue-rotate(180deg) contrast();

A CSS `filter` operates on the *rendered pixels* of the element, so the only
faithful way to bake it into a file is to rasterize each page and apply the
exact same math the browser applies, then repackage the images as a PDF.

The filter chain (applied left-to-right, per the Filter Effects spec) in sRGB
byte space -- which is where browsers apply these shorthand functions, e.g.
`invert(1)` maps a channel c -> 255-c:

  invert(a):       c' = a + c*(1 - 2a)                  (per channel, a=0.888)
  hue-rotate(deg): [r g b]' = M(deg) . [r g b]          (luma-preserving 3x3)
  contrast(k):     c' = (c - 0.5)*k + 0.5               (k defaults to 1 = no-op)

White (page bg) -> ~#1c1c1c dark gray; black (text) -> ~#e3e3e3 light gray;
hue-rotate(180) undoes the hue flip invert causes, so colored figures survive.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np

# alphaXiv defaults, straight from client-only-lazy-*.css:
#   .dark .pdfViewer .page { filter: invert(88.8%) hue-rotate(180deg) contrast() }
DEFAULT_INVERT = 0.888
DEFAULT_HUE = 180.0
DEFAULT_CONTRAST = 1.0  # `contrast()` with no argument == contrast(1) == identity
DEFAULT_DPI = 150
DEFAULT_QUALITY = 80  # JPEG quality for the rasterized pages; 0 = lossless PNG


def hue_rotate_matrix(deg: float) -> np.ndarray:
    """The SVG/CSS `hue-rotate` color matrix for `deg` degrees (RGB, row-major)."""
    c = math.cos(math.radians(deg))
    s = math.sin(math.radians(deg))
    luma = np.array(
        [[0.213, 0.715, 0.072]] * 3,
        dtype=np.float64,
    )
    cos_part = np.array(
        [
            [0.787, -0.715, -0.072],
            [-0.213, 0.285, -0.072],
            [-0.213, -0.715, 0.928],
        ],
        dtype=np.float64,
    )
    sin_part = np.array(
        [
            [-0.213, -0.715, 0.928],
            [0.143, 0.140, -0.283],
            [-0.787, 0.715, 0.072],
        ],
        dtype=np.float64,
    )
    return luma + c * cos_part + s * sin_part


def apply_filter(
    rgb: np.ndarray,
    invert: float,
    hue: float,
    contrast: float,
) -> np.ndarray:
    """Apply invert -> hue-rotate -> contrast to an (H, W, 3) uint8 array."""
    x = rgb.astype(np.float64) / 255.0

    # invert(a): c' = a + c*(1 - 2a)
    x = invert + x * (1.0 - 2.0 * invert)

    # hue-rotate(deg): matrix multiply across the channel axis
    m = hue_rotate_matrix(hue)
    x = x @ m.T

    # contrast(k): c' = (c - 0.5)*k + 0.5
    if contrast != 1.0:
        x = (x - 0.5) * contrast + 0.5

    x = np.clip(x, 0.0, 1.0)
    return np.rint(x * 255.0).astype(np.uint8)


def convert(
    src: Path,
    dst: Path,
    invert: float = DEFAULT_INVERT,
    hue: float = DEFAULT_HUE,
    contrast: float = DEFAULT_CONTRAST,
    dpi: int = DEFAULT_DPI,
    quality: int = DEFAULT_QUALITY,
) -> None:
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    doc = fitz.open(src)
    out = fitz.open()
    try:
        for page in doc:
            # Render on white (alpha=False) -- matches the browser's white page
            # background that the filter then darkens.
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            arr = np.frombuffer(pix.samples, dtype=np.uint8)
            arr = arr.reshape(pix.height, pix.stride)[:, : pix.width * pix.n]
            arr = arr.reshape(pix.height, pix.width, pix.n)

            arr = apply_filter(arr[:, :, :3], invert, hue, contrast)

            processed = fitz.Pixmap(
                fitz.csRGB, pix.width, pix.height, arr.tobytes(), False
            )

            # New page at the original point size; stretch the raster to fill it
            # so page geometry (and thus print size) is preserved.
            new_page = out.new_page(width=page.rect.width, height=page.rect.height)
            if quality > 0:
                # JPEG-compress the raster -- rasterizing a whole page is heavy,
                # so lossless PNG can bloat 10x+; JPEG keeps files reasonable.
                new_page.insert_image(
                    page.rect,
                    stream=processed.tobytes("jpeg", jpg_quality=quality),
                )
            else:
                new_page.insert_image(page.rect, pixmap=processed)

            pix = processed = None  # free ASAP; PDFs can be big

        out.set_metadata(doc.metadata or {})
        dst.parent.mkdir(parents=True, exist_ok=True)
        out.save(dst, deflate=True, garbage=4)
    finally:
        out.close()
        doc.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="darkpdf",
        description="Bake alphaXiv's dark-mode filter into a PDF "
        "(invert 88.8% + hue-rotate 180deg).",
    )
    p.add_argument("input", type=Path, help="source PDF")
    p.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="destination PDF (default: <input>.dark.pdf)",
    )
    p.add_argument(
        "--dpi",
        type=int,
        default=DEFAULT_DPI,
        help=f"raster resolution (default {DEFAULT_DPI}); higher = sharper + bigger",
    )
    p.add_argument(
        "--invert",
        type=float,
        default=DEFAULT_INVERT,
        help=f"invert amount 0..1 (default {DEFAULT_INVERT}; 1.0 = pure black bg)",
    )
    p.add_argument(
        "--hue",
        type=float,
        default=DEFAULT_HUE,
        help=f"hue-rotate degrees (default {DEFAULT_HUE})",
    )
    p.add_argument(
        "--contrast",
        type=float,
        default=DEFAULT_CONTRAST,
        help=f"contrast multiplier (default {DEFAULT_CONTRAST} = no-op)",
    )
    p.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_QUALITY,
        help=f"JPEG quality 1..100 for rasterized pages "
        f"(default {DEFAULT_QUALITY}); 0 = lossless PNG (much larger)",
    )
    args = p.parse_args(argv)

    if not args.input.is_file():
        p.error(f"input not found: {args.input}")
    out = args.output or args.input.with_suffix(".dark.pdf")

    convert(
        args.input,
        out,
        invert=args.invert,
        hue=args.hue,
        contrast=args.contrast,
        dpi=args.dpi,
        quality=args.quality,
    )
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
