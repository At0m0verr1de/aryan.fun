import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  headToHead, streak, byColour, byClass, favouriteOpening, fastestWin, bestAccuracy, ratingTrend, boardOf, howLabel, chessLine, outcomeFor,
} from './chess.js';

const A = 'a';
const R = 'r';
let n = 0;
const g = (white, winner, extra = {}) => ({
  id: `g${n++}`, white, black: white === A ? R : A, winner, how: winner ? 'resigned' : 'agreed', time_class: 'blitz', rated: true,
  white_rating: 900 + n, black_rating: 950 - n, white_accuracy: null, black_accuracy: null, opening: null, moves: 30, ...extra,
});

test('head to head counts wins and draws, and where the rope knot sits', () => {
  const games = [g(A, A), g(R, A), g(A, R), g(R, null)];
  assert.deepEqual(headToHead(games, A, R), { me: 2, partner: 1, draws: 1, total: 4, share: 2.5 / 4 });
  assert.equal(headToHead([], A, R).share, 0.5);
});

test('streak runs until someone else wins or a draw', () => {
  assert.deepEqual(streak([g(A, R), g(R, R), g(A, A)]), { who: R, n: 2 });
  assert.equal(streak([g(A, null), g(A, A)]), null);
  assert.equal(streak([]), null);
});

test('splits by colour and time class', () => {
  const games = [g(A, A), g(A, null), g(R, R), g(R, A, { time_class: 'bullet' })];
  const c = byColour(games, A);
  assert.deepEqual(c.white, { win: 1, draw: 1, loss: 0, n: 2 });
  assert.deepEqual(c.black, { win: 1, draw: 0, loss: 1, n: 2 });
  assert.deepEqual(byClass(games, A, R).map((r) => [r.c, r.me, r.partner]), [['bullet', 1, 0], ['blitz', 1, 1]]);
});

test('favourite opening is your choice as white; fastest win; best accuracy', () => {
  const games = [
    g(A, A, { opening: 'Italian Game', moves: 41 }), g(A, R, { opening: 'Italian Game' }), g(A, A, { opening: 'London System', moves: 19 }),
    g(R, R, { opening: 'Sicilian Defense', black_accuracy: 88.4 }), g(R, A, { black_accuracy: 71 }),
  ];
  assert.deepEqual(favouriteOpening(games, A), { name: 'Italian Game', n: 2, win: 1 });
  assert.equal(favouriteOpening(games, R).name, 'Sicilian Defense');
  assert.equal(fastestWin(games, A).moves, 19);
  assert.equal(bestAccuracy(games, A).a, 88.4);
  assert.equal(bestAccuracy(games, R), null);
});

test('rating trend uses the most played rated time class, oldest first', () => {
  const games = [g(A, A, { white_rating: 1010 }), g(R, R, { black_rating: 1000 }), g(A, A, { time_class: 'rapid' })];
  const t = ratingTrend(games, A, R);
  assert.equal(t.c, 'blitz');
  assert.deepEqual(t.me, [1000, 1010]);
  assert.equal(ratingTrend([g(A, A)], A, R), null);
});

test('reads a final position', () => {
  const b = boardOf('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.equal(b.length, 8);
  assert.equal(b[0][4].piece.startsWith('♚'), true);
  assert.equal(b[0][4].white, false);
  assert.equal(b[4][4].white, true);
  assert.equal(b[3][0], null);
  assert.equal(boardOf('junk'), null);
});

test('labels and the home line', () => {
  assert.equal(howLabel({ winner: A, how: 'checkmated' }), 'by checkmate');
  assert.equal(howLabel({ winner: null, how: 'repetition' }), 'by repetition');
  assert.equal(outcomeFor({ winner: R }, A), 'loss');
  assert.equal(chessLine([], A, R, 'Rupali'), 'Play each other on chess.com and your games land here ♟');
  assert.equal(chessLine([g(A, R), g(A, A), g(R, R)], A, R, 'Rupali'), 'Rupali leads 2–1 · last: Rupali won');
  assert.equal(chessLine([g(A, null), g(A, A)], A, R, 'Rupali'), 'You lead 1–0 · last one a draw');
});
