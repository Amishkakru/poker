# Poker

No-limit Texas Hold'em for two to six players, with bots. One small Node server, one dependency, no build step. Play alone against bots, or put it online and send friends a link. Play chips only: nothing is played for money.

It is built in the same family as Kaat (same server design, same fonts and khadi cards, indigo page), with green felt and rani pink for "whose turn it is".

## Run it locally

```bash
npm install
npm start
```

The terminal prints a `localhost` address and a same-Wi-Fi address. Open one, enter a name, and choose **Create a table**. Needs Node 20 or newer.

```bash
npm test                  # engine, fuzz, room, hosting and WebSocket tests
npm run simulate          # bot-only matches with summary stats; add numbers: matches, players (2-6), hands
POKER_FAST=1 npm start    # bots, pauses and timers run near-instantly, for testing
```

## Put it online

Same as Kaat: it needs a host that keeps a Node process running and allows WebSockets (not Vercel, Netlify or Cloudflare Pages). `render.yaml` and the `Dockerfile` are ready.

1. Put this folder in its own GitHub repo.
2. In Render choose **New > Blueprint**, pick the repo, apply. The service is named `poker`.
3. Open the address Render gives you, create a table, and use **Share** or **Copy link**.

Tables live in the server's memory, so a restart, sleep or redeploy ends every table in progress. Run exactly one instance. On Render's free plan the service sleeps after 15 idle minutes; use `plan: starter` for always-on.

| Setting | Purpose |
|---|---|
| `PORT` | Set by the host. Defaults to 3000. |
| `ALLOWED_ORIGINS` | Only needed if the page is served from a different address than the server. Comma-separated, `*` allows any. |
| `POKER_FAST` | `1` shortens every pause and timer. For tests only. |

The public-internet protections are the same as Kaat's (`server/guard.js`): `/healthz`, a strict content security policy, gzip and caching, per-address limits on new tables, connections, wrong codes and message rate, and an origin check on the WebSocket.

## The rules as built

- Up to six players in a room: any mix of people and bots. At least two to start. Everyone starts with the same stack (1,000, 2,000 or 5,000).
- **Match length** (host's choice): 20 hands, 40 hands, or freezeout, which runs until one player has every chip. A fixed-length match ends on the last hand and ranks players by chips; players with equal chips share a place. Busted players are ranked by when they went out, and players who bust on the same hand by their stack at the start of it.
- **Blinds**: the first big blind is a fiftieth of the starting stack (20 for 1,000), the small blind half of it. They step up every 8 hands through 1.5×, 2×, 3×, 4×, 6×, 8× and so on. The slip above the table always shows the next level.
- **Button**: starts on a random live seat and moves one live seat clockwise each hand. Heads up, the button posts the small blind, acts first before the flop and last after it.
- **Betting**: fold, check, call, bet, raise, all in. A raise must be at least the size of the last bet or raise in the round, and the minimum opening bet is the big blind. A short all-in that is not a full raise does not reopen the betting for players who already acted. You cannot fold when you could check for free.
- **Pots**: side pots are built from each player's total contribution. A bet nobody called is returned. Ties split a pot, and any odd chip goes to the winner closest to the left of the button.
- **Showdown**: only players still in the hand show cards. When everyone else folds nothing is shown. When everyone left is all in, the rest of the board is dealt one street at a time with a pause between.
- **Hand strength**: best five of seven, standard rankings, ace plays high or low in a straight. The names are spelled out ("Full house, kings over fours") and your own best hand so far is shown under your cards.

### Choices I made where the chat didn't say

| Question | What the game does |
|---|---|
| Starting stacks | 1,000, 2,000 or 5,000, which is always 50 big blinds at the start. Host picks; default 1,000. |
| Match length | 20 hands by default; 40 or freezeout in the lobby |
| Timers | 30 seconds a turn. Out of time means check, or fold if there is a bet. Two missed turns in a row sit you out (checked or folded automatically) until you press **I'm back**. The host can switch turn timers off. |
| Between hands | The result stays on the table for about 8 seconds after a showdown and 4 after a fold-out, with a countdown. The host can press **Deal now**. |
| Nobody online | The table holds: nothing is dealt or timed out until someone is connected. |
| Joining late | A started match is closed to new players. Anyone who was seated can come back with their tab's token. |
| Bots | Fill any empty chair before the match. They estimate their chances by dealing out the unseen cards, compare them with the pot odds, and play in different styles chosen by name, from tight to loose and from passive to aggressive, with an occasional bluff. They only see what a person in their chair would see. |

## How it's put together

```
engine/   rules and bots, plain JS with no I/O; cards.js is also served to the browser
server/   HTTP static server + WebSocket rooms (seats, reconnect, timers, sit-out, bots); guard.js holds the public-internet limits
public/   vanilla JS modules, one stylesheet, bundled fonts
scripts/  simulate.js: all-bot matches with summary stats
test/     node:test suites
```

- The server is the only authority. Each player receives a view that contains only what their seat may see: your own cards, other players' cards only at a showdown, and never the deck.
- Refreshing the page or losing the connection returns you to the same seat (a token is kept per browser tab, so two tabs can be two players).
- The evaluator is checked against an independent brute-force ranking on thousands of random hands, and a fuzz test plays thousands of hands asserting that chips are conserved, pots add up and only eligible players win.

## Fonts

Bodoni Moda and Hanken Grotesk, both under the SIL Open Font License. Licence texts are in `public/fonts/`.
