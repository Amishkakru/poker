// Bots. They decide from a seat's own view, so they see exactly what a person in that chair would see.
// Each estimates its chance of winning by dealing out the unknown cards a few hundred times, then
// compares that with the price of staying in (pot odds). A bot's style sets how tight and how aggressive it is.

import { makeDeck, shuffle, mulberry32 } from './cards.js';
import { evaluate } from './evaluate.js';

/** Chance of winning (ties count as a share) against `opponents` random hands, from the cards a seat can see. */
export function equity({
  hole, board, opponents, samples = 200, rng = Math.random,
}) {
  if (opponents < 1) return 1;
  const seen = new Set([...hole, ...board]);
  const rest = makeDeck().filter((c) => !seen.has(c));
  const missing = 5 - board.length;
  let score = 0;
  for (let i = 0; i < samples; i++) {
    const deck = shuffle(rest, rng);
    const runout = deck.splice(0, missing);
    const full = [...board, ...runout];
    const mine = evaluate([...hole, ...full]).score;
    let best = -1;
    let tied = 1;
    for (let o = 0; o < opponents; o++) {
      const theirs = evaluate([deck[2 * o], deck[2 * o + 1], ...full]).score;
      if (theirs > best) { best = theirs; tied = 1; } else if (theirs === best) tied += 1;
    }
    if (mine > best) score += 1;
    else if (mine === best) score += 1 / (tied + 1);
  }
  return score / samples;
}

/** A bot's temperament, derived from its name so the same bot always plays the same way. */
export function styleFor(name = '') {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1009;
  const r = mulberry32(h);
  return {
    tight: 0.2 + r() * 0.6, // 0 loose, 1 tight
    aggro: 0.25 + r() * 0.6, // how often a good hand raises instead of calling
    bluff: 0.02 + r() * 0.09, // chance to bet or raise with nothing
  };
}

export const NEUTRAL = { tight: 0.5, aggro: 0.5, bluff: 0.05 };

/** The move a seat that is sitting out makes: check when free, otherwise fold. */
export function safeMove(view) {
  const L = view.legal;
  if (!L) return null;
  return L.canCheck ? { type: 'check' } : { type: 'fold' };
}

/** Round a chip amount to something a person would bet, without leaving the legal range. */
function tidy(to, L, blinds) {
  const unit = Math.max(1, blinds.sb);
  let v = Math.round(to / unit) * unit;
  v = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, v));
  return v;
}

export function decide(view, rng = Math.random, style = NEUTRAL, samples = 200) {
  const L = view.legal;
  if (!L) return null;
  const me = view.players[view.seat];
  const opponents = view.players.filter((p) => p && p.seat !== view.seat && !p.folded).length;
  const eq = equity({
    hole: view.hole, board: view.board, opponents, samples, rng,
  });
  const fair = 1 / (opponents + 1); // an even share of the pot
  const s = Math.max(0, (eq - fair) / (1 - fair)); // 0 = no better than average, 1 = a lock
  const pot = view.pot;
  const stackBB = (me.stack + me.bet) / view.blinds.bb;
  const raiseTo = (frac) => tidy(view.currentBet + Math.round(frac * (pot + L.toCall)), L, view.blinds);
  const shove = () => (L.canRaise ? { type: 'allin' } : { type: 'call' });
  const roll = rng();

  if (L.toCall === 0) {
    const valueAt = 0.3 + style.tight * 0.12;
    if (L.canRaise && s > valueAt && rng() < 0.45 + style.aggro * 0.5) {
      const big = s > 0.75 ? 0.8 : s > 0.6 ? 0.6 : 0.45;
      const to = raiseTo(big + (rng() - 0.5) * 0.2);
      return to >= L.maxRaiseTo || to >= (me.stack + me.bet) * 0.6 ? shove() : { type: 'raise', to };
    }
    if (L.canRaise && roll < style.bluff && s < 0.3) return { type: 'raise', to: raiseTo(0.5) };
    return { type: 'check' };
  }

  const price = L.toCall / (pot + L.toCall); // the share of the final pot I must put in
  const margin = 0.02 + style.tight * 0.05;
  const need = Math.min(0.9, price + margin);

  // A short stack with a decent hand just goes in.
  if (stackBB < 9 && L.canRaise && eq > Math.max(fair * 1.15, price + 0.08)) return shove();

  if (eq < need) {
    // Now and then a cheap bet gets a call or a bluff raise anyway.
    if (L.canRaise && roll < style.bluff * 0.6 && price < 0.35) return { type: 'raise', to: raiseTo(0.75) };
    if (price < 0.12 && roll < 0.35) return { type: 'call' };
    return { type: 'fold' };
  }
  if (L.canRaise && s > 0.42 && rng() < 0.25 + style.aggro * 0.5) {
    const to = raiseTo(s > 0.8 ? 0.9 : 0.65);
    return to >= L.maxRaiseTo || to >= (me.stack + me.bet) * 0.6 ? shove() : { type: 'raise', to };
  }
  return { type: 'call' };
}
