// An editable list of players (name, seconds, move up, move down, remove), used by the display's
// setup screen and the phone's Players sheet. `players` ([{name, seconds}]) is edited in place.
// onChange() runs after every edit; the list redraws itself when rows are added, moved or removed.
import { NAME_MAX, MAX_SECONDS } from './config.js';

export function renderPlayerList(container, players, { onChange = () => {}, emptyText = '' } = {}){
  const redraw = () => { renderPlayerList(container, players, { onChange, emptyText }); onChange(); };
  const scrollTop = container.scrollTop;
  container.replaceChildren();

  if(!players.length && emptyText){
    const empty = document.createElement('div');
    empty.className = 'plist-empty';
    empty.textContent = emptyText;
    container.append(empty);
  }

  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'plist-row';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'plist-name';
    name.maxLength = NAME_MAX;
    name.value = p.name;
    name.autocomplete = 'off';
    name.setAttribute('aria-label', `Player ${i + 1} name`);
    name.addEventListener('input', () => { p.name = name.value; onChange(); });

    const secs = document.createElement('input');
    secs.type = 'number';
    secs.className = 'plist-secs';
    secs.min = '1'; secs.max = String(MAX_SECONDS); secs.step = '1';
    secs.inputMode = 'numeric';
    secs.value = p.seconds;
    secs.setAttribute('aria-label', `Player ${i + 1} seconds`);
    secs.addEventListener('input', () => {
      const v = Math.round(parseFloat(secs.value));
      if(v >= 1){ p.seconds = Math.min(MAX_SECONDS, v); onChange(); }
    });
    secs.addEventListener('blur', () => { secs.value = p.seconds; }); // show what is actually used

    const button = (text, label, disabled, action, extraClass = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `plist-btn ${extraClass}`.trim();
      b.textContent = text;
      b.disabled = disabled;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { action(); redraw(); });
      return b;
    };
    const swap = (a, b) => { [players[a], players[b]] = [players[b], players[a]]; };

    row.append(
      name, secs,
      button('↑', `Move player ${i + 1} up`, i === 0, () => swap(i, i - 1)),
      button('↓', `Move player ${i + 1} down`, i === players.length - 1, () => swap(i, i + 1)),
      button('×', `Remove player ${i + 1}`, false, () => players.splice(i, 1), 'remove'),
    );
    container.append(row);
  });

  container.scrollTop = scrollTop;
}
