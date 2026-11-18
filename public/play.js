import { h, mount, store, session, SYM, CLS } from './common.js';

const app = document.getElementById('app');
const top = document.getElementById('top');
const meEl = document.getElementById('me');
const scoreEl = document.getElementById('score');
const socket = io();

const pathCode = (location.pathname.match(/^\/p\/([A-Za-z]{4})$/) || [])[1];
let code = pathCode ? pathCode.toUpperCase() : null;
let joined = false;
let view = null;
let pending = null; // pilihan yang baru ditekan, sebelum view dari server datang
let joinError = '';
let wasLocked = true;

const tokenKey = c => `riuh.token.${c}`;
// Token per tab (sessionStorage) diutamakan agar dua tab di satu browser tidak bertukar identitas;
// localStorage cadangan bila browser HP menutup tab lalu peserta membuka link lagi.
const token = {
  get: c => session.get(tokenKey(c)) || store.get(tokenKey(c)),
  set: (c, v) => { session.set(tokenKey(c), v); store.set(tokenKey(c), v); },
  del: c => { session.del(tokenKey(c)); store.del(tokenKey(c)); },
};
const call = (ev, payload) => new Promise(res => socket.emit(ev, payload, res));
const ERRORS = {
  NO_ROOM: 'Ruang tidak ditemukan',
  FULL: 'Ruang penuh',
  NAME_EMPTY: 'Isi nama dulu',
  KICKED: 'Kamu dikeluarkan dari ruang ini',
};
const cut = s => (s.length > 20 ? s.slice(0, 20) + '...' : s);

async function join(name) {
  const saved = code ? token.get(code) : null;
  const res = await call('player:join', { code, name, token: saved || undefined });
  if (!res.ok) {
    if (saved) token.del(code);
    joined = false;
    joinError = ERRORS[res.error] || 'Gagal bergabung';
    return render();
  }
  code = res.code;
  token.set(code, res.token);
  if (!pathCode) history.replaceState(null, '', `/p/${code}`);
  joined = true;
  joinError = '';
}

// Saat pertama tersambung dan setiap tersambung ulang (HP tidur, ganti jaringan), masuk lagi dengan token.
socket.on('connect', () => {
  if (code && token.get(code)) join('');
  else render();
});
socket.on('player:view', v => {
  view = v;
  if (v.phase !== 'answering' || v.myChoice) pending = null;
  if (wasLocked && !v.locked) navigator.vibrate?.(60);
  wasLocked = v.locked;
  render();
});
socket.on('player:kicked', () => {
  token.del(code);
  joined = false;
  view = null;
  joinError = ERRORS.KICKED;
  render();
});

function answer(choice) {
  if (!view || view.locked || pending) return;
  pending = choice;
  navigator.vibrate?.(30);
  socket.emit('player:answer', { choice });
  render();
}
document.addEventListener('keydown', e => {
  if (e.target.closest('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') answer('a');
  if (k === 'arrowright' || k === 'l') answer('b');
});

function screen(cls, ...children) {
  app.className = 'screen ' + cls;
  mount(app, children);
}

function render() {
  const inGame = joined && view;
  top.classList.toggle('hidden', !inGame);
  if (inGame) {
    meEl.textContent = view.name;
    scoreEl.textContent = view.rank ? `${view.score} poin` : '';
  }
  if (!joined) return joinForm();
  if (!view) return screen('wait', h('p', { class: 'sub', text: 'Menyambung...' }));

  const v = view;
  const choice = v.myChoice || pending;

  if (v.phase === 'lobby' || v.phase === 'board') {
    return screen('wait', h('p', { class: 'big', text: v.name }), h('p', { class: 'sub', text: 'Lihat layar presenter' }));
  }
  if (v.phase === 'reading') {
    return screen('reading', h('p', { class: 'big', text: 'Baca soal di layar' }));
  }
  if (v.phase === 'answering' && choice) {
    return screen(CLS[v.qType][choice],
      h('p', { class: 'big', text: `${SYM[v.qType][choice]}  ${v.labels[choice]}` }),
      h('p', { class: 'sub', text: 'Menunggu yang lain' }));
  }
  if (v.phase === 'answering' && v.locked) {
    return screen('reading', h('p', { class: 'big', text: 'Ikut di soal berikutnya' }), h('p', { class: 'sub', text: 'Lihat layar presenter' }));
  }
  if (v.phase === 'answering') {
    const btn = side => h('button', { class: CLS[v.qType][side], type: 'button', onpointerdown: e => { e.preventDefault(); answer(side); } },
      h('span', { class: 'sym', text: SYM[v.qType][side] }),
      h('span', { class: 'txt', text: cut(v.labels[side]) }));
    app.className = 'pad';
    return mount(app, btn('a'), btn('b'));
  }
  if (v.phase === 'result') return resultScreen(v);
  if (v.phase === 'end') {
    if (!v.rank) return screen('ink', h('p', { class: 'big', text: 'Terima kasih sudah ikut' }));
    return screen('ink',
      h('p', { class: 'sub', text: 'Peringkat akhir' }),
      h('p', { class: 'big num', text: `${v.rank} dari ${v.total}` }),
      h('p', { class: 'sub num', text: `${v.score} poin` }));
  }
}

function resultScreen(v) {
  const rank = v.rank ? h('p', { class: 'sub num', text: `Peringkat ${v.rank} dari ${v.total}` }) : null;
  const r = v.result;
  if (!r || r.kind === 'missed') return screen('reading', h('p', { class: 'big', text: 'Tidak sempat menjawab' }), rank);
  if (r.kind === 'correct') return screen('yes', h('p', { class: 'big num', text: `Benar! +${r.gain}` }), rank);
  if (r.kind === 'wrong') return screen('no', h('p', { class: 'big', text: 'Belum tepat' }), rank);
  return screen(CLS.pick[v.myChoice] || 'wait', h('p', { class: 'big num', text: `Kamu bersama ${r.percent}% peserta` }), rank);
}

function joinForm() {
  const codeInput = !pathCode && h('input', {
    class: 'field code', id: 'code', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters',
    inputmode: 'text', placeholder: 'ABCD', value: code || '',
  });
  const nameInput = h('input', { class: 'field', id: 'name', maxlength: '16', autocomplete: 'nickname', placeholder: 'Nama panggilan' });
  const form = h('form', { class: 'join' },
    h('h1', { text: 'Riuh' }),
    codeInput && h('label', null, 'Kode ruang', codeInput),
    h('label', null, 'Nama kamu', nameInput),
    h('p', { class: 'error', text: joinError }),
    h('button', { class: 'btn', type: 'submit' }, 'Masuk'),
  );
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (codeInput) code = codeInput.value.trim().toUpperCase();
    if (!code || code.length !== 4) { joinError = ERRORS.NO_ROOM; return render(); }
    if (!nameInput.value.trim()) { joinError = ERRORS.NAME_EMPTY; return render(); }
    join(nameInput.value);
  });
  screen('wait', form);
  (codeInput && !code ? codeInput : nameInput).focus();
}
