// One hand of no-limit Texas Hold'em: deal, blinds, four betting rounds, side pots and the showdown.
// Pure logic. Every mutating method returns { ok: true } or { ok: false, error }.
//
// Seats run clockwise by index. `players[seat]` is null for a seat that is not in this hand.
// Chips are whole numbers. Nothing here knows about timers, sockets or bots.

import { makeDeck, shuffle, sortHole } from './cards.js';
import { evaluate, describe } from './evaluate.js';

export const SEATS = 6;

const fail = (error) => ({ ok: false, error });
const OK = Object.freeze({ ok: true });
const STREETS = ['preflop', 'flop', 'turn', 'river'];
const BOARD_AFTER = { flop: 3, turn: 4, river: 5 };

export class Hand {
  /**
   * @param stacks  chips per seat, length SEATS; a seat with 0 chips sits this hand out
   * @param dealer  the seat holding the button (must have chips)
   * @param blinds  { sb, bb }
   */
  constructor({
    stacks, dealer, blinds, rng = Math.random,
  }) {
    this.blinds = { sb: blinds.sb, bb: blinds.bb };
    this.dealer = dealer;
    this.players = Array.from({ length: SEATS }, (_, seat) => (stacks[seat] > 0 ? {
      seat, stack: stacks[seat], start: stacks[seat], bet: 0, total: 0,
      folded: false, allIn: false, acted: false, seenRaise: -1, hole: [], last: null,
    } : null));
    const inHand = this.seatsIn();
    if (inHand.length < 2) throw new Error('A hand needs at least two players with chips.');
    if (!this.players[dealer]) throw new Error('The dealer must be in the hand.');

    this.deck = shuffle(makeDeck(), rng);
    this.board = [];
    this.phase = 'preflop'; // preflop | flop | turn | river | done
    this.currentBet = 0; // the highest bet on the table this street
    this.minRaise = blinds.bb; // the smallest legal raise increment
    this.raiseCount = 0; // full raises this street; a short all-in does not count
    this.turn = null;
    this.pending = null; // 'street' | 'showdown' while an all-in board is being run out
    this.events = [];
    this.result = null;
    this.potTotal = 0;

    // Two cards each, one at a time, starting left of the button.
    for (let round = 0; round < 2; round++) {
      for (const s of this.orderFrom(dealer)) this.players[s].hole.push(this.deck.pop());
    }
    for (const p of this.players) if (p) p.hole = sortHole(p.hole);

    // Heads up, the button is the small blind and acts first before the flop.
    const order = this.orderFrom(dealer);
    this.sbSeat = inHand.length === 2 ? dealer : order[0];
    this.bbSeat = inHand.length === 2 ? order[0] : order[1];
    this.emit({ type: 'deal', dealer, sb: this.sbSeat, bb: this.bbSeat });
    this.post(this.sbSeat, blinds.sb, 'sb');
    this.post(this.bbSeat, blinds.bb, 'bb');
    this.currentBet = blinds.bb;

    this.turn = this.nextToAct(this.bbSeat);
    if (this.turn === null) this.closeStreet(); // everyone is all in on the blinds
  }

  // ------------------------------------------------------------ helpers

  emit(event) { this.events.push({ n: this.events.length, ...event }); }

  seatsIn() { return this.players.flatMap((p) => (p ? [p.seat] : [])); }

  /** Occupied seats clockwise, starting with the one after `seat`. */
  orderFrom(seat) {
    const out = [];
    for (let i = 1; i <= SEATS; i++) {
      const s = (seat + i) % SEATS;
      if (this.players[s]) out.push(s);
    }
    return out;
  }

  alive() { return this.players.filter((p) => p && !p.folded); }

  pot() { return this.result ? this.potTotal : this.players.reduce((n, p) => n + (p?.total ?? 0), 0); }

  currentActor() { return this.phase === 'done' || this.pending ? null : this.turn; }

