// The rules of Beat the Clock. Plain data in, plain data out: no DOM, no sound, no network,
// so it can be tested on its own (tests/game.test.html).
//
// Each player has a clock. Only the player "on the clock" loses time. A correct answer passes play to
// the next player who still has time. A player whose clock reaches zero is out; the last one left wins.
import { MAX_ADJUST_SECONDS, MIN_SECONDS, MAX_SECONDS } from './config.js';
import { plural } from './util.js';

export const PHASE = Object.freeze({
  READY: 'ready',          // players are set, waiting for "Start clock"
  COUNTDOWN: 'countdown',  // 3-2-1-GO on screen
  RUNNING: 'running',      // the active player's clock is ticking
  PAUSED: 'paused',
  TIME_UP: 'timeUp',       // a clock just hit zero; waiting for "Continue"
  OVER: 'over',            // one player left: the winner
});

// players: [{name, seconds}] in play order, already cleaned (see util.sanitizePlayers)
export function newGame(players){
  return {
    phase: PHASE.READY,
    started: false,        // has the clock been started yet (first countdown finished)
    players: players.map((p, i) => ({
      name: p.name,
      timeLeftMs: p.seconds * 1000,
      usedMs: 0,           // clock time this player has used up
      correct: 0,
      fastestMs: null,     // quickest single turn that ended in a correct answer
      closestShaveMs: null,// least time left on their clock when they answered correctly
      startRank: i,        // position in the setup list, for "Biggest Climber"
    })),
    activeIndex: 0,        // who is on the clock
    nextIndex: null,       // TIME_UP only: who plays after "Continue"
    lastOut: null,         // the player who most recently ran out of time
    eliminated: [],        // player indices in the order they ran out
    winnerIndex: null,
    finalPair: null,       // the last two players, kept on screen after the final ends
    turnMs: 0,             // clock time used so far in the current turn
  };
}

// ---------------------------------------------------------------- actions
// Each returns something truthy if it did anything.

export function startClock(g){
  if(g.phase !== PHASE.READY) return false;
  g.phase = PHASE.COUNTDOWN;
  return true;
}

export function finishCountdown(g){
  if(g.phase !== PHASE.COUNTDOWN) return false;
  g.phase = PHASE.RUNNING;
  g.started = true;
  g.turnMs = 0;
  return true;
}

export function togglePause(g){
  if(g.phase === PHASE.RUNNING) g.phase = PHASE.PAUSED;
  else if(g.phase === PHASE.PAUSED) g.phase = PHASE.RUNNING;
  else return false;
  return true;
}

// The active player answered correctly: record it and pass play on. -> {from, to} player indices
export function markCorrect(g){
  if(g.phase !== PHASE.RUNNING) return null;
  const from = g.activeIndex, p = g.players[from];
  p.correct += 1;
  if(p.closestShaveMs === null || p.timeLeftMs < p.closestShaveMs) p.closestShaveMs = p.timeLeftMs;
  if(g.turnMs > 0 && (p.fastestMs === null || g.turnMs < p.fastestMs)) p.fastestMs = g.turnMs;
  const to = nextLiveIndex(g, from);
  if(to !== -1) g.activeIndex = to;
  g.turnMs = 0;
  return { from, to: g.activeIndex };
}

// After a TIME_UP, hand over to the next player (with a countdown first).
export function continueGame(g){
  if(g.phase !== PHASE.TIME_UP) return false;
  g.activeIndex = g.nextIndex;
  g.nextIndex = null;
  g.phase = PHASE.COUNTDOWN;
  return true;
}

const canAdjust = (g) => g.phase === PHASE.RUNNING || g.phase === PHASE.PAUSED || g.phase === PHASE.TIME_UP;

// Add (or, if negative, remove) time for everyone still in. Nobody still in can drop below 1 second,
// which is also why a game can never end without a winner.
export function addTimeToAll(g, seconds){
  if(!canAdjust(g) || !Number.isInteger(seconds) || seconds === 0 || Math.abs(seconds) > MAX_ADJUST_SECONDS) return false;
  for(const p of g.players){
    if(p.timeLeftMs > 0) p.timeLeftMs = Math.max(1000, p.timeLeftMs + seconds * 1000);
  }
  return true;
}

