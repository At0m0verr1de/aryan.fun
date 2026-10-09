// Pure helpers for the pet: colours, moods, what it says, meter words, the diary and the home line.
// state is pet_state(): { pet, today, last, events, graves }.

export const COLOURS = {
  pink:  { body: '#ffb3cf', belly: '#ffe3ee', inner: '#ff8fb5' },
  blue:  { body: '#a9d8ff', belly: '#e3f3ff', inner: '#7cbcf5' },
  cream: { body: '#ffe2a8', belly: '#fff6e0', inner: '#ffc06e' },
  lilac: { body: '#d4bfff', belly: '#f1e9ff', inner: '#b496ff' },
  mint:  { body: '#a8edcf', belly: '#e4fbf1', inner: '#72d6aa' },
  peach: { body: '#ffc2a3', belly: '#ffe9de', inner: '#ff9c78' },
};
export const NAMES = ['Mochi', 'Laddoo', 'Pista', 'Momo', 'Biscuit', 'Chikoo', 'Jalebi', 'Gulab', 'Peanut', 'Kaju'];
export const LIMITS = { feed: 3, play: 6, pet: 12 };
export const TREATS = ['🍙', '🥭', '🍪', '🍓', '🧁', '🥕', '🍌', '🍩'];
export const TOYS = [
  { kind: 'wordle', slug: 'wordle-duo', label: 'Wordle', icon: '🟩' },
  { kind: 'kitne', slug: 'kitne-ka', label: 'Kitne Ka?', icon: '🛒' },
  { kind: 'chess', slug: 'chess-mates', label: 'Chess', icon: '♟' },
  { kind: 'jar', slug: 'date-jar', label: 'Date Jar', icon: '🫙' },
];

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

export const istHour = (now) => new Date(now + IST_OFFSET_MS).getUTCHours();
export const istDay = (t) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
export const isDead = (pet) => Boolean(pet?.died_at);
export const isNight = (now) => { const h = istHour(now); return h >= 23 || h < 7; };

// The worst thing going on decides the face.
export function moodOf(pet, now) {
  if (!pet) return 'egg';
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
  happiness: [[75, 'Over the moon'], [45, 'Happy'], [20, 'Mopey'], [0, 'Heartbroken']],
  health: [[75, 'Thriving'], [45, 'Healthy'], [20, 'Poorly'], [0, 'Fading']],
};
export const meterWord = (key, v) => WORDS[key].find(([min]) => v >= min)[1];

const LINES = {
  happy: ['Best. Day. Ever.', 'You two are my favourite humans 💛', 'I did a little dance when you came in', 'I feel like a whole cupcake today',
    'Is it snack o\'clock? Asking for me.', 'I love it here 🥹'],
  okay: ['Hi hi hi!', 'What are we doing today?', 'I was just thinking about you two', 'Pat me? Pat me.', 'I counted the clouds today. Eleven.'],
  sleepy: ['zzz… five more minutes…', 'mm… dreaming of mangoes…', 'shh, I\'m charging'],
  hungry: ['My tummy is making whale noises 🐋', 'I\'ve been staring at the fridge for an hour', 'Is that… food? No. It\'s a sock.',
    'I could eat a whole thali. Two thalis.'],
  sad: ['I practised fetch alone today. The ball didn\'t throw itself back.', 'I built a blanket fort. Nobody came.',
    'I\'m fine. Totally fine. *sniff*', 'Do you still like me?'],
  sick: ['I feel a bit see-through 🥺', 'Everything is spinny…', 'Could you stay a little longer?'],
  fading: ['If I fade away, tell the Wordle tiles I loved them', 'I think I can see a light… is that the fridge?',
    'Remember me as a good little blob 🕯️'],
  dead: ['🕊️'],
};

// Nudges about the other toys: never "play more", always something the pet noticed.
function nudges(state, now, partnerName) {
  const last = state.last ?? {};
  const ago = (k) => (last[k] ? now - Date.parse(last[k]) : Infinity);
  const today = istDay(now);
  const playedToday = (k) => last[k] && istDay(Date.parse(last[k])) === today;
  const out = [];
  if (!playedToday('wordle') && istHour(now) >= 12) out.push('Nobody\'s touched the Wordle tiles today. I\'d do it but I don\'t have thumbs.');
  if (!playedToday('kitne')) out.push('I saw a mango at the market and had NO idea what it cost. Help?');
  if (ago('jar') > 14 * DAY_MS) out.push('I shook the date jar. It sounded… dusty.');
  if (ago('chess') > 7 * DAY_MS && last.chess) out.push('I set the chess pieces up again. Just in case.');
  const lastVisit = Math.max(...['feed', 'play', 'pet', 'adopt'].map((k) => (last[k] ? Date.parse(last[k]) : 0)));
  if (now - lastVisit > 2 * DAY_MS) out.push('I sat by the door all evening. It creaked once. It was the wind.');
  if (now - lastVisit > 4 * DAY_MS) out.push(`I made a little calendar. I\'m crossing off days. It\'s a lot of crosses.`);
  if (last.feed && ago('feed') < 6 * HOUR_MS && partnerName) out.push(`${partnerName} fed me earlier. I\'m telling everyone.`);
  return out;
}

// What the pet says right now. pick(n) chooses an index; defaults to one that changes every ten minutes.
export function speech(state, now, partnerName, pick = (n) => Math.floor(now / 600000) % n) {
  const pet = state?.pet;
  if (!pet) return '';
  const mood = moodOf(pet, now);
  if (mood === 'dead') return LINES.dead[0];
  if (pet.health < 12) return LINES.fading[pick(LINES.fading.length)];
  const pool = [...LINES[mood]];
  if (mood !== 'sleepy') pool.push(...nudges(state, now, partnerName), ...nudges(state, now, partnerName)); // nudges twice as likely
  return pool[pick(pool.length)];
}

export function ageLabel(bornAt, until) {
  const days = Math.floor((until - Date.parse(bornAt)) / DAY_MS);
  if (days < 1) return 'hatched today';
  return days === 1 ? '1 day old' : `${days} days old`;
}

const EVENT_TEXT = {
  adopt: (who, pet) => `${who} hatched ${pet} 🐣`,
  feed: (who, pet) => `${who} fed ${pet}`,
  play: (who, pet) => `${who} played fetch with ${pet}`,
  pet: (who, pet) => `${who} gave ${pet} a cuddle`,
  wordle: (who, pet) => `${who} played Wordle, ${pet} perked up`,
  kitne: (who, pet) => `${who} played Kitne Ka?, ${pet} perked up`,
  chess: (_, pet) => `You two played chess, ${pet} perked up`,
  jar: (who, pet) => `${who} opened the Date Jar, ${pet} perked up`,
  drinks: (who, pet) => `${who} logged a drink, ${pet} got a sniff`,
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
  if (!state) return 'Hatch a pet together 🥚';
  const pet = state.pet;
  if (!pet) return state.graves?.length ? 'An egg is waiting for you two 🥚' : 'Hatch a pet together 🥚';
  if (isDead(pet)) return `${pet.name} waited for you… 🕊️`;
  return `${pet.name}: “${speech(state, now, partnerName)}”`;
}
