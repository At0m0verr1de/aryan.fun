// Pure helpers for the cat: collars, food, moods, what it says, meter words, the diary and the home line.
// state is pet_state(): { pet, today, last, events, graves }. The database calls the collar colour "colour".

// Coats: fur gradient (top, middle, belly), head gradient, inner ear, nose, iris (centre → rim), tabby stripes,
// a white bib (tuxedo), whiskers, the collar that suits it, and the egg it hatches from.
export const COATS = {
  black: { label: 'Midnight', fur: ['#3a3645', '#211f28', '#131217'], head: ['#3b3746', '#23212a', '#16151b'], ear: '#3d2b36', nose: '#c98a96',
    iris: ['#fff3a8', '#f4c445', '#d38a1d', '#8f5410'], stripe: null, bib: false, whisker: '#d9d4dc', collar: '#d9788f',
    egg: { shell: '#2b2831', spot: '#e6c15a' } },
  grey: { label: 'Smoke', fur: ['#9a9ea8', '#767a84', '#5c5f68'], head: ['#a3a7b1', '#7d818b', '#62656e'], ear: '#d7a3ab', nose: '#d68f9a',
    iris: ['#eaffb8', '#acd964', '#5f9a32', '#33601a'], stripe: '#4c4f57', bib: false, whisker: '#eceaee', collar: '#6f9bd1',
    egg: { shell: '#b3b7bf', spot: '#6d717b' } },
  ginger: { label: 'Marmalade', fur: ['#f2ab62', '#dc8840', '#bb682c'], head: ['#f4b26c', '#df8e45', '#c27030'], ear: '#f2b8a8', nose: '#e58b8a',
    iris: ['#f8ffbe', '#cfd95c', '#8e9d2a', '#55600f'], stripe: '#ad5620', bib: false, whisker: '#fff4e6', collar: '#5f9e83',
    egg: { shell: '#f6c995', spot: '#d9823a', stripes: true } },
  cream: { label: 'Biscuit', fur: ['#f6e7cb', '#e8d2ab', '#d4b88c'], head: ['#f8ebd2', '#ead5b0', '#d9bf95'], ear: '#f0b6ad', nose: '#e5969a',
    iris: ['#ecf8ff', '#9ecaee', '#4f87c0', '#2a4f80'], stripe: '#cba373', bib: false, whisker: '#ffffff', collar: '#a48ad3',
    egg: { shell: '#f8eedb', spot: '#e0bf8c' } },
  white: { label: 'Snow', fur: ['#ffffff', '#f2eff1', '#d9d4da'], head: ['#ffffff', '#f4f1f3', '#e0dbe0'], ear: '#f3b5be', nose: '#ef97a4',
    iris: ['#eaf7ff', '#8ec5f0', '#4b86c4', '#24497a'], stripe: null, bib: false, whisker: '#a9a3a8', collar: '#d9788f',
    egg: { shell: '#fdfbf9', spot: '#f2c3cd' } },
  tuxedo: { label: 'Tuxedo', fur: ['#3a3645', '#211f28', '#131217'], head: ['#3b3746', '#23212a', '#16151b'], ear: '#3d2b36', nose: '#d993a0',
    iris: ['#f2ffc4', '#bce274', '#6aa63a', '#386a1c'], stripe: null, bib: true, whisker: '#e8e4ea', collar: '#c9483f',
    egg: { shell: '#2b2831', spot: '#ffffff', split: true } },
};
export const coatOf = (key) => COATS[key] ?? COATS.black;
export const NAMES = ['Mochi', 'Noori', 'Kaju', 'Pepper', 'Billu', 'Raat', 'Kohl', 'Miso', 'Biscuit', 'Shadow'];
export const LIMITS = { feed: 3, play: 6, pet: 12 };
export const FOODS = [
  { kind: 'fish', label: 'Fish', line: 'A whole fish. You understand me completely.' },
  { kind: 'tuna', label: 'Tuna', line: 'Tuna. I forgive you for everything.' },
  { kind: 'salmon', label: 'Salmon', line: 'Salmon, on a weekday? I could get used to this.' },
  { kind: 'treat', label: 'Treats', line: 'The good treats. The good ones.' },
];
export const TOYS = [
  { kind: 'wordle', slug: 'wordle-duo', label: 'Wordle' },
  { kind: 'kitne', slug: 'kitne-ka', label: 'Kitne Ka?' },
  { kind: 'chess', slug: 'chess-mates', label: 'Chess' },
  { kind: 'jar', slug: 'date-jar', label: 'Date Jar' },
];

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

export const istHour = (now) => new Date(now + IST_OFFSET_MS).getUTCHours();
export const istDay = (t) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
export const isDead = (pet) => Boolean(pet?.died_at);
export const isNight = (now) => { const h = istHour(now); return h >= 23 || h < 7; };

// The worst thing going on decides the mood.
export function moodOf(pet, now) {
  if (!pet) return 'none';
  if (isDead(pet)) return 'dead';
  if (pet.health < 25) return 'sick';
  if (pet.hunger < 20) return 'hungry';
  if (pet.happiness < 25) return 'sad';
  if (isNight(now)) return 'sleepy';
  if (pet.hunger > 65 && pet.happiness > 65 && pet.health > 65) return 'happy';
  return 'okay';
}

const WORDS = {
  hunger: [[75, 'Full'], [45, 'Peckish'], [20, 'Hungry'], [0, 'Starving']],
  happiness: [[75, 'Content'], [45, 'Happy'], [20, 'Mopey'], [0, 'Heartbroken']],
  health: [[75, 'Thriving'], [45, 'Healthy'], [20, 'Poorly'], [0, 'Fading']],
};
export const meterWord = (key, v) => WORDS[key].find(([min]) => v >= min)[1];

