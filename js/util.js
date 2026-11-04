// Small helpers shared by both pages. Nothing here runs on import.
import {
  NAME_MAX, MIN_SECONDS, MAX_SECONDS, DEFAULT_SECONDS, MAX_PLAYERS,
  ROOM_CODE_CHARS, ROOM_CODE_LENGTH,
} from './config.js';

export const $ = (id) => document.getElementById(id);
export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// 75500 -> "01:16" (rounds up, so a clock only shows 00:00 once it has really run out)
export function fmtTime(ms){
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function ordinal(n){
  const lastTwo = n % 100;
  if(lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

// ---- player names and times: every route into the game goes through these ----
export function cleanName(name){
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}
export function clampSeconds(value){
  const n = Math.round(parseFloat(value));
  return Number.isFinite(n) ? clamp(n, MIN_SECONDS, MAX_SECONDS) : DEFAULT_SECONDS;
}
// Any list of players (from the phone, from storage, from the network) -> [{name, seconds}] that is
// safe to use: names cleaned, blank names dropped, times clamped, at most MAX_PLAYERS.
// Accepts the older {name, time} shape too.
export function sanitizePlayers(list){
  if(!Array.isArray(list)) return [];
  const out = [];
  for(const item of list){
    if(out.length >= MAX_PLAYERS) break;
    const name = cleanName(item?.name);
    if(name) out.push({ name, seconds: clampSeconds(item.seconds ?? item.time) });
  }
  return out;
}

// ---- saved settings (localStorage can be unavailable or full, so nothing here throws) ----
export const store = {
  get(key){ try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value){ try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key){ try { localStorage.removeItem(key); } catch { /* nothing to do */ } },
  getJSON(key){ try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  setJSON(key, value){ return store.set(key, JSON.stringify(value)); },
};

// ---- room codes ----
export function randomString(length, chars){
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}
export const newRoomCode = () => randomString(ROOM_CODE_LENGTH, ROOM_CODE_CHARS);
export const normaliseCode = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
export const isValidCode = (code) => /^[A-Z0-9]{4,12}$/.test(code ?? '');

// ---- the page ----
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function setText(el, text){
  if(el.textContent !== text) el.textContent = text;
}
// Hide something but keep its space, so nothing around it moves.
export function setVisible(el, visible){
  el.classList.toggle('invisible', !visible);
}
// Replay a CSS animation that is triggered by a class.
export function restartAnimation(el, className){
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

// Tap-twice buttons for anything that throws something away: the first tap changes the label,
// a second tap within 3 seconds confirms.
export function armConfirm(btn, armedLabel, onConfirm){
  const idleLabel = btn.textContent;
  let timer = null;
  const reset = () => { timer = null; btn.textContent = idleLabel; btn.classList.remove('armed'); };
  const disarm = () => { if(timer){ clearTimeout(timer); reset(); } };
  btn.addEventListener('click', () => {
    if(timer){ disarm(); onConfirm(); return; }
    btn.textContent = armedLabel;
    btn.classList.add('armed');
    timer = setTimeout(reset, 3000);
  });
  return { disarm };
}
