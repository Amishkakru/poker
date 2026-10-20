// Plays all-bot matches and prints how the table behaves.
// Usage: npm run simulate -- 20 [players 2-6] [hands]
import { Match } from '../engine/match.js';
import { decide, styleFor } from '../engine/bots.js';
import { mulberry32 } from '../engine/cards.js';

const N = Number(process.argv[2] ?? 20);
const PLAYERS = Math.min(6, Math.max(2, Number(process.argv[3] ?? 6)));
const HANDS = Number(process.argv[4] ?? 20);
const NAMES = ['Mira', 'Dev', 'Zoya', 'Kabir', 'Anaya', 'Rohan'].slice(0, PLAYERS);
const seats = NAMES.map((_, i) => i);

const tally = Object.fromEntries(NAMES.map((n) => [n, { wins: 0, chips: 0, vpip: 0, raises: 0, hands: 0 }]));
let hands = 0, showdowns = 0, allIns = 0, pots = 0, multiway = 0, sidePots = 0, preflopEnds = 0;
const started = Date.now();

for (let g = 1; g <= N; g++) {
  const rng = mulberry32(g * 7919);
  const m = new Match({ seats, length: HANDS, rng });
  while (!m.finished) {
    const h = m.startHand();
    const inHand = new Set(h.players.filter(Boolean).map((p) => p.seat));
    const entered = new Set();
    const raised = new Set();
    let guard = 0;
    while (h.phase !== 'done') {
      if (++guard > 500) throw new Error(`hand ${m.handNo} of game ${g} did not finish`);
      if (h.pending) { h.advance(); continue; }
      const seat = h.currentActor();
      const a = decide(h.view(seat), rng, styleFor(NAMES[seat]), 12);
      const res = h.act(seat, a);
      if (!res.ok) throw new Error(`illegal ${JSON.stringify(a)} by ${NAMES[seat]}: ${res.error}`);
      if (h.phase === 'preflop') {
        if (a.type === 'call' || a.type === 'raise' || a.type === 'allin') entered.add(seat);
        if (a.type === 'raise' || a.type === 'allin') raised.add(seat);
      }
    }
    m.settle();
    const r = h.result;
    hands++;
    if (r.showdown) showdowns++;
    if (h.board.length === 0) preflopEnds++;
    if (r.pots.length > 1) sidePots++;
    pots += r.pot;
    if (h.players.some((p) => p?.allIn)) allIns++;
    if (h.players.filter((p) => p && !p.folded).length > 2) multiway++;
    for (const s of inHand) {
      tally[NAMES[s]].hands++;
      if (entered.has(s)) tally[NAMES[s]].vpip++;
      if (raised.has(s)) tally[NAMES[s]].raises++;
    }
    if (m.total() !== m.stack * PLAYERS) throw new Error('chips were created or lost');
  }
  const top = m.standings()[0];
  for (const x of m.standings()) tally[NAMES[x.seat]].chips += x.chips;
  if (top.place === 1) tally[NAMES[top.seat]].wins += 1;
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
console.log(`${N} matches of ${HANDS} hands, ${PLAYERS} players, ${hands} hands in ${((Date.now() - started) / 1000).toFixed(1)}s. Chips were conserved in every hand.\n`);
console.log(`Reached showdown      ${pct(showdowns, hands)}`);
console.log(`Ended before the flop ${pct(preflopEnds, hands)}`);
console.log(`Three or more at the end ${pct(multiway, hands)}`);
console.log(`Someone all in        ${pct(allIns, hands)}`);
console.log(`Side pots             ${pct(sidePots, hands)}`);
console.log(`Average pot           ${Math.round(pots / hands)}\n`);
console.log('Bot      style               wins   avg chips   played   raised');
for (const n of NAMES) {
  const t = tally[n];
  const s = styleFor(n);
  const label = `tight ${s.tight.toFixed(2)} aggr ${s.aggro.toFixed(2)} bluff ${s.bluff.toFixed(2)}`;
  console.log(`${n.padEnd(8)} ${label.padEnd(30)} ${String(t.wins).padStart(3)}   ${String(Math.round(t.chips / N)).padStart(8)}   ${pct(t.vpip, t.hands).padStart(6)}   ${pct(t.raises, t.hands).padStart(6)}`);
}
