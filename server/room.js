// A table: six seats, a match, turn timers, bots and per-seat snapshots.
// The server is the only place the full deal exists; clients only ever get `hand.view(seat)`.

import crypto from 'node:crypto';
import {
  Match, SEATS, DEFAULT_SETTINGS, isLength, isStack, MIN_PLAYERS,
} from '../engine/match.js';
import { decide, safeMove, styleFor } from '../engine/bots.js';

export { DEFAULT_SETTINGS, SEATS };

const BOT_NAMES = ['Mira', 'Dev', 'Zoya', 'Kabir', 'Anaya', 'Rohan', 'Tara', 'Veer', 'Isha', 'Neel'];

// `act` is how long a person has to decide. `result` is how long a finished hand stays on the table before the next deal.
export const REAL_TIMING = {
  botMin: 900,
  botMax: 2100,
  sitOut: 500,
  runoutPause: 1700,
  result: { showdown: 8000, fold: 4200 },
  limits: { act: 30_000 },
};
export const FAST_TIMING = {
  botMin: 5,
  botMax: 15,
  sitOut: 5,
  runoutPause: 15,
  result: { showdown: 40, fold: 20 },
  limits: { act: 500 },
};

const AWAY_AFTER = 2; // consecutive timeouts before a seat is sat out
const LOG_KEEP = 400;
const clean = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16);

export class Room {
  constructor(code, { timing = REAL_TIMING, rng = Math.random } = {}) {
    this.code = code;
    this.timing = timing;
    this.rng = rng;
    this.settings = { ...DEFAULT_SETTINGS };
    this.seats = Array.from({ length: SEATS }, () => ({ kind: 'empty' }));
    this.stage = 'lobby'; // lobby | hand | between | over
    this.match = null;
    this.log = [];
    this.logId = 0;
    this.cursor = 0;
    this.nextAt = 0; // when the next hand is dealt, while the result is on the table
    this.deadline = null;
    this.timers = [];
    this.version = 0;
    this.lastSeen = Date.now();
  }

  // ------------------------------------------------------------ seats

  isBot(i) { return this.seats[i].kind === 'bot'; }

  /** A person who is away or has timed out twice: the table plays check-or-fold for them. */
  isSitOut(i) {
    const s = this.seats[i];
    return s.kind === 'human' && (!s.connected || s.afk >= AWAY_AFTER);
  }

  humansOnline() {
    return this.seats.some((s) => s.kind === 'human' && s.connected);
  }

  /** The first connected human runs the table. */
  hostSeat() {
    const online = this.seats.findIndex((s) => s.kind === 'human' && s.connected);
    if (online >= 0) return online;
    const any = this.seats.findIndex((s) => s.kind === 'human');
    return any >= 0 ? any : 0;
  }

  uniqueName(base, except = -1) {
    const taken = new Set(this.seats.map((s, i) => (i === except || s.kind === 'empty' ? null : s.name.toLowerCase())));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    return name;
  }

  seated() { return this.seats.filter((s) => s.kind !== 'empty').length; }

  join(ws, { name, token } = {}) {
    this.lastSeen = Date.now();
    const known = token ? this.seats.findIndex((s) => s.kind === 'human' && s.token === token) : -1;
    if (known >= 0) {
      const seat = this.seats[known];
      if (!this.humansOnline()) this.rearmClocks(); // the table was held while everyone was away
      if (seat.ws && seat.ws !== ws) { try { seat.ws.close(4000, 'replaced'); } catch { /* already closed */ } }
      seat.ws = ws;
      seat.connected = true;
      seat.afk = 0;
      if (this.stage !== 'lobby') this.push({ type: 'back', seat: known });
      this.afterChange();
      return { seat: known, token: seat.token };
    }
    if (this.stage !== 'lobby') return { error: 'started', msg: 'This table has already started. Ask the host to begin a new match.' };
    let i = this.seats.findIndex((s) => s.kind === 'empty');
    if (i < 0) i = this.seats.findIndex((s) => s.kind === 'bot'); // a person takes a bot's chair
    if (i < 0) return { error: 'full', msg: 'All six seats are taken.' };
    const newToken = crypto.randomUUID();
    this.seats[i] = {
      kind: 'human',
      name: this.uniqueName(clean(name) || `Player ${i + 1}`, i),
      token: newToken, ws, connected: true, afk: 0,
    };
    this.afterChange();
    return { seat: i, token: newToken };
  }

