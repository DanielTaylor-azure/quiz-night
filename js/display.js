// The big-screen display: setup, the game and the results.
//
// How it fits together:
//  - All game rules are in game.js. This file holds the screen state (`ui`), runs actions and draws.
//  - Every action, whoever asks for it (a button, a key, or the phone), goes through perform(),
//    which checks game.allowedActions() first, runs it, then calls render().
//  - render() works out everything on screen from `ui`; it also runs on every clock tick.
import {
  MAX_PLAYERS, DEFAULT_PLAYER_COUNT, DEFAULT_SECONDS, LOW_MS, CRITICAL_MS,
  TICK_MS, COUNTDOWN, COUNTDOWN_STEP_MS, COUNTDOWN_END_MS,
} from './config.js';
import {
  $, clamp, fmtTime, ordinal, plural, cleanName, clampSeconds, sanitizePlayers,
  setText, setVisible, restartAnimation,
} from './util.js';
import * as game from './game.js';
import { PHASE } from './game.js';
import * as sound from './sound.js';
import * as effects from './effects.js';
import { renderPlayerList } from './player-list.js';
import { initDisplayRemote } from './display-remote.js';

const defaultPlayers = () => Array.from({ length: DEFAULT_PLAYER_COUNT }, (_, i) => ({ name: `Player ${i + 1}`, seconds: DEFAULT_SECONDS }));

const ui = {
  screen: 'setup',                 // 'setup' | 'game' | 'result'
  setupPlayers: defaultPlayers(),  // [{name, seconds}] in play order
  game: null,                      // see game.newGame()
  adminOpen: false,                // the host-controls panel between turns
};

// ================================================================ actions

const allowedNow = () => game.allowedActions(ui.screen, ui.game, ui.setupPlayers.length >= 2);

const ACTIONS = {
  'start-game': startGame,
  'set-players': (arg) => {            // from the phone: replace the setup list, and maybe start
    const players = sanitizePlayers(arg?.players);
    if(!players.length) return;
    ui.setupPlayers = players;
    renderSetupList();
    if(arg.start === true && players.length >= 2) startGame();
  },
  'start-clock': () => { if(game.startClock(ui.game)) runCountdown(); },
  'correct': answerCorrect,
  'pause': () => game.togglePause(ui.game),
  'continue': () => {
    if(ui.game.phase === PHASE.OVER) showResult();
    else if(game.continueGame(ui.game)) runCountdown();
  },
  'add-time': (arg) => {
    const s = Math.round(Number(arg));
    if(game.addTimeToAll(ui.game, s)) flashLabel($('bonusTimeBtn'), `${s > 0 ? '+' : ''}${s}s ✓`);
  },
  'set-time': (arg) => {
    if(game.setAllClocks(ui.game, Math.round(Number(arg)))) flashLabel($('setTimeBtn'), 'Set ✓');
  },
  'new-game': newGame,
};

// -> true if the action was allowed (and so was run)
function perform(action, arg){
  if(!allowedNow().has(action)) return false;
  ACTIONS[action](arg);
  render();
  return true;
}

function startGame(){
  const players = ui.setupPlayers.map((p, i) => ({ name: cleanName(p.name) || `Player ${i + 1}`, seconds: clampSeconds(p.seconds) }));
  ui.game = game.newGame(players);
  ui.adminOpen = false;
  ui.screen = 'game';
  $('leaderboard').replaceChildren();
  sound.unlock();
}

function newGame(){
  $('confirmModal').hidden = true;
  ui.game = null;
  ui.adminOpen = false;
  ui.setupPlayers = defaultPlayers();
  ui.screen = 'setup';
  renderSetupList();
}

function answerCorrect(){
  const burstFrom = activeClockElement();
  if(!game.markCorrect(ui.game)) return;
  sound.play('correct');
  restartAnimation(burstFrom, 'correct-flash');
  restartAnimation($('correctBtn'), 'pop');
  effects.sparkBurst(burstFrom, fitScale);
}

// The clock of the player on the clock: the big one, or their side of the final.
function activeClockElement(){
  const pair = game.duelPair(ui.game);
  if(!pair) return $('clockWrap');
  return pair[0] === ui.game.activeIndex ? $('duelClockA') : $('duelClockB');
}

function showResult(){
  ui.screen = 'result';
  renderResult();
  effects.confetti();
  sound.play('fanfare');
}

