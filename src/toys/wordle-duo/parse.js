// Reads a Wordle board out of a screenshot's pixels, or out of pasted share text.
// Works for NYT web + app, light/dark mode, and high-contrast mode.
// k: 1 = correct (green / orange), 2 = present (yellow / blue), 3 = absent (gray)
const PALETTE = [
  { k: 1, rgb: [106, 170, 100] }, // light green
  { k: 1, rgb: [83, 141, 78] },   // dark green
  { k: 1, rgb: [245, 121, 58] },  // high-contrast orange
  { k: 2, rgb: [201, 180, 88] },  // light yellow
  { k: 2, rgb: [181, 159, 59] },  // dark yellow
  { k: 2, rgb: [133, 192, 249] }, // high-contrast blue
  { k: 3, rgb: [120, 124, 126] }, // light gray
  { k: 3, rgb: [58, 58, 60] },    // dark gray
];
const MAX_COLOR_DIST = 40;
const LETTERS = '.GYB';
const ROWS = 6;
const EMPTY_OUTLINE_MIN = 45; // NYT's empty-tile border is ~40 per channel off the page colour

function classify(r, g, b) {
  let best = 0;
  let bestDist = Infinity;
  for (const p of PALETTE) {
    const dr = r - p.rgb[0];
    const dg = g - p.rgb[1];
    const db = b - p.rgb[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = p.k;
    }
  }
  return bestDist < MAX_COLOR_DIST * MAX_COLOR_DIST ? best : 0;
}

// Connected blobs of same-class pixels (4-neighbour flood fill).
function findBlobs(cls, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    const k = cls[i];
    if (!k || label[i]) continue;
    id++;
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    let minX = w, maxX = 0, minY = h, maxY = 0, count = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p / w) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ];
      for (const q of neighbours) {
        if (q >= 0 && !label[q] && cls[q] === k) {
          label[q] = id;
          stack[sp++] = q;
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    blobs.push({ k, x: minX, y: minY, w: bw, h: bh, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, fill: count / (bw * bh) });
  }
  return blobs;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Square, mostly-filled blobs are board tiles; keyboard keys are taller than wide,
// empty tiles are hollow outlines, letters and icons are too small.
function pickTiles(blobs) {
  const squares = blobs.filter(
    (b) => b.w >= 12 && b.h >= 12 && b.w / b.h > 0.8 && b.w / b.h < 1.25 && b.fill > 0.45,
  );
  let best = [];
  for (const t of squares) {
    const group = squares.filter((u) => Math.abs(u.w - t.w) <= t.w * 0.15);
    if (group.length > best.length || (group.length === best.length && best.length && t.w > best[0].w)) {
      best = group;
    }
  }
  return best;
}

function groupRows(tiles, size) {
  const sorted = [...tiles].sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const t of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(t.cy - last.cy) < size * 0.5) {
      last.tiles.push(t);
      last.cy = last.tiles.reduce((s, u) => s + u.cy, 0) / last.tiles.length;
    } else {
      rows.push({ cy: t.cy, tiles: [t] });
    }
  }
  return rows
    .filter((r) => r.tiles.length === 5)
    .map((r) => ({ ...r, tiles: [...r.tiles].sort((a, b) => a.cx - b.cx) }))
    .filter((r) => {
      for (let i = 1; i < 5; i++) {
        const gap = r.tiles[i].cx - r.tiles[i - 1].cx;
        if (gap < size * 0.95 || gap > size * 1.45) return false;
      }
      return true;
    });
}

// Longest run of evenly stacked, column-aligned rows = the board.
function longestBoardRun(rows, size) {
  let best = [];
  let run = [];
  for (const r of rows) {
    const prev = run[run.length - 1];
    const stacked = prev && r.cy - prev.cy >= size * 0.9 && r.cy - prev.cy <= size * 1.5;
    const aligned = prev && Math.abs(r.tiles[0].cx - run[0].tiles[0].cx) <= size * 0.35;
    run = stacked && aligned ? [...run, r] : [r];
    if (run.length > best.length) best = run;
  }
  return best;
}

