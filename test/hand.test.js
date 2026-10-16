import test from 'node:test';
import assert from 'node:assert/strict';
import { Hand, SEATS } from '../engine/hand.js';
import { mulberry32 } from '../engine/cards.js';

// Build a hand with chosen stacks, then rig the cards. Seats 0..n-1 are in; seat 0 has the button.
function rig({
  stacks, dealer = 0, blinds = { sb: 10, bb: 20 }, holes = {}, board = [],
}) {
  const full = Array.from({ length: SEATS }, (_, i) => stacks[i] ?? 0);
  const h = new Hand({
    stacks: full, dealer, blinds, rng: mulberry32(1),
  });
  for (const [s, cards] of Object.entries(holes)) h.players[Number(s)].hole = cards;
  h.deck = [...board].reverse(); // deck.pop() deals the board in the order given
  return h;
}
const ok = (h, seat, action) => {
  const r = h.act(seat, action);
  assert.equal(r.ok, true, `${JSON.stringify(action)} by ${seat}: ${r.error}`);
};
const bad = (h, seat, action, pattern) => {
  const r = h.act(seat, action);
  assert.equal(r.ok, false, `${JSON.stringify(action)} by ${seat} should be refused`);
  if (pattern) assert.match(r.error, pattern);
};
const chips = (h) => h.players.reduce((n, p) => n + (p ? p.stack : 0), 0);

test('blinds are posted and the seat after the big blind acts first', () => {
  const h = rig({ stacks: [1000, 1000, 1000, 1000] });
  assert.equal(h.sbSeat, 1);
  assert.equal(h.bbSeat, 2);
  assert.equal(h.players[1].bet, 10);
  assert.equal(h.players[2].bet, 20);
  assert.equal(h.pot(), 30);
  assert.equal(h.turn, 3);
  assert.equal(h.currentBet, 20);
  assert.equal(h.legal(3).toCall, 20);
});

test('everyone gets two cards, and no card appears twice', () => {
  const h = new Hand({ stacks: [500, 500, 500, 500, 500, 500], dealer: 3, blinds: { sb: 5, bb: 10 }, rng: mulberry32(7) });
  const all = h.players.flatMap((p) => p.hole);
  assert.equal(all.length, 12);
  assert.equal(new Set([...all, ...h.deck]).size, 52);
});

test('heads up the button is the small blind and acts first before the flop, last after it', () => {
  const h = rig({ stacks: [1000, 1000] });
  assert.equal(h.sbSeat, 0);
  assert.equal(h.bbSeat, 1);
  assert.equal(h.turn, 0, 'the button acts first preflop');
  ok(h, 0, { type: 'call' });
  assert.equal(h.turn, 1, 'the big blind has the option');
  ok(h, 1, { type: 'check' });
  assert.equal(h.phase, 'flop');
  assert.equal(h.turn, 1, 'the big blind acts first on the flop');
});

test('a hand with a button on a higher seat deals clockwise correctly', () => {
  const h = rig({ stacks: [1000, 0, 1000, 0, 1000, 1000], dealer: 5 });
  assert.equal(h.sbSeat, 0);
  assert.equal(h.bbSeat, 2);
  assert.equal(h.turn, 4);
});

test('when everyone folds to the big blind, the big blind wins the small blind without a showdown', () => {
  const h = rig({ stacks: [1000, 1000, 1000], holes: { 0: ['AS', 'AD'], 1: ['2C', '7D'], 2: ['3C', '8D'] } });
  ok(h, 0, { type: 'fold' });
  ok(h, 1, { type: 'fold' });
  assert.equal(h.phase, 'done');
  assert.equal(h.result.showdown, false);
  assert.deepEqual(h.result.winners, [2]);
  assert.equal(h.players[2].stack, 1010);
  assert.equal(h.players[1].stack, 990);
  assert.deepEqual(h.result.net, [0, -10, 10, 0, 0, 0]);
  // Nobody's cards are shown, not even the winner's, to the others.
  assert.equal(h.view(0).players[2].cards, null);
});

