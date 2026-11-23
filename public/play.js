import { h, mount, store, session, SYM, CLS } from './common.js';
import { t, preferredLang, isLang } from './i18n.js';

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
let joinError = ''; // kunci teks, diterjemahkan saat render
let wasLocked = true;
let roomLang = null; // bahasa ruang sebelum bergabung (dari room:info)

// HP mengikuti bahasa yang dipilih presenter; sebelum tahu ruangnya, pakai bahasa browser.
const lang = () => (view ? view.lang : roomLang || preferredLang());
const tr = (key, ...args) => t(lang(), key, ...args);

const tokenKey = c => `riuh.token.${c}`;
// Token per tab (sessionStorage) diutamakan agar dua tab di satu browser tidak bertukar identitas;
// localStorage cadangan bila browser HP menutup tab lalu peserta membuka link lagi.
const token = {
  get: c => session.get(tokenKey(c)) || store.get(tokenKey(c)),
  set: (c, v) => { session.set(tokenKey(c), v); store.set(tokenKey(c), v); },
  del: c => { session.del(tokenKey(c)); store.del(tokenKey(c)); },
};
const call = (ev, payload) => new Promise(res => socket.emit(ev, payload, res));
const ERRORS = { NO_ROOM: 'noRoom', FULL: 'full', NAME_EMPTY: 'nameEmpty', KICKED: 'kicked' };
const cut = s => (s.length > 20 ? s.slice(0, 20) + '...' : s);

async function join(name) {
  const saved = code ? token.get(code) : null;
  const res = await call('player:join', { code, name, token: saved || undefined });
  if (!res.ok) {
    if (saved) token.del(code);
    joined = false;
    joinError = ERRORS[res.error] || 'joinFailed';
    return render();
  }
  code = res.code;
  token.set(code, res.token);
  if (!pathCode) history.replaceState(null, '', `/p/${code}`);
  joined = true;
  joinError = '';
}

async function fetchRoomLang() {
  if (!code) return;
  const info = await call('room:info', { code });
  if (info.ok && isLang(info.lang)) { roomLang = info.lang; if (!joined) render(); }
}

// Saat pertama tersambung dan setiap tersambung ulang (HP tidur, ganti jaringan), masuk lagi dengan token.
socket.on('connect', () => {
  fetchRoomLang();
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
  joinError = 'kicked';
  render();
});

function answer(choice) {
  if (!view || view.locked || pending) return;
  pending = choice;
  navigator.vibrate?.(30);
  sendAnswer(choice);
  render();
}
// Token ikut dikirim agar jawaban tetap tercatat walau ditekan saat sedang menyambung ulang.
// Bila tetap gagal (selain ALREADY), layar kembali ke tombol supaya peserta bisa menekan lagi.
function sendAnswer(choice) {
  socket.timeout(4000).emit('player:answer', { choice, code, token: token.get(code) }, (err, res) => {
    if (!err && (res.ok || res.error === 'ALREADY')) return;
    if (pending === choice) { pending = null; render(); }
  });
}