  commit(p, amount) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.bet += a;
    p.total += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  post(seat, amount, kind) {
    const p = this.players[seat];
    const paid = this.commit(p, amount);
    p.last = { kind };
    this.emit({ type: 'blind', seat, kind, amount: paid, allIn: p.allIn });
  }

  /** Is anyone else still able to bet? Raising against nobody is pointless. */
  othersCanBet(p) {
    return this.players.some((o) => o && o !== p && !o.folded && !o.allIn);
  }

  nextToAct(from) {
    for (let i = 1; i <= SEATS; i++) {
      const p = this.players[(from + i) % SEATS];
      if (!p || p.folded || p.allIn) continue;
      if (p.bet < this.currentBet || (!p.acted && this.othersCanBet(p))) return p.seat;
    }
    return null;
  }

  // -------------------------------------------------------------- legal moves

  canRaise(p) {
    return p.stack > 0
      && p.bet + p.stack > this.currentBet // chips beyond a call
      && p.seenRaise !== this.raiseCount // a short all-in does not reopen the betting for those who already acted
      && this.othersCanBet(p);
  }

  /** What `seat` may do right now (only meaningful on their turn). */
  legal(seat) {
    const p = this.players[seat];
    if (!p || this.turn !== seat || this.phase === 'done' || this.pending) return null;
    const toCall = this.currentBet - p.bet;
    const maxTo = p.bet + p.stack;
    const canRaise = this.canRaise(p);
    return {
      toCall,
      callAmount: Math.min(toCall, p.stack),
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canFold: toCall > 0,
      canRaise,
      isBet: this.currentBet === 0,
      minRaiseTo: Math.min(this.currentBet + this.minRaise, maxTo),
      maxRaiseTo: maxTo,
    };
  }

  // ------------------------------------------------------------------ acting

  act(seat, action) {
    if (this.phase === 'done') return fail('The hand is over.');
    if (this.pending) return fail('The board is still being dealt.');
    const p = this.players[seat];
    if (!p || p.folded) return fail('You are not in this hand.');
    if (seat !== this.turn) return fail('It is not your turn.');
    const toCall = this.currentBet - p.bet;
    const type = action?.type ?? action?.t;

    if (type === 'fold') {
      if (toCall === 0) return fail('You can check for free, so there is no reason to fold.');
      p.folded = true;
      p.last = { kind: 'fold' };
      this.emit({ type: 'fold', seat });
    } else if (type === 'check') {
      if (toCall > 0) return fail('There is a bet to call. Call, raise or fold.');
      p.last = { kind: 'check' };
      this.emit({ type: 'check', seat });
    } else if (type === 'call') {
      if (toCall === 0) return fail('There is nothing to call. Check instead.');
      const paid = this.commit(p, toCall);
      p.last = { kind: 'call', amount: p.bet };
      this.emit({ type: 'call', seat, amount: paid, allIn: p.allIn });
    } else if (type === 'raise' || type === 'allin') {
      const res = this.raise(p, type === 'allin' ? p.bet + p.stack : action.to);
      if (!res.ok) return res;
    } else {
      return fail('Unknown action.');
    }

    p.acted = true;
    p.seenRaise = this.raiseCount;
    this.afterAction(seat);
    return OK;
  }