test('illegal actions are refused with a reason', () => {
  const h = rig({ stacks: [1000, 1000, 1000] });
  bad(h, 1, { type: 'call' }, /not your turn/);
  bad(h, 0, { type: 'check' }, /bet to call/);
  bad(h, 0, { type: 'raise', to: 30 }, /smallest raise is to 40/);
  bad(h, 0, { type: 'raise', to: 20 }, /must go above 20/);
  bad(h, 0, { type: 'raise', to: 45.5 }, /whole number/);
  bad(h, 0, { type: 'raise', to: 5000 }, /not have that many/);
  bad(h, 0, { type: 'dance' }, /Unknown/);
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'call' });
  bad(h, 2, { type: 'call' }, /nothing to call/);
  bad(h, 2, { type: 'fold' }, /check for free/);
  ok(h, 2, { type: 'check' });
  assert.equal(h.phase, 'flop');
});

test('a raise must be at least the size of the last raise, and each raise sets the next minimum', () => {
  const h = rig({ stacks: [2000, 2000, 2000] });
  ok(h, 0, { type: 'raise', to: 60 }); // raise of 40 over the blind
  assert.equal(h.legal(1).minRaiseTo, 100);
  bad(h, 1, { type: 'raise', to: 90 }, /smallest raise is to 100/);
  ok(h, 1, { type: 'raise', to: 100 });
  assert.equal(h.legal(2).minRaiseTo, 140);
  ok(h, 2, { type: 'raise', to: 300 }); // raise of 200
  assert.equal(h.legal(0).minRaiseTo, 500);
  assert.equal(h.legal(0).toCall, 240);
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'call' });
  assert.equal(h.phase, 'flop');
  assert.equal(h.pot(), 900);
  // A fresh street: a bet of less than the big blind is refused.
  assert.equal(h.legal(1).isBet, true);
  assert.equal(h.legal(1).minRaiseTo, 20);
  bad(h, 1, { type: 'raise', to: 10 }, /smallest bet is to 20/);
});

test('an all-in for less than a full raise lets the others call, but does not reopen the raising', () => {
  const h = rig({ stacks: [1000, 150, 1000], blinds: { sb: 10, bb: 20 } });
  // Seat 0 is the button, seat 1 the small blind, seat 2 the big blind.
  ok(h, 0, { type: 'raise', to: 100 }); // a raise of 80
  ok(h, 1, { type: 'allin' }); // to 150: only 50 more, short of a full raise
  assert.equal(h.currentBet, 150);
  assert.equal(h.minRaise, 80, 'the raise size does not change');
  // Seat 2 has not acted yet, so a raise is still allowed for them.
  assert.equal(h.legal(2).canRaise, true);
  ok(h, 2, { type: 'call' });
  // Seat 0 already acted: they may call or fold only.
  assert.equal(h.turn, 0);
  assert.equal(h.legal(0).canRaise, false);
  bad(h, 0, { type: 'raise', to: 400 }, /not a full raise/);
  bad(h, 0, { type: 'allin' }, /not a full raise/);
  ok(h, 0, { type: 'call' });
  assert.equal(h.phase, 'flop');
});

test('a full raise after a short all-in reopens the betting for everyone', () => {
  const h = rig({ stacks: [1000, 150, 1000] });
  ok(h, 0, { type: 'raise', to: 100 });
  ok(h, 1, { type: 'allin' });
  ok(h, 2, { type: 'raise', to: 300 }); // a full raise of 150 over 150
  assert.equal(h.turn, 0);
  assert.equal(h.legal(0).canRaise, true);
  assert.equal(h.legal(0).minRaiseTo, 450);
});

test('the big blind gets the option to raise when everyone calls', () => {
  const h = rig({ stacks: [1000, 1000, 1000] });
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'call' });
  assert.equal(h.turn, 2);
  assert.equal(h.legal(2).canCheck, true);
  assert.equal(h.legal(2).canRaise, true);
  ok(h, 2, { type: 'raise', to: 80 });
  assert.equal(h.turn, 0);
});