// Summed RGB distance from the slot's centre colour to its edge, at the inset where the outline is strongest.
function outlineContrast(data, w, { x, y, w: tw, h: th }) {
  const at = (px, py) => (py * w + px) * 4;
  const inner = [0, 0, 0];
  let n = 0;
  for (let py = y + Math.round(th * 0.3); py < y + th * 0.7; py++) {
    for (let px = x + Math.round(tw * 0.3); px < x + tw * 0.7; px++, n++) {
      for (let c = 0; c < 3; c++) inner[c] += data[at(px, py) + c];
    }
  }
  for (let c = 0; c < 3; c++) inner[c] /= n;
  let best = 0;
  for (let d = 0; d <= 3; d++) {
    let sum = 0;
    let count = 0;
    const edge = (px, py) => {
      const i = at(px, py);
      sum += Math.abs(data[i] - inner[0]) + Math.abs(data[i + 1] - inner[1]) + Math.abs(data[i + 2] - inner[2]);
      count++;
    };
    for (let px = x + d; px < x + tw - d; px++) { edge(px, y + d); edge(px, y + th - 1 - d); }
    for (let py = y + d; py < y + th - d; py++) { edge(x + d, py); edge(x + tw - 1 - d, py); }
    best = Math.max(best, sum / count);
  }
  return best;
}

// A real board always shows all 6 rows; unplayed ones are empty outlined squares.
// Counts the empty rows under the last guess, so a cropped board can't pass as a shorter game.
function emptyRowsBelow(data, w, h, last, wanted) {
  const pitch = (last.tiles[4].cx - last.tiles[0].cx) / 4;
  let found = 0;
  for (let k = 1; k <= wanted; k++) {
    const slots = last.tiles.map((t) => ({ x: t.x, y: Math.round(t.y + pitch * k), w: t.w, h: t.h }));
    const inside = slots.every((s) => s.y >= 0 && s.y + s.h <= h && s.x >= 0 && s.x + s.w <= w);
    if (!inside || !slots.every((s) => outlineContrast(data, w, s) > EMPTY_OUTLINE_MIN)) break;
    found++;
  }
  return found;
}

function summarise(grid, source) {
  const solvedAt = grid.indexOf('GGGGG');
  if (solvedAt >= 0) {
    return { ok: true, grid: grid.slice(0, solvedAt + 1), guesses: solvedAt + 1, solved: true, confidence: 'high', source };
  }
  if (grid.length === 6) {
    return { ok: true, grid, guesses: null, solved: false, confidence: 'high', source };
  }
  return {
    ok: true, grid, guesses: null, solved: false, confidence: 'low', source,
    note: `Found ${grid.length} row${grid.length === 1 ? '' : 's'} but no win — is the game finished?`,
  };
}

// data: RGBA bytes (canvas ImageData.data), already downscaled to ~900px max side.
export function parsePixels(data, w, h) {
  const cls = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    cls[i] = classify(data[p], data[p + 1], data[p + 2]);
  }
  const tiles = pickTiles(findBlobs(cls, w, h));
  if (tiles.length < 5) {
    return { ok: false, note: "Couldn't spot a Wordle board. Close the stats popup and screenshot the grid." };
  }
  const size = median(tiles.map((t) => t.w));
  const board = longestBoardRun(groupRows(tiles, size), size);
  if (!board.length) {
    return { ok: false, note: "Couldn't line up the tiles into rows. Try a clearer screenshot of the whole board." };
  }
  const rows = board.slice(0, 6);
  const grid = rows.map((r) => r.tiles.map((t) => LETTERS[t.k]).join(''));
  const result = summarise(grid, 'screenshot');
  const played = rows.slice(0, result.grid.length);
  if (played.length < ROWS && emptyRowsBelow(data, w, h, played[played.length - 1], ROWS - played.length) < ROWS - played.length) {
    return { ok: false, cropped: true, note: 'Show the whole board: all 6 rows, including the empty ones under your last guess.' };
  }
  // Tile rectangles (same shape as grid) so letters can be read out of them.
  result.boxes = played.map((r) => r.tiles.map(({ x, y, w: tw, h: th }) => ({ x, y, w: tw, h: th })));
  return result;
}

const EMOJI = { '🟩': 'G', '🟧': 'G', '🟨': 'Y', '🟦': 'Y', '⬛': 'B', '⬜': 'B' };

// "Wordle 1,936 3/6*" + emoji rows.
export function parseShareText(text) {
  const clean = text.replace(/️/g, '');
  const m = clean.match(/Wordle\s+([\d.,\s]+?)\s+([1-6X])\/6/i);
  if (!m) return null;
  const puzzle = parseInt(m[1].replace(/\D/g, ''), 10);
  const grid = clean
    .split(/\r?\n/)
    .map((line) => [...line.trim()])
    .filter((chars) => chars.length === 5 && chars.every((c) => EMOJI[c]))
    .map((chars) => chars.map((c) => EMOJI[c]).join(''));
  const solved = m[2].toUpperCase() !== 'X';
  return {
    ok: true, puzzle, grid, solved,
    guesses: solved ? Number(m[2]) : null,
    confidence: 'high', source: 'text',
  };
}
