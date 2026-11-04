// The link between the display and the phone, through free public MQTT relays (config.RELAYS).
// Every relay is used at once, so the link works as long as any one of them is up. That means the same
// message can arrive more than once: the display ignores repeats.
//
// Topics, for a room code such as A7K2QX:
//   dansbtc/2/A7K2QX/cmd     phone -> display   { v, from, seq, action, arg? }
//   dansbtc/2/A7K2QX/status  display -> phone   { v, online, at, screen, phase, player, next, allowed, ack }
// The status message is "retained", so a phone that joins later gets it at once. If the display
// disappears, the relays publish its last-will message { v, online:false } in its place.
// The room code is the only thing protecting a room, and anything can arrive on a public relay,
// so every message is checked here before it is used.
import { RELAYS, TOPIC_ROOT, PROTOCOL_VERSION, HEARTBEAT_MS, ACTIONS } from './config.js';
import { randomString } from './util.js';

const SCREENS = ['setup', 'game', 'result'];
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

// -> {from, seq, action, arg} or null
export function parseCommand(raw){
  if(typeof raw !== 'string' || raw.length > 12000) return null;
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if(!m || m.v !== PROTOCOL_VERSION || !ACTIONS.includes(m.action)) return null;
  if(typeof m.from !== 'string' || !m.from || m.from.length > 16 || !Number.isInteger(m.seq)) return null;
  return { from: m.from, seq: m.seq, action: m.action, arg: m.arg };
}

// -> a clean status object, or null if the display is offline (or the message is not one of ours)
export function parseStatus(raw){
  let o;
  try { o = JSON.parse(raw); } catch { return null; }
  if(!o || o.v !== PROTOCOL_VERSION || o.online !== true) return null;
  const ack = o.ack && typeof o.ack.from === 'string' && Number.isInteger(o.ack.seq)
    ? { from: o.ack.from.slice(0, 16), seq: o.ack.seq } : null;
  return {
    at: Number.isFinite(o.at) ? o.at : 0,
    screen: SCREENS.includes(o.screen) ? o.screen : '',
    phase: text(o.phase, 16),
    player: text(o.player, 40),
    next: text(o.next, 40),
    allowed: Array.isArray(o.allowed) ? o.allowed.filter((a) => ACTIONS.includes(a)) : [],
    ack,
  };
}

const decode = (payload) => (typeof payload === 'string' ? payload : new TextDecoder().decode(payload));

