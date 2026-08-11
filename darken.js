// Darken a PDF at the CONTENT-STREAM level, keeping text and images real.
//
//   1. prepend a dark background rectangle underneath the existing content
//   2. rewrite fill/stroke colour operators (g/G/rg/RG/k/K, plus device-space
//      sc/scn) with the same invert + hue-rotate maths the CSS preview uses
//
// Image XObjects are deliberately left untouched: their pixels are never
// re-encoded, so figures and photos survive byte-for-byte.

// ---------- colour maths: mirror of CSS invert() + hue-rotate() ----------
// CSS filters operate in sRGB space on 0..1 components.
function applyInvert(c, amount) {
  return c.map(v => v * (1 - amount) + (1 - v) * amount);
}

// hue-rotate matrix per the SVG/CSS filter spec
function hueRotateMatrix(deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
}

function applyMatrix(c, m) {
  return [
    m[0] * c[0] + m[1] * c[1] + m[2] * c[2],
    m[3] * c[0] + m[4] * c[1] + m[5] * c[2],
    m[6] * c[0] + m[7] * c[1] + m[8] * c[2],
  ];
}

function applyContrast(c, amount) {
  return c.map(v => (v - 0.5) * amount + 0.5);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function transformRgb(rgb, opts) {
  let c = applyInvert(rgb, opts.invert);
  c = applyMatrix(c, hueRotateMatrix(opts.hue));
  if (opts.contrast !== 1) c = applyContrast(c, opts.contrast);
  return c.map(clamp01);
}

// ---------- colour space conversions ----------
const grayToRgb = (g) => [g, g, g];
const cmykToRgb = (c, m, y, k) => [
  (1 - c) * (1 - k),
  (1 - m) * (1 - k),
  (1 - y) * (1 - k),
];
function rgbToCmyk([r, g, b]) {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}
const rgbToGray = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

const fmt = (v) => {
  const s = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" || s === "-0" ? "0" : s;
};

// ---------- content stream tokenizer ----------
// Walks a latin1 string, emitting tokens while correctly skipping
// ( ) literal strings, < > hex strings, % comments, and BI..ID..EI inline images.
const WS = new Set([" ", "\n", "\r", "\t", "\f", "\0"]);
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

function rewriteColorOps(src, opts) {
  let out = "";
  let i = 0;
  const n = src.length;
  // operand stack of raw token strings since the last operator
  let operands = [];
  // current colourspace selected by cs/CS, saved/restored by q/Q
  let fillSpace = "/DeviceGray";
  let strokeSpace = "/DeviceGray";
  const gsStack = [];

  const isNum = (t) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t);

  while (i < n) {
    const ch = src[i];

    // whitespace — copy through
    if (WS.has(ch)) { out += ch; i++; continue; }

    // comment to end of line
    if (ch === "%") {
      const start = i;
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      out += src.slice(start, i);
      continue;
    }

    // literal string: balanced parens, backslash escapes
    if (ch === "(") {
      const start = i;
      let depth = 0;
      while (i < n) {
        const c = src[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      out += src.slice(start, i);
      operands.push("(str)");
      continue;
    }

    // hex string  <...>  (but not the dict opener <<)
    if (ch === "<" && src[i + 1] !== "<") {
      const start = i;
      while (i < n && src[i] !== ">") i++;
      i++;
      out += src.slice(start, i);
      operands.push("(hex)");
      continue;
    }

    // dict open/close, arrays — copy verbatim, treat as operand noise
    if (ch === "<" && src[i + 1] === "<") { out += "<<"; i += 2; continue; }
    if (ch === ">" && src[i + 1] === ">") { out += ">>"; i += 2; continue; }
    if (ch === "[" || ch === "]" || ch === "{" || ch === "}") { out += ch; i++; operands.push(ch); continue; }

    // name object /Foo
    if (ch === "/") {
      const start = i;
      i++;
      while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++;
      const name = src.slice(start, i);
      out += name;
      operands.push(name);
      continue;
    }

    // regular token: number or operator keyword
    const start = i;
    while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++;
    if (i === start) { out += ch; i++; continue; } // safety: unknown delimiter
    const tok = src.slice(start, i);

    // ---- inline image: skip binary between ID and EI ----
    if (tok === "BI") {
      // copy through until we hit ID, then skip raw bytes to EI
      out += tok;
      // find the ID operator
      let j = i;
      while (j < n) {
        // scan token-by-token for "ID"
        while (j < n && WS.has(src[j])) j++;
        const ts = j;
        while (j < n && !WS.has(src[j]) && !DELIM.has(src[j])) j++;
        if (src.slice(ts, j) === "ID") break;
        if (j === ts) j++; // delimiter, advance
      }
      // after ID there is exactly one whitespace byte, then binary data
      let k = j + 1;
      // scan for whitespace-delimited EI
      while (k < n - 1) {
        if (src[k] === "E" && src[k + 1] === "I" &&
            (k + 2 >= n || WS.has(src[k + 2]) || DELIM.has(src[k + 2])) &&
            WS.has(src[k - 1])) break;
        k++;
      }
      const end = Math.min(k + 2, n);
      out += src.slice(i, end);   // copy ID + binary + EI untouched
      i = end;
      operands = [];
      continue;
    }

    if (isNum(tok)) { out += tok; operands.push(tok); continue; }

    // ---- colour operators ----
    const nums = operands.filter(isNum).map(Number);
    let replaced = null;

    // colour state is part of the graphics state, so q/Q save/restore it
    if (tok === "q") { gsStack.push([fillSpace, strokeSpace]); }
    else if (tok === "Q") { const s = gsStack.pop(); if (s) { fillSpace = s[0]; strokeSpace = s[1]; } }

    if (tok === "g" || tok === "G") {
      // g/G also SET the colourspace to DeviceGray
      if (tok === "g") fillSpace = "/DeviceGray"; else strokeSpace = "/DeviceGray";
      if (nums.length >= 1) {
        const gray = nums[nums.length - 1];
        const t = transformRgb(grayToRgb(gray), opts);
        replaced = fmt(clamp01(rgbToGray(t))) + " " + tok;
      }
    } else if (tok === "rg" || tok === "RG") {
      if (tok === "rg") fillSpace = "/DeviceRGB"; else strokeSpace = "/DeviceRGB";
      if (nums.length >= 3) {
        const c = nums.slice(-3);
        const t = transformRgb(c, opts);
        replaced = t.map(fmt).join(" ") + " " + tok;
      }
    } else if (tok === "k" || tok === "K") {
      if (tok === "k") fillSpace = "/DeviceCMYK"; else strokeSpace = "/DeviceCMYK";
      if (nums.length >= 4) {
        const c = nums.slice(-4);
        const t = transformRgb(cmykToRgb(...c), opts);
        replaced = rgbToCmyk(t).map(v => fmt(clamp01(v))).join(" ") + " " + tok;
      }
    } else if (tok === "cs" || tok === "CS") {
      // remember the selected colourspace so sc/scn can be interpreted safely
      const name = operands[operands.length - 1];
      if (typeof name === "string" && name.startsWith("/")) {
        if (tok === "cs") fillSpace = name; else strokeSpace = name;
      }
    } else if (tok === "sc" || tok === "SC" || tok === "scn" || tok === "SCN") {
      // ONLY rewrite when the current colourspace is a known device space.
      // Indexed/Separation/ICCBased/DeviceN/Lab operands are palette indices or
      // ink tints, so inverting them numerically would be wrong. Patterns skip too.
      const space = (tok === "sc" || tok === "scn") ? fillSpace : strokeSpace;
      const lastOperand = operands[operands.length - 1];
      const isPattern = typeof lastOperand === "string" && lastOperand.startsWith("/");
      if (!isPattern) {
        if (space === "/DeviceGray" && nums.length === 1) {
          const t = transformRgb(grayToRgb(nums[0]), opts);
          replaced = fmt(clamp01(rgbToGray(t))) + " " + tok;
        } else if (space === "/DeviceRGB" && nums.length === 3) {
          replaced = transformRgb(nums.slice(-3), opts).map(fmt).join(" ") + " " + tok;
        } else if (space === "/DeviceCMYK" && nums.length === 4) {
          const t = transformRgb(cmykToRgb(...nums.slice(-4)), opts);
          replaced = rgbToCmyk(t).map(v => fmt(clamp01(v))).join(" ") + " " + tok;
        }
      }
    }

    if (replaced !== null) {
      // strip the operands we just consumed from the tail of `out`
      const consumed = tok === "g" || tok === "G" ? 1
        : tok === "rg" || tok === "RG" ? 3
        : tok === "k" || tok === "K" ? 4
        : nums.length;
      out = stripTrailingNumbers(out, consumed);
      out += replaced;
    } else {
      out += tok;
    }
    operands = [];
    continue;
  }
  return out;
}

// remove the last `count` numeric tokens (and their trailing whitespace) from out
function stripTrailingNumbers(out, count) {
  let end = out.length;
  for (let c = 0; c < count; c++) {
    while (end > 0 && WS.has(out[end - 1])) end--;
    const stop = end;
    while (end > 0 && /[0-9.+-]/.test(out[end - 1])) end--;
    if (stop === end) break; // not a number, bail
  }
  return out.slice(0, end) + (end > 0 && !WS.has(out[end - 1]) ? " " : "");
}


// ---------- PDF-level transform ----------
// Rewrites every page's content stream and prepends a dark background.
// Returns the new PDF bytes. Requires the pdf-lib UMD global.
async function darkenPdf(bytes, opts) {
  const {
    PDFDocument, PDFName, PDFArray, PDFRawStream, PDFContentStream,
    decodePDFRawStream, PDFStream, arrayAsString,
  } = window.PDFLib;

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  // the colour a white page becomes, and what default black text becomes
  const bg = transformRgb([1, 1, 1], opts);
  const fg = transformRgb([0, 0, 0], opts);

  const decodeStream = (stream) => {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    if (stream instanceof PDFContentStream) return stream.getUnencodedContents();
    throw new Error("unsupported content stream type");
  };

  for (const page of doc.getPages()) {
    const Contents = page.node.Contents();
    const streams = !Contents ? []
      : Contents instanceof PDFArray
        ? Contents.asArray().map(r => page.node.context.lookup(r, PDFStream))
        : [Contents];

    // 1. recolour the vector/text drawing operators
    for (const stream of streams) {
      let text;
      try { text = arrayAsString(decodeStream(stream)); }
      catch { continue; } // unsupported filter (e.g. JPX) — leave untouched
      const rewritten = rewriteColorOps(text, opts);
      if (rewritten === text) continue;
      const fresh = doc.context.flateStream(rewritten);
      stream.dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
      // stale params from the previous filter chain would corrupt the stream
      stream.dict.delete(PDFName.of("DecodeParms"));
      stream.dict.delete(PDFName.of("DP"));
      stream.dict.set(PDFName.of("Length"), doc.context.obj(fresh.contents.length));
      stream.contents = fresh.contents;
    }

    // 2. dark background under everything + transformed default colour.
    // The default graphics state is black, so text with no explicit colour
    // operator needs the light default set up front or it stays invisible.
    page.node.normalize();
    const { width, height } = page.getSize();
    const prologue =
      `q ${fmt(bg[0])} ${fmt(bg[1])} ${fmt(bg[2])} rg ` +
      `0 0 ${fmt(width)} ${fmt(height)} re f Q\n` +
      `${fmt(fg[0])} ${fmt(fg[1])} ${fmt(fg[2])} rg ` +
      `${fmt(fg[0])} ${fmt(fg[1])} ${fmt(fg[2])} RG\n`;
    const startRef = doc.context.register(doc.context.flateStream(prologue));
    const endRef = doc.context.register(doc.context.flateStream("\n"));
    if (!page.node.wrapContentStreams(startRef, endRef)) {
      // page had no /Contents at all: install the prologue as its content
      page.node.set(PDFName.of("Contents"), doc.context.obj([startRef, endRef]));
    }
  }

  return await doc.save();
}

export { darkenPdf, rewriteColorOps, transformRgb };
