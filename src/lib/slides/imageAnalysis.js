// src/lib/slides/imageAnalysis.js
// Decodes an uploaded brand-logo/slide image (PNG or JPEG) to raw RGBA
// pixels and extracts a few dominant colors — sharp-free, matching this
// port's existing posture (worker/imageUtils.js already decodes
// PDF-embedded images without sharp; this covers the separate case of a
// standalone uploaded file, which that path never has to handle). `pngjs`
// (already a dependency) covers PNG; `jpeg-js` (pure JS, no native binary)
// covers JPEG.

import { PNG } from "pngjs";
import jpeg from "jpeg-js";

export function decodeImageBuffer(buffer, contentType) {
  if (contentType === "image/png") {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    const { width, height, data } = jpeg.decode(buffer, { useTArray: true });
    return { width, height, data };
  }
  throw new Error(`Unsupported image type for decoding: ${contentType}`);
}

// A plain quantize-and-bucket scan (per the feature spec's own "plain
// average/k-means-ish scan is sufficient" guidance) — round each channel to
// 32 levels (8 bits -> 5 bits), count buckets, return the most frequent
// `count` buckets as hex, skipping near-white/near-black ones (a logo's
// transparent/white background dominates by pixel count but is never a
// useful "brand color" swatch).
export function extractDominantColors(rgba, count = 3) {
  const buckets = new Map();
  const QUANT = 8; // 256 / 32 levels per channel

  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a < 128) continue; // skip transparent pixels
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    // Skip near-white and near-black — dominant by area on most logos, but
    // not a meaningful brand-color swatch.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance > 0.92 || luminance < 0.08) continue;

    const key = `${Math.round(r / QUANT)}:${Math.round(g / QUANT)}:${Math.round(b / QUANT)}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const toHex = (n) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();

  return sorted.slice(0, count).map((bucket) => {
    const r = bucket.r / bucket.count, g = bucket.g / bucket.count, b = bucket.b / bucket.count;
    return `${toHex(r)}${toHex(g)}${toHex(b)}`;
  });
}
