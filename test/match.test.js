import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, blindsFor } from '../engine/match.js';
import { decide, equity, styleFor, safeMove } from '../engine/bots.js';
import { mulberry32 } from '../engine/cards.js';

test('blinds start at a fiftieth of the stack and climb on a schedule', () => {
  assert.deepEqual(blindsFor(1000, 0), { sb: 10, bb: 20 });
  assert.deepEqual(blindsFor(1000, 1), { sb: 15, bb: 30 });
  assert.deepEqual(blindsFor(1000, 2), { sb: 20, bb: 40 });
  assert.deepEqual(blindsFor(1000, 3), { sb: 30, bb: 60 });
  assert.deepEqual(blindsFor(2000, 0), { sb: 20, bb: 40 });
  assert.deepEqual(blindsFor(5000, 0), { sb: 50, bb: 100 });
  assert.deepEqual(blindsFor(5000, 1), { sb: 75, bb: 150 });
  for (const stack of [1000, 2000, 5000]) {
    let prev = 0;
    for (let l = 0; l < 20; l++) {
      const b = blindsFor(stack, l);
      assert.ok(Number.isInteger(b.sb) && Number.isInteger(b.bb) && b.bb === b.sb * 2, `${stack} level ${l}`);
      assert.ok(b.bb >= prev);
      prev = b.bb;
    }
  }
});

test('the match tracks when the blinds next rise', () => {
  const m = new Match({ seats: [0, 1, 2], handsPerLevel: 3, rng: mulberry32(1) });
  assert.equal(m.nextBlinds().rises, 3);
  assert.deepEqual({ sb: m.nextBlinds().sb, bb: m.nextBlinds().bb }, { sb: 10, bb: 20 });
  playHand(m);
  playHand(m);
  assert.equal(m.nextBlinds().rises, 1);
  playHand(m);
  assert.equal(m.nextBlinds().bb, 30);
  assert.equal(m.nextBlinds().next.bb, 40);
  playHand(m);
  assert.equal(m.hand.blinds.bb, 30, 'the fourth hand was dealt at the second level');
});

/** Play a hand to the end with the calling-station strategy: call everything, check when free. */
function playHand(m, strategy = null) {
  const h = m.startHand();
  let guard = 0;
  while (h.phase !== 'done') {
    assert.ok(++guard < 200);
    if (h.pending) { h.advance(); continue; }
    const seat = h.currentActor();
    const L = h.legal(seat);
    const a = strategy ? strategy(h, seat, L) : (L.canCheck ? { type: 'check' } : { type: 'call' });
    assert.equal(h.act(seat, a).ok, true);
  }
  m.settle();
  return h;
}

test('the button moves one live seat each hand and skips empty seats', () => {
  const m = new Match({ seats: [1, 3, 4], rng: mulberry32(3) });
  const seen = [];
  for (let i = 0; i < 6; i++) { playHand(m); seen.push(m.dealer); }
  for (let i = 1; i < seen.length; i++) {
    const order = [1, 3, 4];
    assert.equal(seen[i], order[(order.indexOf(seen[i - 1]) + 1) % 3], `hand ${i + 1}`);
  }
});

test('stacks carry over, chips are conserved and a busted player is out for good', () => {
  const m = new Match({ seats: [0, 1, 2], stack: 1000, length: 'freezeout', rng: mulberry32(11) });
  const shove = (h, seat, L) => (L.canRaise ? { type: 'allin' } : L.canCall ? { type: 'call' } : { type: 'check' });
  let hands = 0;
  while (!m.finished) {
    playHand(m, shove);
    hands += 1;
    assert.equal(m.total(), 3000);
    assert.ok(hands < 200);
  }
  assert.equal(m.alive().length, 1);
  assert.equal(m.chips(m.alive()[0]), 3000);
  assert.equal(m.busted.length, 2);
  const st = m.standings();
  assert.equal(st[0].place, 1);
  assert.deepEqual(st.map((x) => x.place), [1, 2, 3]);
  assert.equal(st[0].seat, m.alive()[0]);
  assert.deepEqual(st.slice(1).map((x) => x.seat), [...m.busted].reverse().map((b) => b.seat));
  assert.throws(() => m.startHand(), /over/);
});

test('a fixed-length match ends after that many hands, and equal stacks share a place', () => {
  const m = new Match({ seats: [0, 1], length: 2, rng: mulberry32(2) });
  playHand(m);
  assert.equal(m.finished, false);
  playHand(m);
  assert.equal(m.finished, true);
  assert.equal(m.history.length, 2);
  const st = m.standings();
  assert.equal(st.length, 2);
  assert.equal(st[0].chips + st[1].chips, 2000);
  assert.equal(st[0].place, 1);
  assert.equal(st[1].place, st[0].chips === st[1].chips ? 1 : 2);
});

test('a match needs two players, and a hand must be settled before the next', () => {
  assert.throws(() => new Match({ seats: [0] }));
  const m = new Match({ seats: [0, 1], rng: mulberry32(2) });
  const h = m.startHand();
  assert.throws(() => m.settle(), /not over/);
  while (h.phase !== 'done') {
    if (h.pending) { h.advance(); continue; }
    const seat = h.currentActor();
    h.act(seat, h.legal(seat).canCheck ? { type: 'check' } : { type: 'call' });
  }
  assert.throws(() => m.startHand(), /Settle/);
  m.settle();
  m.settle(); // settling twice is harmless
  assert.equal(m.history.length, 1);
});

