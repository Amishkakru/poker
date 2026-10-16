// Rules sheet (native <dialog>).

import { $ } from './util.js';
import { miniCard } from './cards.js';

const ranking = [
  ['Royal flush', ['10S', 'JS', 'QS', 'KS', 'AS']],
  ['Straight flush', ['5H', '6H', '7H', '8H', '9H']],
  ['Four of a kind', ['9S', '9H', '9D', '9C', 'KS']],
  ['Full house', ['QS', 'QH', 'QD', '4C', '4S']],
  ['Flush', ['2D', '6D', '9D', 'JD', 'KD']],
  ['Straight', ['5C', '6D', '7H', '8S', '9C']],
  ['Three of a kind', ['7S', '7H', '7D', 'AC', '3S']],
  ['Two pair', ['JS', 'JH', '5D', '5C', 'AS']],
  ['Pair', ['10S', '10H', 'AD', '8C', '3S']],
  ['High card', ['AS', 'JH', '8D', '5C', '2S']],
];

const HTML = `
  <form method="dialog" class="rules-inner">
    <header><h2>How Poker works</h2><button class="btn quiet small" value="close" aria-label="Close rules">Close</button></header>
    <div class="rules-body">
      <section>
        <h3>The table</h3>
        <p>No-limit Texas Hold'em for two to six players, played with chips that have no cash value. Everyone starts with the same stack. A match is a set number of hands (20 or 40) or a freezeout, which goes on until one player holds every chip.</p>
      </section>
      <section>
        <h3>A hand</h3>
        <p>The dealer button moves one seat clockwise each hand. The two players left of it post the small and big blinds. Heads up, the button posts the small blind and acts first before the flop. Everyone gets two private cards, then betting starts left of the big blind.</p>
        <p>Betting runs in four rounds: before the flop, then after the flop (three shared cards), the turn (a fourth) and the river (a fifth). On your turn you can <b>fold</b>, <b>check</b> if nobody has bet, <b>call</b> to match the bet, or <b>bet</b> or <b>raise</b>. No-limit means you can bet any amount up to all your chips.</p>
        <p>A raise must be at least as big as the last bet or raise in that round. A short all-in that is not a full raise does not reopen the betting for players who already acted.</p>
      </section>
      <section>
        <h3>Showdown and pots</h3>
        <p>If one player is left, they win the pot without showing cards. Otherwise the best five-card hand from your two cards and the five shared cards wins. When someone is all in for less than the others, extra bets go into side pots that the short stack cannot win. A bet nobody called is returned. Tied hands split the pot, and an odd chip goes to the winner closest to the left of the button.</p>
      </section>
      <section>
        <h3>Hand rankings</h3>
        <ol class="ranking">
          ${ranking.map(([name, cards]) => `<li><span>${name}</span><span class="cards">${cards.map(miniCard).join('')}</span></li>`).join('')}
        </ol>
      </section>
      <section>
        <h3>Blinds and timers</h3>
        <p>The first big blind is a fiftieth of the starting stack, so 20 for a stack of 1,000. The blinds go up every 8 hands. With turn timers on, you have 30 seconds to act. If time runs out you are checked, or folded when there is a bet to call. After two missed turns in a row you sit out: you are checked or folded automatically until you press <b>I'm back</b>.</p>
      </section>
      <section>
        <h3>Bots and friends</h3>
        <p>The host can seat bots in any empty chair before the match starts. Bots weigh their chances against the pot odds and play in different styles, from tight to bluff-happy. Friends join with the table code or the invite link. If you lose your connection, reopen the page in the same tab to take your seat back.</p>
      </section>
    </div>
  </form>`;

export function mountRules() {
  const dlg = $('#rules');
  dlg.innerHTML = HTML;
  $('#btnRules').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}
