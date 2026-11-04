// The phone remote: the host runs the game from here. It sends button presses to the display and
// shows what the display reports back: who is being asked, and which buttons make sense right now.
import {
  STORAGE, PHONE_SETTINGS_KEYS, MAX_PLAYERS, NAME_MAX, DEFAULT_PLAYER_COUNT, DEFAULT_SECONDS,
  REPEAT_GUARD_MS, MAX_ADJUST_SECONDS, MIN_SECONDS, MAX_SECONDS,
} from './config.js';
import {
  $, store, plural, cleanName, clampSeconds, sanitizePlayers, normaliseCode, isValidCode,
  randomString, restartAnimation, armConfirm,
} from './util.js';
import { openRelay, manageConnection } from './relay.js';
import { renderPlayerList } from './player-list.js';
import { initQuestions } from './questions.js';

const SESSION = randomString(8, 'abcdefghijklmnopqrstuvwxyz0123456789'); // which phone sent a command
let seq = 0;                      // numbers this phone's commands, so the display can confirm them
let relay = null;
let code = '';
let connectingSince = 0;
const lastSentAt = {};            // per action, for the double-tap guard
let feedbackUntil = 0;            // a fresh "Sent: …" note stays up until then
// After a Correct, the next player's name shows at once; the display's own report takes over as soon
// as it confirms the press. { player, seq, until }
let expected = null;

const connection = manageConnection(() => relay, { isDisplay: false });
const questions = initQuestions();
let autoAdvance = store.get(STORAGE.autoAdvance) !== '0';

// ================================================================ connecting

function connect(newCode){
  code = newCode;
  store.set(STORAGE.remoteCode, code);
  history.replaceState(null, '', `remote.html?code=${code}`);
  $('rmPair').hidden = true;
  $('rmPad').hidden = false;
  relay?.stop(false);
  connectingSince = Date.now();
  relay = openRelay({ role: 'remote', code, onChange: render });
  relay.start();
  render();
  connection.requestWake();
}

function showPairing(prefill){
  $('rmPad').hidden = true;
  $('rmSheet').hidden = true;
  $('rmPlayersSheet').hidden = true;
  $('rmPair').hidden = false;
  $('rmCodeInput').value = prefill;
  relay?.stop(false);
  relay = null;
  connection.releaseWake();
  render();
}

function submitCode(){
  const c = normaliseCode($('rmCodeInput').value);
  if(isValidCode(c)) connect(c); else $('rmCodeInput').focus();
}

// ================================================================ sending

// -> how many relays it went out on (0 = not sent), or -1 if ignored as a double tap
function send(action, arg, label, btn){
  const now = Date.now();
  if(now - (lastSentAt[action] || 0) < REPEAT_GUARD_MS) return -1;
  lastSentAt[action] = now;
  const command = { from: SESSION, seq: ++seq, action };
  if(arg !== undefined) command.arg = arg;
  const count = relay ? relay.send(command) : 0;
  if(btn) restartAnimation(btn, 'sent');
  if(count > 0){ showFeedback(`Sent: ${label} ✓`); navigator.vibrate?.(15); }
  else { showFeedback('Not connected, so that was not sent', 'bad'); navigator.vibrate?.([40, 40, 40]); }
  return count;
}

function showFeedback(text, kind = ''){
  feedbackUntil = Date.now() + 3500;
  for(const el of [$('rmLast'), $('rmSheetLast')]){ el.textContent = text; el.className = `rm-last ${kind}`.trim(); }
}

function expectNextPlayer(){
  const status = relay?.latestStatus();
  const until = Date.now() + 1800;
  if(expected) expected = { ...expected, seq, until };
  else if(status?.phase === 'running' && status.next) expected = { player: status.next, seq, until };
  else return;
  renderTurn();
  setTimeout(renderTurn, 1900);
}

// ================================================================ drawing

function render(){
  renderConnection();
  renderTurn();
  renderButtons();
}

function renderConnection(){
  const connected = relay ? relay.connectedCount() : 0;
  let kind = 'warn', text;
  if(!relay) text = 'Enter a room code';
  else if(relay.failed){ kind = 'bad'; text = 'Could not load the connection library'; }
  else if(!connected){
    if(Date.now() - connectingSince > 8000){ kind = 'bad'; text = 'No connection'; }
    else text = 'Connecting…';
  }
  else if(relay.latestStatus()){ kind = 'ok'; text = 'Display connected'; }
  else text = 'Waiting for the display…';
  $('rmStatus').className = `rm-status ${kind}`;
  $('rmStatusText').textContent = text;
}

