// All the game's sounds, made with Web Audio beeps (no sound files).
// Browsers keep audio locked until someone taps or clicks the page; unlock() is wired to every tap.

let ctx = null;
let muted = false;
let lockListener = () => {};

export function unlock(){
  if(!ctx){
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    ctx.onstatechange = () => lockListener();
  }
  if(ctx.state === 'suspended') ctx.resume().catch(() => {});
  lockListener();
}
// True while sound is on but the browser is not letting us play it yet.
export const isLocked = () => !muted && (!ctx || ctx.state !== 'running');
export const isMuted = () => muted;
export function setMuted(value){ muted = value; lockListener(); }
export function onLockChange(fn){ lockListener = fn; }

function beep(freq, seconds, volume, wave = 'square'){
  if(muted || !ctx) return;
  try {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
    osc.stop(ctx.currentTime + seconds + 0.02);
  } catch { /* a missed beep is not worth an error */ }
}

// A sound is a list of notes: [frequency Hz, length s, volume 0-1, start delay ms, waveform].
function playNotes(notes){
  if(muted || !ctx) return;
  for(const [freq, seconds, volume, delay = 0, wave] of notes){
    if(delay) setTimeout(() => beep(freq, seconds, volume, wave), delay);
    else beep(freq, seconds, volume, wave);
  }
}

const CUES = {
  tick:       [[520, 0.045, 0.04]],                                    // each second, above 45 s
  buzzer:     [[140, 0.6, 0.24], [95, 0.6, 0.18], [65, 0.65, 0.14]],  // a clock hits zero
  countdown:  [[700, 0.14, 0.12, 0, 'sine']],                          // "3", "2", "1"
  go:         [[1050, 0.22, 0.15, 0, 'sine'], [1400, 0.2, 0.12, 90, 'sine']],
  whoosh:     [300, 460, 660, 900, 1200].map((f, i) => [f, 0.07, 0.06, i * 28]),
  correct:    [[180, 0.14, 0.10], [1100, 0.11, 0.13], [1500, 0.14, 0.11, 60], [1900, 0.10, 0.06, 110]],
  eliminated: [[420, 0.18, 0.16], [280, 0.22, 0.16, 130], [150, 0.32, 0.17, 280]],
  fanfare: [                                                           // C-E-G-C, then a big chord
    [523, 0.22, 0.15, 0], [659, 0.22, 0.15, 120], [784, 0.22, 0.15, 240], [1047, 0.22, 0.15, 360],
    [784, 0.55, 0.13, 570], [1047, 0.55, 0.12, 570], [1319, 0.55, 0.10, 570], [196, 0.55, 0.15, 570],
  ],
};

export function play(name){ playNotes(CUES[name]); }

// Called once per second while a clock runs. Over the last 45 seconds the beep gets higher, louder
// and longer; under 15 s a bass note and a second tick join in; under 5 s it becomes a rapid four-tick.
export function playSecond(secondsLeft){
  if(secondsLeft <= 0){ play('buzzer'); return; }
  if(secondsLeft > 45){ play('tick'); return; }
  const t = (46 - secondsLeft) / 45;          // ~0.02 at 45 s left -> 1.0 at 1 s left
  const freq = 650 + t * 550, vol = 0.07 + t * 0.16, len = 0.09 + t * 0.06;
  const notes = [[freq, len, vol]];
  if(secondsLeft <= 15) notes.push([120, len * 1.3, vol * 0.55]);
  if(secondsLeft <= 5){
    notes.push([freq + 60, len * 0.6, vol * 0.8, 90], [freq + 120, len * 0.6, vol * 0.85, 180], [freq + 180, len * 0.6, vol * 0.9, 270]);
  } else if(secondsLeft <= 15){
    notes.push([freq + 80, len * 0.7, vol * 0.85, 110]);
  }
  playNotes(notes);
}
