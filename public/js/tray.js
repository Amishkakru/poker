// The action tray: fold, check or call, and the bet / raise controls. Also the between-hands countdown.

import {
  store, game, me, seatName, serverNow, isHost, act,
} from './state.js';
import {
  $, esc, renderIfChanged, fmt,
} from './util.js';

export function mountTray() {
  const root = $('#tray');
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
}

const ui = () => store.ui;

function draft(G) {
  const L = G.legal;
  const key = `${G.handNo}:${G.phase}:${G.currentBet}`;
  if (!ui().raise || ui().raise.key !== key) ui().raise = { key, to: L.minRaiseTo };
  ui().raise.to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, ui().raise.to));
  return ui().raise;
}

/** What a bet of `f` times the pot comes to, as a total to raise to. */
function potRaise(G, f) {
  const L = G.legal;
  const mine = G.players[me()].bet;
  const pot = G.pot + L.toCall;
  return Math.round((mine + L.toCall + f * pot) / 1) | 0;
}

function setTo(root, to) {
  const G = game();
  const L = G.legal;
  const d = draft(G);
  d.to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(to)));
  syncRaise(root);
}

function syncRaise(root) {
  const G = game();
  if (!G?.legal?.canRaise) return;
  const L = G.legal;
  const { to } = ui().raise;
  const val = $('.stepval', root);
  if (val) val.textContent = fmt(to);
  const slider = $('.slider', root);
  if (slider && Number(slider.value) !== to) slider.value = String(to);
  const go = $('[data-act="raise"]', root);
  if (go) {
    const allIn = to >= L.maxRaiseTo;
    go.textContent = allIn ? `All in ${fmt(to)}` : `${L.isBet ? 'Bet' : 'Raise to'} ${fmt(to)}`;
  }
  const dec = $('[data-act="less"]', root);
  const inc = $('[data-act="more"]', root);
  if (dec) dec.disabled = to <= L.minRaiseTo;
  if (inc) inc.disabled = to >= L.maxRaiseTo;
}

function onInput(e) {
  if (e.target.matches('.slider')) setTo($('#tray'), Number(e.target.value));
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const root = $('#tray');
  const G = game();
  const kind = b.dataset.act;
  if (kind === 'resume') return act({ t: 'resume' });
  if (kind === 'next') return act({ t: 'next' });
  if (!G?.legal) return;
  const L = G.legal;
  const step = Math.max(1, G.blinds.bb);
  const to = ui().raise?.to ?? L.minRaiseTo;
  switch (kind) {
    case 'fold': return act({ t: 'fold' });
    case 'check': return act({ t: 'check' });
    case 'call': return act({ t: 'call' });
    case 'less': return setTo(root, Math.max(L.minRaiseTo, to - step));
    case 'more': return setTo(root, to + step);
    case 'preset': {
      const f = b.dataset.f;
      if (f === 'min') return setTo(root, L.minRaiseTo);
      if (f === 'max') return setTo(root, L.maxRaiseTo);
      return setTo(root, potRaise(G, Number(f)));
    }
    case 'raise':
      return to >= L.maxRaiseTo ? act({ t: 'allin' }) : act({ t: 'raise', to });
    default: return undefined;
  }
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
  const G = game();
  if (!G?.legal || document.querySelector('dialog[open]')) return;
  const L = G.legal;
  const k = e.key.toLowerCase();
  if (k === 'f' && L.canFold) act({ t: 'fold' });
  else if (k === 'c') act({ t: L.canCheck ? 'check' : 'call' });
}