// The pill above the question: who the host is asking.
function renderTurn(){
  const status = relay?.latestStatus() ?? null;
  const confirmed = status?.ack?.from === SESSION && status.ack.seq >= expected?.seq;
  if(expected && (Date.now() > expected.until || confirmed)) expected = null;
  const turn = expected ? { player: expected.player, phase: 'running' } : status?.player ? status : null;
  const pill = $('rmQPlayer');
  pill.classList.toggle('invisible', !turn);
  $('rmQPlayerName').textContent = turn ? turn.player : '';
  pill.dataset.phase = turn ? turn.phase : '';
  pill.title = !turn ? '' : turn.phase === 'running' ? 'On the clock' : turn.phase === 'timeUp' ? 'Up next' : 'Current player';
}

const bonusValue = () => Math.round(parseFloat($('rmBonus').value));
const setValue = () => Math.round(parseFloat($('rmSet').value));
const validBonus = () => Number.isInteger(bonusValue()) && bonusValue() !== 0 && Math.abs(bonusValue()) <= MAX_ADJUST_SECONDS;
const validSet = () => setValue() >= MIN_SECONDS && setValue() <= MAX_SECONDS;

// Every control follows what the display says can be done right now, with a short note on why not.
function renderButtons(){
  const status = relay?.latestStatus() ?? null;
  const connected = !!relay && relay.connectedCount() > 0;
  const can = (action) => !!status && status.allowed.includes(action);
  const enoughPlayers = sanitizePlayers(players).length >= 2;

  for(const btn of document.querySelectorAll('#rmPad [data-action]')) btn.disabled = !can(btn.dataset.action);
  $('rmBonusBtn').disabled = !(can('add-time') && validBonus());
  $('rmSetBtn').disabled = !(can('set-time') && validSet());
  $('rmNewGame').disabled = !can('new-game');
  if(!can('new-game')) newGameConfirm.disarm();
  $('rmSendPlayers').disabled = $('rmSendStart').disabled = !(can('set-players') && enoughPlayers);
  $('rmSortBtn').disabled = players.length < 2;
  $('rmAddBtn').disabled = !(cleanName($('rmAddName').value) && players.length < MAX_PLAYERS);
  $('rmCodeBtn').disabled = !isValidCode(normaliseCode($('rmCodeInput').value));

  let sheetNote = '', padNote = '';
  if(!connected) sheetNote = padNote = 'Connecting…';
  else if(!status) sheetNote = padNote = 'Waiting for the display…';
  else if(status.screen === 'setup'){
    sheetNote = 'Start a game to use these.';
    if(!can('start-game')) padNote = 'Add at least 2 players to start.';
  }
  else if(status.screen === 'result') sheetNote = 'Available during a game.';
  else if(status.phase === 'countdown') sheetNote = 'Available after the countdown.';
  else if(!can('add-time')) sheetNote = status.phase === 'over' ? 'The game is over.' : 'Available once the clock starts.';
  showHint($('rmSheetLast'), sheetNote);
  showHint($('rmLast'), padNote);

  const needMore = 'Add at least 2 players with names to send.';
  const pm = $('rmPmsg');
  if(!enoughPlayers && !pm.classList.contains('ok')) setPlayersMessage(needMore, '');
  else if(enoughPlayers && pm.textContent === needMore) setPlayersMessage('Names and seconds per player. Applies while the display is on its setup screen.');
}

function showHint(el, note){
  if(Date.now() < feedbackUntil) return;      // let a fresh "Sent" note stay for a moment
  if(note){ el.textContent = note; el.className = 'rm-last hint'; }
  else if(el.classList.contains('hint')){ el.textContent = ''; el.className = 'rm-last'; }
}

// ================================================================ players sheet

function loadPlayers(){
  const saved = store.getJSON(STORAGE.players);
  if(!Array.isArray(saved)){
    return Array.from({ length: DEFAULT_PLAYER_COUNT }, (_, i) => ({ name: `Player ${i + 1}`, seconds: DEFAULT_SECONDS }));
  }
  return saved.slice(0, MAX_PLAYERS).map((p) => ({ name: String(p?.name ?? '').slice(0, NAME_MAX), seconds: clampSeconds(p?.seconds ?? p?.time) }));
}
const players = loadPlayers();
const savePlayers = () => store.setJSON(STORAGE.players, players);

function setPlayersMessage(text, kind = ''){
  $('rmPmsg').textContent = text;
  $('rmPmsg').className = `rm-pmsg ${kind}`.trim();
}

function renderPlayers(){
  renderPlayerList($('rmPlist'), players, {
    emptyText: 'No players yet. Add at least two below.',
    onChange: () => { savePlayers(); renderButtons(); },
  });
}

function addPlayer(){
  const nameInput = $('rmAddName');
  const name = cleanName(nameInput.value);
  if(!name){ nameInput.focus(); return; }
  if(players.length >= MAX_PLAYERS){ setPlayersMessage(`That is the maximum of ${MAX_PLAYERS} players.`, 'bad'); return; }
  const seconds = clampSeconds($('rmAddTime').value);
  store.set(STORAGE.newPlayerSeconds, String(seconds));
  players.push({ name, seconds });
  nameInput.value = '';
  savePlayers();
  renderPlayers();
  $('rmPlist').scrollTop = $('rmPlist').scrollHeight;
  setPlayersMessage(`Added ${name}. Tap Send to display when you are ready.`);
  renderButtons();
  nameInput.focus();
}