test('players who bust on the same hand finish in order of their starting stack', () => {
  const m = new Match({ seats: [0, 1, 2], stack: 1000, length: 'freezeout', rng: mulberry32(5) });
  m.stacks = [1000, 300, 600];
  m.dealer = 1; // the button moves to seat 2: small blind 0, big blind 1, and seat 2 acts first
  const h = m.startHand();
  h.players[0].hole = ['AS', 'AD'];
  h.players[1].hole = ['7C', '2D'];
  h.players[2].hole = ['8C', '3D'];
  h.deck = ['4S', '5H', '9D', 'JC', 'KS'].reverse(); // the board plays out as dealt: no help for anyone
  h.act(2, { type: 'allin' });
  h.act(0, { type: 'call' });
  h.act(1, { type: 'call' });
  while (h.pending) h.advance();
  assert.equal(h.phase, 'done');
  m.settle();
  assert.deepEqual(m.alive(), [0]);
  assert.equal(m.chips(0), 1900);
  assert.deepEqual(m.busted.map((b) => b.seat), [1, 2], 'the smaller stack went out first');
  assert.deepEqual(m.standings().map((x) => [x.seat, x.place]), [[0, 1], [2, 2], [1, 3]]);
  assert.equal(m.finished, true);
});

// ------------------------------------------------------------------- bots

test('equity is sane: aces beat a random hand most of the time, seven-deuce rarely does', () => {
  const rng = mulberry32(9);
  const aces = equity({
    hole: ['AS', 'AD'], board: [], opponents: 1, samples: 1500, rng,
  });
  const trash = equity({
    hole: ['7C', '2D'], board: [], opponents: 1, samples: 1500, rng,
  });
  assert.ok(aces > 0.8 && aces < 0.9, `aces ${aces}`);
  assert.ok(trash > 0.3 && trash < 0.42, `72o ${trash}`);
  const crowd = equity({
    hole: ['AS', 'AD'], board: [], opponents: 5, samples: 1500, rng,
  });
  assert.ok(crowd < aces && crowd > 0.45, `aces against five ${crowd}`);
  // A made hand on the river is near certain.
  const nuts = equity({
    hole: ['AS', 'KS'], board: ['QS', 'JS', '10S', '2C', '3D'], opponents: 3, samples: 300, rng,
  });
  assert.equal(nuts, 1);
  // Drawing dead: nothing but the board and the opponent already ahead on a coordinated board.
  assert.ok(equity({
    hole: ['2C', '3D'], board: ['AH', 'KH', 'QH', 'JH', '10H'], opponents: 1, samples: 100, rng,
  }) <= 0.5);
});

test('bots always choose a legal move, over many hands, and styles differ by name', () => {
  assert.notDeepEqual(styleFor('Mira'), styleFor('Dev'));
  assert.deepEqual(styleFor('Mira'), styleFor('Mira'));
  const rng = mulberry32(77);
  const kinds = new Set();
  for (let g = 0; g < 50; g++) {
    const m = new Match({ seats: [0, 1, 2, 3, 4, 5].slice(0, 2 + (g % 5)), length: 'freezeout', rng: mulberry32(g + 1) });
    let hands = 0;
    while (!m.finished && hands < 6) {
      const h = m.startHand();
      let guard = 0;
      while (h.phase !== 'done') {
        assert.ok(++guard < 300);
        if (h.pending) { h.advance(); continue; }
        const seat = h.currentActor();
        const a = decide(h.view(seat), rng, styleFor(`bot${seat}`), 12);
        kinds.add(a.type);
        const r = h.act(seat, a);
        assert.equal(r.ok, true, `game ${g}: ${JSON.stringify(a)} by ${seat}: ${r.error}`);
      }
      m.settle();
      assert.equal(m.total(), m.stack * (2 + (g % 5)));
      hands += 1;
    }
  }
  for (const k of ['fold', 'check', 'call', 'raise']) assert.ok(kinds.has(k), `a bot never played ${k}`);
});

test('a bot does not decide when it is not its turn, and the sit-out move is check or fold', () => {
  const m = new Match({ seats: [0, 1, 2], rng: mulberry32(4) });
  const h = m.startHand();
  const other = (h.currentActor() + 1) % 3;
  assert.equal(decide(h.view(other), Math.random, undefined, 10), null);
  assert.equal(safeMove(h.view(other)), null);
  const seat = h.currentActor();
  assert.deepEqual(safeMove(h.view(seat)), { type: 'fold' });
  h.act(seat, { type: 'call' });
  h.act(h.currentActor(), { type: 'call' });
  assert.deepEqual(safeMove(h.view(h.currentActor())), { type: 'check' });
});

test('facing a big bet, bots with strong hands stay in and bots with trash usually fold', () => {
  const rng = mulberry32(5);
  let strongPlays = 0;
  let trashFolds = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    for (const [cards, kind] of [[['AS', 'AD'], 'strong'], [['7C', '2D'], 'trash']]) {
      const m = new Match({ seats: [0, 1, 2], rng: mulberry32(100 + i) });
      const h = m.startHand();
      const raiser = h.currentActor();
      h.act(raiser, { type: 'raise', to: 200 }); // ten times the big blind
      const seat = h.currentActor();
      h.players[seat].hole = cards;
      const a = decide(h.view(seat), rng, styleFor('x'), 100);
      if (kind === 'strong' && a.type !== 'fold') strongPlays += 1;
      if (kind === 'trash' && a.type === 'fold') trashFolds += 1;
    }
  }
  assert.ok(strongPlays >= N * 0.95, `${strongPlays}`);
  assert.ok(trashFolds >= N * 0.8, `${trashFolds}`);
});
