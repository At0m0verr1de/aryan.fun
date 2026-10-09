// Synthetic Wordle screenshots → parser. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePixels, parseShareText } from './parse.js';

const THEMES = {
  dark: { bg: [18, 18, 19], G: [83, 141, 78], Y: [181, 159, 59], B: [58, 58, 60], empty: [58, 58, 60], key: [129, 131, 132], letter: [255, 255, 255] },
  light: { bg: [255, 255, 255], G: [106, 170, 100], Y: [201, 180, 88], B: [120, 124, 126], empty: [211, 214, 218], key: [211, 214, 218], letter: [255, 255, 255] },
  contrast: { bg: [18, 18, 19], G: [245, 121, 58], Y: [133, 192, 249], B: [58, 58, 60], empty: [58, 58, 60], key: [129, 131, 132], letter: [255, 255, 255] },
};

function makeImage({ w, h, theme, rows, tile, gap, top, keyboard = true, noise = 6 }) {
  const t = THEMES[theme];
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = c[0] + (rand() - 0.5) * noise;
    data[i + 1] = c[1] + (rand() - 0.5) * noise;
    data[i + 2] = c[2] + (rand() - 0.5) * noise;
    data[i + 3] = 255;
  };
  const rect = (x0, y0, rw, rh, c) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) px(x, y, c);
  };
  const outline = (x0, y0, s, c) => {
    rect(x0, y0, s, 2, c); rect(x0, y0 + s - 2, s, 2, c);
    rect(x0, y0, 2, s, c); rect(x0 + s - 2, y0, 2, s, c);
  };
  rect(0, 0, w, h, t.bg);
  rect(10, 10, 10, 10, t.B); // header icon
  const left = Math.round((w - (5 * tile + 4 * gap)) / 2);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const x = left + c * (tile + gap);
      const y = top + r * (tile + gap);
      if (r < rows.length) {
        rect(x, y, tile, tile, t[rows[r][c]]);
        rect(x + Math.round(tile * 0.35), y + Math.round(tile * 0.25), Math.round(tile * 0.3), Math.round(tile * 0.5), t.letter);
      } else {
        outline(x, y, tile, t.empty);
      }
    }
  }
  if (keyboard) {
    const kw = Math.round(tile * 0.55);
    const kh = Math.round(tile * 0.8);
    const ky = top + 6 * (tile + gap) + tile;
    const colors = ['G', 'Y', 'B', 'key', 'key', 'B', 'G', 'key', 'Y', 'key'];
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 10; k++) {
        const c = colors[(k + row) % colors.length];
        rect(4 + k * (kw + 4), ky + row * (kh + 6), kw, kh, c === 'key' ? t.key : t[c]);
      }
    }
  }
  return { data, w, h };
}

const cases = [
  { name: 'phone dark, solved in 4', img: { w: 416, h: 900, theme: 'dark', tile: 64, gap: 5, top: 150, rows: ['BYBBB', 'BGYBB', 'GGBYG', 'GGGGG'] }, expect: { solved: true, guesses: 4 } },
  { name: 'phone light, failed (X)', img: { w: 416, h: 900, theme: 'light', tile: 64, gap: 5, top: 150, rows: ['BBBBB', 'YBBBB', 'GBYBB', 'GGBBY', 'GGGBY', 'GGGGB'] }, expect: { solved: false, guesses: null, confidence: 'high' } },
  { name: 'high contrast, solved in 2', img: { w: 416, h: 900, theme: 'contrast', tile: 64, gap: 5, top: 150, rows: ['YBBYB', 'GGGGG'] }, expect: { solved: true, guesses: 2 } },
  { name: 'desktop dark, tiny tiles, solved in 3', img: { w: 900, h: 506, theme: 'dark', tile: 29, gap: 2, top: 40, rows: ['BBYBB', 'GYBBG', 'GGGGG'] }, expect: { solved: true, guesses: 3 } },
  { name: 'solved in 1, no keyboard', img: { w: 416, h: 600, theme: 'light', tile: 64, gap: 5, top: 100, rows: ['GGGGG'], keyboard: false }, expect: { solved: true, guesses: 1 } },
  { name: 'unfinished game', img: { w: 416, h: 900, theme: 'dark', tile: 64, gap: 5, top: 150, rows: ['BYBBB', 'BGYBB'] }, expect: { solved: false, confidence: 'low' } },
];