// 3-2-1-GO on top of everything, then the clock runs.
function runCountdown(){
  const g = ui.game, overlay = $('countdownOverlay'), num = $('countdownNum');
  const last = COUNTDOWN.length - 1;
  overlay.hidden = false;
  COUNTDOWN.forEach((label, i) => setTimeout(() => {
    num.textContent = label;
    num.classList.toggle('go', i === last);
    restartAnimation(num, 'tick');
    sound.play(i === last ? 'go' : 'countdown');
  }, i * COUNTDOWN_STEP_MS));
  setTimeout(() => {
    overlay.hidden = true;
    if(ui.game === g && game.finishCountdown(g)) sound.play('whoosh');
    render();
  }, last * COUNTDOWN_STEP_MS + COUNTDOWN_END_MS);
}

// Show a short confirmation on a button ("+10s ✓"), then put its label back.
const labelTimers = new Map();
function flashLabel(btn, text){
  if(!labelTimers.has(btn)) btn.dataset.label = btn.textContent;
  clearTimeout(labelTimers.get(btn));
  btn.textContent = text;
  labelTimers.set(btn, setTimeout(() => { btn.textContent = btn.dataset.label; labelTimers.delete(btn); }, 1100));
}

// ================================================================ the clock

// Date.now() on purpose: if the device sleeps mid-turn, that time still counts (as it always has).
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), elapsed = now - lastTick;
  lastTick = now;
  if(ui.screen !== 'game' || !ui.game) return;
  const result = game.tick(ui.game, elapsed);
  if(!result) return;
  if(result.secondChanged){
    sound.playSecond(result.secondsLeft);
    if(result.secondsLeft === 0){ effects.screenFlash(); effects.shake($('app')); }
    else if(result.secondsLeft <= 10) effects.screenFlash();
  }
  if(result.depleted){
    ui.adminOpen = false;
    sound.play('eliminated');
    restartAnimation($('timeUpBanner'), 'flash');
  }
  render();
}, TICK_MS);

// ================================================================ drawing

function render(){
  for(const name of ['setup', 'game', 'result']) $(`screen-${name}`).hidden = ui.screen !== name;
  $('hero').hidden = ui.screen === 'result';
  $('heroTagline').hidden = ui.screen !== 'game';

  const allowed = allowedNow();
  for(const btn of document.querySelectorAll('#stage [data-action]')) btn.disabled = !allowed.has(btn.dataset.action);

  if(ui.screen === 'setup') renderSetupSummary();
  if(ui.screen === 'game') renderGame();
  remote.publishStatus();
}

// ---- setup ----

// Redraws the editable rows; only needed when rows are added, removed or reordered.
function renderSetupList(){
  renderPlayerList($('setupList'), ui.setupPlayers, { onChange: render });
  updateSetupFade();
}
function renderSetupSummary(){
  const n = ui.setupPlayers.length;
  setText($('countNote'), `${plural(n, 'player')} added`);
  $('addPlayerBtn').disabled = n >= MAX_PLAYERS;
}
// Fade the bottom of the list while there are more players to scroll to.
function updateSetupFade(){
  const list = $('setupList');
  list.classList.toggle('more', list.scrollHeight > list.clientHeight + 2 && list.scrollTop + list.clientHeight < list.scrollHeight - 2);
}

function addPlayer(){
  const nameInput = $('playerNameInput');
  const name = cleanName(nameInput.value);
  if(!name || ui.setupPlayers.length >= MAX_PLAYERS) return;
  ui.setupPlayers.push({ name, seconds: clampSeconds($('playerTimeInput').value) });
  nameInput.value = '';
  nameInput.focus();
  renderSetupList();
  $('setupList').scrollTop = $('setupList').scrollHeight; // show the player just added
  updateSetupFade();
  render();
}

// ---- game ----