// role 'display': listens for commands (onCommand) and publishes its status.
// role 'remote':  sends commands and keeps the display's latest status (latestStatus()).
// onChange() runs whenever a connection opens or drops, or a new status arrives.
export function openRelay({ role, code, onCommand = () => {}, onChange = () => {} }){
  const cmdTopic = `${TOPIC_ROOT}${code}/cmd`;
  const statusTopic = `${TOPIC_ROOT}${code}/status`;
  const offline = JSON.stringify({ v: PROTOCOL_VERSION, online: false });
  const isDisplay = role === 'display';
  let links = [];          // one per relay: { client, connected, status, closed }
  let heartbeat = null;
  let status = null;       // display: the status to publish
  const seen = new Set();  // display: commands already handled ("from:seq")
  const seenOrder = [];

  const statusText = () => JSON.stringify({ v: PROTOCOL_VERSION, online: true, at: Date.now(), ...status });
  const publishToAll = (topic, message, options) => {
    let count = 0;
    for(const link of links){
      if(!link.connected) continue;
      try { link.client.publish(topic, message, options); count++; } catch { /* that relay just dropped */ }
    }
    return count;
  };

  function handleMessage(link, topic, payload){
    const raw = decode(payload);
    if(isDisplay && topic === cmdTopic){
      const cmd = parseCommand(raw);
      if(!cmd) return;
      const id = `${cmd.from}:${cmd.seq}`;
      if(seen.has(id)) return;              // the same press, arriving through another relay
      seen.add(id); seenOrder.push(id);
      if(seenOrder.length > 300) seen.delete(seenOrder.shift());
      onCommand(cmd);
    } else if(!isDisplay && topic === statusTopic){
      link.status = parseStatus(raw);
      onChange();
    }
  }

  function connect(url){
    const options = {
      clientId: `btc${role[0]}${randomString(9, 'abcdefghijklmnopqrstuvwxyz0123456789')}`,
      clean: true, keepalive: 15, reconnectPeriod: 2500, connectTimeout: 8000, protocolVersion: 4,
    };
    if(isDisplay) options.will = { topic: statusTopic, payload: offline, qos: 1, retain: true };
    const link = { client: null, connected: false, status: null, closed: false };
    try { link.client = window.mqtt.connect(url, options); } catch { return null; }
    const lost = () => { if(link.closed) return; link.connected = false; link.status = null; onChange(); };
    link.client.on('connect', () => {
      if(link.closed) return; // stopped while it was still connecting
      link.connected = true;
      if(isDisplay){
        link.client.subscribe(cmdTopic, { qos: 0 });
        if(status) link.client.publish(statusTopic, statusText(), { qos: 1, retain: true });
      } else {
        link.client.subscribe(statusTopic, { qos: 1 });
      }
      onChange();
    });
    link.client.on('close', lost);
    link.client.on('offline', lost);
    link.client.on('error', () => { /* mqtt.js keeps retrying by itself */ });
    link.client.on('message', (topic, payload) => { if(!link.closed) handleMessage(link, topic, payload); });
    return link;
  }

  const relay = {
    failed: false,         // true if the MQTT library is missing (vendor/mqtt.min.js did not load)

    start(){
      relay.stop(false);
      if(!window.mqtt || typeof window.mqtt.connect !== 'function'){ relay.failed = true; onChange(); return; }
      links = RELAYS.map(connect).filter(Boolean);
      // re-announce regularly, so a stale "offline" from a relay always corrects itself
      if(isDisplay) heartbeat = setInterval(() => { if(status) publishToAll(statusTopic, statusText(), { qos: 0, retain: true }); }, HEARTBEAT_MS);
      onChange();
    },

    // graceful: tell phones the display has gone (used when the display page closes or the remote is turned off)
    stop(graceful){
      clearInterval(heartbeat); heartbeat = null;
      const old = links;
      links = [];
      for(const link of old){
        link.closed = true;
        if(graceful && isDisplay && link.connected){
          try { link.client.publish(statusTopic, offline, { qos: 1, retain: true }); } catch { /* closing anyway */ }
        }
        setTimeout(() => { try { link.client.end(true); } catch { /* already closed */ } }, graceful ? 350 : 0);
      }
    },

    // Sockets opened before a phone or tablet slept are often dead: start again from scratch.
    reconnect(){ relay.start(); },

    connectedCount: () => links.filter((l) => l.connected).length,

    // ---- display ----
    publishStatus(newStatus){
      status = newStatus;
      publishToAll(statusTopic, statusText(), { qos: 0, retain: true });
    },

    // ---- phone ----
    // -> how many relays it went out on (0 = not sent)
    send(command){
      return publishToAll(cmdTopic, JSON.stringify({ v: PROTOCOL_VERSION, ...command }), { qos: 0 });
    },
    // The newest status from any relay, or null if the display is not online.
    latestStatus(){
      let newest = null;
      for(const link of links){
        if(link.connected && link.status && (!newest || link.status.at >= newest.at)) newest = link.status;
      }
      return newest;
    },
  };
  return relay;
}

// Keeps a link healthy on phones and tablets: reconnects after the device wakes or comes back online,
// and keeps the screen awake while linked. getRelay() returns the current relay (or null).
export function manageConnection(getRelay, { isDisplay }){
  let hiddenAt = 0;
  let wakeLock = null;

  async function requestWake(){
    if(!getRelay() || wakeLock || document.hidden || !('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* not allowed right now; tried again on the next tap */ }
  }
  function releaseWake(){
    if(wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if(document.hidden){ hiddenAt = Date.now(); return; }
    if(hiddenAt && Date.now() - hiddenAt > 4000) getRelay()?.reconnect();
    requestWake();
  });
  window.addEventListener('online', () => getRelay()?.reconnect());
  window.addEventListener('pageshow', (e) => { if(e.persisted) getRelay()?.reconnect(); });
  if(isDisplay) window.addEventListener('pagehide', () => getRelay()?.stop(true));
  document.addEventListener('pointerdown', requestWake, { passive: true });

  return { requestWake, releaseWake };
}
