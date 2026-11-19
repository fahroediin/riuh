import { h, mount, session, SYM, CLS } from './common.js';
import { t, fmt, preferredLang, rememberLang } from './i18n.js';

const app = document.getElementById('app');
const barInfo = document.getElementById('bar-info');
const barTools = document.getElementById('bar-tools');
const fsBtn = document.getElementById('fs');
const socket = io();
const TOKEN_KEY = 'riuh.hostToken';

let view = null;
let sets = [];
let deadline = null; // performance.now() saat hitung mundur habis
let startError = ''; // kunci teks, diterjemahkan saat render
let visitors = null;
let donateOpen = false;
let prefLang = preferredLang();

const lang = () => (view ? view.lang : prefLang);
const tr = (key, ...args) => t(lang(), key, ...args);
const call = (ev, payload) => new Promise(res => (payload === undefined ? socket.emit(ev, res) : socket.emit(ev, payload, res)));

socket.on('connect', async () => {
  const token = session.get(TOKEN_KEY);
  if (!token) return render();
  const res = await call('host:resume', { hostToken: token });
  if (!res.ok) { session.del(TOKEN_KEY); view = null; render(); }
});
socket.on('sets', list => { sets = list; render(); });
socket.on('host:view', v => {
  view = v;
  prefLang = v.lang;
  rememberLang(v.lang);
  deadline = v.remainingMs == null ? null : performance.now() + v.remainingMs;
  render();
});
socket.on('room:closed', () => {
  session.del(TOKEN_KEY);
  view = null;
  startError = 'roomClosed';
  render();
});

async function createRoom() {
  startError = '';
  const res = await call('host:create', { lang: prefLang });
  if (!res.ok) {
    startError = 'serverFull';
    return render();
  }
  session.set(TOKEN_KEY, res.hostToken);
}

function setLang(next) {
  if (next === lang()) return;
  prefLang = next;
  rememberLang(next);
  upload = null; // pesan upload lama berbahasa sebelumnya
  if (view) call('host:setLang', { lang: next });
  render();
}

async function loadVisitors() {
  try {
    const r = await fetch('/api/visits', { cache: 'no-store' });
    if (r.ok) { visitors = (await r.json()).total; renderBar(); }
  } catch { /* angka pengunjung tidak penting untuk jalannya kuis */ }
}
loadVisitors();
setInterval(loadVisitors, 60_000);

const advance = () => view && call('host:advance', { phase: view.phase, qNumber: view.qNumber });

fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && donateOpen) { donateOpen = false; return renderBar(); }
  if (!view || (e.target instanceof Element && e.target.closest('select, input, button'))) return;
  if (e.key === ' ' || e.key === 'ArrowRight') {
    if (['result', 'board'].includes(view.phase)) { e.preventDefault(); advance(); }
  }
});
document.addEventListener('click', e => {
  if (donateOpen && e.target instanceof Element && !e.target.closest('.donate')) { donateOpen = false; renderBar(); }
});

// hitung mundur lokal, disinkronkan ulang tiap view datang
function tickTimer() {
  const el = document.getElementById('timer');
  if (el && deadline != null) el.textContent = String(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
  requestAnimationFrame(tickTimer);
}
requestAnimationFrame(tickTimer);

// Bar atas: jumlah pengunjung, pilihan bahasa, dan donasi hanya tampil di luar soal agar layar tetap fokus.
function renderBar() {
  document.documentElement.lang = lang();
  fsBtn.textContent = tr('fullscreen');
  barInfo.textContent = view ? tr('room', view.code) + (view.setTitle ? `  |  ${view.setTitle}` : '') : '';
  const calm = !view || view.phase === 'lobby' || view.phase === 'end';
  if (!calm) { donateOpen = false; return mount(barTools); }
  const canSwitch = !view || view.phase === 'lobby';
  const langBtn = code => h('button', {
    type: 'button', class: 'lang-btn' + (lang() === code ? ' on' : ''), 'aria-pressed': String(lang() === code),
    onclick: () => setLang(code),
  }, code.toUpperCase());
  mount(barTools,
    visitors != null && h('span', { class: 'visitors num', text: tr('visitors', fmt(lang(), visitors)) }),
    canSwitch && h('div', { class: 'lang', role: 'group', 'aria-label': 'Bahasa / Language' }, langBtn('id'), langBtn('en')),
    h('div', { class: 'donate' },
      h('button', {
        type: 'button', class: 'btn ghost with-icon', 'aria-expanded': String(donateOpen), 'aria-haspopup': 'true',
        onclick: () => { donateOpen = !donateOpen; renderBar(); },
      }, saweriaLogo(), h('span', { text: tr('donate') })),
      donateOpen && donatePanel(),
    ),
  );
}

// alamat email dirakit di sini agar tidak tertulis utuh di HTML untuk pemanen email
const EMAIL = ['imam.fahrudin.work', 'gmail.com'].join('@');
let copied = false;

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(EMAIL);
  } catch {
    // cadangan untuk browser tanpa Clipboard API
    const ta = h('textarea', { class: 'sr-only', readonly: true });
    ta.value = EMAIL;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  copied = true;
  renderBar();
  setTimeout(() => { copied = false; if (donateOpen) renderBar(); }, 2000);
}

