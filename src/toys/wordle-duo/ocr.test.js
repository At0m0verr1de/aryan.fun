// End-to-end reading of drawn boards: colours → letter scores → words → is this the right day?
// Boards use fonts that differ from the reference letters, the way NYT's font differs from the browser's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBoard, nodeRenderer } from './board-fixture.js';
import { parsePixels } from './parse.js';
import { buildTemplates, readGlyphs, scoreBoard, learnFromGreens } from './ocr.js';
import { decodeBoard, verifyBoard, splitWords, pattern, wordFitsRow } from './solve.js';
import { WORDS } from './words.js';

const words = splitWords(WORDS);
const templates = buildTemplates(nodeRenderer(), ['"Liberation Sans"', '"DejaVu Sans"']);
const GAMES = [
  { answer: 'STREW', words: ['CRANE', 'SLOTH', 'STREW'] },
  { answer: 'PIXEL', words: ['ADIEU', 'BLIMP', 'PILOT', 'PIXEL'] },
  { answer: 'GOOEY', words: ['RAISE', 'MONTH', 'GLOVE', 'GOODY', 'GOOFY', 'GOOEY'] },
  { answer: 'QUEUE', words: ['AUDIO', 'QUERY', 'QUEUE'] },
];
const WRONG_DAYS = ['PLUMB', 'CRISP', 'NIGHT', 'ABBEY', 'FROTH', 'MANGO'];
const CASES = [
  { font: 'Nimbus Sans', theme: 'dark', tile: 62 },
  { font: 'URW Gothic', theme: 'light', tile: 44 },
  { font: 'Liberation Sans Narrow', theme: 'contrast', tile: 62 },
];

function read(game, look) {
  const img = drawBoard({ ...game, ...look });
  const parsed = parsePixels(img.data, img.width, img.height);
  const glyphs = readGlyphs(img.data, img.width, parsed.boxes);
  return { parsed, glyphs, scores: scoreBoard(glyphs, templates) };
}

test('wordle colouring handles repeated letters', () => {
  assert.equal(pattern('CRANE', 'STREW'), 'BYBBY');
  assert.equal(pattern('GOODY', 'GOOEY'), 'GGGBG');
  assert.equal(pattern('EERIE', 'THEME'), 'YBBBG');
  assert.equal(pattern('SPEED', 'ABIDE'), 'BBYBY');
});

test('typed words must fit the row colours', () => {
  assert.ok(wordFitsRow('CRANE', 'BYBBY', 'STREW'));
  assert.ok(!wordFitsRow('CRATE', 'BYBBY', 'STREW'));
  assert.ok(!wordFitsRow('cran', 'BYBBY', 'STREW'));
});

test('boards are recognised for their own day and rejected for others', () => {
  for (const look of CASES) {
    for (const game of GAMES) {
      const { parsed, scores } = read(game, look);
      assert.equal(parsed.grid.length, game.words.length, `${look.font} ${game.answer} rows`);
      assert.equal(verifyBoard(parsed.grid, scores, game.answer).verdict, 'match', `${look.font} ${game.answer}`);
      for (const other of WRONG_DAYS) {
        assert.notEqual(verifyBoard(parsed.grid, scores, other).verdict, 'match', `${look.font} ${game.answer} vs ${other}`);
      }
    }
  }
});

test('guessed words are read back, and confident reads are never wrong', () => {
  let rows = 0;
  let right = 0;
  for (const look of CASES) {
    for (const game of GAMES) {
      const { parsed, glyphs } = read(game, look);
      const scores = scoreBoard(glyphs, learnFromGreens(templates, glyphs, parsed.grid, game.answer));
      decodeBoard(parsed.grid, scores, game.answer, words).forEach((d, i) => {
        rows++;
        if (d.word === game.words[i]) right++;
        else assert.ok(!d.confident, `${look.font}: ${game.words[i]} read confidently as ${d.word}`);
      });
    }
  }
  assert.ok(right / rows >= 0.9, `read ${right}/${rows} words`);
});

test('a word missing from the list still gets letters that fit its colours', () => {
  const [row] = decodeBoard(['BYBBY'], [Array.from({ length: 5 }, () => new Float32Array(26))], 'STREW', ['STREW']);
  assert.equal(row.listed, false);
  assert.ok(wordFitsRow(row.word, 'BYBBY', 'STREW'));
});