document.addEventListener('keydown', e => {
  if (e.target instanceof Element && e.target.closest('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') answer('a');
  if (k === 'arrowright' || k === 'l') answer('b');
});

function screen(cls, ...children) {
  app.className = 'screen ' + cls;
  mount(app, children);
}

function render() {
  document.documentElement.lang = lang();
  const inGame = joined && view;
  top.classList.toggle('hidden', !inGame);
  if (inGame) {
    meEl.textContent = view.name;
    scoreEl.textContent = view.rank ? tr('points', view.score) : '';
  }
  if (!joined) return joinForm();
  if (!view) return screen('wait', h('p', { class: 'sub', text: tr('connecting') }));

  const v = view;
  const choice = v.myChoice || pending;

  if (v.phase === 'lobby' || v.phase === 'board') {
    return screen('wait', h('p', { class: 'big', text: v.name }), h('p', { class: 'sub', text: tr('lookAtScreen') }));
  }
  if (v.phase === 'reading') {
    return screen('reading', h('p', { class: 'big', text: tr('readOnScreen') }));
  }
  if (v.phase === 'answering' && choice) {
    return screen(CLS[v.qType][choice],
      h('p', { class: 'big', text: `${SYM[v.qType][choice]}  ${v.labels[choice]}` }),
      h('p', { class: 'sub', text: tr('waitOthers') }));
  }
  if (v.phase === 'answering' && v.locked) {
    return screen('reading', h('p', { class: 'big', text: tr('nextRound') }), h('p', { class: 'sub', text: tr('lookAtScreen') }));
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
    if (!v.rank) screen('ink', h('p', { class: 'big', text: tr('thanks') }));
    else {
      screen('ink',
        h('p', { class: 'sub', text: tr('finalRank') }),
        h('p', { class: 'big num', text: tr('rankOf', v.rank, v.total) }),
        h('p', { class: 'sub num', text: tr('points', v.score) }));
    }
    maybeShowReviewModal();
    return;
  }
}

const REVIEW_THROTTLE_MS = 30 * 24 * 60 * 60 * 1000;
let reviewShown = false;

function canPromptReview() {
  const last = Number(store.get('riuh.review.at') || 0);
  return !last || (Date.now() - last >= REVIEW_THROTTLE_MS);
}

function closeReviewModal() {
  const modal = document.getElementById('review-modal');
  if (modal) modal.remove();
}

function dismissReview() {
  store.set('riuh.review.at', Date.now());
  closeReviewModal();
}

function submitReview(rating, comment) {
  store.set('riuh.review.at', Date.now());
  socket.emit('player:review', { rating, comment, code, lang: lang() });
  const card = document.querySelector('.modal-card');
  if (card) {
    card.innerHTML = '';
    card.appendChild(h('p', { class: 'modal-thanks', text: tr('reviewThanks') }));
    setTimeout(closeReviewModal, 1400);
  } else {
    closeReviewModal();
  }
}

function maybeShowReviewModal() {
  if (reviewShown || !canPromptReview() || document.getElementById('review-modal')) return;
  reviewShown = true;

  let selectedRating = 0;
  const starsContainer = h('div', { class: 'star-rating' });
  const starBtns = [];

  let submitBtn;

  const updateStars = val => {
    selectedRating = val;
    starBtns.forEach((btn, i) => {
      btn.classList.toggle('active', i < val);
    });
    if (submitBtn) submitBtn.disabled = selectedRating === 0;
  };

  for (let i = 1; i <= 5; i++) {
    const btn = h('button', {
      type: 'button',
      class: 'star-btn',
      'aria-label': tr('reviewStars', i),
      onpointerdown: e => { e.preventDefault(); updateStars(i); },
    }, '★');
    starBtns.push(btn);
    starsContainer.appendChild(btn);
  }

  const commentInput = h('textarea', {
    class: 'modal-comment',
    maxlength: '500',
    placeholder: tr('reviewCommentPlaceholder'),
  });

  submitBtn = h('button', {
    type: 'button',
    class: 'btn',
    disabled: true,
    text: tr('reviewSubmit'),
    onclick: () => {
      if (selectedRating > 0) submitReview(selectedRating, commentInput.value);
    },
  });

  const laterBtn = h('button', {
    type: 'button',
    class: 'btn ghost',
    text: tr('reviewLater'),
    onclick: dismissReview,
  });

  const closeBtn = h('button', {
    type: 'button',
    class: 'modal-close',
    'aria-label': 'Close',
    text: '×',
    onclick: dismissReview,
  });

  const card = h('div', { class: 'modal-card' },
    closeBtn,
    h('div', { class: 'modal-header' },
      h('h3', { text: tr('reviewTitle') }),
      h('p', { text: tr('reviewSub') })
    ),
    starsContainer,
    commentInput,
    h('div', { class: 'modal-actions' }, laterBtn, submitBtn)
  );

  const overlay = h('div', { class: 'modal-overlay', id: 'review-modal' }, card);
  document.body.appendChild(overlay);
}

function resultScreen(v) {
  const rank = v.rank ? h('p', { class: 'sub num', text: tr('rank', v.rank, v.total) }) : null;
  const r = v.result;
  if (!r || r.kind === 'missed') return screen('reading', h('p', { class: 'big', text: tr('missed') }), rank);
  if (r.kind === 'correct') return screen('yes', h('p', { class: 'big num', text: tr('correct', r.gain) }), rank);
  if (r.kind === 'wrong') return screen('no', h('p', { class: 'big', text: tr('wrong') }), rank);
  return screen(CLS.pick[v.myChoice] || 'wait', h('p', { class: 'big num', text: tr('withPercent', r.percent) }), rank);
}

function joinForm() {
  // simpan isian saat layar dibangun ulang (mis. bahasa ruang baru diketahui)
  const prevName = document.getElementById('name')?.value || '';
  const prevCode = document.getElementById('code')?.value || code || '';
  const codeInput = !pathCode && h('input', {
    class: 'field code', id: 'code', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters',
    inputmode: 'text', placeholder: 'ABCD', value: prevCode,
  });
  const nameInput = h('input', { class: 'field', id: 'name', maxlength: '16', autocomplete: 'nickname', placeholder: tr('nickname'), value: prevName });
  const form = h('form', { class: 'join' },
    h('h1', { text: 'Riuh' }),
    codeInput && h('label', null, t(lang(), 'roomCode'), codeInput),
    h('label', null, tr('yourName'), nameInput),
    h('p', { class: 'error', text: joinError ? tr(joinError) : '' }),
    h('button', { class: 'btn', type: 'submit' }, tr('enter')),
  );
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (codeInput) code = codeInput.value.trim().toUpperCase();
    if (!code || code.length !== 4) { joinError = 'noRoom'; return render(); }
    if (!nameInput.value.trim()) { joinError = 'nameEmpty'; return render(); }
    join(nameInput.value);
  });
  screen('wait', form);
  (codeInput && !prevCode ? codeInput : nameInput).focus();
}