for (const c of cases) {
  test(c.name, () => {
    const { data, w, h } = makeImage(c.img);
    const got = parsePixels(data, w, h);
    assert.equal(got.ok, true);
    assert.deepEqual(got.grid, c.img.rows);
    for (const [k, v] of Object.entries(c.expect)) assert.equal(got[k], v, k);
  });
}

// Keeps only image rows [top, bottom): what a cropped screenshot looks like.
function crop({ data, w }, top, bottom) {
  return { data: data.slice(top * w * 4, bottom * w * 4), w, h: bottom - top };
}

const SOLVED_IN_5 = ['BYYBB', 'BYBYG', 'GGBGG', 'GGBGG', 'GGGGG'];
const pitch = 64 + 5;
const rowTop = (r) => 150 + r * pitch;
const cropCases = [
  { name: 'top rows cropped off a 5-guess board', rows: SOLVED_IN_5, from: rowTop(3) - 3, to: 900 },
  { name: 'empty rows cropped off the bottom', rows: SOLVED_IN_5, from: 0, to: rowTop(5) - 3 },
  { name: 'only the last three rows of a 6-guess board', rows: ['BBBBB', 'YBBBB', 'GBYBB', 'GGBBY', 'GGGBY', 'GGGGG'], from: rowTop(3) - 3, to: 900 },
  { name: 'last row cut in half', rows: SOLVED_IN_5, from: 0, to: rowTop(5) + 30 },
];
for (const c of cropCases) {
  test(`cropped board is rejected: ${c.name}`, () => {
    const img = crop(makeImage({ w: 416, h: 900, theme: 'light', tile: 64, gap: 5, top: 150, rows: c.rows }), c.from, c.to);
    const got = parsePixels(img.data, img.w, img.h);
    assert.equal(got.ok, false);
    assert.equal(got.cropped, true);
  });
}

test('a tight crop that keeps all 6 rows still reads', () => {
  for (const theme of ['light', 'dark', 'contrast']) {
    const img = crop(makeImage({ w: 416, h: 900, theme, tile: 64, gap: 5, top: 150, rows: SOLVED_IN_5 }), rowTop(0) - 4, rowTop(6) + 2);
    const got = parsePixels(img.data, img.w, img.h);
    assert.equal(got.ok, true, theme);
    assert.equal(got.guesses, 5, theme);
  }
});

test('empty board is rejected', () => {
  const blank = makeImage({ w: 416, h: 900, theme: 'dark', tile: 64, gap: 5, top: 150, rows: [], keyboard: false });
  assert.equal(parsePixels(blank.data, blank.w, blank.h).ok, false);
});

test('share text', () => {
  const s = parseShareText('Wordle 1,936 3/6*\n\n⬛🟨⬛⬛⬛\n🟩🟩⬛🟨⬛\n🟩🟩🟩🟩🟩');
  assert.equal(s.puzzle, 1936);
  assert.equal(s.guesses, 3);
  assert.deepEqual(s.grid, ['BYBBB', 'GGBYB', 'GGGGG']);
});

test('share text X + high contrast', () => {
  const s = parseShareText('Wordle 1.930 X/6\n🟦⬜⬜⬜⬜\n🟧🟧⬜⬜🟦\n🟧🟧🟧⬜⬜\n🟧🟧🟧⬜⬜\n🟧🟧🟧🟧⬜\n🟧🟧🟧🟧⬜');
  assert.equal(s.puzzle, 1930);
  assert.equal(s.solved, false);
  assert.equal(s.grid.length, 6);
  assert.equal(s.grid[0], 'YBBBB');
});

test('not wordle text', () => {
  assert.equal(parseShareText('hello'), null);
});
