// Visual flourishes on the display. The animations themselves are CSS keyframes in display.css;
// these functions only create the pieces. All of them do nothing when the device asks for reduced motion.
import { $, prefersReducedMotion, restartAnimation } from './util.js';

const CONFETTI_COLOURS = ['#e7b740', '#3ec6e0', '#d8434b', '#f3f1ea', '#8b5cf6', '#4ade80'];
const SPARK_COLOURS = ['#3ec6e0', '#e7b740'];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function piece(className, styles){
  const el = document.createElement('div');
  el.className = className;
  for(const [prop, value] of Object.entries(styles)) el.style.setProperty(prop, value);
  return el;
}

// The winner celebration: two waves of confetti and a few emoji.
export function confetti(){
  if(prefersReducedMotion()) return;
  const layer = $('confettiLayer');
  const wave = () => {
    for(let i = 0; i < 110; i++){
      const size = rand(6, 13);
      layer.append(piece('confetti-piece', {
        left: `${rand(0, 100)}%`, width: `${size}px`, height: `${size * 1.4}px`, background: pick(CONFETTI_COLOURS),
        '--drift': `${rand(-80, 80)}px`, 'animation-duration': `${rand(2.4, 4.8)}s`, 'animation-delay': `${rand(0, 1.6)}s`,
      }));
    }
  };
  layer.replaceChildren();
  wave();
  for(let i = 0; i < 12; i++){
    const el = piece('emoji-piece', {
      left: `${rand(5, 95)}%`, top: `${rand(35, 75)}%`, 'font-size': `${rand(22, 42)}px`, 'animation-delay': `${rand(0, 1.4)}s`,
    });
    el.textContent = pick(['🎉', '✨', '🎊']);
    layer.append(el);
  }
  setTimeout(wave, 650);
  setTimeout(() => layer.replaceChildren(), 6400);
}

// A burst of sparks from the middle of `originEl` (a correct answer). `scale` is the screen's fit scale.
export function sparkBurst(originEl, scale = 1){
  if(prefersReducedMotion() || !originEl) return;
  const rect = originEl.getBoundingClientRect();
  if(!rect.width && !rect.height) return;
  const layer = piece('spark-layer', {});
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  for(let i = 0; i < 16; i++){
    const angle = rand(0, Math.PI * 2), distance = rand(36, 90) * scale, size = rand(4, 8) * scale;
    layer.append(piece('spark', {
      left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`, background: SPARK_COLOURS[i % 2],
      '--sx': `${Math.cos(angle) * distance}px`, '--sy': `${Math.sin(angle) * distance}px`,
    }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 650);
}

// A red pulse over the whole screen (last 10 seconds), and a shake when a clock hits zero.
export function screenFlash(){ if(!prefersReducedMotion()) restartAnimation($('criticalFlash'), 'pulse'); }
export function shake(el){ if(!prefersReducedMotion()) restartAnimation(el, 'shake'); }
