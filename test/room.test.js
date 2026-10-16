import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, FAST_TIMING } from '../server/room.js';
import { safeMove } from '../engine/bots.js';
import { mulberry32 } from '../engine/cards.js';

// Rooms are driven directly with stand-in sockets, so every rule of the table can be tested without a network.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, label, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(3);
  }
  throw new Error(`timed out waiting for ${label}`);
};
const fakeSocket = () => ({
  readyState: 1,
  sent: [],
  closed: null,
  send(m) { this.sent.push(m); },
  close(code) { this.closed = code; },
  last() { return JSON.parse(this.sent.at(-1)).s; },
  all() { return this.sent.map((m) => JSON.parse(m).s); },
});

function table({ humans = 1, bots = 0, settings = {}, timing = FAST_TIMING, seed = 1 } = {}) {
  const room = new Room('TEST', { timing, rng: mulberry32(seed) });
  const socks = [];
  for (let i = 0; i < humans; i++) {
    const ws = fakeSocket();
    socks.push(ws);
    room.join(ws, { name: `P${i}` });
  }
  for (let i = 0; i < bots; i++) room.handle(0, { t: 'addBot' });
  if (Object.keys(settings).length) assert.equal(room.handle(0, { t: 'settings', ...settings }), null);
  return { room, socks };
}

/** Starts the match, then shortens it: the settings only offer 20, 40 or freezeout hands. */
function begin(room, hands) {
  assert.equal(room.handle(0, { t: 'start' }), null);
  if (hands) room.match.length = hands;
}

/** Makes the people at the table act for themselves: check when free, otherwise call. */
function autoPlayers(room, seats, { delay = 2 } = {}) {
  const timer = setInterval(() => {
    if (room.stage !== 'hand') return;
    const hand = room.match.hand;
    const seat = hand.currentActor();
    if (seat !== null && seats.includes(seat)) {
      const L = hand.legal(seat);
      room.handle(seat, { t: L.canCheck ? 'check' : 'call' });
    }
  }, delay);
  return () => clearInterval(timer);
}

test('lobby: seats fill in order, the first player hosts, names are cleaned and made unique', () => {
  const room = new Room('TEST', { timing: FAST_TIMING });
  const a = room.join(fakeSocket(), { name: 'Meera' });
  const b = room.join(fakeSocket(), { name: 'meera' });
  const c = room.join(fakeSocket(), { name: '<b>Ravi</b>' });
  assert.deepEqual([a.seat, b.seat, c.seat], [0, 1, 2]);
  assert.equal(room.seats[1].name, 'meera 2');
  assert.equal(room.seats[2].name, 'bRavib');
  assert.equal(room.hostSeat(), 0);
  room.dispose();
});

test('lobby: only the host changes settings, and only valid values are accepted', () => {
  const { room } = table({ humans: 2 });
  assert.match(room.handle(1, { t: 'settings', stack: 2000 }), /host/);
  room.handle(0, { t: 'settings', stack: 2000, length: 40, timers: false });
  assert.deepEqual(room.settings, { stack: 2000, length: 40, timers: false });
  room.handle(0, { t: 'settings', stack: 7, length: 'forever', timers: 'yes' });
  assert.deepEqual(room.settings, { stack: 2000, length: 40, timers: false });
  room.handle(0, { t: 'settings', length: 'freezeout' });
  assert.equal(room.settings.length, 'freezeout');
  room.dispose();
});

