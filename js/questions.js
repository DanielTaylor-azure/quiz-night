// The question reader on the phone. Only the host sees it.
//
// Text size: every question in a set is shown at the same size, the largest (up to READER_MAX_PX) at which
// the longest question and its answer fit the box, so nothing ever needs scrolling. It is worked out again
// when a new set loads or the box changes size (for example when the phone is turned).
//
// It starts with the default questions.json (next to remote.html). The host can pick a JSON file of
// their own (Host controls > Questions); that is saved on the phone and used until they switch back
// to the default or reset all settings. It remembers your place in each list across reloads.
//
// File format:  { "questions": [ { "question": "...", "answer": "..." }, ... ] }   (a bare [ ... ] also works)
import { QUESTIONS_FILE, QUESTION_FILE_MAX_BYTES, MAX_QUESTIONS, STORAGE } from './config.js';
import { $, store, plural, armConfirm } from './util.js';

const READER_MAX_PX = 24;
const READER_MIN_PX = 10;
const MEASURE_LONGEST = 40;  // only the longest questions/answers need measuring to find the size

const clean = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '');

// data: the parsed JSON. -> { questions: [{question, answer}] } or { error: 'message for the host' }
export function parseQuestions(data, fileName = QUESTIONS_FILE){
  const list = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : null;
  if(!list) return { error: `${fileName} should contain a list of questions, each with a "question" and an "answer".` };
  const questions = [];
  for(let i = 0; i < list.length && questions.length < MAX_QUESTIONS; i++){
    const question = clean(list[i]?.question);
    if(!question) return { error: `${fileName}: question ${i + 1} has no "question".` };
    questions.push({ question: question.slice(0, 800), answer: clean(list[i].answer).slice(0, 400) });
  }
  if(!questions.length) return { error: `${fileName} has no questions in it.` };
  return { questions };
}

// Download the default questions. Resolves with the list; rejects with an Error whose message is for the host.
async function fetchDefaultQuestions(){
  let res;
  try { res = await fetch(new URL(QUESTIONS_FILE, location.href), { cache: 'no-cache' }); }
  catch { throw new Error(`Could not load ${QUESTIONS_FILE}. Check your connection.`); }
  if(res.status === 404) throw new Error(`Could not find ${QUESTIONS_FILE}. Put it in the same folder as remote.html.`);
  if(!res.ok) throw new Error(`Could not load ${QUESTIONS_FILE} (error ${res.status}).`);
  let data;
  try { data = JSON.parse((await res.text()).replace(/^﻿/, '')); }
  catch { throw new Error(`${QUESTIONS_FILE} is not valid JSON. Check for a missing comma or quote.`); }
  const parsed = parseQuestions(data);
  if(parsed.error) throw new Error(parsed.error);
  return parsed.questions;
}