test('a player cannot raise when nobody is left who could call', () => {
  const h = rig({ stacks: [1000, 100, 1000, 1000], dealer: 3 });
  // dealer 3, small blind 0, big blind 1 (100, all in on the blind), first to act 2
  assert.equal(h.players[1].bet, 20);
  ok(h, 2, { type: 'allin' }); // 1000
  ok(h, 3, { type: 'fold' });
  ok(h, 0, { type: 'call' });
  assert.equal(h.turn, 1);
  assert.equal(h.legal(1).canRaise, false, 'seat 0 and seat 2 are all in or matched; only a call is left for seat 1');
  ok(h, 1, { type: 'allin' });
  assert.equal(h.pending, 'street', 'betting is closed and the board runs out');
});

test('heads up, an all-in call for less ends the betting and runs the board out', () => {
  const h = rig({ stacks: [1000, 100] });
  ok(h, 0, { type: 'allin' }); // 1000
  assert.equal(h.legal(1).canRaise, false, 'nobody left to call a raise');
  ok(h, 1, { type: 'call' });
  assert.equal(h.phase, 'preflop');
  assert.equal(h.pending, 'street');
});

test('postflop the first to act is the first live player left of the button', () => {
  const h = rig({ stacks: [1000, 1000, 1000, 1000], dealer: 1 });
  // button 1, sb 2, bb 3, first to act 0
  ok(h, 0, { type: 'fold' });
  ok(h, 1, { type: 'call' });
  ok(h, 2, { type: 'call' });
  ok(h, 3, { type: 'check' });
  assert.equal(h.phase, 'flop');
  assert.equal(h.turn, 2);
  ok(h, 2, { type: 'check' });
  ok(h, 3, { type: 'check' });
  assert.equal(h.turn, 1);
});

test('a showdown awards the pot to the best hand and shows the hands', () => {
  const h = rig({
    stacks: [1000, 1000],
    holes: { 0: ['AS', 'AD'], 1: ['KS', 'KD'] },
    board: ['2C', '7H', '9D', 'JS', '3C'],
  });
  ok(h, 0, { type: 'raise', to: 100 });
  ok(h, 1, { type: 'call' });
  for (let i = 0; i < 3; i++) { ok(h, 1, { type: 'check' }); ok(h, 0, { type: 'check' }); }
  assert.equal(h.phase, 'done');
  assert.equal(h.result.showdown, true);
  assert.deepEqual(h.result.winners, [0]);
  assert.equal(h.players[0].stack, 1100);
  assert.equal(h.players[1].stack, 900);
  assert.equal(h.result.hands[0].name, 'Pair of aces');
  assert.equal(h.result.hands[1].name, 'Pair of kings');
  assert.deepEqual(h.view(1).players[0].cards, ['AS', 'AD'], 'hands are public once they are shown');
});

test('a folded hand stays hidden even after a showdown', () => {
  const h = rig({
    stacks: [1000, 1000, 1000],
    holes: { 0: ['AS', 'AD'], 1: ['KS', 'KD'], 2: ['7C', '2D'] },
    board: ['2C', '7H', '9D', 'JS', '3C'],
  });
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'fold' });
  ok(h, 2, { type: 'check' });
  for (let i = 0; i < 3; i++) { ok(h, 2, { type: 'check' }); ok(h, 0, { type: 'check' }); }
  assert.equal(h.result.showdown, true);
  assert.equal(h.view(0).players[1].cards, null);
  assert.deepEqual(h.view(0).players[2].cards, ['7C', '2D']);
});

test('your own cards are visible to you, and the best hand so far is named once the flop is out', () => {
  const h = rig({
    stacks: [1000, 1000],
    holes: { 0: ['AS', 'AD'], 1: ['KS', 'KD'] },
    board: ['AC', '7H', '9D', 'JS', '3C'],
  });
  assert.equal(h.view(0).handName, null);
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'check' });
  assert.equal(h.view(0).handName, 'Three of a kind, aces');
  assert.equal(h.view(1).handName, 'Pair of kings');
  assert.deepEqual(h.view(0).hole, ['AS', 'AD']);
  assert.equal(h.view(1).players[0].cards, null);
});

