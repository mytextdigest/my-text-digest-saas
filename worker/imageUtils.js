// worker/imageUtils.js
// Shared pdfjs pixel-data → PNG conversion, extracted out of runOcr.js so
// extractFigures.js can reuse the exact same proven logic without duplicating it.

import { PNG } from "pngjs";

// ImageKind constants (not exported by pdfjs-dist display layer, defined here)
export const ImageKind = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 };

export function pixelDataToPngBuffer(imgData) {
  const { width, height, data, kind } = imgData;
  const png = new PNG({ width, height, filterType: -1 });

  if (kind === ImageKind.RGBA_32BPP) {
    // 4 bytes per pixel — use directly
    png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else if (kind === ImageKind.RGB_24BPP) {
    // 3 bytes per pixel → expand to RGBA
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 255;
    }
    png.data = rgba;
  } else if (kind === ImageKind.GRAYSCALE_1BPP) {
    // 1 bit per pixel (packed) → RGBA
    const pixelCount = width * height;
    const rgba = Buffer.alloc(pixelCount * 4);
    for (let p = 0; p < pixelCount; p++) {
      const bit = (data[Math.floor(p / 8)] >> (7 - (p % 8))) & 1;
      const val = bit ? 255 : 0;
      rgba[p * 4] = val;
      rgba[p * 4 + 1] = val;
      rgba[p * 4 + 2] = val;
      rgba[p * 4 + 3] = 255;
    }
    png.data = rgba;
  } else {
    // Treat unknown kinds as RGBA if byte count matches
    const expectedRgba = width * height * 4;
    if (data.length === expectedRgba) {
      png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else {
      throw new Error(`Unsupported image kind: ${kind} (data length ${data.length})`);
    }
  }

  return PNG.sync.write(png);
}