test('lobby: bots are seated by the host, a person can take a bot chair, and starting needs two players', () => {
  const { room } = table({ humans: 1 });
  assert.match(room.handle(0, { t: 'start' }), /at least two/);
  assert.equal(room.handle(0, { t: 'addBot' }), null);
  assert.equal(room.seats[1].kind, 'bot');
  assert.equal(room.handle(0, { t: 'addBot', seat: 4 }), null);
  assert.match(room.handle(0, { t: 'addBot', seat: 4 }), /not empty/);
  assert.equal(room.handle(0, { t: 'fillBots' }), null);
  assert.equal(room.seats.filter((s) => s.kind === 'bot').length, 5);
  const joined = room.join(fakeSocket(), { name: 'Late' });
  assert.equal(joined.seat, 1, 'a person takes the first bot chair');
  assert.match(room.handle(1, { t: 'removeSeat', seat: 2 }), /host/);
  assert.equal(room.handle(0, { t: 'removeSeat', seat: 2 }), null);
  assert.equal(room.seats[2].kind, 'empty');
  assert.match(room.handle(0, { t: 'removeSeat', seat: 0 }), /yourself/);
  room.dispose();
});

test('lobby: a seventh player is turned away', () => {
  const room = new Room('TEST', { timing: FAST_TIMING });
  for (let i = 0; i < 6; i++) assert.ok(!room.join(fakeSocket(), { name: `P${i}` }).error);
  const extra = room.join(fakeSocket(), { name: 'Seven' });
  assert.equal(extra.error, 'full');
  room.dispose();
});

test('a started table turns strangers away but lets a seated player back in with their token', async () => {
  const { room, socks } = table({ humans: 2, bots: 1, settings: { length: 1, timers: false } });
  const token = room.seats[1].token;
  assert.equal(room.handle(0, { t: 'start' }), null);
  assert.equal(room.join(fakeSocket(), { name: 'Stranger' }).error, 'started');
  assert.equal(room.join(fakeSocket(), { name: 'P1', token: 'wrong' }).error, 'started');

  room.detach(socks[1]);
  assert.equal(room.seats[1].connected, false);
  assert.equal(room.isSitOut(1), true);
  const back = fakeSocket();
  const res = room.join(back, { token });
  assert.equal(res.seat, 1);
  assert.equal(room.seats[1].connected, true);
  assert.equal(room.isSitOut(1), false);
  assert.ok(back.sent.length > 0, 'the returning player is sent the table');
  room.dispose();
});

test('a whole match plays out with bots and two people, and the chips always add up', async () => {
  const { room } = table({ humans: 2, bots: 2, settings: { length: 6, timers: false } });
  const stop = autoPlayers(room, [0, 1]);
  begin(room, 6);
  await until(() => room.stage === 'over', 'the match to finish', 30_000);
  stop();
  const m = room.match;
  assert.equal(m.handNo, 6);
  assert.equal(m.total(), 4000);
  assert.equal(m.history.length, 6);
  const snap = room.snapshotFor(0);
  assert.equal(snap.stage, 'over');
  assert.equal(snap.match.standings.length, 4);
  assert.equal(snap.match.standings[0].place, 1);
  assert.equal(snap.match.standings.reduce((n, s) => n + s.chips, 0), 4000);
  assert.ok(room.log.some((e) => e.type === 'hand' && e.no === 6));
  room.dispose();
});

test('a freezeout ends when one player holds every chip', async () => {
  const { room } = table({ humans: 1, bots: 2, settings: { length: 'freezeout', stack: 1000, timers: false } });
  // The person shoves every hand, so the match is short.
  const timer = setInterval(() => {
    if (room.stage !== 'hand') return;
    const hand = room.match.hand;
    if (hand.currentActor() === 0) {
      const L = hand.legal(0);
      room.handle(0, { t: L.canRaise ? 'allin' : L.canCall ? 'call' : 'check' });
    }
  }, 2);
  assert.equal(room.handle(0, { t: 'start' }), null);
  await until(() => room.stage === 'over', 'the freezeout to finish', 60_000);
  clearInterval(timer);
  assert.equal(room.match.alive().length, 1);
  assert.equal(room.snapshotFor(0).match.standings[0].chips, 3000);
  room.dispose();
});

