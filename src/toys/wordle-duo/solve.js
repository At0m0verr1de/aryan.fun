// Wordle rules for reading a board: colour patterns, picking each row's word, and checking a board
// really belongs to a given day's answer. Pure functions; letter images come in as per-tile scores
// (scores[row][col][0..25] = how much the tile looks like A..Z, from ocr.js).

const A = 65;
const ROW_MARGIN = 0.05;     // best word must beat the runner-up by this much (0.04 was the measured safe floor)
const MATCH_AT = 0.7;        // share of evidence that must agree with the answer
const MISMATCH_AT = 0.45;    // at or below this, the board belongs to a different day
const MIN_EVIDENCE = 3;      // too little evidence (e.g. all-gray board) means we can't tell
const NEAR_BEST = 0.04;      // a letter "matches" if it scores within this of the tile's best letter
const WEIGHT = { G: 2, Y: 1, B: 0.5 };

// Wordle's colouring, including repeated letters: greens first, then yellows left to right.
export function pattern(guess, answer) {
  const out = ['B', 'B', 'B', 'B', 'B'];
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = 'G';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] !== 'G' && left[guess[i]]) {
      out[i] = 'Y';
      left[guess[i]]--;
    }
  }
  return out.join('');
}

export function splitWords(packed) {
  const words = new Array(packed.length / 5);
  for (let i = 0; i < words.length; i++) words[i] = packed.slice(i * 5, i * 5 + 5);
  return words;
}

const score = (tile, letter) => tile[letter.charCodeAt(0) - A];
const nearBest = (tile, letter) => score(tile, letter) >= Math.max(...tile) - NEAR_BEST;

// Does this tile's image fit its colour, given the answer? null = tile says nothing either way.
function tileEvidence(tile, colour, answer, i) {
  if (!tile || Math.max(...tile) <= 0) return null;
  if (colour === 'G') return nearBest(tile, answer[i]);
  if (colour === 'Y') return [...new Set(answer)].some((l) => l !== answer[i] && nearBest(tile, l));
  // Gray: only informative when the tile clearly reads as a letter that isn't in the answer.
  const best = String.fromCharCode(A + tile.indexOf(Math.max(...tile)));
  return answer.includes(best) ? null : true;
}

// 'match' | 'mismatch' | 'unsure', plus how much agreed, so callers can explain a rejection.
export function verifyBoard(grid, scores, answer) {
  let agree = 0;
  let total = 0;
  grid.forEach((row, r) => {
    for (let c = 0; c < 5; c++) {
      const ok = tileEvidence(scores[r]?.[c], row[c], answer, c);
      if (ok === null) continue;
      total += WEIGHT[row[c]];
      if (ok) agree += WEIGHT[row[c]];
    }
  });
  const ratio = total ? agree / total : 0;
  const verdict = total < MIN_EVIDENCE ? 'unsure' : ratio >= MATCH_AT ? 'match' : ratio <= MISMATCH_AT ? 'mismatch' : 'unsure';
  return { verdict, ratio: Math.round(ratio * 100) / 100, evidence: total };
}

// Best-looking letters that still produce the row's colours, for words missing from the list
// (NYT adds words over time). Depth-first over letters in score order, so the first fit is a good one.
const SEARCH_LIMIT = 50000;
function lettersFor(row, rowScores, answer) {
  const options = [...row].map((colour, c) => {
    if (colour === 'G') return [answer[c]];
    const order = [...Array(26).keys()].sort((a, b) => rowScores[c][b] - rowScores[c][a]).map((l) => String.fromCharCode(A + l));
    return order.filter((l) => l !== answer[c] && (colour === 'Y' ? answer.includes(l) : true));
  });
  let steps = 0;
  const pick = [];
  const search = (c) => {
    if (++steps > SEARCH_LIMIT) return false;
    if (c === 5) return pattern(pick.join(''), answer) === row;
    for (const l of options[c]) {
      pick[c] = l;
      if (search(c + 1)) return true;
    }
    return false;
  };
  return search(0) ? pick.join('') : options.map((o) => o[0]).join('');
}

// Each row's word: the listed word that produces exactly the row's colours and looks most like the tiles.
export function decodeBoard(grid, scores, answer, words) {
  return grid.map((row, r) => {
    const rowScores = scores[r];
    const ranked = [];
    for (const w of words) {
      if (pattern(w, answer) !== row) continue;
      let s = 0;
      for (let c = 0; c < 5; c++) s += score(rowScores[c], w[c]);
      ranked.push({ w, s: s / 5 });
    }
    ranked.sort((x, y) => y.s - x.s);
    if (!ranked.length) return { word: lettersFor(row, rowScores, answer), confident: false, listed: false, alternatives: [] };
    const [best, second] = ranked;
    return {
      word: best.w,
      confident: !second || best.s - second.s >= ROW_MARGIN,
      listed: true,
      alternatives: ranked.slice(1, 4).map((x) => x.w),
    };
  });
}

// A word typed by the player is accepted only if it produces the row's colours for this answer.
export const wordFitsRow = (word, row, answer) => /^[A-Z]{5}$/.test(word) && pattern(word, answer) === row;
