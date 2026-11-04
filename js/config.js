// Every number and name you might want to tune, in one place.

// ---- players ----
export const MAX_PLAYERS = 24;
export const NAME_MAX = 20;              // characters
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 1800;
export const DEFAULT_SECONDS = 60;
export const DEFAULT_PLAYER_COUNT = 4;   // "Player 1" … "Player 4" on a new game
export const MAX_ADJUST_SECONDS = 600;   // most time "Add time" can add or remove in one go

// ---- the clock ----
export const TICK_MS = 100;
export const LOW_MS = 30000;             // the big clock starts to pulse
export const CRITICAL_MS = 15000;        // clocks turn red
export const COUNTDOWN = ['3', '2', '1', 'GO!'];
export const COUNTDOWN_STEP_MS = 700;
export const COUNTDOWN_END_MS = 650;     // how long "GO!" stays up

// ---- remote control (phone <-> display) ----
// Free public MQTT relays. All are used at once; any one being up is enough.
export const RELAYS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];
export const PROTOCOL_VERSION = 2;       // bump this and TOPIC_ROOT together when messages change shape
export const TOPIC_ROOT = 'dansbtc/2/';
export const HEARTBEAT_MS = 8000;        // the display re-announces itself this often
export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1
export const ROOM_CODE_LENGTH = 6;
export const REPEAT_GUARD_MS = 500;      // the phone ignores the same button pressed twice this quickly

// Everything the phone can ask the display to do. game.allowedActions() says when each is allowed.
export const ACTIONS = [
  'start-game', 'set-players', 'start-clock', 'correct', 'pause',
  'continue', 'add-time', 'set-time', 'new-game',
];

// ---- questions (phone reader) ----
export const QUESTIONS_FILE = 'questions.json';
export const QUESTION_FILE_MAX_BYTES = 1000000;
export const MAX_QUESTIONS = 2000;

// ---- saved on the device (localStorage) ----
// Keep these names: they carry the room code and the host's settings over from earlier versions.
export const STORAGE = {
  displayCode: 'btc_display_code',       // display: its room code
  remoteOn: 'btc_remote_on',             // display: remote switched on
  remoteCode: 'btc_remote_code',         // phone: the room it last joined
  players: 'btc_remote_players',         // phone: the players list
  newPlayerSeconds: 'btc_remote_time',   // phone: seconds for a newly added player
  autoAdvance: 'btc_q_adv',              // phone: next question after Correct
  questionIndex: 'btc_q_idx',            // phone: where you are in the questions
  questionSig: 'btc_q_sig',              // phone: which question list that place belongs to
  customQuestions: 'btc_q_custom',       // phone: a questions file the host picked
};

// "Reset all settings" on the phone clears exactly these. The room code is not here on purpose,
// so a reset never disconnects the phone. Add any new phone setting to this list.
export const PHONE_SETTINGS_KEYS = [
  STORAGE.players, STORAGE.newPlayerSeconds, STORAGE.autoAdvance,
  STORAGE.questionIndex, STORAGE.questionSig, STORAGE.customQuestions,
];