function renderGame(){
  const g = ui.game, phase = g.phase;
  const live = phase === PHASE.RUNNING || phase === PHASE.PAUSED;
  const betweenTurns = phase === PHASE.TIME_UP, over = phase === PHASE.OVER;

  const pair = game.duelPair(g);
  $('stageHeadSolo').hidden = !!pair;
  $('duelHead').hidden = !pair;
  if(pair) renderDuel(g, pair); else renderSolo(g);
  renderLeaderboard(g);

  // The controls share one fixed-size zone and are hidden with visibility, so nothing moves.
  setVisible($('startBtn'), !g.started && (phase === PHASE.READY || phase === PHASE.COUNTDOWN));
  setVisible($('pauseBtn'), live);
  setText($('pauseBtn'), phase === PHASE.PAUSED ? 'Resume' : 'Pause Game');
  setVisible($('answerRow'), live);
  setVisible($('gameHint'), live || !g.started);
  setVisible($('timeUpBanner'), betweenTurns || over);
  if(betweenTurns || over){
    const out = g.players[g.lastOut], place = game.liveIndices(g).length + 1;
    setText($('timeUpBanner'), `${out.name}'s clock is depleted - they finish the quiz in ${ordinal(place)} place!`);
  }
  setVisible($('adminWrap'), betweenTurns);
  setVisible($('adjustPanel'), betweenTurns && ui.adminOpen);
  $('adminToggle').classList.toggle('open', ui.adminOpen);
  $('adminToggle').setAttribute('aria-expanded', String(ui.adminOpen));
  setVisible($('continueRow'), betweenTurns || over);
  const cont = $('continueBtn');
  setText(cont, over ? 'See result →' : 'Continue →');
  cont.classList.toggle('btn-gold', over);
  cont.classList.toggle('btn-red', !over);
}

function setClockLevel(el, ms){
  el.classList.toggle('low', ms <= LOW_MS && ms > 0);
  el.classList.toggle('critical', ms <= CRITICAL_MS && ms > 0);
}

function renderSolo(g){
  const p = g.players[g.activeIndex];
  setText($('activeName'), p.name);
  setText($('activeClock'), fmtTime(p.timeLeftMs));
  setClockLevel($('activeClock'), p.timeLeftMs);
}

function renderDuel(g, pair){
  pair.forEach((index, side) => {
    const p = g.players[index], key = side === 0 ? 'A' : 'B';
    const highlighted = g.phase === PHASE.OVER
      ? index === g.winnerIndex
      : index === g.activeIndex && (g.phase === PHASE.RUNNING || !g.started);
    $(`duelSide${key}`).classList.toggle('active', highlighted);
    $(`duelSide${key}`).classList.toggle('out', p.timeLeftMs <= 0);
    setText($(`duelName${key}`), p.name);
    setText($(`duelClock${key}`), fmtTime(p.timeLeftMs));
    setClockLevel($(`duelClock${key}`), p.timeLeftMs);
  });
}

const TURN_TAGS = { 0: ['NOW', 'now'], 1: ['NEXT', 'next'] };

// Rows slide to their new place (CSS transition on --rank) as the standings change.
function renderLeaderboard(g){
  const board = $('leaderboard');
  const order = game.standings(g), turns = game.turnOrder(g);
  board.style.setProperty('--rows', order.length);
  order.forEach((index, rank) => {
    const p = g.players[index];
    let row = board.querySelector(`[data-player="${index}"]`);
    if(!row){
      row = document.createElement('div');
      row.dataset.player = index;
      row.innerHTML = '<div class="lb-rank"></div><div class="lb-name"></div><div class="lb-tag"></div><div class="lb-correct"></div><div class="lb-time"></div>';
      row.style.setProperty('--rank', rank);   // before it is added, so it starts in place
      board.append(row);
    }
    const turnsAway = turns.get(index);
    const [tagText, tagClass] = TURN_TAGS[turnsAway] || (turnsAway > 1 ? [`+${turnsAway}`, 'upcoming'] : ['', '']);
    row.className = `lb-row${turnsAway === 0 ? ' active' : ''}${p.timeLeftMs <= 0 ? ' out' : ''}`;
    row.style.setProperty('--rank', rank);
    setText(row.querySelector('.lb-rank'), `#${rank + 1}`);
    setText(row.querySelector('.lb-name'), p.name);
    setText(row.querySelector('.lb-correct'), `${p.correct} ✓`);
    const tag = row.querySelector('.lb-tag');
    setText(tag, tagText);
    tag.className = `lb-tag ${tagClass}`.trim();
    const time = row.querySelector('.lb-time');
    setText(time, fmtTime(p.timeLeftMs));
    time.classList.toggle('critical', p.timeLeftMs <= CRITICAL_MS && p.timeLeftMs > 0);
  });
}

// ---- result (drawn once, when the game ends) ----

function renderResult(){
  const g = ui.game, winner = g.players[g.winnerIndex];
  setText($('resultTitle'), `🏆 ${winner.name.toUpperCase()} WINS! 🏆`);
  $('statsGrid').replaceChildren(...game.stats(g).map(statCard));
  $('rankList').replaceChildren(...game.standings(g).map((index, i) => rankRow(g, index, i)));
}

