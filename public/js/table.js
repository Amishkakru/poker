// The felt: six seats, bets in front of them, the pot, the board, and the status slip above it all.

import {
  store, game, me, rel, seatName, serverNow, isHost, act, SEATS,
} from './state.js';
import {
  $, esc, initial, renderIfChanged, fmt,
} from './util.js';
import { cardEl, backEl } from './cards.js';

const seatEls = [];
let boardSeen = { hand: -1, n: 0 };

// ------------------------------------------------------------------ chips

/** A small stack of discs. The colour says roughly how many big blinds it is; the height, how deep. */
export function chipsHtml(amount, bb) {
  const r = amount / Math.max(1, bb);
  const tier = r < 2 ? 0 : r < 5 ? 1 : r < 15 ? 2 : r < 50 ? 3 : 4;
  const n = Math.max(1, Math.min(6, Math.ceil(Math.log2(r + 1))));
  return `<span class="chips t${tier}" style="--n:${n}" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i style="--k:${k}"></i>`).join('')}</span>`;
}

// ------------------------------------------------------------------ seats

export function mountSeats() {
  const root = $('#seats');
  for (let i = 0; i < SEATS; i++) {
    const el = document.createElement('div');
    el.className = 'seat';
    el.dataset.seat = String(i);
    el.innerHTML = `
      <div class="coaster">
        <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="ring-track" cx="32" cy="32" r="30"/>
          <circle class="ring-run" cx="32" cy="32" r="30"/>
        </svg>
        <span class="initial"></span>
        <span class="dealer-btn" title="Dealer" hidden>D</span>
      </div>
      <div class="seat-name"></div>
      <div class="seat-meta"></div>
      <div class="seat-tags"></div>
      <div class="seat-cards"></div>
      <div class="seat-hand"></div>
      <div class="bubble" hidden></div>`;
    root.append(el);
    seatEls.push(el);
  }
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const seatEl = e.target.closest('.seat');
    if (!btn || !seatEl) return;
    const seat = Number(seatEl.dataset.seat);
    if (btn.dataset.act === 'addBot') act({ t: 'addBot', seat });
    if (btn.dataset.act === 'remove') act({ t: 'removeSeat', seat });
  });
}

const BUBBLE = {
  fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise',
};

function bubbleFor(P, G, i) {
  if (!P) return null;
  if (G.phase === 'done' && G.result) {
    const won = G.result.won?.[i] ?? 0;
    if (won > 0) return { text: `+${fmt(won)}`, cls: 'is-win' };
  }
  if (!P.last) return null;
  if (P.allIn && P.last.kind !== 'fold') return { text: 'All in', cls: 'is-allin' };
  const text = BUBBLE[P.last.kind];
  return text ? { text, cls: `is-${P.last.kind}` } : null;
}

export function updateSeats() {
  const snap = store.snap;
  if (!snap) return;
  const G = game();
  const inLobby = snap.stage === 'lobby';
  const host = isHost();
  const done = G?.phase === 'done';
  const winners = new Set(done ? G.result?.winners ?? [] : []);
  const dl = G?.deadline;

  seatEls.forEach((el, i) => {
    const info = snap.seats[i];
    const r = rel(i);
    const P = G?.players[i] ?? null;
    const empty = info.kind === 'empty';
    const turn = Boolean(G && !done && !G.pending && G.turn === i);
    const folded = Boolean(P?.folded);
    const busted = !inLobby && !empty && !P && snap.match?.stacks[i] === 0;
    const spectating = !inLobby && !empty && !P && !busted;

    el.className = [
      'seat', r < 0 ? 'is-vacant' : `pos${r}`,
      empty && 'is-empty',
      i === me() && 'is-me',
      turn && 'is-turn',
      folded && 'is-folded',
      busted && 'is-busted',
      spectating && 'is-folded',
      winners.has(i) && 'is-winner',
      info.kind === 'human' && !info.connected && 'is-offline',
    ].filter(Boolean).join(' ');

    // Parts that change rarely are only touched when something about them changed.
    const showDown = done && G.result?.showdown;
    const reveal = P?.cards && i !== me() ? P.cards : null;
    const handName = showDown && !folded ? G.result.hands?.[i]?.name ?? '' : '';
    const bubble = G && P ? bubbleFor(P, G, i) : null;
    const sig = JSON.stringify([
      info, i === snap.host, inLobby, host, me(), P && [P.stack, P.folded, P.allIn], G?.dealer, G?.sbSeat, G?.bbSeat,
      reveal, handName, bubble, busted, done,
    ]);
    renderIfChanged(el, sig, () => {
      $('.initial', el).textContent = empty ? '+' : initial(info.name);
      $('.seat-name', el).textContent = empty ? 'Open seat' : info.name;

      const meta = $('.seat-meta', el);
      if (inLobby) {
        meta.textContent = empty ? '' : info.kind === 'bot' ? 'Bot' : info.connected ? (i === snap.host ? 'Host' : 'Ready') : 'Offline';
      } else if (P) {
        meta.innerHTML = `<b class="num">${fmt(P.stack)}</b>`;
      } else if (!empty) {
        meta.innerHTML = busted ? 'Out of chips' : '';
      } else meta.textContent = '';

      const tags = [];
      if (inLobby) {
        if (empty && host) tags.push('<button class="chip" type="button" data-act="addBot">Seat a bot</button>');
        if (!empty && host && i !== me()) tags.push('<button class="chip chip-quiet" type="button" data-act="remove">Remove</button>');
      } else if (G) {
        if (P && i === G.sbSeat) tags.push('<span class="tag tag-blind">SB</span>');
        if (P && i === G.bbSeat) tags.push('<span class="tag tag-blind">BB</span>');
        if (P?.allIn && !folded) tags.push('<span class="tag tag-allin">All in</span>');
        if (info.sitOut) tags.push('<span class="tag tag-away">Sitting out</span>');
        else if (info.kind === 'human' && !info.connected) tags.push('<span class="tag tag-away">Offline</span>');
      }
      $('.seat-tags', el).innerHTML = tags.join('');

      const cards = $('.seat-cards', el);
      cards.replaceChildren();
      if (P && !folded && i !== me()) {
        if (reveal) {
          reveal.forEach((c) => cards.append(cardEl(c, { cls: 'in-seat' })));
          cards.classList.add('is-open');
        } else if (!done || showDown) {
          cards.classList.remove('is-open');
          cards.append(backEl(), backEl());
        }
      }
      $('.seat-hand', el).textContent = handName;

      const b = $('.bubble', el);
      b.hidden = !bubble;
      if (bubble) { b.textContent = bubble.text; b.className = `bubble ${bubble.cls}`; }

      $('.dealer-btn', el).hidden = !(G && P && G.dealer === i);
    });

    // The turn ring runs on its own, so it is never restarted by an unrelated update.
    const ring = $('.ring-run', el);
    if (turn && dl && dl.kind === 'turn' && dl.seat === i) {
      const at = String(dl.at);
      if (ring.dataset.at !== at) {
        ring.dataset.at = at;
        ring.style.animation = 'none';
        void ring.getBoundingClientRect();
        ring.style.animation = `ring ${Math.max(0, dl.at - serverNow())}ms linear forwards`;
      }
    } else if (ring.dataset.at) {
      ring.dataset.at = '';
      ring.style.animation = 'none';
    }
  });
}

// ------------------------------------------------------------------ bets, pot, board

export function renderBets() {
  const root = $('#bets');
  const G = game();
  const sig = G && G.phase !== 'done'
    ? JSON.stringify([me(), store.snap.match?.stacks.map((c) => c === null), G.blinds.bb, G.players.map((p) => p?.bet ?? 0)])
    : 'none';
  renderIfChanged(root, sig, () => {
    if (sig === 'none') { root.innerHTML = ''; return; }
    root.innerHTML = G.players.map((p, i) => (p && p.bet > 0 && rel(i) >= 0
      ? `<div class="bet pos${rel(i)}">${chipsHtml(p.bet, G.blinds.bb)}<b class="num">${fmt(p.bet)}</b></div>`
      : '')).join('');
  });
}

export function renderPot() {
  const root = $('#pot');
  const G = game();
  const sig = G ? [G.pot, G.blinds.bb] : 'none';
  renderIfChanged(root, sig, () => {
    root.hidden = !G || !G.pot;
    if (!G || !G.pot) { root.innerHTML = ''; return; }
    root.innerHTML = `${chipsHtml(G.pot, G.blinds.bb)}<span class="pot-text"><small>Pot</small><b class="num">${fmt(G.pot)}</b></span>`;
  });
}

export function renderBoard() {
  const root = $('#board');
  const G = game();
  const done = G?.phase === 'done';
  // At a showdown the cards that make the winning hands stay bright and the rest step back.
  const bright = new Set();
  if (done && G.result?.showdown) {
    for (const w of G.result.winners) for (const c of G.result.hands[w]?.best ?? []) bright.add(c);
  }
  const sig = G ? [G.handNo, G.board, [...bright]] : 'none';
  renderIfChanged(root, sig, () => {
    root.innerHTML = '';
    if (!G) return;
    if (boardSeen.hand !== G.handNo) boardSeen = { hand: G.handNo, n: 0 };
    for (let k = 0; k < 5; k++) {
      const c = G.board[k];
      if (!c) { const slot = document.createElement('span'); slot.className = 'board-slot'; root.append(slot); continue; }
      const fresh = k >= boardSeen.n;
      const el = cardEl(c, { cls: `in-board ${fresh ? 'is-dealt' : ''} ${bright.size && !bright.has(c) ? 'is-dim' : ''} ${bright.has(c) ? 'is-best' : ''}` });
      if (fresh) el.style.setProperty('--deal', `${(k - boardSeen.n) * 140}ms`);
      root.append(el);
    }
    boardSeen.n = G.board.length;
  });
}

// ------------------------------------------------------------------ status slip

const PHASE = {
  preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', done: 'Showdown',
};

const who = (s) => (s === me() ? 'You' : seatName(s));

function messageHtml(G) {
  if (G.phase === 'done' && G.result) {
    const r = G.result;
    const names = r.winners.map((w) => `<b>${esc(who(w))}</b> <span class="num">+${fmt(r.won[w])}</span>`).join(', ');
    const top = r.winners.map((w) => r.hands[w]?.name).find(Boolean);
    const how = r.showdown ? esc(top ?? '') : 'Everyone else folded';
    const cls = r.winners.includes(me()) ? 'is-win' : '';
    return { cls, html: `<span class="slip-label">Result</span><span class="slip-text">${names}${how ? ` · ${how}` : ''}</span>` };
  }
  if (G.pending) return { cls: '', html: `<span class="slip-label">${PHASE[G.phase] ?? ''}</span><span class="slip-text">All in. The board is running out.</span>` };
  const mine = G.turn === me();
  const text = mine ? 'Your turn' : `${esc(seatName(G.turn))} to act`;
  const facing = G.currentBet > 0 ? ` · ${fmt(G.currentBet)} to match` : '';
  return { cls: mine ? 'is-turn' : '', html: `<span class="slip-label">${PHASE[G.phase] ?? ''}</span><span class="slip-text">${text}${esc(facing)}</span>` };
}

export function renderSlip() {
  const root = $('#slip');
  const snap = store.snap;
  const G = game();
  if (!snap || !G) { root.innerHTML = ''; return; }
  const m = snap.match;
  const of = m.length === 'freezeout' ? 'Freezeout' : `of ${m.length}`;
  const msg = messageHtml(G);
  const html = `
    <div class="slip-seg slip-hand">
      <span class="slip-label">Hand</span>
      <b class="num slip-num">${G.handNo}</b>
      <span class="slip-sub">${of}</span>
    </div>
    <div class="slip-seg slip-blinds">
      <span class="slip-label">Blinds</span>
      <b class="num slip-val">${fmt(G.blinds.sb)} / ${fmt(G.blinds.bb)}</b>
      <span class="slip-sub">Then ${fmt(m.levelUp.sb)} / ${fmt(m.levelUp.bb)} at hand ${m.levelUpAt}</span>
    </div>
    <div class="slip-seg slip-msg ${msg.cls}">${msg.html}</div>`;
  renderIfChanged(root, html, () => { root.innerHTML = html; });
}
