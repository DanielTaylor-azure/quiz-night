# Beat the Clock: notes for whoever changes the code

A static quiz game: a **display** page (laptop or tablet in landscape, shown to the audience) and a **phone
remote** page (portrait) that the host runs every game from. They talk through public MQTT relays.
No build step, no npm, no framework: plain ES modules served by GitHub Pages. See README.md for how it is used.

## Files

| File | What it is |
|---|---|
| `index.html` | Display markup. Its first script forwards old `?remote=CODE` links to `remote.html`. |
| `remote.html` | Phone remote markup. |
| `questions.json` | Default questions for the phone's reader. |
| `css/base.css` | Shared colour tokens, buttons, inputs, player-list rows, the one reduced-motion rule. |
| `css/display.css` | Display layout and animations. |
| `css/remote.css` | Phone layout. The landscape fallback is last on purpose (it must win). |
| `js/config.js` | Every tunable number and name, the action list, localStorage keys, `PHONE_SETTINGS_KEYS`. |
| `js/util.js` | Small shared helpers: formatting, input clean-up (`cleanName`, `clampSeconds`, `sanitizePlayers`), `store`, `armConfirm`. |
| `js/game.js` | **All game rules.** Pure data, no DOM. Phases, actions, `tick`, `allowedActions`, standings, stats. |
| `js/display.js` | Display entry point: `ui` state, `perform()`, `render()`, countdown, tick loop, fit-to-screen, wiring. |
| `js/display-remote.js` | Display side of the remote: on/off, pairing dialog and QR, runs incoming commands, publishes status. |
| `js/remote.js` | Phone entry point: connecting, sending commands, pad and host sheet, players sheet. |
| `js/questions.js` | Phone question reader: default file, a picked file, saved place, `parseQuestions`. |
| `js/relay.js` | MQTT link over several relays, message checks (`parseCommand`, `parseStatus`), reconnect and wake lock. |
| `js/player-list.js` | Editable player rows, used by the display's setup screen and the phone's Players sheet. |
| `js/sound.js` | Web Audio beeps. Sounds are data in `CUES`; `playSecond()` is the escalating countdown alarm. |
| `js/effects.js` | Confetti, sparks, screen flash and shake (keyframes are in display.css). |
| `vendor/` | Pinned third-party code: `mqtt.min.js` (MQTT.js 5.15.2) and `qrcode.js` (qrcode-generator 1.4.4). Do not edit. |
| `tests/game.test.js` | Checks for game.js, the clean-up helpers, `parseQuestions` and the relay message checks. |

## Rules to keep

- **Game rules live only in `game.js`.** It must not touch the DOM, sound or network, so it stays testable in Node.
- **The display has one way in and one way out.** Every action, whether from a button, a key or the phone,
  goes through `perform(action, arg)` in display.js. That function checks `game.allowedActions()`, runs the
  action, then calls `render()`. `render()` works out everything on screen from `ui`; event handlers do not
  show or hide things themselves. The exceptions are one-off effects (sounds, flashes, confetti) and the
  setup list, which is only redrawn when rows are added, moved or removed (so inputs keep focus).
- **Buttons that run actions carry `data-action="<action>"`** on both pages. The display disables them from
  `allowedActions`; the phone disables them from the `allowed` list in the display's status.
- **Nothing on the big screen may move.** Controls that come and go share one grid cell (`.ctrl-zone`) and are
  hidden with `setVisible()` (`visibility`), not removed. Use `hidden` only for whole screens or panels that swap
  in place at the same size.
- **The display is laid out 1100px wide and scaled to fit** (`fitStage`). Do not add viewport-based sizes inside `#stage`.
- **Anything from the relays is untrusted.** It is checked in `relay.js` (`parseCommand`, `parseStatus`), and
  arguments are cleaned in `perform()`/`game.js` (`sanitizePlayers`, the limits in `addTimeToAll`/`setAllClocks`).
- **Behaviours that are deliberate (keep them):**
  - The clock uses `Date.now()`, so time spent while the display sleeps still counts.
  - "Biggest Climber" counts from the setup order.
  - New game is not allowed during the 3-2-1 countdown.
  - New game resets the display to Player 1–4.
  - Nobody still in can be taken below 1 s, so there is always a winner.

## Message protocol (relay.js)

Topics are `dansbtc/2/<ROOM>/cmd` and `dansbtc/2/<ROOM>/status`.

- **Command** (phone → display): `{ v:2, from, seq, action, arg? }`.
  - `from` is the phone's session id; `seq` counts up.
  - The display ignores repeats of the same `from:seq`, because each message arrives once per relay.
- **Status** (display → phone, retained): `{ v:2, online:true, at, screen, phase, player, next, allowed:[…], ack:{from,seq} }`.
  - The last-will message is `{ v:2, online:false }`.
  - `ack` tells the phone its press was handled.
  - `next` (only while running) lets the phone show the next player instantly on Correct.
- **Arguments:**
  - `add-time` and `set-time` take seconds.
  - `set-players` takes `{ players:[{name, seconds}], start:boolean }`, which sets the list and starts in one message.
- **Changing the shape of a message:** bump `PROTOCOL_VERSION` and `TOPIC_ROOT` in config.js together, and update `parseCommand`/`parseStatus`.

## How to…

**Add a game action** (something the host can do):
1. Add the rule to `game.js` (a function that changes the game object), and decide when it is allowed in `allowedActions()`.
2. Add its name to `ACTIONS` in config.js. That also whitelists it for the relay.
3. Add an entry to the `ACTIONS` table in display.js that calls the game.js function.
4. Add buttons with `data-action="<name>"`: on the display in index.html (inside `#stage`), and/or on the phone
   inside `#rmPad` in remote.html. The phone's pad buttons need `data-label` (used in "Sent: …").
5. Add a test in tests/game.test.js.

**Add a phone setting:**
1. Add a key to `STORAGE` in config.js.
2. Add it to `PHONE_SETTINGS_KEYS`, so "Reset all settings" clears it.
3. Read it at start-up with a default.

**Change a sound:** edit `CUES` in sound.js. Each note is `[frequency Hz, length s, volume 0-1, delay ms, waveform]`.

**Change timings, limits or colours:** limits and timings are in config.js; colours are the tokens at the top of base.css.

**Change the questions format:** edit `parseQuestions` in questions.js, add tests, and update README.md.

## Checking a change

1. Start a server in the project folder: `python -m http.server 8000`. Modules and `fetch` do not work from `file://`.
2. Run `node tests/game.test.js`, or open <http://localhost:8000/tests/game.test.html>. Everything must pass.
3. Play a game on <http://localhost:8000/> with the mouse. Check:
   - setup editing
   - the 3-2-1 countdown
   - Correct, and the C and P keys
   - a clock running out (banner, host panel, Continue)
   - the final duel
   - the results and New Game
4. Resize the window across landscape shapes. There must be no scrollbars, and nothing may move when banners or buttons appear.
5. Remote: tap 📡 and open the shown link in a second window at phone size. Check that:
   - the phone shows "Display connected"
   - Send & start, Start clock, Correct (the name and question move on at once), Pause and Continue all work
   - buttons grey out when they cannot be used
6. Phone reader:
   - the default questions load
   - Choose file accepts a good JSON file and refuses a broken one with a message
   - ⏮ First needs two taps
   - Reset all settings restores the defaults and stays connected
