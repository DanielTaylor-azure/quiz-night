// Checks for the parts of the app that have no screen: the game rules, the player clean-up and the
// questions-file reader. Open tests/game.test.html in a browser (through a web server), or run
// `node tests/game.test.js` from the project folder.
import * as game from '../js/game.js';
import { PHASE } from '../js/game.js';
import { sanitizePlayers, cleanName, clampSeconds, fmtTime, ordinal } from '../js/util.js';
import { parseQuestions } from '../js/questions.js';
import { parseCommand, parseStatus } from '../js/relay.js';
import { MAX_PLAYERS } from '../js/config.js';

const results = [];
function test(name, fn){
  try { fn(); results.push({ name, ok: true }); }
  catch(err){ results.push({ name, ok: false, error: err.message }); }
}
function eq(actual, expected, what = 'value'){
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if(a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
const ok = (condition, what) => { if(!condition) throw new Error(what); };

// a game that is already running, with the given clocks in seconds
function running(...seconds){
  const g = game.newGame(seconds.map((s, i) => ({ name: `P${i + 1}`, seconds: s })));
  game.startClock(g);
  game.finishCountdown(g);
  return g;
}

// ---------------------------------------------------------------- the clock
test('a new game waits for Start clock', () => {
  const g = game.newGame([{ name: 'A', seconds: 60 }, { name: 'B', seconds: 30 }]);
  eq(g.phase, PHASE.READY, 'phase');
  eq(game.tick(g, 1000), null, 'tick before start');
  eq(g.players[0].timeLeftMs, 60000, 'time left');
});

test('tick only takes time while running', () => {
  const g = running(10, 10);
  game.tick(g, 1500);
  eq(g.players[0].timeLeftMs, 8500, 'running');
  game.togglePause(g);
  eq(game.tick(g, 3000), null, 'paused tick');
  eq(g.players[0].timeLeftMs, 8500, 'paused');
  eq(g.players[1].timeLeftMs, 10000, 'other player untouched');
});

test('tick reports each new second', () => {
  const g = running(10, 10);
  let r = game.tick(g, 300);          // 9.7 s left -> shows 10
  eq([r.secondsLeft, r.secondChanged], [10, false], 'first tick');
  r = game.tick(g, 800);              // 8.9 s left -> shows 9
  eq([r.secondsLeft, r.secondChanged], [9, true], 'second tick');
});

// ---------------------------------------------------------------- turns
test('Correct passes play on and skips players who are out', () => {
  const g = running(5, 1, 5);
  game.markCorrect(g);                // P1 -> P2
  eq(g.activeIndex, 1, 'P2 up');
  game.tick(g, 1000);                 // P2 runs out
  eq(g.phase, PHASE.TIME_UP, 'phase');
  game.continueGame(g); game.finishCountdown(g);
  eq(g.activeIndex, 2, 'P3 up after P2 is out');
  game.markCorrect(g);
  eq(g.activeIndex, 0, 'wraps round to P1, skipping P2');
});

test('running out goes to TIME_UP with the right next player', () => {
  const g = running(1, 5, 5);
  const r = game.tick(g, 1200);
  eq(r.depleted, true, 'depleted');
  eq(g.phase, PHASE.TIME_UP, 'phase');
  eq(g.nextIndex, 1, 'next');
  eq(g.lastOut, 0, 'last out');
  eq(g.players[0].timeLeftMs, 0, 'clamped at zero');
  eq(g.players[0].usedMs, 1000, 'only the time it had counts as used');
});

test('the last two end in OVER with a winner and the final pair', () => {
  const g = running(5, 2);
  game.markCorrect(g);                // P2's turn
  game.tick(g, 2000);
  eq(g.phase, PHASE.OVER, 'phase');
  eq(g.winnerIndex, 0, 'winner');
  eq(g.finalPair, [0, 1], 'final pair');
  eq(game.duelPair(g), [0, 1], 'duel stays on screen');
});

test('turn order: NOW/NEXT while running, no NOW between turns', () => {
  const g = running(1, 5, 5, 5);
  eq([...game.turnOrder(g)], [[0, 0], [1, 1], [2, 2], [3, 3]], 'running');
  game.tick(g, 1000);                 // P1 out -> TIME_UP, P2 next
  eq([...game.turnOrder(g)], [[1, 1], [2, 2], [3, 3]], 'between turns');
});

test('standings: most time first, then last out first', () => {
  const g = running(1, 2, 9);
  game.tick(g, 1000);                 // P1 out
  game.continueGame(g); game.finishCountdown(g);
  eq(game.standings(g), [2, 1, 0], 'order');
});

// ---------------------------------------------------------------- host adjustments
test('add time: live players only, never below 1 second', () => {
  const g = running(1, 5, 20);
  game.tick(g, 1000);                 // P1 out, TIME_UP
  ok(game.addTimeToAll(g, -10), 'allowed between turns');
  eq(g.players.map((p) => p.timeLeftMs), [0, 1000, 10000], 'after -10');
  ok(game.addTimeToAll(g, 600), 'max');
  ok(!game.addTimeToAll(g, 601), 'over the limit refused');
  ok(!game.addTimeToAll(g, 0), 'zero refused');
  ok(!game.addTimeToAll(g, 2.5), 'fractions refused');
});

test('set all clocks: live players only, 1-1800', () => {
  const g = running(1, 5, 20);
  game.tick(g, 1000);
  ok(game.setAllClocks(g, 30), 'allowed');
  eq(g.players.map((p) => p.timeLeftMs), [0, 30000, 30000], 'after set');
  ok(!game.setAllClocks(g, 0) && !game.setAllClocks(g, 1801), 'out of range refused');
});

test('adjustments are refused before the clock starts and after the end', () => {
  const g = game.newGame([{ name: 'A', seconds: 5 }, { name: 'B', seconds: 5 }]);
  ok(!game.addTimeToAll(g, 10), 'ready');
  game.startClock(g);
  ok(!game.setAllClocks(g, 10), 'countdown');
});

// ---------------------------------------------------------------- what is allowed when
test('allowed actions follow the screen and phase', () => {
  const list = (screen, g, enough = true) => [...game.allowedActions(screen, g, enough)].sort();
  eq(list('setup', null, false), ['set-players'], 'setup, too few players');
  eq(list('setup', null, true), ['set-players', 'start-game'], 'setup');
  eq(list('result', null), ['new-game'], 'result');
  const g = game.newGame([{ name: 'A', seconds: 1 }, { name: 'B', seconds: 5 }, { name: 'C', seconds: 5 }]);
  eq(list('game', g), ['new-game', 'start-clock'], 'ready');
  game.startClock(g);
  eq(list('game', g), [], 'countdown: nothing, not even new game');
  game.finishCountdown(g);
  eq(list('game', g), ['add-time', 'correct', 'new-game', 'pause', 'set-time'], 'running');
  game.togglePause(g);
  eq(list('game', g), ['add-time', 'new-game', 'pause', 'set-time'], 'paused');
  game.togglePause(g);
  game.tick(g, 1000);
  eq(list('game', g), ['add-time', 'continue', 'new-game', 'set-time'], 'time up');
});

// ---------------------------------------------------------------- stats
test('fastest answer leaves out paused time', () => {
  const g = running(30, 30);
  game.tick(g, 2000);
  game.togglePause(g);
  game.tick(g, 50000);                // ignored while paused
  game.togglePause(g);
  game.tick(g, 1000);
  game.markCorrect(g);
  eq(g.players[0].fastestMs, 3000, 'fastest');
  eq(game.stats(g)[1].detail, '3.0s', 'card');
});

test('fastest average = time used / correct answers', () => {
  const g = running(30, 30);
  game.tick(g, 4000); game.markCorrect(g);   // P1: 4 s
  game.tick(g, 1000); game.markCorrect(g);   // P2: 1 s
  game.tick(g, 2000); game.markCorrect(g);   // P1: 2 s more -> 6 s / 2 = 3 s
  eq(g.players[0].usedMs / g.players[0].correct, 3000, 'P1 average');
  const card = game.stats(g)[2];
  eq([card.value, card.detail], ['P2', '1.0s avg'], 'card');
});

test('closest shave says how much time was left', () => {
  const g = running(10, 30);
  game.tick(g, 7700); game.markCorrect(g);   // answered with 2.3 s left
  eq(game.stats(g)[3], { icon: '😅', label: 'Closest Shave', value: 'P1', detail: 'answered with 2.3s left' }, 'card');
});

test('biggest climber counts from the setup order', () => {
  // setup order P1, P2, P3; P1 goes out first, then P2, so P3 wins: P3 climbed 2 places
  const g = running(1, 1, 30);
  game.tick(g, 1000); game.continueGame(g); game.finishCountdown(g);
  game.tick(g, 1000);
  eq(g.phase, PHASE.OVER, 'over');
  eq(game.stats(g)[0], { icon: '📈', label: 'Biggest Climber', value: 'P3', detail: 'climbed 2 places' }, 'card');
});

test('with no correct answers the cards say so', () => {
  const g = running(1, 5);
  game.tick(g, 1000);
  const [, fastest, average, shave] = game.stats(g);
  eq([fastest.value, average.value, shave.value], ['—', '—', '—'], 'values');
});

test('a winner always exists: time can never be taken below 1 s', () => {
  const g = running(1, 1);
  game.tick(g, 500);
  game.addTimeToAll(g, -600);
  eq(g.players.map((p) => p.timeLeftMs), [1000, 1000], 'floored');
});

// ---------------------------------------------------------------- input clean-up
test('sanitizePlayers trims, drops blanks, clamps times and caps the list', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `  P ${i}  `, seconds: 99999 }));
  const out = sanitizePlayers(many);
  eq(out.length, MAX_PLAYERS, 'capped');
  eq(out[0], { name: 'P 0', seconds: 1800 }, 'cleaned and clamped');
  eq(sanitizePlayers([{ name: '   ' }, { name: 'Ann', time: 0 }, null, 'x']), [{ name: 'Ann', seconds: 1 }], 'blanks dropped, old {time} accepted');
  eq(sanitizePlayers('nope'), [], 'not a list');
});

