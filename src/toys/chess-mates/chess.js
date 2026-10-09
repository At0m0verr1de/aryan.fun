// Pure helpers for Chess Mates: head-to-head numbers, streaks, splits, and reading a final position.
// A game (from chess_state): { id, url, ended_at, time_class, rated, white, black, winner (null = draw), how,
//   white_rating, black_rating, white_accuracy, black_accuracy, opening, fen, moves }.

export const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'];
export const CLASS_LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };
export const CLASS_ICON = { bullet: '⚡', blitz: '🔥', rapid: '⏱️', daily: '☀️' };
const PIECES = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT_STYLE = '︎'; // keeps ♟ from turning into an emoji on iPhones

// "Rupali won by checkmate" ← how, from the loser's side or the kind of draw.
const WIN_HOW = { checkmated: 'by checkmate', resigned: 'by resignation', timeout: 'on time', abandoned: 'by abandonment' };
const DRAW_HOW = {
  agreed: 'by agreement', repetition: 'by repetition', stalemate: 'by stalemate', insufficient: 'with too few pieces left',
  '50move': 'by the 50-move rule', timevsinsufficient: 'on time with too few pieces',
};
export const howLabel = (g) => (g.winner ? WIN_HOW[g.how] ?? '' : DRAW_HOW[g.how] ?? '');

export const colourOf = (g, id) => (g.white === id ? 'white' : g.black === id ? 'black' : null);
export const outcomeFor = (g, id) => (g.winner == null ? 'draw' : g.winner === id ? 'win' : 'loss');
export const ratingOf = (g, id) => (g.white === id ? g.white_rating : g.black_rating);
export const accuracyOf = (g, id) => {
  const a = g.white === id ? g.white_accuracy : g.black_accuracy;
  return a == null ? null : Number(a);
};

export function headToHead(games, me, partner) {
  const t = { me: 0, partner: 0, draws: 0, total: games.length };
  for (const g of games) {
    if (g.winner === me) t.me++;
    else if (g.winner === partner) t.partner++;
    else t.draws++;
  }
  // Where the rope's knot sits: 0 = all theirs, 1 = all yours, draws count half each.
  t.share = t.total ? (t.me + t.draws / 2) / t.total : 0.5;
  return t;
}

// Current run of wins by one person (games newest first). Draws end a run.
export function streak(games) {
  const first = games[0];
  if (!first?.winner) return null;
  let n = 0;
  while (n < games.length && games[n].winner === first.winner) n++;
  return { who: first.winner, n };
}

// Win/draw/loss for one person, split by colour.
export function byColour(games, id) {
  const out = { white: { win: 0, draw: 0, loss: 0, n: 0 }, black: { win: 0, draw: 0, loss: 0, n: 0 } };
  for (const g of games) {
    const c = colourOf(g, id);
    if (!c) continue;
    out[c][outcomeFor(g, id)]++;
    out[c].n++;
  }
  return out;
}

// Wins each per time class, only classes you've played.
export function byClass(games, me, partner) {
  return TIME_CLASSES.map((c) => ({ c, ...headToHead(games.filter((g) => g.time_class === c), me, partner) })).filter((r) => r.total);
}

// Opening played most when this person had white (their choice), with how it went.
export function favouriteOpening(games, id) {
  const tally = new Map();
  for (const g of games) {
    if (g.white !== id || !g.opening) continue;
    const t = tally.get(g.opening) ?? { name: g.opening, n: 0, win: 0 };
    t.n++;
    if (g.winner === id) t.win++;
    tally.set(g.opening, t);
  }
  return [...tally.values()].sort((a, b) => b.n - a.n || b.win - a.win)[0] ?? null;
}

export function fastestWin(games, id) {
  return games.filter((g) => g.winner === id && g.moves).sort((a, b) => a.moves - b.moves)[0] ?? null;
}

export function bestAccuracy(games, id) {
  let best = null;
  for (const g of games) {
    const a = accuracyOf(g, id);
    if (a != null && (!best || a > best.a)) best = { a, g };
  }
  return best;
}

// Rating after each game in the most played time class, oldest first, for both of you.
export function ratingTrend(games, me, partner) {
  const counts = TIME_CLASSES.map((c) => [c, games.filter((g) => g.time_class === c && g.rated).length]);
  const [c, n] = counts.sort((a, b) => b[1] - a[1])[0];
  if (n < 2) return null;
  const rows = games.filter((g) => g.time_class === c && g.rated).reverse();
  return { c, me: rows.map((g) => ratingOf(g, me)).filter(Boolean), partner: rows.map((g) => ratingOf(g, partner)).filter(Boolean) };
}

// FEN board → 8 rows of 8 { piece, white } (or null), rank 8 first.
export function boardOf(fen) {
  const rows = String(fen ?? '').split(' ')[0].split('/');
  if (rows.length !== 8) return null;
  return rows.map((row) => {
    const out = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
      else if (PIECES[ch.toLowerCase()]) out.push({ piece: PIECES[ch.toLowerCase()] + TEXT_STYLE, white: ch !== ch.toLowerCase() });
    }
    return out.length === 8 ? out : Array(8).fill(null);
  });
}

// One line for the couple home.
export function chessLine(games, me, partner, partnerName) {
  if (!games.length) return 'Play each other on chess.com and your games land here ♟';
  const t = headToHead(games, me, partner);
  const lead = t.me === t.partner ? `All square ${t.me}–${t.partner}` : t.me > t.partner ? `You lead ${t.me}–${t.partner}` : `${partnerName} leads ${t.partner}–${t.me}`;
  const last = games[0];
  const lastLine = last.winner == null ? 'last one a draw' : `last: ${last.winner === me ? 'you' : partnerName} won`;
  return `${lead} · ${lastLine}`;
}
