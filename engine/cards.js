// Card model for Poker: the standard 52-card deck.
// A card is a string: rank + suit letter, e.g. "10H", "QS", "AD". Shared with the browser.

export const SUITS = ['S', 'H', 'C', 'D'];
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
export const SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // 2..14, ace high

export const suitOf = (card) => card.slice(-1);
export const rankOf = (card) => card.slice(0, -1);

export const makeDeck = () => SUITS.flatMap((s) => RANKS.map((r) => r + s));
const DECK_SET = new Set(makeDeck());

// Looked up millions of times by the bots, so the value of every card is worked out once.
const VALUE = new Map(makeDeck().map((c) => [c, RANK_VALUE[rankOf(c)]]));
export const valueOf = (card) => VALUE.get(card);
export const isCard = (c) => typeof c === 'string' && DECK_SET.has(c);

export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Small seeded generator so tests and simulations are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Higher card first, so a hole pair always reads "K Q" rather than "Q K". */
export const sortHole = (cards) => [...cards].sort((a, b) => valueOf(b) - valueOf(a) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)));