  raise(p, to) {
    const maxTo = p.bet + p.stack;
    if (to === maxTo && maxTo <= this.currentBet) {
      // An all-in that does not even cover the bet is just a call.
      const paid = this.commit(p, p.stack);
      p.last = { kind: 'call', amount: p.bet };
      this.emit({ type: 'call', seat: p.seat, amount: paid, allIn: true });
      return OK;
    }
    if (!this.canRaise(p)) {
      if (p.seenRaise === this.raiseCount && p.bet + p.stack > this.currentBet) return fail('The last all-in was not a full raise, so you can only call or fold.');
      return fail('You cannot raise here.');
    }
    if (!Number.isInteger(to)) return fail('Enter a whole number of chips.');
    const word = this.currentBet === 0 ? 'bet' : 'raise';
    if (to <= this.currentBet) return fail(`A ${word} must go above ${this.currentBet}.`);
    if (to > maxTo) return fail('You do not have that many chips.');
    const minTo = this.currentBet + this.minRaise;
    if (to < minTo && to < maxTo) return fail(`The smallest ${word} is to ${minTo}.`);

    const isBet = this.currentBet === 0;
    const inc = to - this.currentBet;
    const full = to >= minTo;
    const paid = this.commit(p, to - p.bet);
    if (full) {
      this.minRaise = inc;
      this.raiseCount += 1;
      for (const o of this.players) if (o && o !== p && !o.folded && !o.allIn) o.acted = false;
    } else {
      // A short all-in: those facing more must answer, but nobody gets a fresh raise option.
      for (const o of this.players) if (o && o !== p && !o.folded && !o.allIn && o.bet < to) o.acted = false;
    }
    this.currentBet = to;
    p.last = { kind: isBet ? 'bet' : 'raise', amount: to };
    this.emit({
      type: isBet ? 'bet' : 'raise', seat: p.seat, to, amount: paid, allIn: p.allIn, full,
    });
    return OK;
  }

  afterAction(seat) {
    if (this.alive().length === 1) return this.finish(false);
    const next = this.nextToAct(seat);
    if (next !== null) { this.turn = next; return undefined; }
    return this.closeStreet();
  }

  // ------------------------------------------------------------------ streets

  closeStreet() {
    const alive = this.alive();
    if (alive.length === 1) return this.finish(false);
    if (this.phase === 'river') return this.finish(true);
    if (alive.filter((p) => !p.allIn).length >= 2) {
      this.dealStreet();
      this.turn = this.nextToAct(this.dealer);
      if (this.turn === null) this.pending = this.phase === 'river' ? 'showdown' : 'street';
      return undefined;
    }
    this.turn = null;
    this.pending = 'street';
    this.emit({ type: 'runout' });
    return undefined;
  }

  dealStreet() {
    const next = STREETS[STREETS.indexOf(this.phase) + 1];
    const need = BOARD_AFTER[next] - this.board.length;
    const fresh = Array.from({ length: need }, () => this.deck.pop());
    this.board.push(...fresh);
    this.phase = next;
    this.currentBet = 0;
    this.minRaise = this.blinds.bb;
    this.raiseCount = 0;
    for (const p of this.players) {
      if (!p) continue;
      p.bet = 0;
      p.acted = false;
      p.seenRaise = -1;
      if (!p.folded) p.last = null;
    }
    this.emit({ type: 'street', phase: next, cards: fresh });
  }

  /**
   * While an all-in board is run out, the table calls this once per street.
   * It deals the next street, and the call after the river goes to the showdown.
   */
  advance() {
    if (!this.pending) return fail('There is nothing to deal.');
    if (this.pending === 'showdown') { this.pending = null; this.finish(true); return OK; }
    this.dealStreet();
    this.pending = this.phase === 'river' ? 'showdown' : 'street';
    return OK;
  }

  // ----------------------------------------------------------------- settling