  detach(ws) {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.ws === ws);
    if (i < 0) return;
    this.seats[i].ws = null;
    this.seats[i].connected = false;
    this.lastSeen = Date.now();
    if (this.stage !== 'lobby') this.push({ type: 'away', seat: i });
    this.afterChange();
  }

  // ----------------------------------------------------------- dispatch

  /** Handle a message from the human at `seat`. Returns an error string or null. */
  handle(seat, msg) {
    this.lastSeen = Date.now();
    const me = this.seats[seat];
    const host = seat === this.hostSeat();
    switch (msg.t) {
      case 'settings': {
        if (!host || this.stage !== 'lobby') return 'Only the host can change settings, before the match starts.';
        if (isStack(msg.stack)) this.settings.stack = msg.stack;
        if (isLength(msg.length)) this.settings.length = msg.length;
        if (typeof msg.timers === 'boolean') this.settings.timers = msg.timers;
        break;
      }
      case 'addBot': {
        if (!host || this.stage !== 'lobby') return 'Only the host can seat bots, before the match starts.';
        const i = Number.isInteger(msg.seat) ? msg.seat : this.seats.findIndex((s) => s.kind === 'empty');
        if (i < 0 || i >= SEATS || this.seats[i].kind !== 'empty') return 'That seat is not empty.';
        this.seatBot(i);
        break;
      }
      case 'fillBots': {
        if (!host || this.stage !== 'lobby') return 'Only the host can seat bots, before the match starts.';
        this.seats.forEach((s, i) => { if (s.kind === 'empty') this.seatBot(i); });
        break;
      }
      case 'removeSeat': {
        if (!host || this.stage !== 'lobby') return 'Only the host can free a seat, before the match starts.';
        const i = msg.seat;
        if (!Number.isInteger(i) || i < 0 || i >= SEATS || this.seats[i].kind === 'empty') return 'That seat is already empty.';
        if (i === seat) return 'You cannot remove yourself.';
        const s = this.seats[i];
        if (s.kind === 'human' && s.ws) { try { s.ws.close(4001, 'removed'); } catch { /* closed */ } }
        this.seats[i] = { kind: 'empty' };
        break;
      }
      case 'start': {
        if (!host) return 'Only the host can start the match.';
        if (this.stage !== 'lobby') return 'The match has already started.';
        if (this.seated() < MIN_PLAYERS) return 'Poker needs at least two players. Seat a bot to start.';
        this.match = new Match({
          seats: this.seats.flatMap((s, i) => (s.kind !== 'empty' ? [i] : [])),
          stack: this.settings.stack,
          length: this.settings.length,
          rng: this.rng,
        });
        this.log = [];
        this.beginHand();
        break;
      }
      case 'next': {
        if (!host) return 'Only the host can deal the next hand.';
        if (this.stage !== 'between') return 'The hand is not over yet.';
        this.dealNext();
        return null;
      }
      case 'rematch': {
        if (!host) return 'Only the host can reset the table.';
        if (this.stage !== 'over') return 'The match is not over.';
        this.match = null;
        this.log = [];
        this.stage = 'lobby';
        // Seats that sat out stay seated, but start fresh.
        this.seats.forEach((s) => { if (s.kind === 'human') s.afk = 0; });
        break;
      }
      case 'resume': {
        me.afk = 0;
        break;
      }
      case 'fold': case 'check': case 'call': case 'raise': case 'allin': {
        if (this.stage !== 'hand') return 'There is no hand in play.';
        me.afk = 0;
        const res = this.apply(seat, { type: msg.t, to: msg.to });
        if (!res.ok) return res.error;
        return null;
      }
      default:
        return 'Unknown action.';
    }
    this.afterChange();
    return null;
  }

  seatBot(i) {
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${i + 1}`;
    this.seats[i] = { kind: 'bot', name };
  }

  // -------------------------------------------------------------- engine

  beginHand() {
    const hand = this.match.startHand();
    this.stage = 'hand';
    this.cursor = 0;
    this.nextAt = 0;
    this.push({
      type: 'hand', no: this.match.handNo, dealer: hand.dealer, blinds: hand.blinds,
    });
    this.pullEvents();
  }

  dealNext() {
    if (this.stage !== 'between') return;
    if (this.match.finished) { this.stage = 'over'; this.afterChange(); return; }
    this.beginHand();
    this.afterChange();
  }

  apply(seat, action) {
    const hand = this.match.hand;
    const res = hand.act(seat, action);
    if (res.ok) this.afterEngine();
    return res;
  }

  push(event) {
    this.log.push({ id: this.logId++, ...event });
    if (this.log.length > LOG_KEEP) this.log.splice(0, this.log.length - LOG_KEEP);
  }

  /** Copy the engine's new events into the table log. */
  pullEvents() {
    const hand = this.match.hand;
    const fresh = hand.events.slice(this.cursor);
    this.cursor = hand.events.length;
    for (const e of fresh) if (e.type !== 'deal') this.push(e);
    return fresh;
  }

  afterEngine() {
    const hand = this.match.hand;
    this.pullEvents();
    if (hand.phase === 'done' && this.stage === 'hand') {
      this.match.settle();
      const r = hand.result;
      this.push({
        type: 'result',
        no: this.match.handNo,
        showdown: r.showdown,
        pots: r.pots.map((p) => ({
          label: p.label, amount: p.amount, winners: p.winners, shares: p.shares,
        })),
        names: Object.fromEntries(Object.entries(r.hands).map(([s, h]) => [s, h.name])),
        refunds: r.refunds,
        busted: this.match.history.at(-1)?.busted ?? [],
      });
      this.stage = 'between';
      const { result } = this.timing;
      this.nextAt = Date.now() + (hand.result.showdown ? result.showdown : result.fold);
    }
    this.afterChange();
  }

  // ------------------------------------------------------ scheduling + io

  afterChange() {
    this.schedule();
    this.broadcast();
  }

  /** The between-hands clock is a wall-clock deadline, so give the table its full pause back after everyone was away. */
  rearmClocks() {
    if (this.stage === 'between') this.nextAt = Date.now() + 2500;
  }

  after(ms, fn) {
    this.timers.push(setTimeout(fn, Math.max(0, ms)));
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Set the timers for whatever happens next. Called after every change, so it starts from scratch each time. */
  schedule() {
    this.clearTimers();
    this.deadline = null;
    if (this.stage !== 'hand' && this.stage !== 'between') return;
    if (!this.humansOnline()) return; // nobody is watching: hold the table
    const now = Date.now();
    const t = this.timing;

    if (this.stage === 'between') {
      const ms = Math.max(0, this.nextAt - now);
      this.deadline = { seat: null, kind: 'next', at: this.nextAt, ms };
      this.after(ms + 5, () => this.dealNext());
      return;
    }

    const hand = this.match.hand;
    if (hand.pending) {
      this.after(t.runoutPause, () => this.runout());
      return;
    }
    const actor = hand.currentActor();
    if (actor === null) return;
    if (this.isBot(actor)) {
      this.after(t.botMin + this.rng() * (t.botMax - t.botMin), () => this.botAct(actor));
    } else if (this.isSitOut(actor)) {
      this.after(t.sitOut, () => this.autoAct(actor, false));
    } else if (this.settings.timers) {
      const ms = t.limits.act;
      this.deadline = { seat: actor, kind: 'turn', at: now + ms, ms };
      this.after(ms, () => this.autoAct(actor, true));
    }
  }

  runout() {
    if (this.stage !== 'hand') return;
    const hand = this.match.hand;
    if (hand.pending) hand.advance();
    this.afterEngine();
  }

  botAct(seat) {
    if (this.stage !== 'hand') return;
    const hand = this.match.hand;
    if (hand.currentActor() !== seat) { this.afterChange(); return; }
    const view = hand.view(seat);
    let res = { ok: false, error: 'no decision' };
    try {
      const action = decide(view, this.rng, styleFor(this.seats[seat].name));
      if (action) res = this.apply(seat, action);
    } catch (err) {
      console.error('bot error:', err);
    }
    if (!res.ok) {
      console.error(`bot fell back (${res.error})`);
      const move = safeMove(view);
      if (move) this.apply(seat, move); else this.afterChange();
    }
  }

  /** Check when it is free, otherwise fold. Used when a person times out or is sitting out. */
  autoAct(seat, timedOut) {
    if (this.stage !== 'hand') return;
    const hand = this.match.hand;
    if (hand.currentActor() !== seat) { this.afterChange(); return; }
    if (timedOut) {
      const s = this.seats[seat];
      s.afk = (s.afk ?? 0) + 1;
      this.push({ type: 'timeout', seat });
      if (s.afk === AWAY_AFTER) this.push({ type: 'sitout', seat });
    }
    const move = safeMove(hand.view(seat));
    if (move) this.apply(seat, move); else this.afterChange();
  }

  // ---------------------------------------------------------------- views

  snapshotFor(i) {
    const now = Date.now();
    const snap = {
      now,
      room: this.code,
      you: i,
      host: this.hostSeat(),
      settings: { ...this.settings },
      stage: this.stage,
      seats: this.seats.map((s, idx) => ({
        kind: s.kind,
        name: s.name ?? '',
        connected: s.kind === 'human' ? s.connected : s.kind === 'bot',
        sitOut: s.kind === 'human' && this.isSitOut(idx),
      })),
      match: null,
      game: null,
    };
    if (this.match) {
      const m = this.match;
      const up = m.levelUp();
      snap.match = {
        handNo: m.handNo,
        length: m.length,
        stack: m.stack,
        stacks: [...m.stacks],
        levelUpAt: up.at,
        levelUp: up.blinds,
        busted: m.busted,
        finished: m.finished,
        history: m.history.slice(-60),
        standings: this.stage === 'over' ? m.standings() : null,
      };
    }
    if (this.match?.hand && this.stage !== 'lobby' && this.stage !== 'over') {
      snap.game = {
        ...this.match.hand.view(i),
        handNo: this.match.handNo,
        deadline: this.deadline,
        nextAt: this.stage === 'between' ? this.nextAt : 0,
        log: this.log.slice(-160),
      };
    }
    if (this.stage === 'over') snap.game = { log: this.log.slice(-160) };
    return snap;
  }

  broadcast() {
    this.version += 1;
    this.seats.forEach((s, i) => {
      if (s.kind !== 'human' || !s.ws || s.ws.readyState !== 1) return;
      s.ws.send(JSON.stringify({ t: 'state', v: this.version, s: this.snapshotFor(i) }));
    });
  }

  dispose() {
    this.clearTimers();
  }
}
