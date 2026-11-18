import { h, mount, session, SYM, CLS } from './common.js';

const app = document.getElementById('app');
const barInfo = document.getElementById('bar-info');
const socket = io();
const TOKEN_KEY = 'riuh.hostToken';

let view = null;
let sets = [];
let deadline = null; // performance.now() saat hitung mundur habis
let startError = '';

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
  deadline = v.remainingMs == null ? null : performance.now() + v.remainingMs;
  render();
});
socket.on('room:closed', () => {
  session.del(TOKEN_KEY);
  view = null;
  startError = 'Ruang sudah ditutup karena terlalu lama. Buat ruang baru.';
  render();
});

async function createRoom() {
  startError = '';
  const res = await call('host:create');
  if (!res.ok) {
    startError = 'Server sedang penuh, coba beberapa menit lagi';
    return render();
  }
  session.set(TOKEN_KEY, res.hostToken);
}

const advance = () => call('host:advance');

document.getElementById('fs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener('keydown', e => {
  if (!view || (e.target instanceof Element && e.target.closest('select, input, button'))) return;
  if (e.key === ' ' || e.key === 'ArrowRight') {
    if (['result', 'board'].includes(view.phase)) { e.preventDefault(); advance(); }
  }
});

// hitung mundur lokal, disinkronkan ulang tiap view datang
function tickTimer() {
  const el = document.getElementById('timer');
  if (el && deadline != null) el.textContent = String(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
  requestAnimationFrame(tickTimer);
}
requestAnimationFrame(tickTimer);

function render() {
  if (!view) {
    barInfo.textContent = '';
    return mount(app, startScreen());
  }
  barInfo.textContent = `Ruang ${view.code}` + (view.setTitle ? `  |  ${view.setTitle}` : '');
  const screens = { lobby, reading: question, answering: question, result: question, board, end };
  mount(app, screens[view.phase]());
}

function startScreen() {
  return h('section', { class: 'start' },
    h('h1', { text: 'Riuh' }),
    h('p', { text: 'Kuis pembuka rapat. Peserta ikut lewat HP atau laptop, soal tampil di layar ini.' }),
    h('button', { class: 'btn', type: 'button', onclick: createRoom }, 'Buat ruang'),
    h('p', { class: 'error', text: startError }),
  );
}

function lobby() {
  const select = h('select', { class: 'field', id: 'set' },
    sets.map(s => h('option', { value: s.id, selected: s.id === view.setId }, `${s.title} (${s.count} soal)`)));
  select.addEventListener('change', () => call('host:selectSet', { setId: select.value }));
  const canStart = view.players.length > 0 && view.setId;
  return h('section', { class: 'lobby' },
    h('div', { class: 'join-card' },
      h('img', { src: `/qr/${view.code}.svg`, alt: `QR untuk bergabung ke ruang ${view.code}` }),
      h('div', null, h('div', { class: 'label', text: 'Buka di HP' }), h('div', { class: 'join-link', text: view.joinUrl })),
      h('div', null, h('div', { class: 'label', text: 'Kode ruang' }), h('div', { class: 'join-code', text: view.code })),
    ),
    h('div', { class: 'roster' },
      h('h2', { class: 'num' }, `${view.players.length} peserta`),
      view.players.length
        ? h('div', { class: 'chips' }, view.players.map(p =>
            h('button', {
              class: 'chip' + (p.connected ? '' : ' off'), type: 'button', title: 'Klik untuk mengeluarkan',
              onclick: () => { if (confirm(`Keluarkan ${p.name}?`)) call('host:kick', { playerId: p.id }); },
            }, p.name)))
        : h('p', { class: 'empty', text: 'Menunggu peserta bergabung...' }),
      h('div', { class: 'lobby-controls' },
        h('label', null, h('span', { class: 'label', text: 'Set soal' }), select),
        h('button', { class: 'btn', type: 'button', disabled: !canStart, onclick: () => call('host:start') }, 'Mulai'),
      ),
    ),
  );
}

function question() {
  const q = view.question;
  const reading = view.phase === 'reading';
  const result = view.phase === 'result';
  const kind = q.type === 'tf' ? 'Benar atau Salah' : 'Pilih Satu';
  const split = view.split;
  const total = split ? split.a + split.b : 0;

  const option = side => {
    const cls = ['opt', CLS[q.type][side]];
    if (reading) cls.push('dim');
    if (result && q.type === 'tf') cls.push(view.correct === side ? 'win' : 'dim');
    const count = result ? split[side] : null;
    const names = result && q.type === 'pick'
      ? [...split[side + 'Names'], ...(split[side + 'More'] ? [`+${split[side + 'More']} lainnya`] : [])].join(', ')
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
  if (reading) status = 'Baca soal...';
  else if (view.phase === 'answering') status = `${view.answeredCount} dari ${view.activeCount} sudah menjawab`;
  else if (q.type === 'pick') status = total ? `${total} orang memilih` : 'Tidak ada yang menjawab';
  else status = `Jawaban: ${q[view.correct]}`;

  return [
    h('div', { class: 'q-head' },
      h('span', { class: 'num' }, `Soal ${view.qNumber}/${view.qTotal}`),
      h('span', { text: kind }),
      h('span', { class: 'spacer' }),
      !result && h('span', { class: 'timer num' + (reading ? ' reading' : ''), id: 'timer' }),
    ),
    h('p', { class: 'q-text', text: q.text }),
    h('p', { class: 'q-status num', text: status }),
    h('div', { class: 'options' }, option('a'), option('b')),
    h('div', { class: 'footer-actions' },
      view.phase === 'answering' && h('button', { class: 'btn ghost', type: 'button', onclick: advance }, 'Akhiri soal sekarang'),
      result && h('span', { class: 'hint', text: 'Spasi' }),
      result && h('button', { class: 'btn', type: 'button', onclick: advance }, 'Lanjut'),
    ),
  ];
}

function board() {
  return [
    h('section', { class: 'board' },
      h('h2', { text: '5 Besar' }),
      h('ol', { class: 'rank-list' }, view.top.map((p, i) =>
        h('li', null, h('span', { class: 'pos num', text: String(i + 1) }), h('span', { text: p.name }), h('span', { class: 'num', text: String(p.score) })))),
    ),
    h('div', { class: 'footer-actions' },
      h('span', { class: 'hint', text: 'Spasi' }),
      h('button', { class: 'btn', type: 'button', onclick: advance }, view.qNumber >= view.qTotal ? 'Lihat hasil akhir' : 'Soal berikutnya'),
    ),
  ];
}

function end() {
  const again = h('div', { class: 'footer-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => call('host:replay') }, 'Main lagi'));
  if (!view.scored) return [h('p', { class: 'thanks', text: 'Terima kasih sudah ikut' }), again];
  const r = view.ranking;
  const step = (p, place) => p && h('div', { class: `step p${place}` },
    h('span', { class: 'who', text: p.name }),
    h('span', { class: 'score num', text: `${p.score} poin` }),
    h('span', { class: 'block num', text: String(place) }));
  return [
    h('section', { class: 'end' },
      h('h2', { text: 'Hasil akhir' }),
      h('div', { class: 'podium' }, step(r[1], 2), step(r[0], 1), step(r[2], 3)),
      r.length > 3 && h('ol', { class: 'rest', start: '4' }, r.slice(3).map(p => h('li', { class: 'num', text: `${p.name} - ${p.score}` }))),
    ),
    again,
  ];
}

render();