test('hidden information: nobody is ever sent another player\'s hole cards before a showdown', async () => {
  const { room, socks } = table({ humans: 3, bots: 1, settings: { length: 5, timers: false } });
  const stop = autoPlayers(room, [0, 1, 2]);
  begin(room, 5);
  await until(() => room.stage === 'over', 'the match to finish', 30_000);
  stop();
  let checked = 0;
  socks.forEach((ws, seat) => {
    for (const s of ws.all()) {
      assert.equal(s.you, seat);
      const text = JSON.stringify(s);
      assert.equal(text.includes('"deck"'), false, 'the deck is never sent');
      if (!s.game?.players) continue;
      const g = s.game;
      g.players.forEach((p, other) => {
        if (!p || other === seat) return;
        const showdown = g.phase === 'done' && g.result?.showdown && !p.folded;
        if (!showdown) assert.equal(p.cards, null, `seat ${seat} saw seat ${other}'s cards in ${g.phase}`);
        checked += 1;
      });
      if (g.result && !g.result.showdown) assert.deepEqual(g.result.hands, {}, 'a hand won by folding shows nothing');
    }
  });
  assert.ok(checked > 100);
  room.dispose();
});

test('a person who runs out of time is checked or folded, and after two timeouts they sit out', async () => {
  const { room } = table({ humans: 2, bots: 0, settings: { length: 'freezeout', timers: true } });
  assert.equal(room.handle(0, { t: 'start' }), null);
  // Seat 1 never acts. Seat 0 plays on, so the table is attended.
  const stop = autoPlayers(room, [0], { delay: 1 });
  await until(() => room.seats[1].afk >= 2, 'two timeouts', 8000);
  assert.ok(room.log.some((e) => e.type === 'timeout' && e.seat === 1));
  assert.ok(room.log.some((e) => e.type === 'sitout' && e.seat === 1));
  assert.equal(room.isSitOut(1), true);
  assert.equal(room.snapshotFor(0).seats[1].sitOut, true);
  // The player comes back.
  room.handle(1, { t: 'resume' });
  assert.equal(room.seats[1].afk, 0);
  assert.equal(room.isSitOut(1), false);
  stop();
  room.dispose();
});

test('a person who is acting always gets to act: there is a deadline for them and not for bots', async () => {
  const { room } = table({ humans: 1, bots: 1, settings: { length: 3, timers: true }, timing: { ...FAST_TIMING, limits: { act: 60_000 }, botMin: 5, botMax: 10 } });
  assert.equal(room.handle(0, { t: 'start' }), null);
  await until(() => room.match.hand.currentActor() === 0, 'a turn for the person');
  const snap = room.snapshotFor(0);
  assert.equal(snap.game.deadline.seat, 0);
  assert.equal(snap.game.deadline.kind, 'turn');
  assert.ok(snap.game.legal);
  assert.equal(room.snapshotFor(0).game.legal.canRaise, true);
  room.dispose();
});

test('with timers off the table waits for a person, and with nobody online it holds', async () => {
  const { room, socks } = table({ humans: 1, bots: 1, settings: { length: 3, timers: false } });
  assert.equal(room.handle(0, { t: 'start' }), null);
  await until(() => room.match.hand.currentActor() === 0, 'a turn for the person');
  assert.equal(room.deadline, null);
  await sleep(120);
  assert.equal(room.match.hand.currentActor() === 0 || room.stage !== 'hand', true, 'nothing played for them');
  // Everyone leaves: nothing moves.
  room.detach(socks[0]);
  const before = room.match.hand.events.length;
  await sleep(120);
  assert.equal(room.match.hand.events.length, before);
  assert.equal(room.timers.length, 0);
  room.dispose();
});

test('betting messages are validated and acted on by the right seat', async () => {
  const { room } = table({ humans: 2, settings: { length: 1, timers: false } });
  assert.match(room.handle(0, { t: 'call' }), /no hand/);
  assert.equal(room.handle(0, { t: 'start' }), null);
  const hand = room.match.hand;
  const actor = hand.currentActor();
  const other = 1 - actor;
  assert.match(room.handle(other, { t: 'call' }), /not your turn/);
  assert.match(room.handle(actor, { t: 'check' }), /bet to call/);
  assert.match(room.handle(actor, { t: 'raise', to: 'lots' }), /whole number/);
  assert.match(room.handle(actor, { t: 'jump' }), /Unknown/);
  assert.equal(room.handle(actor, { t: 'raise', to: 60 }), null);
  assert.equal(hand.currentBet, 60);
  room.dispose();
});