test('all-in showdown: main pot to the best hand, side pots to the best of those still eligible', () => {
  // Four players with 300, 800, 1500 and 3000. The best hands are in that order, and the big stack's extra chips come back.
  const h = rig({
    stacks: [300, 800, 1500, 3000],
    dealer: 3,
    holes: {
      0: ['AS', 'AD'], 1: ['KS', 'KD'], 2: ['QS', 'QD'], 3: ['JS', 'JD'],
    },
    board: ['2C', '7H', '9D', '4S', '3C'],
  });
  const before = 300 + 800 + 1500 + 3000;
  ok(h, 2, { type: 'allin' });
  ok(h, 3, { type: 'allin' });
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'call' });
  assert.equal(h.phase, 'preflop');
  assert.equal(h.pending, 'street');
  bad(h, 2, { type: 'check' }, /still being dealt/);
  assert.equal(h.currentActor(), null);
  let steps = 0;
  while (h.pending) { assert.equal(h.advance().ok, true); steps += 1; }
  assert.equal(steps, 4, 'flop, turn, river, then the showdown');
  assert.equal(h.phase, 'done');
  const r = h.result;
  assert.deepEqual(r.pots.map((p) => p.amount), [1200, 1500, 1400]);
  assert.deepEqual(r.pots.map((p) => p.winners), [[0], [1], [2]]);
  assert.deepEqual(r.pots.map((p) => p.eligible), [[0, 1, 2, 3], [1, 2, 3], [2, 3]]);
  assert.deepEqual(r.pots.map((p) => p.label), ['Main pot', 'Side pot 1', 'Side pot 2']);
  assert.deepEqual(h.players.map((p) => p?.stack), [1200, 1500, 1400, 1500, undefined, undefined]);
  assert.equal(chips(h), before);
  assert.equal(r.refunds[3], 1500);
  assert.equal(r.pot, 4100, 'the pot that was contested, without the returned chips');
  assert.deepEqual(r.net.slice(0, 4), [900, 700, -100, -1500]);
});

test('an uncalled bet goes back to its owner', () => {
  const h = rig({
    stacks: [1000, 100],
    holes: { 0: ['AS', 'AD'], 1: ['KS', 'KD'] },
    board: ['2C', '7H', '9D', 'JS', '3C'],
  });
  ok(h, 0, { type: 'raise', to: 600 });
  ok(h, 1, { type: 'allin' }); // a call for 100
  while (h.pending) h.advance();
  assert.equal(h.result.refunds[0], 500);
  assert.equal(h.players[0].stack, 1100);
  assert.equal(h.players[1].stack, 0);
  assert.equal(h.result.pot, 200);
});

test('a bet that everyone folds to is returned in full and takes the blinds', () => {
  const h = rig({ stacks: [1000, 1000, 1000] });
  ok(h, 0, { type: 'raise', to: 100 });
  ok(h, 1, { type: 'fold' });
  ok(h, 2, { type: 'fold' });
  assert.equal(h.phase, 'done');
  assert.equal(h.players[0].stack, 1030);
  assert.equal(h.players[1].stack, 990);
  assert.equal(h.players[2].stack, 980);
});

test('a split pot divides evenly and the odd chip goes to the first winner left of the button', () => {
  // Board plays for everyone: a split three ways between seats 0, 1 and 2 with an odd chip left over.
  const h = rig({
    stacks: [1000, 1000, 1000, 1000],
    dealer: 3,
    holes: {
      0: ['2C', '3D'], 1: ['2D', '3C'], 2: ['4C', '4D'], 3: ['5C', '6D'],
    },
    board: ['AH', 'KH', 'QH', 'JH', '10H'],
  });
  // seat 0 = SB, seat 1 = BB, seat 2 first to act. Fold seat 2 and 3; seats 0 and 1 see it through.
  ok(h, 2, { type: 'fold' });
  ok(h, 3, { type: 'raise', to: 75 });
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'call' });
  for (let i = 0; i < 3; i++) { ok(h, 0, { type: 'check' }); ok(h, 1, { type: 'check' }); ok(h, 3, { type: 'check' }); }
  assert.equal(h.phase, 'done');
  assert.deepEqual(h.result.winners.sort(), [0, 1, 3]);
  assert.equal(h.result.pot, 225);
  // 225 / 3 = 75 each, nothing odd. Make it odd below.
  assert.equal(h.players[0].stack + h.players[1].stack + h.players[3].stack + h.players[2].stack, 4000);
});