export function initQuestions(){
  let questions = [];
  let index = 0;
  let state = 'loading';                 // 'loading' | 'ok' | 'error'
  let errorText = '';
  let source = { type: 'default' };      // or { type: 'file', name: 'my-quiz.json' }
  let request = 0;                       // bumped whenever the source changes, so a late download is ignored
  let retries = 0, retryTimer = null;

  let fittedFor = '';                    // the set and box size the current text size was worked out for
  const mustFit = new Set();             // questions found too long at the current size (see render)

  const el = {
    body: $('rmQBody'),
    count: $('rmQCount'), text: $('rmQText'), answer: $('rmQAns'), answerText: $('rmQAnsText'),
    first: $('rmQFirst'), prev: $('rmQPrev'), next: $('rmQNext'),
    source: $('rmQSource'), useDefault: $('rmQDefault'), file: $('rmQFile'), message: $('rmQMsg'),
  };

  const signature = () => (questions.length ? `${questions.length}:${questions[0].question.slice(0, 40)}` : '');
  const savePlace = () => store.set(STORAGE.questionIndex, String(index));
  function showMessage(text, kind = ''){
    el.message.textContent = text;
    el.message.className = `rm-qmsg ${kind}`.trim();
  }

  // Show a list. Keeps your place if it is the same list as last time, unless fromStart.
  function use(list, newSource, fromStart){
    questions = list;
    source = newSource;
    const sig = signature();
    const saved = parseInt(store.get(STORAGE.questionIndex), 10);
    index = !fromStart && store.get(STORAGE.questionSig) === sig && saved >= 0 ? Math.min(saved, list.length) : 0;
    store.set(STORAGE.questionSig, sig);
    savePlace();
    state = 'ok';
    mustFit.clear();
    fitTextSize();
    render();
  }

  // ---- one text size for the whole set ----
  // An invisible copy of the reader text, the same width as the real one, used for measuring.
  const probe = document.createElement('div');
  probe.className = 'rm-rbody rm-probe';
  probe.setAttribute('aria-hidden', 'true');
  probe.innerHTML = '<div class="rm-qtext"></div><div class="rm-qans"><span class="rm-qlabel">Answer</span><span class="rm-qans-text"></span></div>';
  el.body.parentElement.append(probe);
  const [probeQuestion, probeAnswer] = [probe.firstChild, probe.querySelector('.rm-qans-text')];

  function fitTextSize(){
    const width = el.body.clientWidth, height = el.body.clientHeight;
    if(state !== 'ok' || !width || !height) return;      // hidden for now: done when it appears (ResizeObserver)
    const key = `${signature()}|${width}|${height}|${mustFit.size}`;
    if(key === fittedFor) return;
    fittedFor = key;
    const byLength = (field) => questions.slice().sort((a, b) => b[field].length - a[field].length).slice(0, MEASURE_LONGEST);
    const toMeasure = new Set([...byLength('question'), ...byLength('answer'), ...[...mustFit].map((i) => questions[i])]);
    probe.style.width = `${width}px`;
    const fits = (px) => {
      probe.style.setProperty('--qfs', `${px}px`);
      for(const q of toMeasure){
        probeQuestion.textContent = q.question;
        probeAnswer.textContent = q.answer || '—';
        if(probe.scrollHeight > height) return false;
      }
      return true;
    };
    let lo = READER_MIN_PX, hi = READER_MAX_PX;          // largest whole pixel size that fits
    while(lo < hi){
      const mid = Math.ceil((lo + hi) / 2);
      if(fits(mid)) lo = mid; else hi = mid - 1;
    }
    probeQuestion.textContent = probeAnswer.textContent = '';
    el.body.style.setProperty('--qfs', `${lo}px`);
  }

  // The default questions. If they fail to load it quietly tries again a few times (and whenever you
  // come back to the app), but only while the default questions are the ones in use.
  async function loadDefault(quiet){
    clearTimeout(retryTimer);
    const mine = ++request;
    if(!quiet){ state = 'loading'; render(); }
    try {
      const list = await fetchDefaultQuestions();
      if(mine !== request) return;
      retries = 0;
      use(list, { type: 'default' }, false);
    } catch(err){
      if(mine !== request) return;
      state = 'error';
      errorText = err.message;
      render();
      if(retries < 5){
        retries++;
        retryTimer = setTimeout(() => { if(state === 'error' && source.type === 'default') loadDefault(true); }, 15000);
      }
    }
  }

  // The host picked a file. A file that cannot be used never replaces the questions already loaded.
  async function loadFromFile(file){
    if(!file) return;
    const name = String(file.name || 'That file').slice(0, 60);
    if(file.size > QUESTION_FILE_MAX_BYTES){ showMessage(`${name} is too big (over 1 MB).`, 'bad'); return; }
    showMessage(`Reading ${name}…`);
    let data;
    try { data = JSON.parse((await file.text()).replace(/^﻿/, '')); }
    catch { showMessage(`${name} is not valid JSON. Check for a missing comma or quote.`, 'bad'); return; }
    const parsed = parseQuestions(data, name);
    if(parsed.error){ showMessage(parsed.error, 'bad'); return; }
    request++;                           // a default download still on its way must not replace this
    clearTimeout(retryTimer);
    const saved = store.setJSON(STORAGE.customQuestions, { name, questions: parsed.questions });
    use(parsed.questions, { type: 'file', name }, true);
    const loaded = `Loaded ${plural(parsed.questions.length, 'question')} from ${name}`;
    if(saved) showMessage(`${loaded}.`, 'ok');
    else showMessage(`${loaded}, but it could not be saved on this phone, so pick it again if the page reloads.`, 'bad');
  }

  // Back to the default questions. The picked file stays in use unless the default actually loads.
  async function useDefault(){
    const mine = ++request;
    clearTimeout(retryTimer);
    showMessage('Loading the default questions…');
    try {
      const list = await fetchDefaultQuestions();
      if(mine !== request) return;
      store.remove(STORAGE.customQuestions);
      retries = 0;
      use(list, { type: 'default' }, true);
      showMessage('Using the default questions.', 'ok');
    } catch(err){
      if(mine !== request) return;
      showMessage(`${err.message} Still using ${source.name}.`, 'bad');
    }
  }

  function render(){
    const n = questions.length, atEnd = index >= n;
    let count = 'Questions', text = '', dim = true, showAnswer = false;
    if(state === 'loading') text = 'Loading questions…';
    else if(state === 'error') text = errorText;
    else if(atEnd){ text = `That is all ${plural(n, 'question')}. Tap ⏮ First to start again.`; count = `${n} / ${n}`; }
    else {
      text = questions[index].question;
      el.answerText.textContent = questions[index].answer || '—';
      count = `Q ${index + 1} / ${n}`;
      dim = false;
      showAnswer = true;
    }
    el.count.textContent = count;
    el.text.textContent = text;
    el.text.classList.toggle('dim', dim);
    el.text.scrollTop = 0;
    el.answer.classList.toggle('invisible', !showAnswer); // keeps its space, so nothing moves
    el.prev.disabled = state !== 'ok' || index === 0;
    el.next.disabled = state !== 'ok' || atEnd;
    el.first.disabled = state !== 'ok' || index === 0;
    if(el.first.disabled) firstConfirm.disarm();
    // Only the longest questions are measured; if this one still does not fit, fit the set to it too.
    if(showAnswer && el.text.scrollHeight > el.text.clientHeight + 1 && !mustFit.has(index)){
      mustFit.add(index);
      fitTextSize();
    }

    // the Questions section of the host sheet
    const status = state === 'ok' ? plural(n, 'question') : state === 'loading' ? 'loading…' : 'not loaded';
    el.source.textContent = `${source.type === 'file' ? source.name : 'Default questions'} · ${status}`;
    el.useDefault.hidden = source.type !== 'file';
  }

  function step(by){
    if(state !== 'ok') return;
    index = Math.max(0, Math.min(questions.length, index + by));
    savePlace();
    render();
  }

  const firstConfirm = armConfirm(el.first, 'Sure?', () => { if(state === 'ok'){ index = 0; savePlace(); render(); } });
  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  new ResizeObserver(fitTextSize).observe(el.body);       // turned, resized, or just became visible
  document.fonts?.ready.then(() => { fittedFor = ''; fitTextSize(); });
  el.file.addEventListener('change', () => {
    const file = el.file.files && el.file.files[0];
    el.file.value = '';                  // so the same file can be picked again after editing it
    loadFromFile(file);
  });
  el.useDefault.addEventListener('click', useDefault);
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && state === 'error' && source.type === 'default'){ retries = 0; loadDefault(true); }
  });

  // start: a file the host picked earlier wins, otherwise the default questions
  const saved = store.getJSON(STORAGE.customQuestions);
  const parsed = saved && typeof saved.name === 'string' ? parseQuestions(saved, saved.name) : null;
  if(parsed && !parsed.error) use(parsed.questions, { type: 'file', name: saved.name.slice(0, 60) }, false);
  else { store.remove(STORAGE.customQuestions); loadDefault(false); }

  return { next: () => step(1) };
}