function div(className, text = ''){
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}
function statCard({ icon, label, value, detail }){
  const card = div('stat-card');
  card.append(div('stat-icon', icon), div('stat-label', label), div('stat-value', value), div('stat-detail', detail));
  return card;
}
function rankRow(g, index, i){
  const p = g.players[index], won = index === g.winnerIndex;
  const row = div(`rank-row${p.timeLeftMs <= 0 ? ' out' : ''}`);
  row.append(
    div('rank-place', `#${i + 1}`),
    div('rank-name', p.name),
    div(`rank-tag${won ? ' winner' : ''}`, won ? 'WINNER' : p.timeLeftMs <= 0 ? 'OUT OF TIME' : ''),
    div('rank-time', fmtTime(p.timeLeftMs)),
    div('rank-correct', `${p.correct} correct`),
  );
  return row;
}

// ================================================================ fit to screen
// The stage is laid out 1100px wide and then scaled to fit the screen (inside a margin that keeps clear
// of TV overscan and rounded tablet corners), so the whole game is always visible with no scrollbars.

let fitScale = 1;
function fitStage(){
  const app = $('app'), stage = $('stage');
  const w = stage.offsetWidth, h = stage.offsetHeight;
  if(!w || !h) return;
  const margin = Math.max(28, Math.round(Math.min(app.clientWidth, app.clientHeight) * 0.045));
  fitScale = clamp(Math.min((app.clientWidth - 2 * margin) / w, (app.clientHeight - 2 * margin) / h), 0.15, 2.6);
  stage.style.transform = `translate(-50%, -50%) scale(${fitScale})`;
}
let fitQueued = false;
function scheduleFit(){
  if(fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitStage(); });
}

// ================================================================ wiring

// Buttons with data-action run that action. Add/Set time read their number box.
const ACTION_ARGS = { 'add-time': () => $('bonusTimeInput').value, 'set-time': () => $('setTimeInput').value };
$('stage').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if(btn && !btn.disabled) perform(btn.dataset.action, ACTION_ARGS[btn.dataset.action]?.());
});

$('addPlayerBtn').addEventListener('click', addPlayer);
$('playerNameInput').addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); addPlayer(); } });
$('autoSortBtn').addEventListener('click', () => {
  ui.setupPlayers.sort((a, b) => b.seconds - a.seconds);
  renderSetupList();
  render();
});
$('setupList').addEventListener('scroll', updateSetupFade);

$('adminToggle').addEventListener('click', () => { ui.adminOpen = !ui.adminOpen; render(); });

$('muteBtn').addEventListener('click', () => {
  sound.setMuted(!sound.isMuted());
  $('muteBtn').textContent = sound.isMuted() ? '🔇' : '🔊';
});

$('newGameBtn').addEventListener('click', () => { $('confirmModal').hidden = false; });
$('confirmCancelBtn').addEventListener('click', () => { $('confirmModal').hidden = true; });
$('confirmModal').addEventListener('click', (e) => { if(e.target.id === 'confirmModal') $('confirmModal').hidden = true; });
$('confirmYesBtn').addEventListener('click', () => perform('new-game'));

// Keyboard: C = correct, P = pause/resume, Esc closes a dialog. Ignored while typing in a box.
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){ $('confirmModal').hidden = true; remote.closeDialog(); return; }
  if(e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
  const key = e.key.toLowerCase();
  if((key === 'c' && perform('correct')) || (key === 'p' && perform('pause'))) e.preventDefault();
});

// Browsers only allow sound after a tap or key press on the page.
for(const type of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(type, sound.unlock, { passive: true });

new ResizeObserver(scheduleFit).observe($('stage'));
new ResizeObserver(scheduleFit).observe($('app'));
document.fonts?.ready.then(scheduleFit);

// What the phone needs to know (see relay.js for the message format).
function statusForPhone(){
  const g = ui.screen === 'game' ? ui.game : null;
  const turn = g ? game.currentTurn(g) : null;
  return {
    screen: ui.screen,
    phase: g ? g.phase : '',
    player: turn?.player ?? '',
    next: turn?.next ?? '',
    allowed: [...allowedNow()],
  };
}
const remote = initDisplayRemote({ perform, getStatus: statusForPhone });

renderSetupList();
render();
fitStage();
