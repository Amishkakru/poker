// Your two cards, and the name of the best hand they make so far.

import { store, game, me } from './state.js';
import { $, esc, renderIfChanged } from './util.js';
import { cardEl } from './cards.js';

export function mountHand() {}

export function renderHand() {
  const root = $('#hand');
  const G = game();
  const snap = store.snap;
  if (!G || !G.inHand || !G.hole.length) {
    renderIfChanged(root, snap?.stage === 'hand' || snap?.stage === 'between' ? 'out' : 'none', () => {
      root.innerHTML = '';
      root.classList.remove('has-cards');
    });
    return;
  }
  const mine = G.players[me()];
  const done = G.phase === 'done';
  const folded = Boolean(mine?.folded);
  const winners = done ? new Set(G.result?.winners ?? []) : new Set();
  const win = winners.has(me());
  const best = new Set(done && G.result?.showdown && win ? G.result.hands[me()]?.best ?? [] : []);
  const sig = [G.handNo, G.hole.join(','), G.handName, folded, win, [...best].join(','), done].join('|');
  renderIfChanged(root, sig, () => {
    root.classList.add('has-cards');
    root.classList.toggle('is-folded', folded);
    root.innerHTML = '';
    const cards = document.createElement('div');
    cards.className = 'hole';
    G.hole.forEach((c, i) => {
      const el = cardEl(c, { cls: `in-hand is-dealt ${best.has(c) ? 'is-best' : ''}` });
      el.style.setProperty('--i', String(i));
      el.style.setProperty('--deal', `${i * 120}ms`);
      cards.append(el);
    });
    const info = document.createElement('div');
    info.className = 'hole-info';
    const line1 = folded ? 'Folded' : (G.handName ?? 'Your cards');
    const line2 = folded ? 'You are out of this hand.' : (G.handName ? 'Your best hand so far' : 'Pre-flop');
    info.innerHTML = `<b class="hole-name">${esc(line1)}</b><small>${esc(line2)}</small>`;
    root.append(cards, info);
  });
}