test('names, seconds, clock and place formatting', () => {
  eq(cleanName('  a   very   long name that keeps going  '), 'a very long name tha', 'name');
  eq([clampSeconds(''), clampSeconds('0'), clampSeconds('12.6'), clampSeconds(5000)], [60, 1, 13, 1800], 'seconds');
  eq([fmtTime(60000), fmtTime(59001), fmtTime(0), fmtTime(-5)], ['01:00', '01:00', '00:00', '00:00'], 'clock');
  eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st'], 'ordinal');
});

// ---------------------------------------------------------------- questions file
test('parseQuestions accepts the documented format and a bare list', () => {
  const wrapped = parseQuestions({ questions: [{ question: ' What  is 2+2? ', answer: 4 }, { question: 'No answer' }] });
  eq(wrapped, { questions: [{ question: 'What is 2+2?', answer: '4' }, { question: 'No answer', answer: '' }] }, 'wrapped');
  eq(parseQuestions([{ question: 'Q', answer: 'A' }]).questions.length, 1, 'bare list');
});

test('parseQuestions names the problem', () => {
  eq(parseQuestions({ items: [] }, 'quiz.json').error, 'quiz.json should contain a list of questions, each with a "question" and an "answer".', 'wrong shape');
  eq(parseQuestions({ questions: [] }, 'quiz.json').error, 'quiz.json has no questions in it.', 'empty');
  eq(parseQuestions({ questions: [{ question: 'ok' }, { q: 'old key' }] }, 'quiz.json').error, 'quiz.json: question 2 has no "question".', 'bad item');
});

