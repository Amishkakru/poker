// Card rendering. Rules and values come from the shared engine module, so the client
// can never disagree with the server about what a card is.

import {
  rankOf, suitOf, SUIT_NAME, SUIT_SYMBOL, SUITS,
} from '/engine/cards.js';

export { rankOf, suitOf, SUIT_NAME, SUIT_SYMBOL, SUITS };

const RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };

export const isRed = (card) => suitOf(card) === 'H' || suitOf(card) === 'D';
export const cardText = (card) => `${rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`;
export const cardName = (card) => `${RANK_NAME[rankOf(card)] ?? rankOf(card)} of ${SUIT_NAME[suitOf(card)].toLowerCase()}`;

export const suitSvg = (suit, cls = '') =>
  `<svg class="suit ${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#s-${suit}"/></svg>`;

/** A face-up card. */
export function cardEl(card, { cls = '' } = {}) {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const node = document.createElement('div');
  node.setAttribute('role', 'img');
  node.className = `card ${isRed(card) ? 'is-red' : 'is-ink'} ${cls}`.trim();
  node.dataset.card = card;
  node.setAttribute('aria-label', cardName(card));
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  node.innerHTML = `
    <span class="card-index"><b>${rank}</b>${suitSvg(suit)}</span>
    <span class="card-index card-index-end"><b>${rank}</b>${suitSvg(suit)}</span>
    ${court
    ? `<span class="card-court"><i>${rank}</i>${suitSvg(suit)}</span>`
    : `<span class="card-pip ${rank === 'A' ? 'is-ace' : ''}">${suitSvg(suit)}</span>`}`;
  return node;
}

/** Face-down card, used for the cards other players hold. */
export const backEl = () => {
  const i = document.createElement('i');
  i.className = 'back';
  return i;
};

export const miniCard = (card) => `<span class="mini ${isRed(card) ? 'is-red' : 'is-ink'}">${rankOf(card)}${suitSvg(suitOf(card))}</span>`;