export function setAllClocks(g, seconds){
  if(!canAdjust(g) || !Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return false;
  for(const p of g.players){
    if(p.timeLeftMs > 0) p.timeLeftMs = seconds * 1000;
  }
  return true;
}

// Run the active player's clock down by `ms`. -> {secondsLeft, secondChanged, depleted} or null
export function tick(g, ms){
  if(g.phase !== PHASE.RUNNING || !(ms > 0)) return null;
  const p = g.players[g.activeIndex];
  const before = p.timeLeftMs;
  const used = Math.min(ms, before);
  p.timeLeftMs = before - used;
  p.usedMs += used;
  g.turnMs += used;
  const secondsLeft = Math.ceil(p.timeLeftMs / 1000);
  const secondChanged = secondsLeft !== Math.ceil(before / 1000);
  const depleted = p.timeLeftMs <= 0;
  if(depleted) playerRanOut(g, g.activeIndex);
  return { secondsLeft, secondChanged, depleted };
}

function playerRanOut(g, index){
  g.eliminated.push(index);
  g.lastOut = index;
  const live = liveIndices(g);
  if(live.length <= 1){
    g.phase = PHASE.OVER;
    g.winnerIndex = live[0];
    g.finalPair = [index, live[0]].sort((a, b) => a - b);
    g.nextIndex = null;
  } else {
    g.phase = PHASE.TIME_UP;
    g.nextIndex = nextLiveIndex(g, index);
  }
}

// ---------------------------------------------------------------- questions about the game

export const liveIndices = (g) => g.players.flatMap((p, i) => (p.timeLeftMs > 0 ? [i] : []));

// The next player after `from` (in play order) who still has time, or -1 if nobody does.
export function nextLiveIndex(g, from){
  const n = g.players.length;
  for(let step = 1; step <= n; step++){
    const i = (from + step) % n;
    if(g.players[i].timeLeftMs > 0) return i;
  }
  return -1;
}

// Leaderboard order: players still in (most time first), then those who are out (last out first).
export function standings(g){
  const live = liveIndices(g).sort((a, b) => g.players[b].timeLeftMs - g.players[a].timeLeftMs);
  return live.concat(g.eliminated.slice().reverse());
}

// How many turns away each player still in is: 0 = on the clock, 1 = next, …
// Between turns (TIME_UP) the player coming up next is 1 and nobody is 0. Empty once the game is over.
export function turnOrder(g){
  const order = new Map();
  if(g.phase === PHASE.OVER) return order;
  let index = g.activeIndex, turns = 0;
  if(g.phase === PHASE.TIME_UP){ index = g.nextIndex; turns = 1; }
  const live = liveIndices(g).length;
  for(let n = 0; n < live && index !== -1 && !order.has(index); n++){
    order.set(index, turns++);
    index = nextLiveIndex(g, index);
  }
  return order;
}

// When exactly two players are left, the screen shows them side by side. -> [indexA, indexB] or null
export function duelPair(g){
  const live = liveIndices(g);
  if(live.length === 2) return live;
  return g.phase === PHASE.OVER ? g.finalPair : null;
}

// Who the host is asking right now, for the phone. -> {player, next} names, or null once it is over.
// Between turns that is the player coming up; `next` (who a correct answer passes to) is only set while running.
export function currentTurn(g){
  if(g.phase === PHASE.OVER) return null;
  if(g.phase === PHASE.TIME_UP) return { player: g.players[g.nextIndex].name, next: '' };
  const nextIndex = g.phase === PHASE.RUNNING ? nextLiveIndex(g, g.activeIndex) : -1;
  return {
    player: g.players[g.activeIndex].name,
    next: nextIndex !== -1 && nextIndex !== g.activeIndex ? g.players[nextIndex].name : '',
  };
}

// Which actions make sense right now (see config.ACTIONS). The display greys out its buttons with
// this, ignores anything else that arrives from the phone, and sends the list to the phone.
export function allowedActions(screen, g, enoughPlayers){
  const allowed = new Set();
  if(screen === 'setup'){
    allowed.add('set-players');
    if(enoughPlayers) allowed.add('start-game');
  } else if(screen === 'result'){
    allowed.add('new-game');
  } else if(screen === 'game' && g){
    const phase = g.phase;
    if(phase === PHASE.READY) allowed.add('start-clock');
    if(phase === PHASE.RUNNING) allowed.add('correct');
    if(phase === PHASE.RUNNING || phase === PHASE.PAUSED) allowed.add('pause');
    if(phase === PHASE.TIME_UP || phase === PHASE.OVER) allowed.add('continue');
    if(canAdjust(g)){ allowed.add('add-time'); allowed.add('set-time'); }
    if(phase !== PHASE.COUNTDOWN) allowed.add('new-game');
  }
  return allowed;
}

// The four award cards on the results screen. -> [{icon, label, value, detail}]
export function stats(g){
  const finalRank = new Map(standings(g).map((index, rank) => [index, rank]));
  // first player wins ties throughout
  const best = (score) => {
    let top = null;
    g.players.forEach((p, i) => {
      const s = score(p, i);
      if(s !== null && (top === null || s < top.score)) top = { p, score: s };
    });
    return top;
  };
  const secs = (ms) => (ms / 1000).toFixed(1);

  // Places climbed from the setup order to the final standings. Someone always climbs or holds.
  const climber = best((p, i) => -(p.startRank - finalRank.get(i)));
  const climbed = -climber.score;
  const fastest = best((p) => p.fastestMs);
  const average = best((p) => (p.correct > 0 ? p.usedMs / p.correct : null));
  const shave = best((p) => p.closestShaveMs);

  return [
    { icon: '📈', label: 'Biggest Climber', value: climber.p.name,
      detail: climbed > 0 ? `climbed ${plural(climbed, 'place')}` : 'held their position' },
    fastest
      ? { icon: '⚡', label: 'Fastest Answer', value: fastest.p.name, detail: `${secs(fastest.score)}s` }
      : { icon: '⚡', label: 'Fastest Answer', value: '—', detail: 'no answers timed' },
    average
      ? { icon: '🎯', label: 'Fastest Average', value: average.p.name, detail: `${secs(average.score)}s avg` }
      : { icon: '🎯', label: 'Fastest Average', value: '—', detail: 'no answers' },
    shave
      ? { icon: '😅', label: 'Closest Shave', value: shave.p.name, detail: `answered with ${secs(shave.score)}s left` }
      : { icon: '😅', label: 'Closest Shave', value: '—', detail: 'no answers' },
  ];
}
