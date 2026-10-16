// Panels that sit on the felt: the lobby before a match and the final standings after it.

import {
  store, me, seatName, isHost, act, SEATS,
} from './state.js';
import {
  $, esc, renderIfChanged, copyText, toast, fmt,
} from './util.js';

const STACKS = [1000, 2000, 5000];
const LENGTHS = [[20, '20 hands'], [40, '40 hands'], ['freezeout', 'Freezeout']];

export function mountSheet() {
  const root = $('#sheet');
  root.addEventListener('click', onClick);
}

export function renderSheet() {
  const snap = store.snap;
  const root = $('#sheet');
  let html = '';
  let kind = '';
  if (snap.stage === 'lobby') { kind = 'lobby'; html = lobbyHtml(snap); }
  else if (snap.stage === 'over' && snap.match?.standings) { kind = 'over'; html = overHtml(snap); }

  root.hidden = !html;
  root.dataset.kind = kind;
  $('#cloth').classList.toggle('has-sheet', kind === 'over');
  if (!html) return;
  renderIfChanged(root, html, () => { root.innerHTML = html; });
}

// ---------------------------------------------------------------- lobby

export function inviteLink(room) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const lan = store.info?.lan?.[0];
  const host = local && lan ? `${lan}:${store.info.port}` : location.host;
  return `${location.protocol}//${host}/?room=${room}`;
}

const seg = (label, id, options, current, host, attr) => `
  <div class="setting">
    <span id="${id}">${label}</span>
    <div class="seg" role="radiogroup" aria-labelledby="${id}">
      ${options.map(([value, text]) => `<button type="button" role="radio" aria-checked="${current === value}" class="${current === value ? 'is-on' : ''}" data-${attr}="${value}" ${host ? '' : 'disabled'}>${text}</button>`).join('')}
    </div>
  </div>`;

function lobbyHtml(snap) {
  const host = isHost();
  const seated = snap.seats.filter((s) => s.kind !== 'empty').length;
  const empty = SEATS - seated;
  const hostName = esc(snap.seats[snap.host]?.name ?? 'the host');
  const s = snap.settings;
  const bb = Math.round(s.stack / 50 / 2) * 2;
  return `
    <div class="sheet-panel lobby">
      <h2>Table</h2>
      <div class="code" aria-label="Table code ${snap.room.split('').join(' ')}">${snap.room}</div>
      <div class="invite">
        <input readonly aria-label="Invite link" value="${esc(inviteLink(snap.room))}">
        <button class="btn small" type="button" data-act="copy">Copy link</button>
        ${typeof navigator.share === 'function' ? '<button class="btn small" type="button" data-act="share">Share</button>' : ''}
      </div>
      <p class="sub">${seated} of ${SEATS} seats taken. Send the link to friends anywhere, or give them the code to enter on the home page.${host && empty ? ' Seat bots in the empty chairs, or leave them open.' : ''}</p>
      ${seg('Starting chips', 'stackLabel', STACKS.map((n) => [n, fmt(n)]), s.stack, host, 'stack')}
      ${seg('Match length', 'lengthLabel', LENGTHS, s.length, host, 'length')}
      ${seg('Turn timers', 'timerLabel', [[true, 'On'], [false, 'Off']], s.timers, host, 'timers')}
      <p class="scheme-note">Blinds start at ${fmt(bb / 2)} / ${fmt(bb)} and go up every 8 hands.${s.timers ? ' 30 seconds a turn.' : ' No time limit on turns.'}</p>
      <div class="lobby-foot">
        ${host
    ? `${empty ? '<button class="btn" type="button" data-act="fillBots">Fill with bots</button>' : ''}
           <button class="btn primary big" type="button" data-act="start" ${seated < 2 ? 'disabled' : ''}>${seated < 2 ? 'Seat a bot to start' : 'Start match'}</button>`
    : `<p class="sub">Waiting for ${hostName} to start the match.</p>`}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- final standings

function overHtml(snap) {
  const m = snap.match;
  const host = isHost();
  const rows = m.standings.map((x) => {
    const net = x.chips - m.stack;
    const sign = net > 0 ? '+' : net < 0 ? '−' : '';
    return `
      <li class="${x.seat === me() ? 'is-me' : ''} ${x.place === 1 ? 'is-first' : ''}">
        <span class="rank">${x.place}</span>
        <span class="who"><b>${esc(seatName(x.seat))}</b><small>${x.out ? 'Out of chips' : `${fmt(x.chips)} chips`}</small></span>
        <span class="delta ${net > 0 ? 'is-up' : net < 0 ? 'is-down' : ''}">${sign}${fmt(Math.abs(net))}</span>
      </li>`;
  }).join('');
  const winners = m.standings.filter((x) => x.place === 1).map((x) => seatName(x.seat));
  const title = winners.length > 1 ? `${winners.slice(0, -1).join(', ')} and ${winners.at(-1)} tie` : `${winners[0]} wins`;
  return `
    <div class="sheet-panel over">
      <h2>${esc(title)}</h2>
      <p class="sub">After ${m.handNo} hand${m.handNo === 1 ? '' : 's'}. Chips against a start of ${fmt(m.stack)}.</p>
      <ol class="leaders">${rows}</ol>
      <div class="over-foot">
        ${host ? '<button class="btn primary big" type="button" data-act="rematch">Back to the lobby</button>'
    : `<p class="sub">${esc(seatName(snap.host))} can start another match.</p>`}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- actions

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.stack) act({ t: 'settings', stack: Number(d.stack) });
  else if (d.length) act({ t: 'settings', length: d.length === 'freezeout' ? 'freezeout' : Number(d.length) });
  else if (d.timers) act({ t: 'settings', timers: d.timers === 'true' });
  else if (d.act === 'start') act({ t: 'start' });
  else if (d.act === 'fillBots') act({ t: 'fillBots' });
  else if (d.act === 'rematch') act({ t: 'rematch' });
  else if (d.act === 'copy') {
    const input = $('.invite input', $('#sheet'));
    copyText(input.value, input).then((ok) => toast(ok ? 'Invite link copied.' : 'Copy the link from the box.'));
  } else if (d.act === 'share') {
    navigator.share({ title: 'Poker', text: 'Join my poker table', url: $('.invite input', $('#sheet')).value }).catch(() => {});
  }
}
