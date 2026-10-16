// Single client-side store. The server snapshot is the source of truth; `ui` holds only
// things that belong to this browser (the raise being drafted, whether the ledger is open).

export const SEATS = 6;

export const store = {
  snap: null,
  session: null,
  clockOffset: 0,
  status: 'connecting',
  info: null, // { lan: [...], port }
  send: () => {},
  ui: {
    tab: 'play',
    raise: null, // { key, to }: the raise being drafted for the current decision
    ledgerOpen: false,
  },
};

export const act = (msg) => store.send(msg);
export const game = () => (store.snap?.game?.players ? store.snap.game : null);
export const me = () => store.snap?.you ?? 0;
export const seatInfo = (i) => store.snap?.seats[i];
export const seatName = (i) => seatInfo(i)?.name || `Seat ${i + 1}`;
export const isHost = () => store.snap && store.snap.host === store.snap.you;

// Where the n players in a match sit around the felt, as positions clockwise from the bottom (0 is you).
// Fewer players spread out so that heads-up play has the opponent across the table.
const LAYOUT = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 2, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };

/** Position on the felt for a seat, or -1 for a chair nobody is playing from. */
export function rel(seat) {
  const snap = store.snap;
  const m = snap?.match;
  if (!m || snap.stage === 'lobby') return (seat - me() + SEATS) % SEATS;
  const taken = m.stacks.flatMap((c, s) => (c === null ? [] : [s]));
  if (!taken.includes(seat)) return -1;
  const order = taken.sort((a, b) => ((a - me() + SEATS) % SEATS) - ((b - me() + SEATS) % SEATS));
  const layout = LAYOUT[order.length] ?? LAYOUT[6];
  return layout[order.indexOf(seat)] ?? order.indexOf(seat);
}

export const serverNow = () => Date.now() + store.clockOffset;
