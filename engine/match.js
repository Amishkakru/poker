// A match: a run of hands with chip stacks that carry over, blinds that rise on a schedule,
// eliminations, and the finish (last player standing, or the most chips after a set number of hands).

import { Hand, SEATS } from './hand.js';

export { SEATS };

export const STACK_CHOICES = [1000, 2000, 5000];
export const LENGTH_CHOICES = [20, 40, 'freezeout']; // hands, or play until one player has every chip
export const DEFAULT_SETTINGS = { stack: 1000, length: 20, timers: true };
export const HANDS_PER_LEVEL = 8;
export const MIN_PLAYERS = 2;

// The first big blind is stack / 50 (20 for a stack of 1000); it then steps up through these multiples.
const LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];

export function blindsFor(stack, level) {
  const first = Math.max(2, Math.round(stack / 50 / 2) * 2);
  const mult = LEVELS[Math.min(level, LEVELS.length - 1)];
  const bb = Math.max(2, Math.round((first * mult) / 2) * 2);
  return { sb: bb / 2, bb };
}

export const isLength = (v) => LENGTH_CHOICES.includes(v);
export const isStack = (v) => STACK_CHOICES.includes(v);

export class Match {
  /**
   * @param seats    seat numbers taking part
   * @param stack    starting chips for everyone
   * @param length   a number of hands, or 'freezeout'
   */
  constructor({
    seats, stack = DEFAULT_SETTINGS.stack, length = DEFAULT_SETTINGS.length, rng = Math.random, handsPerLevel = HANDS_PER_LEVEL,
  }) {
    if (seats.length < MIN_PLAYERS) throw new Error('A match needs at least two players.');
    this.stack = stack;
    this.length = length;
    this.rng = rng;
    this.handsPerLevel = handsPerLevel;
    this.stacks = Array.from({ length: SEATS }, (_, s) => (seats.includes(s) ? stack : null));
    this.seatsAtStart = [...seats].sort((a, b) => a - b);
    this.handNo = 0;
    this.dealer = null;
    this.hand = null;
    this.finished = false;
    this.busted = []; // seats in the order they went out, with the hand number
    this.history = []; // one summary per finished hand
    this.settled = true;
  }

  chips(seat) { return this.stacks[seat] ?? 0; }

  /** Seats that still have chips. */
  alive() { return this.stacks.flatMap((c, s) => (c > 0 ? [s] : [])); }

  /** The blinds the next hand will use, and how many hands until they rise. */
  nextBlinds() {
    const n = this.handNo; // hands already played
    return {
      ...blindsFor(this.stack, Math.floor(n / this.handsPerLevel)),
      rises: this.handsPerLevel - (n % this.handsPerLevel),
      next: blindsFor(this.stack, Math.floor(n / this.handsPerLevel) + 1),
    };
  }

  /** When the blinds next go up (a hand number) and what they become. Works during a hand and between hands. */
  levelUp() {
    const level = Math.floor((Math.max(this.handNo, 1) - 1) / this.handsPerLevel);
    return { at: (level + 1) * this.handsPerLevel + 1, blinds: blindsFor(this.stack, level + 1) };
  }

  startHand() {
    if (this.finished) throw new Error('The match is over.');
    if (!this.settled) throw new Error('Settle the last hand first.');
    const alive = this.alive();
    // The button moves one live seat clockwise each hand.
    if (this.dealer === null) {
      this.dealer = alive[Math.floor(this.rng() * alive.length)];
    } else {
      let s = this.dealer;
      do { s = (s + 1) % SEATS; } while (!(this.stacks[s] > 0));
      this.dealer = s;
    }
    const blinds = blindsFor(this.stack, Math.floor(this.handNo / this.handsPerLevel));
    this.handNo += 1;
    this.hand = new Hand({
      stacks: this.stacks.map((c) => c ?? 0), dealer: this.dealer, blinds, rng: this.rng,
    });
    this.settled = false;
    return this.hand;
  }

  /** Call once the hand is done: carry the stacks over, retire busted players, decide whether the match goes on. */
  settle() {
    const h = this.hand;
    if (!h || h.phase !== 'done') throw new Error('The hand is not over.');
    if (this.settled) return;
    this.settled = true;
    const out = [];
    for (const p of h.players) {
      if (!p) continue;
      this.stacks[p.seat] = p.stack;
      if (p.stack === 0) out.push(p);
    }
    // Several players can go out on one hand: the bigger starting stack finishes higher.
    out.sort((a, b) => a.start - b.start);
    for (const p of out) this.busted.push({ seat: p.seat, hand: this.handNo });

    const r = h.result;
    this.history.push({
      hand: this.handNo,
      winners: r.winners,
      pot: r.pot,
      showdown: r.showdown,
      best: r.winners.map((s) => r.hands[s]?.name).find(Boolean) ?? null,
      busted: out.map((p) => p.seat),
    });

    const alive = this.alive();
    if (alive.length <= 1) this.finished = true;
    else if (this.length !== 'freezeout' && this.handNo >= this.length) this.finished = true;
  }

  /** Final order, best first: players still holding chips by stack, then the busted, last out first. */
  standings() {
    const alive = this.alive().sort((a, b) => this.stacks[b] - this.stacks[a] || a - b);
    const gone = [...this.busted].reverse().map((b) => b.seat);
    let place = 0;
    let prev = null;
    return [...alive, ...gone].map((seat, i) => {
      const chips = this.stacks[seat] ?? 0;
      if (i < alive.length) {
        if (chips !== prev) place = i + 1;
        prev = chips;
      } else place = i + 1;
      return { seat, place, chips, out: i >= alive.length };
    });
  }

  total() { return this.stacks.reduce((n, c) => n + (c ?? 0), 0); }
}
