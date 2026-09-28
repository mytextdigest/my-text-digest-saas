// SaaS-only tests (no desktop counterpart): the pdfjs 2.16 text layer this
// repo ships, and the pure-JS image preprocessing that replaces sharp.
import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { PNG } from "pngjs";
import { openPdf, readPage, collectRulings } from "../pdf/textLayer.js";
import { otsu, eraseRuns, cleanForOcr, prepareImage, sniffFormat } from "../vision/imageOps.js";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const FIXTURES = path.join(import.meta.dirname, "fixtures");

// Per page "horizontal/vertical rulings/words", as the desktop (pdfjs 3.11)
// reads the same fixtures. Rulings drive the grid for bordered tables.
const DESKTOP_PAGES = {
  annual_report_2025: ["5/4/278", "18/9/220", "25/5/122", "25/5/122", "3/5/98"],
  annual_report_2024: ["5/4/279", "18/9/215", "25/5/122", "25/5/122", "4/5/103"],
  research_paper: ["10/9/276", "0/0/86"],
};

test("pdfjs 2.16: constructPath args are [ops, coords, minMax]", async () => {
  const pdf = await openPdf(fs.readFileSync(path.join(FIXTURES, "annual_report_2025.pdf")));
  const page = await pdf.getPage(2);
  const { fnArray, argsArray } = await page.getOperatorList();
  const i = fnArray.indexOf(pdfjsLib.OPS.constructPath);
  assert.ok(i >= 0, "no constructPath on a ruled page");
  const [ops, coords] = argsArray[i];
  assert.ok(Array.isArray(ops) && ops.every(Number.isInteger));
  assert.ok(coords.length >= 2 && coords.every((n) => typeof n === "number"));
  await pdf.destroy();
});

test("pdfjs 2.16: ruled fixture pages match the desktop's rulings and words", async () => {
  for (const [name, expected] of Object.entries(DESKTOP_PAGES)) {
    const pdf = await openPdf(fs.readFileSync(path.join(FIXTURES, `${name}.pdf`)));
    const got = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await readPage(pdf, p);
      got.push(`${pg.rulings.horizontal.length}/${pg.rulings.vertical.length}/${pg.words.length}`);
    }
    await pdf.destroy();
    assert.deepStrictEqual(got, expected, name);
  }
});

test("collectRulings reads a stroked rectangle as four rules", () => {
  const OPS = pdfjsLib.OPS;
  const viewport = { convertToViewportPoint: (x, y) => [x, 800 - y] };
  const opList = {
    fnArray: [OPS.constructPath, OPS.stroke],
    argsArray: [[[OPS.rectangle], [100, 100, 200, 50], [100, 300, 100, 150]], null],
  };
  const r = collectRulings(opList, viewport);
  assert.strictEqual(r.horizontal.length, 2);
  assert.strictEqual(r.vertical.length, 2);
});

// A white page with a 1 px ruled grid and some glyph-sized strokes.
function ruledImage(width = 800, height = 600) {
  const grey = Buffer.alloc(width * height, 250);
  for (let y = 50; y < height; y += 100) for (let x = 0; x < width; x++) grey[y * width + x] = 10;
  for (let x = 40; x < width; x += 150) for (let y = 0; y < height; y++) grey[y * width + x] = 10;
  const glyphs = [];
  // Vertical and horizontal strokes 25 px long, 3 px thick (a "1" and a "-").
  for (const [gx, gy] of [[100, 70], [300, 170], [500, 270]]) {
    for (let y = gy; y < gy + 25; y++) for (let x = gx; x < gx + 3; x++) { grey[y * width + x] = 20; glyphs.push(y * width + x); }
    for (let y = gy + 30; y < gy + 33; y++) for (let x = gx; x < gx + 25; x++) { grey[y * width + x] = 20; glyphs.push(y * width + x); }
  }
  return { grey, width, height, glyphs };
}

test("imageOps: eraseRuns removes a 1 px ruled grid but keeps 25 px glyph strokes", () => {
  const { grey, width, height, glyphs } = ruledImage();
  const bin = cleanForOcr(grey, width, height);
  // y = 150 is a horizontal rule and x = 490 a vertical one.
  for (let x = 0; x < width; x++) assert.strictEqual(bin[150 * width + x], 255, `h-rule left at x=${x}`);
  // The horizontal pass runs first and cuts vertical rules at every
  // crossing; the 50 px stubs past the outer crossings stay under the 70 px
  // minimum, as on desktop. Everything between them goes.
  for (let y = 50; y <= 550; y++) assert.strictEqual(bin[y * width + 490], 255, `v-rule left at y=${y}`);
  for (const i of glyphs) assert.strictEqual(bin[i], 0, "glyph stroke erased");
});

test("imageOps: eraseRuns uses the desktop thresholds per axis", () => {
  const width = 100, height = 3;
  const bin = Buffer.alloc(width * height, 255);
  for (let x = 0; x < 69; x++) bin[x] = 0; // 69 px: below max(70, 5%)
  for (let x = 0; x < 70; x++) bin[width + x] = 0; // 70 px: erased
  eraseRuns(bin, width, height, 70, true);
  assert.strictEqual(bin[0], 0);
  assert.strictEqual(bin[width], 255);
});

test("imageOps: otsu splits a bimodal histogram between its modes", () => {
  const px = Buffer.concat([Buffer.alloc(6000, 30), Buffer.alloc(4000, 220)]);
  const t = otsu(px);
  assert.ok(t >= 30 && t < 220, `threshold ${t}`);
  const noisy = Buffer.from(Array.from({ length: 20000 }, (_, i) => (i % 2 ? 200 : 60) + ((i * 7919) % 11) - 5));
  const t2 = otsu(noisy);
  assert.ok(t2 >= 65 && t2 < 195, `threshold ${t2}`); // dark is <= t
});

function pngOf(width, height, rgba = [255, 255, 255, 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set(rgba, i * 4);
  return PNG.sync.write(png);
}

test("imageOps: prepareImage upscales small images for OCR and caps the model copy", () => {
  const small = prepareImage(pngOf(700, 300));
  assert.strictEqual(small.width, 1400);
  assert.strictEqual(small.height, 600);
  assert.strictEqual(PNG.sync.read(small.ocr).width, 1400);
  assert.strictEqual(PNG.sync.read(small.model).width, 700);
  assert.strictEqual(small.modelMime, "image/png");

  const big = prepareImage(pngOf(3000, 1500));
  assert.strictEqual(big.width, 3000);
  const m = PNG.sync.read(big.model);
  assert.deepStrictEqual([m.width, m.height], [2048, 1024]);

  // Transparent pixels flatten onto white, not black.
  const clear = prepareImage(pngOf(10, 10, [0, 0, 0, 0]));
  assert.strictEqual(PNG.sync.read(clear.model).data[0], 255);
});

test("imageOps: formats without a pure-JS decoder pass through untouched", () => {
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
  assert.strictEqual(sniffFormat(gif), "gif");
  const r = prepareImage(gif);
  assert.strictEqual(r.ocr, gif);
  assert.strictEqual(r.model, gif);
  assert.strictEqual(r.modelMime, "image/gif");
});
