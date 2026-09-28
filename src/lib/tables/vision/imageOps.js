// src/lib/tables/vision/imageOps.js
// Image preparation for vision table reading, in pure JS on pngjs/jpeg-js
// (no sharp or canvas here). Replaces the pixel work of desktop
// vision/render.js; the algorithm is the same: an OCR copy (small images
// upscaled, binarised with Otsu, ruling lines erased) and a model copy
// capped at 2048 px. Only the pixel I/O differs.
//
// WebP, GIF and BMP have no pure-JS decoder here: those buffers skip
// preprocessing and go to Tesseract (which decodes them) and to the model
// as they are.
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const OCR_TARGET_WIDTH = 1400;
const OCR_MAX_UPSCALE = 3;
const MODEL_MAX_SIDE = 2048;

export function sniffFormat(buf) {
  if (!buf || buf.length < 12) return "other";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
  return "other";
}

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };

// → { width, height, data: RGBA Buffer } or null when there is no decoder.
export function decodeImage(buf) {
  const fmt = sniffFormat(buf);
  try {
    if (fmt === "png") {
      const png = PNG.sync.read(buf);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (fmt === "jpeg") {
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
      return { width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
    }
  } catch (err) {
    console.warn(`⚠️  [tables] Could not decode ${fmt} image:`, err.message || err);
  }
  return null;
}

// RGBA → RGB flattened onto white (sharp .flatten({ background: "#ffffff" })).
function flattenRgb({ width, height, data }) {
  const out = Buffer.alloc(width * height * 3);
  for (let p = 0, i = 0, o = 0; p < width * height; p++, i += 4, o += 3) {
    const a = data[i + 3] / 255;
    out[o] = Math.round(data[i] * a + 255 * (1 - a));
    out[o + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
    out[o + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
  }
  return out;
}

// RGB → one-channel luminance (Rec. 709 weights, as libvips "b-w").
function toGrey(rgb, width, height) {
  const out = Buffer.alloc(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 3) {
    out[p] = Math.round(0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]);
  }
  return out;
}

// Resamples an interleaved image with `channels` bytes per pixel. Bilinear
// when enlarging; area-average when shrinking (so thin strokes don't alias).
export function resize(src, width, height, channels, newWidth, newHeight) {
  const out = Buffer.alloc(newWidth * newHeight * channels);
  const sx = width / newWidth;
  const sy = height / newHeight;
  if (sx <= 1 && sy <= 1) {
    for (let y = 0; y < newHeight; y++) {
      const fy = Math.max(0, Math.min(height - 1, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(height - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < newWidth; x++) {
        const fx = Math.max(0, Math.min(width - 1, (x + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(width - 1, x0 + 1), wx = fx - x0;
        for (let c = 0; c < channels; c++) {
          const a = src[(y0 * width + x0) * channels + c], b = src[(y0 * width + x1) * channels + c];
          const d = src[(y1 * width + x0) * channels + c], e = src[(y1 * width + x1) * channels + c];
          const top = a + (b - a) * wx, bottom = d + (e - d) * wx;
          out[(y * newWidth + x) * channels + c] = Math.round(top + (bottom - top) * wy);
        }
      }
    }
    return out;
  }
  const acc = new Float64Array(channels);
  for (let y = 0; y < newHeight; y++) {
    const ya = Math.floor(y * sy), yb = Math.max(ya + 1, Math.min(height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < newWidth; x++) {
      const xa = Math.floor(x * sx), xb = Math.max(xa + 1, Math.min(width, Math.floor((x + 1) * sx)));
      acc.fill(0);
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          const i = (yy * width + xx) * channels;
          for (let c = 0; c < channels; c++) acc[c] += src[i + c];
        }
      }
      const n = (yb - ya) * (xb - xa);
      for (let c = 0; c < channels; c++) out[(y * newWidth + x) * channels + c] = Math.round(acc[c] / n);
    }
  }
  return out;
}

function encodePng(pixels, width, height, channels) {
  const png = new PNG({ width, height });
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    rgba[p * 4] = pixels[i];
    rgba[p * 4 + 1] = channels === 1 ? pixels[i] : pixels[i + 1];
    rgba[p * 4 + 2] = channels === 1 ? pixels[i] : pixels[i + 2];
    rgba[p * 4 + 3] = 255;
  }
  png.data = rgba;
  return PNG.sync.write(png);
}

// Otsu threshold of a greyscale histogram.
export function otsu(pixels) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < pixels.length; i++) hist[pixels[i]]++;
  const total = pixels.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

// Whitens every run of dark pixels longer than `minRun` along one axis.
export function eraseRuns(bin, width, height, minRun, horizontal) {
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const at = horizontal ? (o, i) => o * width + i : (o, i) => i * width + o;
  for (let o = 0; o < outer; o++) {
    let start = -1;
    for (let i = 0; i <= inner; i++) {
      const dark = i < inner && bin[at(o, i)] === 0;
      if (dark && start < 0) start = i;
      else if (!dark && start >= 0) {
        if (i - start >= minRun) for (let k = start; k < i; k++) bin[at(o, k)] = 255;
        start = -1;
      }
    }
  }
}

// Tesseract garbles ruled tables: cell borders read as "|", "]" or merge
// into digits, and shaded header cells drop out. The OCR copy is therefore
// binarised (which also removes light shading) and long horizontal and
// vertical runs — ruling lines — are erased. Runs are measured against the
// text height the upscale aims for (~25-35 px), so letters survive.
// Takes a greyscale buffer; returns the binarised buffer (callers encode).
export function cleanForOcr(grey, width, height) {
  const t = otsu(grey);
  const bin = Buffer.alloc(width * height);
  for (let i = 0; i < bin.length; i++) bin[i] = grey[i] <= t ? 0 : 255;
  eraseRuns(bin, width, height, Math.max(70, Math.round(width * 0.05)), true);
  eraseRuns(bin, width, height, Math.max(70, Math.round(height * 0.03)), false);
  return bin;
}

// Two copies of one image: an OCR copy (small images upscaled so digits are
// ~20px tall, cleaned of ruling lines) and a model copy capped at 2048 px,
// the largest size the vision API uses at detail "high". Same shape as the
// desktop's prepareImage, plus modelMime (not always PNG here).
export function prepareImage(buffer) {
  const img = decodeImage(buffer);
  if (!img) {
    const fmt = sniffFormat(buffer);
    return { ocr: buffer, model: buffer, modelMime: MIME[fmt] || "image/png", width: 0, height: 0 };
  }
  const { width, height } = img;
  const rgb = flattenRgb(img);

  const factor = width && width < OCR_TARGET_WIDTH ? Math.min(OCR_MAX_UPSCALE, OCR_TARGET_WIDTH / width) : 1;
  let grey = toGrey(rgb, width, height);
  let ow = width, oh = height;
  if (factor > 1) {
    ow = Math.round(width * factor);
    oh = Math.round(height * (ow / width));
    grey = resize(grey, width, height, 1, ow, oh);
  }
  const ocr = encodePng(cleanForOcr(grey, ow, oh), ow, oh, 1);

  let model;
  if (Math.max(width, height) > MODEL_MAX_SIDE) {
    const s = MODEL_MAX_SIDE / Math.max(width, height);
    const mw = Math.max(1, Math.round(width * s)), mh = Math.max(1, Math.round(height * s));
    model = encodePng(resize(rgb, width, height, 3, mw, mh), mw, mh, 3);
  } else {
    model = encodePng(rgb, width, height, 3);
  }
  return { ocr, model, modelMime: "image/png", width: ow, height: oh };
}