  /** Split the pot. `showdown` is false when everyone else folded. */
  finish(showdown) {
    this.turn = null;
    this.pending = null;

    // The part of the biggest bet that nobody matched goes back to its owner.
    const sorted = this.players.filter(Boolean).sort((a, b) => b.total - a.total);
    const refunds = Array(SEATS).fill(0);
    if (sorted[0].total > sorted[1].total) {
      refunds[sorted[0].seat] = sorted[0].total - sorted[1].total;
      sorted[0].total = sorted[1].total;
    }
    this.potTotal = this.players.reduce((n, p) => n + (p?.total ?? 0), 0);

    const contenders = this.alive();
    const hands = {};
    if (showdown) {
      for (const p of contenders) {
        const e = evaluate([...p.hole, ...this.board]);
        hands[p.seat] = {
          cards: p.hole, score: e.score, category: e.category, best: e.best, name: describe(e.score),
        };
      }
    }

    const pots = this.buildPots(contenders).map((pot, i, all) => {
      const live = pot.eligible;
      let winners = live;
      if (showdown && live.length > 1) {
        const top = Math.max(...live.map((s) => hands[s].score));
        winners = live.filter((s) => hands[s].score === top);
      }
      // Odd chips go one at a time to the winners nearest the left of the button.
      const left = this.orderFrom(this.dealer);
      winners = [...winners].sort((a, b) => left.indexOf(a) - left.indexOf(b));
      const share = Math.floor(pot.amount / winners.length);
      let extra = pot.amount - share * winners.length;
      const shares = {};
      for (const s of winners) { shares[s] = share + (extra > 0 ? 1 : 0); extra -= extra > 0 ? 1 : 0; }
      return {
        amount: pot.amount, eligible: pot.eligible, winners, shares, label: i === 0 ? 'Main pot' : `Side pot ${i}`, sides: all.length,
      };
    });

    const won = Array(SEATS).fill(0);
    for (const pot of pots) for (const [s, v] of Object.entries(pot.shares)) won[Number(s)] += v;
    for (const p of this.players) {
      if (!p) continue;
      p.stack += won[p.seat] + refunds[p.seat];
    }

    this.phase = 'done';
    if (showdown) this.emit({ type: 'showdown', seats: contenders.map((p) => p.seat) });
    this.result = {
      showdown,
      pot: this.potTotal,
      pots,
      hands,
      refunds,
      won,
      net: this.players.map((p) => (p ? p.stack - p.start : 0)),
      stacks: this.players.map((p) => (p ? p.stack : 0)),
      winners: [...new Set(pots.flatMap((pot) => pot.winners))],
    };
    this.emit({ type: 'end', showdown });
  }

  /** Layer the contributions into a main pot and side pots, merging layers with the same claimants. */
  buildPots(contenders) {
    const live = new Set(contenders.map((p) => p.seat));
    const inHand = this.players.filter(Boolean);
    const levels = [...new Set(inHand.map((p) => p.total).filter((t) => t > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      const amount = inHand.reduce((n, p) => n + Math.min(p.total, level) - Math.min(p.total, prev), 0);
      const eligible = inHand.filter((p) => live.has(p.seat) && p.total >= level).map((p) => p.seat);
      prev = level;
      if (amount === 0) continue;
      const last = pots.at(-1);
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else if (eligible.length === 0) {
        // Only folded players reached this layer; it joins the pot below.
        if (last) last.amount += amount;
      } else pots.push({ amount, eligible });
    }
    return pots;
  }

  // -------------------------------------------------------------------- views

  /** Everything `seat` is allowed to see. Other players' hole cards appear only after a showdown. */
  view(seat) {
    const me = this.players[seat];
    const reveal = Boolean(this.result?.showdown);
    const myTurn = this.turn === seat && !this.pending && this.phase !== 'done';
    let handName = null;
    if (me && !me.folded && this.board.length >= 3) handName = describe(evaluate([...me.hole, ...this.board]).score);
    return {
      seat,
      phase: this.phase,
      dealer: this.dealer,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      blinds: { ...this.blinds },
      board: [...this.board],
      pot: this.pot(),
      currentBet: this.currentBet,
      turn: this.currentActor(),
      pending: this.pending,
      hole: me ? [...me.hole] : [],
      inHand: Boolean(me),
      handName,
      legal: myTurn ? this.legal(seat) : null,
      players: this.players.map((p) => (p ? {
        seat: p.seat,
        stack: p.stack,
        start: p.start,
        bet: p.bet,
        total: p.total,
        folded: p.folded,
        allIn: p.allIn,
        last: p.last,
        cards: p.seat === seat ? [...p.hole] : (reveal && !p.folded ? [...p.hole] : null),
      } : null)),
      result: this.result,
    };
  }
}