export function renderTray() {
  const root = $('#tray');
  const snap = store.snap;
  const G = game();
  if (!snap || !G) { root.innerHTML = ''; return; }
  const mySeat = snap.seats[me()];
  const L = G.legal;
  const P = G.players[me()];
  const done = G.phase === 'done';
  const dl = G.deadline;

  let html = '';
  if (mySeat.sitOut) {
    html = `<div class="away-banner"><span>You are sitting out after missing two turns. You are checked or folded until you return.</span><button class="btn primary small" type="button" data-act="resume">I'm back</button></div>`;
  } else if (L) {
    const d = draft(G);
    const callLabel = L.callAmount >= (P?.stack ?? 0) && L.callAmount > 0 ? `All in ${fmt(L.callAmount)}` : `Call ${fmt(L.callAmount)}`;
    const presets = L.canRaise ? [
      ['min', 'Min'], ['0.5', '½ pot'], ['0.75', '¾ pot'], ['1', 'Pot'], ['max', 'All in'],
    ] : [];
    html = `
      <div class="tray-row tray-main">
        ${L.canFold ? '<button class="btn fold" type="button" data-act="fold">Fold</button>' : ''}
        ${L.canCheck ? '<button class="btn primary act" type="button" data-act="check">Check</button>' : ''}
        ${L.canCall ? `<button class="btn primary act" type="button" data-act="call">${callLabel}</button>` : ''}
        ${L.canRaise ? `<button class="btn rani act" type="button" data-act="raise">${L.isBet ? 'Bet' : 'Raise to'} ${fmt(d.to)}</button>` : ''}
        <span class="clock" data-at="${dl?.kind === 'turn' ? dl.at : ''}" data-kind="turn" data-seat="${me()}" ${dl?.kind === 'turn' ? '' : 'hidden'}></span>
      </div>
      ${L.canRaise ? `
      <div class="tray-row tray-raise">
        <div class="stepper" role="group" aria-label="${L.isBet ? 'Bet' : 'Raise'} amount">
          <button class="step" type="button" data-act="less" aria-label="Less">−</button>
          <span class="stepval num" aria-live="off">${fmt(d.to)}</span>
          <button class="step" type="button" data-act="more" aria-label="More">+</button>
        </div>
        <input class="slider" type="range" min="${L.minRaiseTo}" max="${L.maxRaiseTo}" step="1" value="${d.to}" aria-label="${L.isBet ? 'Bet' : 'Raise to'} amount">
        <div class="presets">
          ${presets.map(([f, label]) => `<button class="preset" type="button" data-act="preset" data-f="${f}">${label}</button>`).join('')}
        </div>
      </div>` : ''}`;
  } else if (done) {
    const secs = G.nextAt;
    html = `<div class="tray-row tray-wait">
      <p class="prompt">${snap.match?.finished ? 'That was the final hand. The standings come next.' : 'Next hand'} <span class="clock" data-at="${secs}" data-kind="next" ${secs ? '' : 'hidden'}></span></p>
      ${isHost() ? '<button class="btn small" type="button" data-act="next">Deal now</button>' : ''}
    </div>`;
  } else if (!G.inHand) {
    html = '<p class="prompt">You are out of this match. You can keep watching.</p>';
  } else if (P?.folded) {
    html = `<p class="prompt">You folded. ${G.pending ? '' : G.turn !== null ? `${esc(seatName(G.turn))} to act.` : ''}</p>`;
  } else if (P?.allIn) {
    html = '<p class="prompt"><b>You are all in.</b> The remaining cards decide it.</p>';
  } else if (G.pending) {
    html = '<p class="prompt">Dealing the rest of the board.</p>';
  } else {
    const turnSeat = G.turn;
    html = `<div class="tray-row tray-wait">
      <p class="prompt">Waiting for <b>${esc(seatName(turnSeat))}</b></p>
      <span class="clock" data-at="${dl?.kind === 'turn' ? dl.at : ''}" data-kind="turn" data-seat="${turnSeat}" ${dl?.kind === 'turn' ? '' : 'hidden'}></span>
    </div>`;
  }

  const held = document.activeElement?.closest('#tray') ? document.activeElement.dataset.act : null;
  // The drafted amount is not part of the signature: moving the slider must not rebuild the tray under the finger.
  const sig = JSON.stringify([
    mySeat.sitOut, L, done, G.handNo, G.phase, G.turn, G.pending, G.pot, dl?.at, dl?.kind, P?.folded, P?.allIn, P?.stack,
    G.inHand, snap.match?.finished, isHost(), G.nextAt > 0, ui().raise?.key,
  ]);
  const changed = renderIfChanged(root, sig, () => { root.innerHTML = html; });
  if (changed && held) root.querySelector(`[data-act="${held}"]:not(:disabled)`)?.focus();
  root.classList.toggle('is-my-turn', Boolean(L));
  if (L) syncRaise(root);
  tickClock();
}

/** Update the countdown text without re-rendering the tray. */
export function tickClock() {
  const c = $('#tray .clock');
  if (!c || c.hidden) return;
  const at = Number(c.dataset.at);
  if (!at) { c.hidden = true; return; }
  const left = Math.max(0, at - serverNow());
  const s = Math.ceil(left / 1000);
  const time = `0:${String(s).padStart(2, '0')}`;
  if (c.dataset.kind === 'next') c.textContent = time;
  else {
    const seat = Number(c.dataset.seat);
    c.textContent = `${seat === store.snap.you ? 'Your time ' : ''}${time}`;
  }
  c.classList.toggle('is-low', s <= 5);
}