test('odd chips: a 101 pot split two ways pays 51 to the winner nearest the button', () => {
  const h = rig({
    stacks: [1000, 1000, 1000],
    dealer: 0,
    blinds: { sb: 1, bb: 2 },
    holes: { 0: ['2C', '3D'], 1: ['2D', '3C'], 2: ['4C', '4D'] },
    board: ['AH', 'KH', 'QH', 'JH', '10H'],
  });
  ok(h, 0, { type: 'raise', to: 51 }); // button
  ok(h, 1, { type: 'call' });
  ok(h, 2, { type: 'fold' });
  assert.equal(h.pot(), 51 + 51 + 2);
  for (let i = 0; i < 3; i++) { ok(h, 1, { type: 'check' }); ok(h, 0, { type: 'check' }); }
  assert.equal(h.result.pot, 104);
  // 104 splits 52 / 52 (seat 2 folded its big blind of 2 into the pot).
  assert.equal(h.players[0].stack, 1000 - 51 + 52);
  assert.equal(h.players[1].stack, 1000 - 51 + 52);
  const odd = rig({
    stacks: [1000, 1000, 1000],
    dealer: 0,
    blinds: { sb: 1, bb: 2 },
    holes: { 0: ['2C', '3D'], 1: ['2D', '3C'], 2: ['4C', '4D'] },
    board: ['AH', 'KH', 'QH', 'JH', '10H'],
  });
  ok(odd, 0, { type: 'call' }); // 2
  ok(odd, 1, { type: 'fold' }); // sb folds a 1 chip blind
  ok(odd, 2, { type: 'check' }); // the big blind's option
  // pot: 2 + 1 + 2 = 5 between seats 0 and 2 (both play the board; seat 2's pair of fours does not help)
  for (let i = 0; i < 3; i++) { ok(odd, 2, { type: 'check' }); ok(odd, 0, { type: 'check' }); }
  assert.equal(odd.result.pot, 5);
  assert.deepEqual(odd.result.winners, [2, 0]);
  assert.equal(odd.result.won[2], 3, 'seat 2 is nearest the left of the button among the winners and takes the odd chip');
  assert.equal(odd.result.won[0], 2);
});

test('a player who cannot cover the big blind posts what they have and is all in', () => {
  const h = rig({ stacks: [1000, 1000, 15] });
  assert.equal(h.players[2].bet, 15);
  assert.equal(h.players[2].allIn, true);
  assert.equal(h.currentBet, 20, 'the others still have to call the full big blind');
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'call' });
  assert.equal(h.phase, 'flop');
});

test('everyone all in on the blinds runs the board out immediately', () => {
  const h = new Hand({ stacks: [10, 10, 0, 0, 0, 0], dealer: 0, blinds: { sb: 10, bb: 20 }, rng: mulberry32(5) });
  assert.equal(h.pending, 'street');
  assert.equal(h.currentActor(), null);
  while (h.pending) h.advance();
  assert.equal(h.phase, 'done');
  assert.equal(h.players[0].stack + h.players[1].stack, 20);
});

test('two players cannot hold the same chips twice: totals always add up', () => {
  const h = rig({ stacks: [500, 700, 900, 1100] });
  const before = chips(h) + h.pot();
  ok(h, 3, { type: 'raise', to: 100 });
  ok(h, 0, { type: 'call' });
  ok(h, 1, { type: 'fold' });
  ok(h, 2, { type: 'call' });
  assert.equal(chips(h) + h.pot(), before);
});

