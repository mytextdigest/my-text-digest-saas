// src/lib/slides/gradientRaster.js
// PPTX export has no native gradient-fill support (pptxgenjs's ShapeFillProps
// only supports "none"|"solid") — a gradient background is exported by
// rasterizing to a PNG and using it as a slide background IMAGE instead of a
// fill. Desktop does this via `sharp` + an SVG `<linearGradient>`. This repo
// has no `sharp`; a 2-stop linear gradient is just per-pixel color
// interpolation along an angle, so this is pure `pngjs` pixel math instead
// of a real SVG rasterizer (unlike icons.js, which genuinely needs one for
// arbitrary Lucide icon paths).
//
// Same angle -> gradient-line math as the desktop SVG version (standard
// CSS-gradient-angle convention: 0deg points up, angle increases clockwise,
// coordinates in 0-100 percentage space, "pad" spread at both ends) so the
// exported file's gradient matches what the desktop version already
// produced, pixel-for-pixel logic — just evaluated directly instead of
// handed to an SVG renderer.

import { PNG } from "pngjs";

const SLIDE_W = 13.3;
const SLIDE_H = 7.5;

function hexToRgb(hex) {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// Cached by "angle:stopA:stopB" — a deck rebuild happens on every single
// synchronous edit route (theme/reorder/duplicate/...), so without this the
// same background gets re-rasterized on every save.
const gradientRasterCache = new Map();

export function gradientToBase64Png(angle, stops) {
  const cacheKey = `${angle}:${stops[0]}:${stops[1]}`;
  if (gradientRasterCache.has(cacheKey)) return gradientRasterCache.get(cacheKey);

  try {
    const rad = ((angle - 90) * Math.PI) / 180;
    // Gradient line endpoints in 0-100 percentage space — same conversion
    // the desktop SVG version used.
    const x1 = 50 - Math.cos(rad) * 50, y1 = 50 - Math.sin(rad) * 50;
    const x2 = 50 + Math.cos(rad) * 50, y2 = 50 + Math.sin(rad) * 50;

    const w = 1600, h = Math.round((w * SLIDE_H) / SLIDE_W);
    const [rA, gA, bA] = hexToRgb(stops[0]);
    const [rB, gB, bB] = hexToRgb(stops[1]);

    const abx = x2 - x1, aby = y2 - y1;
    const abLenSq = abx * abx + aby * aby || 1;

    const png = new PNG({ width: w, height: h, filterType: -1 });
    for (let py = 0; py < h; py++) {
      const yPct = (py / (h - 1)) * 100;
      for (let px = 0; px < w; px++) {
        const xPct = (px / (w - 1)) * 100;
        // Project this pixel onto the gradient line, clamped to [0,1] —
        // "pad" spread method, matching SVG's default.
        let t = ((xPct - x1) * abx + (yPct - y1) * aby) / abLenSq;
        t = Math.min(1, Math.max(0, t));
        const idx = (w * py + px) << 2;
        png.data[idx] = Math.round(rA + (rB - rA) * t);
        png.data[idx + 1] = Math.round(gA + (gB - gA) * t);
        png.data[idx + 2] = Math.round(bA + (bB - bA) * t);
        png.data[idx + 3] = 255;
      }
    }

    const pngBuffer = PNG.sync.write(png);
    const dataUri = "image/png;base64," + pngBuffer.toString("base64");
    gradientRasterCache.set(cacheKey, dataUri);
    return dataUri;
  } catch (err) {
    console.error("gradientToBase64Png error:", err.message || err);
    return null;
  }
}