function donatePanel() {
  return h('div', { class: 'donate-panel', role: 'dialog', 'aria-label': tr('donate') },
    h('p', { class: 'donate-note', text: tr('donateNote') }),
    // Saweria utama: donatur lokal cukup scan QRIS atau pakai e-wallet, tanpa akun
    h('a', {
      class: 'pill primary', href: 'https://saweria.co/ifahrudin', target: '_blank', rel: 'noopener noreferrer',
    }, saweriaLogo(), h('span', { text: tr('donateSaweria') })),
    h('div', { class: 'pill-row' },
      // langsung ke jendela tulis Gmail; mailto: bergantung aplikasi email bawaan yang sering belum diatur
      h('a', {
        class: 'pill', target: '_blank', rel: 'noopener noreferrer',
        href: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(EMAIL)}&su=${encodeURIComponent(tr('donateSubject'))}`,
      }, icon('mail'), h('span', { text: tr('donateEmail') })),
      h('button', { class: 'pill' + (copied ? ' done' : ''), type: 'button', onclick: copyEmail, 'aria-live': 'polite' },
        icon(copied ? 'check' : 'copy'), h('span', { text: copied ? tr('copied') : tr('copyEmail') })),
    ),
  );
}

// logo Saweria (favicon resmi saweria.co), disajikan dari situs sendiri karena CSP img-src 'self'
const saweriaLogo = () => h('img', { class: 'brand-logo', src: '/saweria.png', alt: '', width: '20', height: '20' });

// Ikon garis 24x24 (bentuk dari Lucide, lisensi ISC), dibuat lewat DOM agar lolos CSP.
const ICONS = {
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  check: ['M20 6 9 17l-5-5'],
};
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) {
    svg.setAttribute(k, v);
  }
  for (const d of ICONS[name]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

function render() {
  // jangan bangun ulang lobi saat presenter sedang membuka dropdown set soal
  if (view && view.phase === 'lobby' && document.activeElement && document.activeElement.id === 'set') {
    document.activeElement.addEventListener('blur', render, { once: true });
    return;
  }
  renderBar();
  if (!view) return mount(app, startScreen());
  const screens = { lobby, reading: question, answering: question, result: question, board, end };
  mount(app, screens[view.phase]());
}

function startScreen() {
  return h('section', { class: 'start' },
    h('div', { class: 'start-intro' },
      h('h1', { text: 'Riuh' }),
      h('p', { class: 'tagline', text: tr('tagline') }),
      h('button', { class: 'btn', type: 'button', onclick: createRoom }, tr('createRoom')),
      h('p', { class: 'error', text: startError ? tr(startError) : '' }),
      h('div', { class: 'how' },
        h('h2', { class: 'label', text: tr('howTitle') }),
        h('ol', null, ['how1', 'how2', 'how3'].map((k, i) =>
          h('li', null, h('span', { class: 'how-n num', text: String(i + 1) }), h('span', { text: tr(k) })))),
      ),
    ),
    demo(),
  );
}

// ---------- demo satu ronde di layar awal ----------
// Empat tahap berulang: baca soal -> tombol HP terbuka -> peserta menekan -> hasil di layar.
// Satu timer global memperbarui elemen yang ada; render ulang layar awal tidak memulai timer baru.
const DEMO_STEPS = 4;
const DEMO_MS = 1800;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let demoStep = reduceMotion ? 3 : 0;

function demo() {
  const el = h('figure', { class: 'demo', 'aria-label': tr('demoLabel') });
  // isi layar dibuat sekali; tahap hanya mengganti class sehingga transisi CSS jalan
  el.append(
    h('div', { class: 'demo-screen' },
      h('span', { class: 'demo-cap', text: tr('demoScreen') }),
      h('div', { class: 'demo-frame' },
      h('div', { class: 'demo-head' },
        h('span', { class: 'num', text: tr('questionNo', 1, 10) }),
        h('span', { class: 'demo-timer num', text: '10' })),
      h('p', { class: 'demo-q', text: tr('demoQ') }),
      h('p', { class: 'demo-status num' }),
      h('div', { class: 'demo-opts' },
        h('div', { class: 'demo-opt a' },
          h('span', { class: 'sym', text: 'A' }), h('span', { text: tr('demoA') }),
          h('span', { class: 'demo-pct num', text: '75%' }), h('span', { class: 'demo-names', text: tr('demoNames') }),
          h('span', { class: 'demo-bar w75' })),
        h('div', { class: 'demo-opt b' },
          h('span', { class: 'sym', text: 'B' }), h('span', { text: tr('demoB') }),
          h('span', { class: 'demo-pct num', text: '25%' }), h('span', { class: 'demo-names', text: tr('demoNamesB') }),
          h('span', { class: 'demo-bar w25' })),
      ),
      ),
    ),
    h('div', { class: 'demo-phone' },
      h('span', { class: 'demo-cap', text: tr('demoPhone') }),
      h('div', { class: 'demo-phone-body' },
        h('div', { class: 'demo-ph read', text: tr('readOnScreen') }),
        h('div', { class: 'demo-ph pad' },
          h('div', { class: 'demo-key a' }, h('span', { class: 'sym', text: 'A' }), h('span', { text: tr('demoA') })),
          h('div', { class: 'demo-key b' }, h('span', { class: 'sym', text: 'B' }), h('span', { text: tr('demoB') }))),
        h('div', { class: 'demo-ph picked', text: `A  ${tr('demoA')}` }),
        h('div', { class: 'demo-ph done', text: tr('withPercent', 75) }),
      ),
    ),
  );
  setDemoStep(el, demoStep);
  return el;
}

function setDemoStep(el, step) {
  el.dataset.step = String(step);
  const status = el.querySelector('.demo-status');
  status.textContent = step === 0 ? tr('readQuestion')
    : step === 3 ? tr('picked', 4)
    : tr('answered', step === 1 ? 0 : 3, 4);
  el.querySelector('.demo-timer').textContent = step === 0 ? '3' : step === 1 ? '10' : '6';
}

if (!reduceMotion) {
  setInterval(() => {
    const el = document.querySelector('.demo');
    if (!el || document.hidden) return;
    demoStep = (demoStep + 1) % DEMO_STEPS;
    setDemoStep(el, demoStep);
  }, DEMO_MS);
}

// status upload terakhir: { kind: 'busy' | 'ok' | 'error', lines: string[] }
let upload = null;

async function uploadFile(file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) {
    upload = { kind: 'error', lines: [tr('notXlsx')] };
    return render();
  }
  if (file.size > 1024 * 1024) {
    upload = { kind: 'error', lines: [tr('tooBig')] };
    return render();
  }
  upload = { kind: 'busy', lines: [tr('reading', file.name)] };
  render();
  const res = await call('host:uploadSet', { name: file.name, data: await file.arrayBuffer() });
  if (res.ok) {
    upload = { kind: 'ok', lines: [tr('uploadOk', res.title, res.count)] };
  } else {
    const shown = res.errors.slice(0, 10);
    if (res.errors.length > 10) shown.push(tr('moreErrors', res.errors.length - 10));
    upload = { kind: 'error', lines: [tr('uploadFail'), ...shown] };
  }
  render();
}

function uploadBox() {
  const input = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', class: 'hidden' });
  input.addEventListener('change', () => uploadFile(input.files[0]));
  const en = lang() === 'en';
  return h('div', { class: 'upload' },
    h('div', { class: 'upload-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => input.click() }, tr('upload')),
      h('a', { class: 'link', href: en ? '/template.xlsx?lang=en' : '/template.xlsx', download: en ? 'riuh-template-en.xlsx' : 'riuh-template.xlsx' }, tr('downloadTemplate')),
      input,
    ),
    upload && h('ul', { class: 'upload-msg ' + upload.kind }, upload.lines.map(l => h('li', { text: l }))),
  );
}

function lobby() {
  const select = h('select', { class: 'field', id: 'set' },
    sets.map(s => h('option', { value: s.id, selected: s.id === view.setId },
      `${s.title} (${tr('questionsCount', s.count)})${s.custom ? ' ' + tr('uploaded') : ''}`)));
  select.addEventListener('change', () => call('host:selectSet', { setId: select.value }));
  const canStart = view.players.length > 0 && view.setId;
  return h('section', { class: 'lobby' },
    h('div', { class: 'join-card' },
      h('img', { src: `/qr/${view.code}.svg`, alt: tr('qrAlt', view.code) }),
      h('div', null, h('div', { class: 'label', text: tr('openOnPhone') }), h('div', { class: 'join-link', text: view.joinUrl })),
      h('div', null, h('div', { class: 'label', text: tr('roomCode') }), h('div', { class: 'join-code', text: view.code })),
    ),
    h('div', { class: 'roster' },
      h('h2', { class: 'num' }, tr('participants', view.players.length)),
      view.players.length
        ? h('div', { class: 'chips' }, view.players.map(p =>
            h('button', {
              class: 'chip' + (p.connected ? '' : ' off'), type: 'button', title: tr('kickHint'),
              onclick: () => { if (confirm(tr('kickConfirm', p.name))) call('host:kick', { playerId: p.id }); },
            }, p.name)))
        : h('p', { class: 'empty', text: tr('waitingPlayers') }),
      h('div', { class: 'lobby-controls' },
        h('label', null, h('span', { class: 'label', text: tr('questionSet') }), select),
        h('button', { class: 'btn', type: 'button', disabled: !canStart, onclick: () => call('host:start') }, tr('start')),
      ),
      uploadBox(),
    ),
  );
}

function question() {
  const q = view.question;
  const reading = view.phase === 'reading';
  const result = view.phase === 'result';
  const kind = q.type === 'tf' ? tr('kindTf') : tr('kindPick');
  const split = view.split;
  const total = split ? split.a + split.b : 0;

  const option = side => {
    const cls = ['opt', CLS[q.type][side]];
    if (reading) cls.push('dim');
    if (result && q.type === 'tf') cls.push(view.correct === side ? 'win' : 'dim');
    const count = result ? split[side] : null;
    const names = result && q.type === 'pick'
      ? [...split[side + 'Names'], ...(split[side + 'More'] ? [tr('more', split[side + 'More'])] : [])].join(', ')
      : '';
    return h('div', { class: cls.join(' ') },
      h('span', { class: 'sym', text: SYM[q.type][side] }),
      h('span', { class: 'txt', text: q[side] }),
      names && h('span', { class: 'names', text: names }),
      count != null && h('span', { class: 'count num', text: q.type === 'pick' && total ? `${Math.round((count / total) * 100)}%` : String(count) }),
      result && q.type === 'pick' && h('span', { class: 'bar', style: `width:${total ? (count / total) * 100 : 0}%` }),
    );
  };

  let status = '';
  if (reading) status = tr('readQuestion');
  else if (view.phase === 'answering') status = tr('answered', view.answeredCount, view.activeCount);
  else if (q.type === 'pick') status = total ? tr('picked', total) : tr('nobody');
  else status = tr('answerIs', q[view.correct]);

  return [
    h('div', { class: 'q-head' },
      h('span', { class: 'num' }, tr('questionNo', view.qNumber, view.qTotal)),
      h('span', { text: kind }),
      h('span', { class: 'spacer' }),
      !result && h('span', { class: 'timer num' + (reading ? ' reading' : ''), id: 'timer' }),
    ),
    h('p', { class: 'q-text', text: q.text }),
    h('p', { class: 'q-status num', text: status }),
    h('div', { class: 'options' }, option('a'), option('b')),
    h('div', { class: 'footer-actions' },
      view.phase === 'answering' && h('button', { class: 'btn ghost', type: 'button', onclick: advance }, tr('endNow')),
      result && h('span', { class: 'hint', text: tr('space') }),
      result && h('button', { class: 'btn', type: 'button', onclick: advance }, tr('next')),
    ),
  ];
}

function board() {
  return [
    h('section', { class: 'board' },
      h('h2', { text: tr('top5') }),
      h('ol', { class: 'rank-list' }, view.top.map((p, i) =>
        h('li', null, h('span', { class: 'pos num', text: String(i + 1) }), h('span', { text: p.name }), h('span', { class: 'num', text: String(p.score) })))),
    ),
    h('div', { class: 'footer-actions' },
      h('span', { class: 'hint', text: tr('space') }),
      h('button', { class: 'btn', type: 'button', onclick: advance }, view.qNumber >= view.qTotal ? tr('seeFinal') : tr('nextQuestion')),
    ),
  ];
}

function end() {
  const again = h('div', { class: 'footer-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => call('host:replay') }, tr('playAgain')));
  if (!view.scored) return [h('p', { class: 'thanks', text: tr('thanks') }), again];
  const r = view.ranking;
  const step = (p, place) => p && h('div', { class: `step p${place}` },
    h('span', { class: 'who', text: p.name }),
    h('span', { class: 'score num', text: tr('points', p.score) }),
    h('span', { class: 'block num', text: String(place) }));
  return [
    h('section', { class: 'end' },
      h('h2', { text: tr('finalResult') }),
      h('div', { class: 'podium' }, step(r[1], 2), step(r[0], 1), step(r[2], 3)),
      r.length > 3 && h('ol', { class: 'rest', start: '4' }, r.slice(3).map(p => h('li', { class: 'num', text: `${p.name} - ${p.score}` }))),
    ),
    again,
  ];
}

render();
