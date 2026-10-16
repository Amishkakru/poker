// Wires the connection to the views. Every server message is a full snapshot of what this seat may see.

import {
  store, game, seatName, isHost, me,
} from './state.js';
import { $, toast, esc, fmt } from './util.js';
import { connect, loadSession, saveSession, clearSession } from './net.js';
import {
  mountSeats, updateSeats, renderBets, renderPot, renderBoard, renderSlip,
} from './table.js';
import { mountHand, renderHand } from './hand.js';
import { mountTray, renderTray, tickClock } from './tray.js';
import { mountSheet, renderSheet, inviteLink } from './sheet.js';
import { mountLedger, renderLedger } from './ledger.js';
import { mountEntry, showError, setBusy } from './entry.js';
import { mountRules } from './rules.js';

const app = $('#app');
let pendingName = '';
let lastStage = null;
let lastBlinds = '';
let wasSitOut = false;

store.session = loadSession();

const net = connect({
  onMessage,
  onStatus(status, code) {
    store.status = status;
    $('#conn').hidden = status === 'open';
    if (status === 'open') {
      // After a reconnect or a page refresh, take the same seat back.
      if (store.session) net.send({ t: 'join', room: store.session.room, token: store.session.token, name: store.session.name });
    } else if (code === 4001) {
      leaveTable('The host removed you from the table.');
    }
  },
});
store.send = net.send;

fetch('/api/info').then((r) => r.json()).then((info) => { store.info = info; if (store.snap) render(); }).catch(() => {});

function onMessage(m) {
  switch (m.t) {
    case 'joined':
      store.session = { room: m.room, token: m.token, seat: m.seat, name: pendingName || store.session?.name || '' };
      saveSession(store.session);
      history.replaceState(null, '', `/?room=${m.room}`);
      break;
    case 'state':
      store.clockOffset = m.s.now - Date.now();
      store.snap = m.s;
      setBusy(false);
      render();
      break;
    case 'error':
      if (!store.snap) {
        setBusy(false);
        if (m.code === 'noroom' || m.code === 'started' || m.code === 'full') {
          clearSession();
          store.session = null;
        }
        showError(m.msg);
      } else {
        toast(m.msg, { kind: 'warn' });
      }
      break;
    default:
  }
}

function leaveTable(message) {
  clearSession();
  store.session = null;
  store.snap = null;
  history.replaceState(null, '', '/');
  app.dataset.view = 'entry';
  showError(message);
}

function render() {
  const snap = store.snap;
  if (!snap) return;
  const G = game();
  app.dataset.view = snap.stage === 'lobby' ? 'lobby' : 'game';
  app.dataset.stage = snap.stage;

  if (lastStage !== snap.stage && snap.stage === 'lobby') { store.ui.tab = 'play'; lastBlinds = ''; }
  lastStage = snap.stage;

  const room = $('#barRoom');
  room.hidden = false;
  room.innerHTML = `<span>Table</span> <b>${esc(snap.room)}</b>`;
  const m = snap.match;
  $('#barRound').textContent = m && snap.stage !== 'lobby'
    ? (snap.stage === 'over' ? 'Match over' : `Hand ${m.handNo}${m.length === 'freezeout' ? '' : ` of ${m.length}`}`)
    : '';
  const mine = Boolean(G?.legal);
  document.title = snap.stage === 'lobby' ? `Poker ${snap.room}` : `${mine ? 'Your turn. ' : ''}Poker ${snap.room}`;

  announce(snap, G);
  updateSeats();
  renderSlip();
  renderBets();
  renderPot();
  renderBoard();
  renderHand();
  renderTray();
  renderSheet();
  renderLedger();
}

/** One-off notices that come from the game itself rather than from something the player did. */
function announce(snap, G) {
  if (G) {
    const b = `${G.blinds.sb}/${G.blinds.bb}`;
    if (lastBlinds && lastBlinds !== b) toast(`Blinds are now ${fmt(G.blinds.sb)} / ${fmt(G.blinds.bb)}.`, { ms: 4500 });
    lastBlinds = b;
  }
  const out = Boolean(snap.seats[me()]?.sitOut);
  if (out && !wasSitOut) toast('You missed two turns and are now sitting out.', { kind: 'warn', ms: 5000 });
  wasSitOut = out;
}

// ---------------------------------------------------------------- startup

mountSeats();
mountHand();
mountTray();
mountSheet();
mountLedger();
mountRules();
mountEntry({
  onCreate(name) {
    pendingName = name;
    setBusy(true);
    net.send({ t: 'create', name });
  },
  onJoin(name, room) {
    pendingName = name;
    setBusy(true);
    net.send({ t: 'join', room, name });
  },
});

// Resuming a refreshed tab: show a quiet "rejoining" state instead of the form.
if (store.session) {
  setBusy(true);
  app.dataset.view = 'entry';
}

$('#btnLedger').addEventListener('click', () => {
  store.ui.ledgerOpen = !store.ui.ledgerOpen;
  app.classList.toggle('ledger-open', store.ui.ledgerOpen);
});

setInterval(tickClock, 250);

// Handy for debugging in the console and for the browser tests.
window.poker = { store, game, seatName, isHost, inviteLink };
