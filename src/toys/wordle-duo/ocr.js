// Reads the letter in each Wordle tile by comparing it with reference letters drawn in a similar bold font.
// Works on raw RGBA pixels so it runs in the browser and in tests. Letters on played tiles are white in
// every Wordle theme, so "ink" is any bright, unsaturated pixel.

export const GLYPH = 20;          // letters are compared as GLYPH x GLYPH grids
const INSET = 0.08;               // skip the tile's outer edge (borders, rounded corners)
const INK_LO = 150;               // min(r, g, b) below this is tile colour, above INK_HI is letter
const INK_HI = 225;
const MIN_INK_SHARE = 0.015;      // less ink than this = blank tile
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Normalised ink grid for one tile, or null if the tile is blank.
export function glyphVector(data, width, box) {
  const x0 = Math.round(box.x + box.w * INSET);
  const y0 = Math.round(box.y + box.h * INSET);
  const w = Math.max(1, Math.round(box.w * (1 - 2 * INSET)));
  const h = Math.max(1, Math.round(box.h * (1 - 2 * INSET)));
  const ink = new Float32Array(w * h);
  let minX = w, minY = h, maxX = -1, maxY = -1, total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y0 + y) * width + (x0 + x)) * 4;
      const v = clamp01((Math.min(data[p], data[p + 1], data[p + 2]) - INK_LO) / (INK_HI - INK_LO));
      ink[y * w + x] = v;
      total += v;
      if (v > 0.5) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || total < w * h * MIN_INK_SHARE) return null;

  // Fit the letter's bounding box into a square, centred, keeping its proportions (so I stays thin).
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const side = Math.max(bw, bh);
  const ox = minX - (side - bw) / 2;
  const oy = minY - (side - bh) / 2;
  const out = new Float32Array(GLYPH * GLYPH);
  const step = side / GLYPH;
  const sub = Math.max(1, Math.min(4, Math.ceil(step)));
  for (let gy = 0; gy < GLYPH; gy++) {
    for (let gx = 0; gx < GLYPH; gx++) {
      let sum = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const x = Math.floor(ox + (gx + (sx + 0.5) / sub) * step);
          const y = Math.floor(oy + (gy + (sy + 0.5) / sub) * step);
          if (x >= 0 && y >= 0 && x < w && y < h) sum += ink[y * w + x];
        }
      }
      out[gy * GLYPH + gx] = sum / (sub * sub);
    }
  }
  return normalise(out);
}

function normalise(v) {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

// templates: letter -> array of glyph vectors (several fonts). render(letter, font) -> { data, width, box }.
export function buildTemplates(render, fonts) {
  const templates = {};
  for (const letter of LETTERS) {
    templates[letter] = fonts.map((font) => {
      const { data, width, box } = render(letter, font);
      return glyphVector(data, width, box);
    }).filter(Boolean);
  }
  return templates;
}

// How much a tile looks like each of A..Z (cosine similarity, best over the reference fonts).
export function scoreGlyph(vec, templates) {
  const scores = new Float32Array(26);
  if (!vec) return scores;
  for (let l = 0; l < 26; l++) {
    let best = -1;
    for (const t of templates[LETTERS[l]]) best = Math.max(best, dot(vec, t));
    scores[l] = best;
  }
  return scores;
}

// Glyph vectors for every tile of a parsed board.
export const readGlyphs = (data, width, boxes) => boxes.map((row) => row.map((box) => glyphVector(data, width, box)));

export const scoreBoard = (glyphs, templates) => glyphs.map((row) => row.map((vec) => scoreGlyph(vec, templates)));

// Once the answer is confirmed, green tiles show its letters in the screenshot's own font: add them as references.
export function learnFromGreens(templates, glyphs, grid, answer) {
  const learned = Object.fromEntries(Object.entries(templates).map(([l, list]) => [l, [...list]]));
  grid.forEach((row, r) => {
    for (let c = 0; c < 5; c++) if (row[c] === 'G' && glyphs[r][c]) learned[answer[c]].push(glyphs[r][c]);
  });
  return learned;
}

// Reference letters drawn with the browser's own fonts.
export function browserRenderer() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (letter, font) => {
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(size * 0.55)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2);
    return { data: ctx.getImageData(0, 0, size, size).data, width: size, box: { x: 0, y: 0, w: size, h: size } };
  };
}

// Font stacks close to Wordle's tile lettering on common systems.
export const REFERENCE_FONTS = [
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  '"Segoe UI", Roboto, "Noto Sans", "DejaVu Sans", sans-serif',
  'Verdana, "DejaVu Sans", sans-serif',
];
