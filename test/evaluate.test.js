import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate, score5, describe, categoryOf, CATEGORY,
} from '../engine/evaluate.js';
import { makeDeck, shuffle, mulberry32 } from '../engine/cards.js';

const hand = (s) => s.split(' ');
const score = (s) => evaluate(hand(s)).score;

test('every category is recognised', () => {
  const cases = [
    ['AS KD 9C 5H 2D', CATEGORY.HIGH],
    ['AS AD 9C 5H 2D', CATEGORY.PAIR],
    ['AS AD 9C 9H 2D', CATEGORY.TWO_PAIR],
    ['AS AD AC 9H 2D', CATEGORY.TRIPS],
    ['5S 6D 7C 8H 9D', CATEGORY.STRAIGHT],
    ['AS 9S 7S 5S 2S', CATEGORY.FLUSH],
    ['AS AD AC 9H 9D', CATEGORY.FULL_HOUSE],
    ['AS AD AC AH 2D', CATEGORY.QUADS],
    ['5S 6S 7S 8S 9S', CATEGORY.STRAIGHT_FLUSH],
  ];
  for (const [cards, cat] of cases) assert.equal(categoryOf(score(cards)), cat, cards);
});

test('categories rank in the right order', () => {
  const ladder = [
    '7S 5D 4C 3H 2D', 'AS AD 9C 5H 2D', 'AS AD 9C 9H 2D', '2S 2D 2C 9H 4D', '5S 6D 7C 8H 9D',
    'AS 9S 7S 5S 2S', '2S 2D 2C 3H 3D', '2S 2D 2C 2H 3D', '5S 6S 7S 8S 9S',
  ].map(score);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] > ladder[i - 1], `rung ${i}`);
});

test('the wheel is the lowest straight and a steel wheel the lowest straight flush', () => {
  const wheel = score('AS 2D 3C 4H 5D');
  const six = score('2S 3D 4C 5H 6D');
  assert.equal(categoryOf(wheel), CATEGORY.STRAIGHT);
  assert.ok(six > wheel);
  assert.ok(wheel > score('AS AD AC KH QD'), 'a wheel beats trip aces');
  const steel = score('AS 2S 3S 4S 5S');
  assert.equal(categoryOf(steel), CATEGORY.STRAIGHT_FLUSH);
  assert.ok(steel < score('2S 3S 4S 5S 6S'));
  assert.equal(describe(wheel), 'Straight, five high');
});

test('ace-high straight and broadway', () => {
  assert.equal(describe(score('TS JD QC KH AD'.replace('TS', '10S'))), 'Straight, ace high');
  assert.equal(describe(score('10S JS QS KS AS')), 'Royal flush');
});

test('kickers decide between equal pairs, and low cards matter down to the fifth', () => {
  assert.ok(score('AS AD KC 5H 2D') > score('AC AH QC 5S 2H'));
  assert.ok(score('AS KD 9C 5H 3D') > score('AC KH 9S 5D 2H'));
  assert.equal(score('AS KD 9C 5H 3D'), score('AC KH 9S 5D 3H'));
  assert.ok(score('KS KD 9C 9H 2D') > score('QS QD JC JH AD'), 'higher top pair wins');
  assert.ok(score('KS KD 9C 9H 3D') > score('KC KH 9S 9D 2H'), 'two pair kicker');
});

test('full houses compare the trips first, then the pair', () => {
  assert.ok(score('3S 3D 3C 2H 2D') > score('2S 2D 2C AH AD'));
  assert.ok(score('KS KD KC 4H 4D') > score('KC KH KS 3H 3D'));
});

test('the best five of seven are chosen', () => {
  const e = evaluate(hand('AS AD 2C 7H 9D KS KC'));
  assert.equal(e.category, CATEGORY.TWO_PAIR);
  assert.equal(describe(e.score), 'Two pair, aces and kings');
  // The kicker is the best remaining card, not one of the leftovers.
  assert.equal(e.score, score('AS AD KS KC 9D'));
  // A flush hiding in seven cards.
  assert.equal(evaluate(hand('2H 9H JH 3H KH AS AD')).category, CATEGORY.FLUSH);
  // Six cards of one suit: the top five count.
  assert.equal(describe(evaluate(hand('2H 9H JH 3H KH 5H AS')).score), 'Flush, king high');
  // The board plays: both players hold the same best five.
  const board = hand('AH KH QH JH 10H');
  assert.equal(evaluate([...board, '2C', '3D']).score, evaluate([...board, '4C', '5D']).score);
});

test('hand names read naturally', () => {
  assert.equal(describe(score('6S 6D 6C 6H 2D')), 'Four of a kind, sixes');
  assert.equal(describe(score('KS KD KC 4H 4D')), 'Full house, kings over fours');
  assert.equal(describe(score('AS 9S 7S 5S 2S')), 'Flush, ace high');
  assert.equal(describe(score('9S 9D 9C 4H 2D')), 'Three of a kind, nines');
  assert.equal(describe(score('JS JD 4C 4H 2D')), 'Two pair, jacks and fours');
  assert.equal(describe(score('10S 10D 9C 5H 2D')), 'Pair of tens');
  assert.equal(describe(score('QS 9D 7C 5H 2D')), 'High card, queen');
  assert.equal(describe(score('2S 3S 4S 5S 6S')), 'Straight flush, six high');
});

test('evaluate rejects the wrong number of cards', () => {
  assert.throws(() => evaluate(hand('AS KD 9C 5H')));
  assert.throws(() => evaluate(makeDeck().slice(0, 8)));
});

test('scores are a strict total order consistent with a brute-force comparison', () => {
  // Compare the integer scores of 4000 random five-card pairs with an independent, slower ranking.
  const rank = (cards) => {
    const v = cards.map((c) => ({ A: 14, K: 13, Q: 12, J: 11 }[c.slice(0, -1)] ?? Number(c.slice(0, -1)))).sort((a, b) => b - a);
    const flush = new Set(cards.map((c) => c.slice(-1))).size === 1;
    const uniq = [...new Set(v)];
    let straight = uniq.length === 5 && v[0] - v[4] === 4 ? v[0] : 0;
    if (uniq.length === 5 && v.join() === '14,5,4,3,2') straight = 5;
    const counts = {};
    v.forEach((x) => { counts[x] = (counts[x] ?? 0) + 1; });
    const groups = Object.entries(counts).map(([k, n]) => [Number(k), n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const shape = groups.map((g) => g[1]).join('');
    const key = groups.map((g) => g[0]);
    if (straight && flush) return [8, straight];
    if (shape === '41') return [7, ...key];
    if (shape === '32') return [6, ...key];
    if (flush) return [5, ...v];
    if (straight) return [4, straight];
    if (shape === '311') return [3, ...key];
    if (shape === '221') return [2, ...key];
    if (shape === '2111') return [1, ...key];
    return [0, ...v];
  };
  const cmp = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return Math.sign(d);
    }
    return 0;
  };
  const rng = mulberry32(42);
  for (let i = 0; i < 4000; i++) {
    const deck = shuffle(makeDeck(), rng);
    const a = deck.slice(0, 5);
    const b = deck.slice(5, 10);
    assert.equal(Math.sign(score5(a) - score5(b)), cmp(rank(a), rank(b)), `${a} vs ${b}`);
  }
});