// ---------------------------------------------------------------- messages from the public relays
test('parseCommand only accepts well-formed commands', () => {
  const good = { v: 2, from: 'abc', seq: 3, action: 'correct' };
  eq(parseCommand(JSON.stringify(good)), { from: 'abc', seq: 3, action: 'correct' }, 'good');
  eq(parseCommand(JSON.stringify({ ...good, v: 1 })), null, 'old version');
  eq(parseCommand(JSON.stringify({ ...good, action: 'format-disk' })), null, 'unknown action');
  eq(parseCommand(JSON.stringify({ ...good, seq: '3' })), null, 'seq not a number');
  eq(parseCommand(JSON.stringify({ ...good, from: 'x'.repeat(17) })), null, 'sender id too long');
  eq(parseCommand('not json'), null, 'not JSON');
  eq(parseCommand('x'.repeat(13000)), null, 'too long');
});

test('parseStatus cleans what the display reports', () => {
  const s = parseStatus(JSON.stringify({ v: 2, online: true, at: 5, screen: 'game', phase: 'running', player: 'A'.repeat(99), allowed: ['correct', 'evil'], ack: { from: 'abc', seq: 2 } }));
  eq([s.screen, s.player.length, s.allowed, s.ack], ['game', 40, ['correct'], { from: 'abc', seq: 2 }], 'cleaned');
  eq(parseStatus(JSON.stringify({ v: 2, online: false })), null, 'offline');
  eq(parseStatus(JSON.stringify({ v: 2, online: true, screen: 'hacked' })).screen, '', 'unknown screen');
});

// ---------------------------------------------------------------- report
const failed = results.filter((r) => !r.ok);
if(typeof document !== 'undefined'){
  const list = document.getElementById('results');
  for(const r of results){
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`;
    list.append(li);
  }
  const summary = document.getElementById('summary');
  summary.textContent = `${results.length - failed.length} / ${results.length} passed`;
  summary.className = failed.length ? 'fail' : 'pass';
} else {
  for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  console.log(`\n${results.length - failed.length} / ${results.length} passed`);
  if(failed.length) process.exitCode = 1;
}
