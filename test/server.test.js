import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createPokerServer } from '../server/index.js';
import { decide, styleFor } from '../engine/bots.js';
import { mulberry32 } from '../engine/cards.js';

const TIMEOUT = 60_000;

async function boot() {
  const app = createPokerServer({ port: 0, host: '127.0.0.1', fast: true });
  const port = await app.listen();
  return { app, url: `ws://127.0.0.1:${port}` };
}

/** A tiny protocol client. With `brain: true` it plays its own seat using the bot logic. */
function client(url, { brain = false } = {}) {
  const ws = new WebSocket(url);
  const rng = mulberry32(Math.floor(Math.random() * 1e6));
  const c = {
    ws, state: null, joined: null, errors: [], states: [], waiters: [], brain,
    send: (m) => ws.send(JSON.stringify(m)),
    open: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    close: () => ws.close(),
    until(pred, label = 'condition') {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), TIMEOUT);
        const check = () => {
          if (c.state && pred(c.state)) { clearTimeout(t); c.waiters = c.waiters.filter((w) => w !== check); resolve(c.state); }
        };
        c.waiters.push(check);
        check();
      });
    },
  };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') c.joined = m;
    if (m.t === 'error') c.errors.push(m);
    if (m.t === 'state') {
      c.state = m.s;
      c.version = m.v;
      c.states.push(m.s);
      if (c.brain) c.think();
      [...c.waiters].forEach((w) => w());
    }
  });
  c.think = () => {
    const g = c.state.game;
    if (!g || c.state.stage !== 'hand' || g.pending || g.turn !== c.state.you) return;
    const a = decide(g, rng, styleFor('human'), 10);
    if (!a) return;
    const key = `${c.version}:${a.type}:${a.to ?? ''}`;
    if (key === c.lastSent) return;
    c.lastSent = key;
    if (a.type === 'raise') c.send({ t: 'raise', to: a.to });
    else c.send({ t: a.type });
  };
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('three people and three bots play a whole match over WebSockets', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url, { brain: true });
    await host.open;
    host.send({ t: 'create', name: 'Abhinav' });
    await host.until((s) => s.stage === 'lobby', 'lobby');
    const code = host.joined.room;
    assert.match(code, /^[A-Z]{4}$/);

    const others = [];
    for (const name of ['Amish', 'Roshan']) {
      const c = client(url, { brain: true });
      await c.open;
      c.send({ t: 'join', room: code, name });
      await c.until((s) => s.stage === 'lobby', 'lobby');
      others.push(c);
    }
    const all = [host, ...others];
    assert.deepEqual(all.map((c) => c.joined.seat), [0, 1, 2]);

    host.send({ t: 'settings', length: 20, timers: false });
    host.send({ t: 'fillBots' });
    await host.until((s) => s.seats.filter((x) => x.kind === 'bot').length === 3, 'bots');
    others[0].send({ t: 'start' });
    await sleep(30);
    assert.equal(host.state.stage, 'lobby', 'only the host can start');
    assert.ok(others[0].errors.length > 0);
    host.send({ t: 'start' });

    await Promise.all(all.map((c) => c.until((s) => s.stage === 'over', 'the match to end')));
    for (const c of all) {
      const st = c.state.match.standings;
      assert.equal(st.length, 6);
      assert.equal(st.reduce((n, s) => n + s.chips, 0), 6000);
      assert.equal(st[0].place, 1);
    }

    // Nobody was ever shown a hand that was not theirs.
    for (const c of all) {
      for (const s of c.states) {
        const g = s.game;
        if (!g?.players) continue;
        g.players.forEach((p, seat) => {
          if (!p || seat === c.joined.seat) return;
          const open = g.phase === 'done' && g.result?.showdown && !p.folded;
          if (!open) assert.equal(p.cards, null);
        });
      }
    }

    host.send({ t: 'rematch' });
    await host.until((s) => s.stage === 'lobby', 'the lobby again');
    assert.equal(host.state.seats.filter((x) => x.kind !== 'empty').length, 6);
    all.forEach((c) => c.close());
  } finally {
    await app.close();
  }
});

test('a player who drops out can come back with their token and finds the table as it was', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url);
    await host.open;
    host.send({ t: 'create', name: 'Host' });
    await host.until((s) => s.stage === 'lobby', 'lobby');
    const guest = client(url);
    await guest.open;
    guest.send({ t: 'join', room: host.joined.room, name: 'Guest' });
    await guest.until((s) => s.stage === 'lobby', 'lobby');
    const { token } = guest.joined;
    host.send({ t: 'settings', timers: false });
    host.send({ t: 'start' });
    await guest.until((s) => s.stage === 'hand', 'the hand');
    guest.close();
    await host.until((s) => s.seats[1].connected === false, 'the drop');

    const back = client(url);
    await back.open;
    back.send({ t: 'join', room: host.joined.room, token });
    const s = await back.until((x) => x.stage === 'hand', 'the table');
    assert.equal(back.joined.seat, 1);
    assert.equal(s.you, 1);
    assert.equal(s.game.hole.length, 2);

    const stranger = client(url);
    await stranger.open;
    stranger.send({ t: 'join', room: host.joined.room, name: 'Stranger' });
    await sleep(60);
    assert.equal(stranger.errors[0]?.code, 'started');
    [host, back, stranger].forEach((c) => c.close());
  } finally {
    await app.close();
  }
});

test('wrong room codes and bad messages get a plain error, not a crash', async () => {
  const { app, url } = await boot();
  try {
    const c = client(url);
    await c.open;
    c.send({ t: 'join', room: 'ZZZZ', name: 'Lost' });
    await sleep(60);
    assert.equal(c.errors.at(-1).code, 'noroom');
    c.send({ t: 'start' });
    await sleep(30);
    assert.match(c.errors.at(-1).msg, /Join a table/);
    c.ws.send('not json');
    await sleep(30);
    assert.match(c.errors.at(-1).msg, /Malformed/);
    c.close();
  } finally {
    await app.close();
  }
});