// One message carries the list and whether to start, so the two can never arrive out of order.
function sendPlayers(start){
  const list = sanitizePlayers(players);
  if(list.length < 2){ setPlayersMessage('Add at least 2 players with names first.', 'bad'); return; }
  const sent = send('set-players', { players: list, start }, `players (${list.length})`, $(start ? 'rmSendStart' : 'rmSendPlayers'));
  if(sent === -1) return;
  if(sent === 0){ setPlayersMessage('Not connected, so that was not sent.', 'bad'); return; }
  if(start){
    setPlayersMessage(`Sent ${plural(list.length, 'player')} ✓ starting the game…`, 'ok');
    $('rmPlayersSheet').hidden = true;            // back to the buttons, ready for Start clock
  } else {
    setPlayersMessage(`Sent ${plural(list.length, 'player')} ✓ They appear on the display’s setup screen.`, 'ok');
  }
}

// ================================================================ wiring

for(const btn of document.querySelectorAll('#rmPad [data-action]')){
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const sent = send(action, undefined, btn.dataset.label, btn);
    if(action === 'correct' && sent > 0){
      expectNextPlayer();                         // the name changes at once
      if(autoAdvance) questions.next();           // and so does the question
    }
  });
}

$('rmCodeBtn').addEventListener('click', submitCode);
$('rmCodeInput').addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); submitCode(); } });
$('rmCodeInput').addEventListener('input', renderButtons);

// host sheet
const openSheet = (id) => { renderButtons(); $(id).hidden = false; };
const closeOnBackdrop = (id) => $(id).addEventListener('click', (e) => { if(e.target.id === id) $(id).hidden = true; });
$('rmMoreBtn').addEventListener('click', () => openSheet('rmSheet'));
$('rmSheetClose').addEventListener('click', () => { $('rmSheet').hidden = true; });
closeOnBackdrop('rmSheet');
$('rmBonusBtn').addEventListener('click', () => {
  const v = bonusValue();
  if(validBonus()) send('add-time', v, `${v > 0 ? '+' : ''}${v}s for everyone`, $('rmBonusBtn'));
});
$('rmBonusSign').addEventListener('click', () => {   // phone number pads have no minus key
  const v = parseFloat($('rmBonus').value);
  $('rmBonus').value = !v ? '-10' : String(-Math.round(v));
  renderButtons();
});
$('rmSetBtn').addEventListener('click', () => {
  const v = setValue();
  if(validSet()) send('set-time', v, `all clocks set to ${v}s`, $('rmSetBtn'));
});
$('rmBonus').addEventListener('input', renderButtons);
$('rmSet').addEventListener('input', renderButtons);
$('rmQAdv').checked = autoAdvance;
$('rmQAdv').addEventListener('change', () => {
  autoAdvance = $('rmQAdv').checked;
  store.set(STORAGE.autoAdvance, autoAdvance ? '1' : '0');
});
const newGameConfirm = armConfirm($('rmNewGame'), 'Tap again to confirm', () => {
  send('new-game', undefined, 'new game', $('rmNewGame'));
  $('rmSheet').hidden = true;
});
armConfirm($('rmReset'), 'Tap again to reset all settings', () => {
  for(const key of PHONE_SETTINGS_KEYS) store.remove(key);
  location.reload();                              // every setting and box starts again from its default
});
$('rmChange').addEventListener('click', () => showPairing(code));

// players sheet
$('rmPlayersBtn').addEventListener('click', () => { renderPlayers(); openSheet('rmPlayersSheet'); });
$('rmPlayersClose').addEventListener('click', () => { $('rmPlayersSheet').hidden = true; });
closeOnBackdrop('rmPlayersSheet');
$('rmSortBtn').addEventListener('click', () => {
  players.sort((a, b) => b.seconds - a.seconds);
  savePlayers();
  renderPlayers();
  setPlayersMessage('Sorted by time, most first. Tap Send to display to apply it.');
});
$('rmAddBtn').addEventListener('click', addPlayer);
$('rmAddName').addEventListener('input', renderButtons);
$('rmAddName').addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); addPlayer(); } });
$('rmAddTime').value = String(clampSeconds(store.get(STORAGE.newPlayerSeconds) ?? DEFAULT_SECONDS));
$('rmSendPlayers').addEventListener('click', () => sendPlayers(false));
$('rmSendStart').addEventListener('click', () => sendPlayers(true));

// start: the code in the address, or the room this phone joined last time
const params = new URLSearchParams(location.search);
let startCode = normaliseCode(params.get('code'));
if(!isValidCode(startCode)) startCode = normaliseCode(store.get(STORAGE.remoteCode));
if(isValidCode(startCode)) connect(startCode); else showPairing('');
setInterval(render, 1000);   // "No connection" after 8 s, and the turn pill's timeout, need a clock
