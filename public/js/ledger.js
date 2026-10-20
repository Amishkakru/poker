// Right-hand ledger: what happened (blinds, bets, streets, results) and the standings.

import { store, seatName, me, SEATS } from './state.js';
import {
  $, esc, renderIfChanged, fmt,
} from './util.js';
import { miniCard } from './cards.js';

export function mountLedger() {
  $('#ledger').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { store.ui.tab = t.dataset.tab; renderLedger(); }
    if (t.dataset.act === 'close') { store.ui.ledgerOpen = false; document.getElementById('app').classList.remove('ledger-open'); }
  });
}

const STREET = { flop: 'Flop', turn: 'Turn', river: 'River' };
const n = (s) => `<b>${esc(seatName(s))}</b>`;
const amt = (v) => `<b class="num">${fmt(v)}</b>`;

function describe(e) {
  switch (e.type) {
    case 'hand': return {
      cls: 'hand',
      html: `<b>Hand ${e.no}</b><span>Blinds ${fmt(e.blinds.sb)} / ${fmt(e.blinds.bb)} · ${esc(seatName(e.dealer))} on the button</span>`,
    };
    case 'blind': return { html: `${n(e.seat)} posted the ${e.kind === 'sb' ? 'small' : 'big'} blind ${amt(e.amount)}${e.allIn ? ' (all in)' : ''}`, cls: 'blind' };
    case 'fold': return { html: `${n(e.seat)} folded`, cls: 'fold' };
    case 'check': return { html: `${n(e.seat)} checked`, cls: 'check' };
    case 'call': return { html: `${n(e.seat)} called ${amt(e.amount)}${e.allIn ? ' (all in)' : ''}`, cls: 'call' };
    case 'bet': return { html: `${n(e.seat)} bet ${amt(e.to)}${e.allIn ? ' (all in)' : ''}`, cls: 'raise' };
    case 'raise': return { html: `${n(e.seat)} raised to ${amt(e.to)}${e.allIn ? ' (all in)' : ''}`, cls: 'raise' };
    case 'street': return {
      cls: 'street',
      html: `<b>${STREET[e.phase] ?? e.phase}</b><span class="street-cards">${e.cards.map(miniCard).join('')}</span>`,
    };
    case 'runout': return { html: 'Everyone is all in. The board runs out.', cls: 'note' };
    case 'showdown': return { html: `Showdown: ${e.seats.map((s) => esc(seatName(s))).join(', ')}`, cls: 'key' };
    case 'result': {
      const lines = e.pots.map((p) => {
        const who = p.winners.map((w) => `${n(w)}${e.names[w] ? ` <em>${esc(e.names[w])}</em>` : ''} ${amt(p.shares[w])}`).join(', ');
        return `<div>${esc(p.label)} ${amt(p.amount)}: ${who}</div>`;
      }).join('');
      const back = Object.entries(e.refunds ?? {}).filter(([, v]) => v > 0).map(([s, v]) => `<div class="refund">${amt(v)} returned to ${n(Number(s))}</div>`).join('');
      const out = (e.busted ?? []).map((s) => `<div class="refund">${n(s)} is out of chips</div>`).join('');
      return { cls: 'result', html: `${lines}${back}${out}` };
    }
    case 'timeout': return { html: `${n(e.seat)} ran out of time`, cls: 'note' };
    case 'sitout': return { html: `${n(e.seat)} is sitting out`, cls: 'note' };
    case 'away': return { html: `${n(e.seat)} disconnected`, cls: 'note' };
    case 'back': return { html: `${n(e.seat)} is back`, cls: 'note' };
    default: return null;
  }
}

export function renderLedger() {
  const snap = store.snap;
  const root = $('#ledger');
  if (!snap || snap.stage === 'lobby') { root.innerHTML = ''; return; }

  const tab = store.ui.tab;
  let body = '';
  if (tab === 'play') {
    const items = (snap.game?.log ?? []).map((e) => ({ e, d: describe(e) })).filter((x) => x.d);
    body = !items.length
      ? '<p class="empty-note">Blinds, bets and results are recorded here as they happen.</p>'
      : `<ol class="log">${items.map(({ e, d }) => `<li class="log-${d.cls}" data-id="${e.id}">${d.html}</li>`).join('')}</ol>`;
  } else {
    const m = snap.match;
    const live = (s) => m.stacks[s] ?? 0;
    const rows = snap.seats.map((x, s) => (x.kind === 'empty' || m?.stacks[s] === null ? '' : `
        <tr class="${s === me() ? 'is-me' : ''} ${live(s) === 0 ? 'is-out' : ''}">
          <th scope="row">${esc(seatName(s))}</th>
          <td class="num">${fmt(live(s))}</td>
          <td class="num ${live(s) - m.stack > 0 ? 'is-up' : live(s) - m.stack < 0 ? 'is-down' : ''}">${live(s) - m.stack > 0 ? '+' : live(s) - m.stack < 0 ? '−' : ''}${fmt(Math.abs(live(s) - m.stack))}</td>
        </tr>`)).join('');
    const hist = (m?.history ?? []).slice().reverse().map((h) => `
        <li><b>Hand ${h.hand}</b> ${h.winners.map((w) => esc(seatName(w))).join(' and ')} won ${fmt(h.pot)}
        <small>${h.showdown ? esc(h.best ?? '') : 'No showdown'}</small></li>`).join('');
    body = `
      <table class="scores">
        <thead><tr><th>Player</th><th>Chips</th><th>Vs start</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="empty-note">Chips are counted at the start of the current hand.</p>
      ${hist ? `<ul class="history">${hist}</ul>` : ''}`;
  }

  const html = `
    <div class="ledger-head">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${tab === 'play'}" data-tab="play">Play</button>
        <button type="button" role="tab" aria-selected="${tab === 'scores'}" data-tab="scores">Chips</button>
      </div>
      <button class="btn quiet small only-narrow" type="button" data-act="close">Close</button>
    </div>
    <div class="ledger-body" tabindex="0">${body}</div>`;

  const body0 = $('.ledger-body', root);
  const stick = !body0 || body0.scrollHeight - body0.scrollTop - body0.clientHeight < 40;
  if (renderIfChanged(root, html, () => { root.innerHTML = html; }) && tab === 'play' && stick) {
    const b = $('.ledger-body', root);
    b.scrollTop = b.scrollHeight;
  }
}

export { SEATS };
