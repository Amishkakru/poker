// Hand evaluation. `evaluate(cards)` takes five to seven cards and returns the best five-card hand as a
// single integer score: a higher score always beats a lower one and equal scores split the pot.

import { valueOf, suitOf } from './cards.js';

export const CATEGORY = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};

const BASE = 15; // card values run 2..14, so every kicker fits one base-15 digit
const SHIFT = BASE ** 5;

const tally = new Int8Array(15); // scratch space: how many of each value, reused by every call

/** Score exactly five cards. */
export function score5(cards) {
  // Values, high to low (an insertion sort: five items).
  const v = [valueOf(cards[0]), valueOf(cards[1]), valueOf(cards[2]), valueOf(cards[3]), valueOf(cards[4])];
  for (let i = 1; i < 5; i++) {
    const x = v[i];
    let j = i - 1;
    while (j >= 0 && v[j] < x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
  const s0 = suitOf(cards[0]);
  const flush = suitOf(cards[1]) === s0 && suitOf(cards[2]) === s0 && suitOf(cards[3]) === s0 && suitOf(cards[4]) === s0;

  for (let i = 0; i < 5; i++) tally[v[i]] += 1;
  // Tiebreak values by group size (quads, trips, pairs, singles), then by value.
  const order = [];
  let shape = '';
  for (let size = 4; size >= 1; size--) {
    for (let i = 0; i < 5; i++) {
      if (tally[v[i]] === size) {
        order.push(v[i]);
        shape += size;
        tally[v[i]] = 0; // a value counts once; the loop below clears the rest
        i += size - 1;
      }
    }
  }
  tally.fill(0);
  // shape now has one digit per distinct value, e.g. "41", "32", "311", "221", "2111", "11111"
  let straightHigh = 0;
  if (order.length === 5) {
    if (v[0] - v[4] === 4) straightHigh = v[0];
    else if (v[0] === 14 && v[1] === 5 && v[4] === 2) straightHigh = 5; // the wheel: A 2 3 4 5
  }

  let category;
  let tiebreak = order;
  if (straightHigh && flush) { category = CATEGORY.STRAIGHT_FLUSH; tiebreak = [straightHigh]; }
  else if (shape === '41') category = CATEGORY.QUADS;
  else if (shape === '32') category = CATEGORY.FULL_HOUSE;
  else if (flush) { category = CATEGORY.FLUSH; tiebreak = v; }
  else if (straightHigh) { category = CATEGORY.STRAIGHT; tiebreak = [straightHigh]; }
  else if (shape === '311') category = CATEGORY.TRIPS;
  else if (shape === '221') category = CATEGORY.TWO_PAIR;
  else if (shape === '2111') category = CATEGORY.PAIR;
  else { category = CATEGORY.HIGH; tiebreak = v; }

  let score = 0;
  for (let i = 0; i < 5; i++) score = score * BASE + (tiebreak[i] ?? 0);
  return category * SHIFT + score;
}

/** Best five of five to seven cards. Returns { score, category, best } where `best` is the five cards used. */
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error(`evaluate needs 5 to 7 cards, got ${cards.length}`);
  let top = -1;
  let best = null;
  const n = cards.length;
  // Choose which (n - 5) cards to leave out.
  const pick = (skipA, skipB) => {
    const hand = cards.filter((_, i) => i !== skipA && i !== skipB);
    const s = score5(hand);
    if (s > top) { top = s; best = hand; }
  };
  if (n === 5) pick(-1, -1);
  else if (n === 6) for (let a = 0; a < n; a++) pick(a, -1);
  else for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pick(a, b);
  return { score: top, category: Math.floor(top / SHIFT), best };
}

export const categoryOf = (score) => Math.floor(score / SHIFT);

/** The tiebreak values (high card first) hidden in a score, for naming the hand. */
function digits(score) {
  const out = [];
  let rest = score % SHIFT;
  for (let i = 0; i < 5; i++) { out.unshift(rest % BASE); rest = Math.floor(rest / BASE); }
  return out;
}

const NAME = {
  14: 'ace', 13: 'king', 12: 'queen', 11: 'jack', 10: 'ten', 9: 'nine', 8: 'eight', 7: 'seven', 6: 'six', 5: 'five', 4: 'four', 3: 'three', 2: 'two',
};
const PLURAL = { six: 'sixes' };
const plural = (v) => PLURAL[NAME[v]] ?? `${NAME[v]}s`;

/** "Full house, kings over fours" and so on. */
export function describe(score) {
  const d = digits(score);
  switch (categoryOf(score)) {
    case CATEGORY.STRAIGHT_FLUSH: return d[0] === 14 ? 'Royal flush' : `Straight flush, ${NAME[d[0]]} high`;
    case CATEGORY.QUADS: return `Four of a kind, ${plural(d[0])}`;
    case CATEGORY.FULL_HOUSE: return `Full house, ${plural(d[0])} over ${plural(d[1])}`;
    case CATEGORY.FLUSH: return `Flush, ${NAME[d[0]]} high`;
    case CATEGORY.STRAIGHT: return `Straight, ${NAME[d[0]]} high`;
    case CATEGORY.TRIPS: return `Three of a kind, ${plural(d[0])}`;
    case CATEGORY.TWO_PAIR: return `Two pair, ${plural(d[0])} and ${plural(d[1])}`;
    case CATEGORY.PAIR: return `Pair of ${plural(d[0])}`;
    default: return `High card, ${NAME[d[0]]}`;
  }
}

/** Short name for the category only, used when there is no room for the detail. */
export const CATEGORY_NAME = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];