const LINES = {
  happy: ['I have decided you may stay.', 'This is a good house. I approve of it.',
    'I was going to knock something off the table. I decided not to. For you.', 'The sunbeam and I had a lovely afternoon.',
    'You two smell nice today.'],
  okay: ['Oh. You\'re here.', 'I was not waiting for you. I was sitting near the door for other reasons.',
    'Something moved behind the sofa. I\'m keeping an eye on it.', 'Pet me. Or don\'t. (Do.)', 'I counted the birds today. Four. One was rude.'],
  sleepy: ['zzz…', 'mm… fish…', 'shh. I\'m dreaming about the windowsill.'],
  hungry: ['The bowl is empty. I\'m told this is a crisis.', 'I have been staring at the kitchen for an hour.',
    'I would eat a whole fish. Two fish.', 'Is that tuna? No. It\'s a sock. Again.'],
  sad: ['I batted the ball around on my own today. It didn\'t bat back.', 'I sat on the sofa. Your side. It was cold.',
    'I\'m fine. I\'m a cat. Cats are always fine.', 'Do you still like me?'],
  sick: ['I feel very small today.', 'Everything is a bit spinny.', 'Could you stay a little longer?'],
  fading: ['If I fade away, tell the Wordle tiles I loved them', 'I think I see a light… is that the fridge?', 'Remember me as a good cat.'],
};

// Nudges about the other toys: never "play more", always something the cat noticed.
function nudges(state, now, partnerName) {
  const last = state.last ?? {};
  const ago = (k) => (last[k] ? now - Date.parse(last[k]) : Infinity);
  const today = istDay(now);
  const playedToday = (k) => last[k] && istDay(Date.parse(last[k])) === today;
  const out = [];
  if (!playedToday('wordle') && istHour(now) >= 12) out.push('Nobody\'s touched the Wordle tiles today. I\'d do it, but no thumbs.');
  if (!playedToday('kitne')) out.push('Someone left a price tag on the counter. I knocked it off. You should guess what it was.');
  if (ago('jar') > 14 * DAY_MS) out.push('I knocked the date jar off the shelf. It sounded… dusty.');
  if (ago('chess') > 7 * DAY_MS && last.chess) out.push('I sat on the chessboard. Nobody minded. Nobody\'s played in a while.');
  const lastVisit = Math.max(...['feed', 'play', 'pet', 'adopt'].map((k) => (last[k] ? Date.parse(last[k]) : 0)));
  if (now - lastVisit > 2 * DAY_MS) out.push('I sat by the door all evening. It creaked once. It was the wind.');
  if (now - lastVisit > 4 * DAY_MS) out.push('I\'ve been counting the days on the wall with my claws. It\'s a lot of scratches.');
  if (last.feed && ago('feed') < 6 * HOUR_MS && partnerName) out.push(`${partnerName} fed me earlier. I\'m telling everyone.`);
  return out;
}

// What the cat says right now. pick(n) chooses an index; defaults to one that changes every ten minutes.
export function speech(state, now, partnerName, pick = (n) => Math.floor(now / 600000) % n) {
  const pet = state?.pet;
  if (!pet) return '';
  const mood = moodOf(pet, now);
  if (mood === 'dead') return '';
  if (pet.health < 12) return LINES.fading[pick(LINES.fading.length)];
  const pool = [...LINES[mood]];
  if (mood !== 'sleepy') pool.push(...nudges(state, now, partnerName), ...nudges(state, now, partnerName)); // nudges twice as likely
  return pool[pick(pool.length)];
}

export function ageLabel(bornAt, until) {
  const days = Math.floor((until - Date.parse(bornAt)) / DAY_MS);
  if (days < 1) return 'arrived today';
  return days === 1 ? '1 day with you' : `${days} days with you`;
}

const EVENT_TEXT = {
  adopt: (who, pet) => `${who} brought ${pet} home`,
  feed: (who, pet) => `${who} fed ${pet}`,
  play: (who, pet) => `${who} played with ${pet}`,
  pet: (who, pet) => `${who} gave ${pet} a cuddle`,
  wordle: (who, pet) => `${who} played Wordle, ${pet} perked up`,
  kitne: (who, pet) => `${who} played Kitne Ka?, ${pet} perked up`,
  chess: (_, pet) => `You two played chess, ${pet} perked up`,
  jar: (who, pet) => `${who} opened the Date Jar, ${pet} perked up`,
  drinks: (who, pet) => `${who} logged a drink, ${pet} sniffed it`,
};
export const eventText = (e, whoOf, petName) => (EVENT_TEXT[e.kind] ?? (() => ''))(whoOf(e.user_id), petName);

// Fold runs of the same thing by the same person into one diary line with a count.
export function diary(events, limit = 8) {
  const out = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === e.kind && prev.user_id === e.user_id && Date.parse(prev.at) - Date.parse(e.at) < 6 * HOUR_MS) prev.n++;
    else out.push({ ...e, n: 1 });
  }
  return out.slice(0, limit);
}

export function petHomeLine(state, now, partnerName) {
  if (!state) return 'Adopt a cat together';
  const pet = state.pet;
  if (!pet) return state.graves?.length ? 'A little cat is waiting at your door' : 'Adopt a cat together';
  if (isDead(pet)) return `${pet.name} waited for you…`;
  return `${pet.name}: “${speech(state, now, partnerName)}”`;
}
