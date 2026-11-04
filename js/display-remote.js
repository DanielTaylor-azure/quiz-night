// The display's side of the phone remote: switching it on and off, the pairing dialog (QR code,
// room code, link), running commands from the phone, and telling the phone what is going on.
import { STORAGE } from './config.js';
import { $, store, newRoomCode, normaliseCode, isValidCode } from './util.js';
import { openRelay, manageConnection } from './relay.js';
import * as sound from './sound.js';

// perform(action, arg): runs an action if it is allowed right now (display.js)
// getStatus(): what the phone should know right now (display.js)
export function initDisplayRemote({ perform, getStatus }){
  let enabled = false;
  let code = '';
  let relay = null;
  let lastAck = null;      // the last command handled, so the phone knows its press arrived
  let lastPublished = '';
  const connection = manageConnection(() => relay, { isDisplay: true });

  const remoteUrl = () => new URL(`remote.html?code=${code}`, location.href).toString();

  function onCommand(cmd){
    lastAck = { from: cmd.from, seq: cmd.seq };
    perform(cmd.action, cmd.arg);   // ignored if not allowed right now
    publishStatus();                // always, so the ack goes out even if nothing changed
  }

  // Send the phone the current status, but only when something in it has changed.
  function publishStatus(){
    if(!relay) return;
    const status = { ...getStatus(), ack: lastAck };
    const text = JSON.stringify(status);
    if(text === lastPublished) return;
    lastPublished = text;
    relay.publishStatus(status);
  }

  function connect(){
    relay?.stop(true);
    lastPublished = '';
    relay = openRelay({ role: 'display', code, onCommand, onChange: renderUi });
    relay.start();
    publishStatus();
    connection.requestWake();
  }

  function enable(){
    code = normaliseCode(store.get(STORAGE.displayCode));
    if(!isValidCode(code)){ code = newRoomCode(); store.set(STORAGE.displayCode, code); }
    enabled = true;
    store.set(STORAGE.remoteOn, '1');
    connect();
    renderUi();
  }

  function disable(){
    enabled = false;
    store.remove(STORAGE.remoteOn);
    relay?.stop(true);
    relay = null;
    connection.releaseWake();
    renderUi();
  }

  // The chip in the top bar and the dialog's status lines.
  function renderUi(){
    $('rcChip').hidden = !enabled;
    if(!enabled) return;
    const connected = relay ? relay.connectedCount() : 0;
    const locked = sound.isLocked();
    $('rcDot').className = `rc-dot ${relay?.failed ? 'bad' : connected ? 'ok' : 'warn'}`;
    $('rcChipText').textContent = code + (locked ? ' 🔇' : '');
    $('rcCode').textContent = code;
    const status = $('rcStatus');
    if(relay?.failed){ status.textContent = 'Could not load the connection library. Reload the page.'; status.className = 'rc-status bad'; }
    else if(connected){ status.textContent = 'Ready'; status.className = 'rc-status ok'; }
    else { status.textContent = 'Connecting…'; status.className = 'rc-status'; }
    $('rcAudioNote').hidden = !locked;
  }

  function renderQr(){
    const box = $('rcQr');
    if(typeof window.qrcode !== 'function'){ box.innerHTML = '<div class="rc-qr-note">QR code unavailable.<br>Use the link below.</div>'; return; }
    const qr = window.qrcode(0, 'M');
    qr.addData(remoteUrl());
    qr.make();
    const n = qr.getModuleCount(), quiet = 3, size = n + quiet * 2;
    let path = '';
    for(let r = 0; r < n; r++){
      for(let c = 0; c < n; c++) if(qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
    box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"`
      + ` aria-label="QR code that opens the remote on a phone"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0b0d14"/></svg>`;
  }

  function openDialog(){
    if(!enabled) enable();
    renderQr();
    $('rcLink').textContent = remoteUrl().replace(/^https?:\/\//, '');
    renderUi();
    $('remoteModal').hidden = false;
  }
  const closeDialog = () => { $('remoteModal').hidden = true; };

  $('remoteBtn').addEventListener('click', openDialog);
  $('rcChip').addEventListener('click', openDialog);
  $('rcClose').addEventListener('click', closeDialog);
  $('remoteModal').addEventListener('click', (e) => { if(e.target.id === 'remoteModal') closeDialog(); });
  $('rcCopy').addEventListener('click', () => {
    const btn = $('rcCopy');
    const done = (ok) => {
      btn.textContent = ok ? 'Copied ✓' : 'Press and hold the link to copy';
      setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
    };
    if(navigator.clipboard?.writeText) navigator.clipboard.writeText(remoteUrl()).then(() => done(true), () => done(false));
    else done(false);
  });
  $('rcNew').addEventListener('click', () => {
    code = newRoomCode();
    store.set(STORAGE.displayCode, code);
    connect();
    openDialog();          // redraws the QR code and link
  });
  $('rcOff').addEventListener('click', () => { disable(); closeDialog(); });
  sound.onLockChange(renderUi);

  if(store.get(STORAGE.remoteOn) === '1') enable();

  return { publishStatus, closeDialog };
}