test('a hand ends, the result waits on the table, and the host can deal the next hand early', async () => {
  const { room } = table({ humans: 2, settings: { length: 3, timers: false }, timing: { ...FAST_TIMING, result: { showdown: 60_000, fold: 60_000 } } });
  assert.equal(room.handle(0, { t: 'start' }), null);
  const hand = room.match.hand;
  const first = hand.currentActor();
  assert.equal(room.handle(first, { t: 'fold' }), null);
  assert.equal(room.stage, 'between');
  assert.equal(room.snapshotFor(0).game.phase, 'done');
  assert.ok(room.snapshotFor(0).game.nextAt > Date.now());
  assert.equal(room.snapshotFor(0).game.deadline.kind, 'next');
  assert.match(room.handle(1, { t: 'next' }), /host/);
  assert.equal(room.handle(0, { t: 'next' }), null);
  assert.equal(room.stage, 'hand');
  assert.equal(room.match.handNo, 2);
  assert.match(room.handle(0, { t: 'next' }), /not over/);
  room.dispose();
});

test('the final hand is shown, then the match is over and the host can start again', async () => {
  const { room } = table({ humans: 2, settings: { length: 1, timers: false }, timing: { ...FAST_TIMING, result: { showdown: 60_000, fold: 60_000 } } });
  begin(room, 1);
  room.handle(room.match.hand.currentActor(), { t: 'fold' });
  assert.equal(room.stage, 'between');
  assert.equal(room.match.finished, true);
  assert.equal(room.handle(0, { t: 'next' }), null);
  assert.equal(room.stage, 'over');
  assert.match(room.handle(1, { t: 'rematch' }), /host/);
  assert.equal(room.handle(0, { t: 'rematch' }), null);
  assert.equal(room.stage, 'lobby');
  assert.equal(room.match, null);
  assert.equal(room.handle(0, { t: 'start' }), null);
  assert.equal(room.stage, 'hand');
  room.dispose();
});

test('an all-in board is dealt one street at a time', async () => {
  const { room } = table({ humans: 2, settings: { length: 1, timers: false }, timing: { ...FAST_TIMING, runoutPause: 40 } });
  assert.equal(room.handle(0, { t: 'start' }), null);
  const hand = room.match.hand;
  const a = hand.currentActor();
  room.handle(a, { t: 'allin' });
  room.handle(1 - a, { t: 'call' });
  assert.equal(hand.pending, 'street');
  const seen = new Set();
  const poll = setInterval(() => seen.add(hand.board.length), 2);
  await until(() => room.stage !== 'hand', 'the showdown');
  clearInterval(poll);
  assert.ok(seen.has(3) && seen.has(4) && seen.has(5), `board lengths seen: ${[...seen]}`);
  assert.equal(hand.result.showdown, true);
  room.dispose();
});

test('the log records the hand marker, blinds, actions and the street cards', async () => {
  const { room } = table({ humans: 2, settings: { length: 1, timers: false } });
  assert.equal(room.handle(0, { t: 'start' }), null);
  const a = room.match.hand.currentActor();
  room.handle(a, { t: 'call' });
  room.handle(1 - a, { t: 'check' });
  const types = room.log.map((e) => e.type);
  assert.deepEqual(types.slice(0, 4), ['hand', 'blind', 'blind', 'call']);
  assert.ok(types.includes('check'));
  assert.ok(types.includes('street'));
  const ids = room.log.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
  room.dispose();
});

test('safeMove: nothing when it is not your turn', () => {
  const { room } = table({ humans: 2, settings: { timers: false } });
  room.handle(0, { t: 'start' });
  const h = room.match.hand;
  const idle = 1 - h.currentActor();
  assert.equal(safeMove(h.view(idle)), null);
  room.dispose();
});