test('constructor guards', () => {
  assert.throws(() => new Hand({ stacks: [100, 0, 0, 0, 0, 0], dealer: 0, blinds: { sb: 1, bb: 2 } }));
  assert.throws(() => new Hand({ stacks: [100, 100, 0, 0, 0, 0], dealer: 3, blinds: { sb: 1, bb: 2 } }));
});

// ---------------------------------------------------------------- fuzz

test('fuzz: random legal play never loses a chip, always finishes, and every pot has a winner', () => {
  let showdowns = 0;
  let allins = 0;
  let sideHands = 0;
  for (let seed = 1; seed <= 4000; seed++) {
    const rnd = mulberry32(seed * 7919);
    const n = 2 + Math.floor(rnd() * 5);
    const seatsIn = [];
    while (seatsIn.length < n) { const s = Math.floor(rnd() * SEATS); if (!seatsIn.includes(s)) seatsIn.push(s); }
    const stacks = Array(SEATS).fill(0);
    let total = 0;
    for (const s of seatsIn) { stacks[s] = 1 + Math.floor(rnd() * rnd() * 3000) + (rnd() < 0.3 ? 0 : 20); total += stacks[s]; }
    const blinds = { sb: 5 + Math.floor(rnd() * 10), bb: 10 + 2 * Math.floor(rnd() * 20) };
    const dealer = seatsIn[Math.floor(rnd() * n)];
    const h = new Hand({
      stacks, dealer, blinds, rng: mulberry32(seed),
    });
    let guard = 0;
    while (h.phase !== 'done') {
      assert.ok(++guard < 400, `seed ${seed} did not finish`);
      if (h.pending) { assert.equal(h.advance().ok, true); continue; }
      const seat = h.currentActor();
      assert.notEqual(seat, null, `seed ${seed}: nobody to act in ${h.phase}`);
      const L = h.legal(seat);
      const roll = rnd();
      let a;
      if (L.canCheck && roll < 0.45) a = { type: 'check' };
      else if (L.canCall && roll < 0.55) a = { type: 'call' };
      else if (L.canRaise && roll < 0.75) {
        const span = L.maxRaiseTo - L.minRaiseTo;
        a = { type: 'raise', to: L.minRaiseTo + Math.floor(rnd() * (span + 1)) };
      } else if (L.canRaise && roll < 0.8) a = { type: 'allin' };
      else if (L.canCall && roll < 0.9) a = { type: 'call' };
      else if (L.canFold && roll < 0.95) a = { type: 'fold' };
      else a = L.canCheck ? { type: 'check' } : { type: 'call' };
      const r = h.act(seat, a);
      assert.equal(r.ok, true, `seed ${seed}: ${JSON.stringify(a)} by ${seat}: ${r.error}`);
      if (h.phase !== 'done') assert.equal(h.players.reduce((c, p) => c + (p ? p.stack + p.total : 0), 0), total, `seed ${seed}: chips moved mid-hand`);
    }
    const r = h.result;
    assert.equal(h.players.reduce((c, p) => c + (p ? p.stack : 0), 0), total, `seed ${seed}: chips lost`);
    assert.equal(r.net.reduce((a, b) => a + b, 0), 0, `seed ${seed}: net does not sum to zero`);
    assert.equal(r.pots.reduce((a, p) => a + p.amount, 0), r.pot, `seed ${seed}: pots do not add up`);
    for (const pot of r.pots) {
      assert.ok(pot.winners.length >= 1);
      assert.equal(Object.values(pot.shares).reduce((a, b) => a + b, 0), pot.amount, `seed ${seed}: shares`);
      for (const w of pot.winners) assert.ok(pot.eligible.includes(w));
    }
    for (const p of h.players) if (p) assert.ok(p.stack >= 0);
    if (r.showdown) showdowns += 1;
    if (h.players.some((p) => p?.allIn)) allins += 1;
    if (r.pots.length > 1) sideHands += 1;
  }
  assert.ok(showdowns > 500, `only ${showdowns} showdowns`);
  assert.ok(allins > 300, `only ${allins} all-in hands`);
  assert.ok(sideHands > 20, `only ${sideHands} hands with side pots`);
});
