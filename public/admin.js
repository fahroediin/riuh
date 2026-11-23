import { h, mount, store } from './common.js';

const app = document.getElementById('admin-app');
const KEY_STORAGE = 'riuh.admin.key';

function getAdminKey() {
  const urlParam = new URL(location.href).searchParams.get('key');
  if (urlParam) {
    store.set(KEY_STORAGE, urlParam);
    return urlParam;
  }
  return store.get(KEY_STORAGE) || '';
}

async function fetchMetrics(key) {
  const res = await fetch(`/api/admin/metrics?key=${encodeURIComponent(key)}`);
  if (res.status === 403) return { error: 'disabled' };
  if (!res.ok) return null;
  const body = await res.json();
  return body.ok ? body.metrics : null;
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderAuthForm(errorMsg = '') {
  const input = h('input', {
    type: 'password',
    class: 'field',
    placeholder: 'Masukkan kunci akses admin...',
    autofocus: true,
  });

  const btn = h('button', {
    type: 'submit',
    class: 'btn',
    text: 'Buka Dashboard',
  });

  const form = h('form', {
    class: 'modal-card',
    onsubmit: async e => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      btn.disabled = true;
      const data = await fetchMetrics(val);
      btn.disabled = false;
      if (data && !data.error) {
        store.set(KEY_STORAGE, val);
        renderDashboard(data, val);
      } else if (data?.error === 'disabled') {
        renderAuthForm('Akses admin dinonaktifkan di server (ADMIN_KEY belum diset di .env)');
      } else {
        renderAuthForm('Kunci akses tidak valid');
      }
    },
  },
    h('div', { class: 'modal-header' },
      h('h3', { text: 'Akses Admin Riuh' }),
      h('p', { text: 'Masukkan ADMIN_KEY untuk memantau data review dan kuis' })
    ),
    input,
    errorMsg ? h('p', { class: 'error', text: errorMsg }) : null,
    btn,
    h('a', {
      href: '/',
      style: 'text-align: center; font-weight: 700; color: var(--muted); text-decoration: none; font-size: 0.9rem;',
      text: '← Kembali ke Beranda',
    })
  );

  const container = h('div', {
    style: 'min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;',
  }, form);

  mount(app, container);
}

function renderDashboard(metrics, currentKey) {
  const { reviews, heatmap, sessions } = metrics;
  const totalSessions = heatmap.reduce((acc, x) => acc + x.sessionCount, 0);
  const totalParticipants = heatmap.reduce((acc, x) => acc + x.totalParticipants, 0);

  // Top Bar
  const header = h('header', { class: 'admin-header' },
    h('div', null,
      h('h1', { text: 'Riuh Admin' }),
      h('p', { class: 'sub', text: 'Ringkasan performa kuis dan ulasan kepuasan audiens' })
    ),
    h('div', { style: 'display: flex; gap: 0.8rem; align-items: center;' },
      h('button', {
        type: 'button',
        class: 'btn ghost',
        text: 'Segarkan',
        onclick: async () => {
          const fresh = await fetchMetrics(currentKey);
          if (fresh) renderDashboard(fresh, currentKey);
        },
      }),
      h('button', {
        type: 'button',
        class: 'btn ghost',
        text: 'Keluar',
        onclick: () => {
          store.del(KEY_STORAGE);
          renderAuthForm();
        },
      }),
      h('a', {
        href: '/',
        class: 'btn',
        style: 'text-decoration: none;',
        text: 'Buka Riuh',
      })
    )
  );

  // Cards
  const cards = h('div', { class: 'admin-grid-cards' },
    h('div', { class: 'admin-card' },
      h('span', { class: 'label', text: 'Rata-rata Rating' }),
      h('span', { class: 'val', text: `${reviews.averageRating || 0} / 5` }),
      h('span', { class: 'sub', text: `Dari ${reviews.total} ulasan masuk` })
    ),
    h('div', { class: 'admin-card' },
      h('span', { class: 'label', text: 'Total Sesi Kuis' }),
      h('span', { class: 'val', text: String(totalSessions) }),
      h('span', { class: 'sub', text: 'Sesi kuis yang telah dimulai' })
    ),
    h('div', { class: 'admin-card' },
      h('span', { class: 'label', text: 'Total Peserta' }),
      h('span', { class: 'val', text: String(totalParticipants) }),
      h('span', { class: 'sub', text: 'Akumulasi peserta kuis' })
    ),
    h('div', { class: 'admin-card' },
      h('span', { class: 'label', text: 'Rata-rata Peserta / Sesi' }),
      h('span', { class: 'val', text: String(totalSessions > 0 ? Math.round(totalParticipants / totalSessions) : 0) }),
      h('span', { class: 'sub', text: 'Peserta aktif per ruang kuis' })
    )
  );

  // Section 1: Heatmap Kuis
  const maxSessions = Math.max(1, ...heatmap.map(h => h.sessionCount));
  const heatRows = heatmap.map(item => {
    let badgeClass = 'heat-low';
    if (item.sessionCount >= maxSessions * 0.7 && item.sessionCount >= 3) badgeClass = 'heat-high';
    else if (item.sessionCount >= maxSessions * 0.4 && item.sessionCount >= 2) badgeClass = 'heat-mid';

    const langText = Object.entries(item.langBreakdown)
      .map(([l, count]) => `${l.toUpperCase()}: ${count}`)
      .join(', ') || '-';

    return h('tr', null,
      h('td', { style: 'font-weight: 800;' }, item.setTitle),
      h('td', null,
        h('span', { class: `heat-badge ${badgeClass}`, text: `${item.sessionCount}x dipilih` })
      ),
      h('td', { class: 'num', text: String(item.totalParticipants) }),
      h('td', { class: 'num', text: String(item.avgParticipants) }),
      h('td', null, langText),
      h('td', { class: 'num', text: formatDate(item.lastPlayed) })
    );
  });

  const heatmapSection = h('section', { class: 'admin-section' },
    h('h2', { text: 'Heatmap & Popularitas Set Kuis' }),
    h('div', { class: 'admin-table-wrap' },
      h('table', { class: 'admin-table' },
        h('thead', null,
          h('tr', null,
            h('th', { text: 'Judul Set Kuis' }),
            h('th', { text: 'Frekuensi Dipilih' }),
            h('th', { text: 'Total Peserta' }),
            h('th', { text: 'Rata-rata Peserta' }),
            h('th', { text: 'Bahasa' }),
            h('th', { text: 'Terakhir Dimainkan' })
          )
        ),
        h('tbody', null, heatRows.length ? heatRows : h('tr', null, h('td', { colspan: 6, text: 'Belum ada data sesi kuis yang terekam.' })))
      )
    )
  );

  // Section 2: Review & Feedback Audiens
  const distTotal = Math.max(1, reviews.total);
  const distBars = [5, 4, 3, 2, 1].map(stars => {
    const count = reviews.distribution[stars] || 0;
    const pct = Math.round((count / distTotal) * 100);
    const fill = h('div', { class: 'rating-bar-fill' });
    fill.style.width = `${pct}%`;

    return h('div', { class: 'rating-bar-row' },
      h('span', { style: 'width: 3.5rem;', text: `${stars} Bintang` }),
      h('div', { class: 'rating-bar-bg' }, fill),
      h('span', { class: 'num', style: 'width: 3.5rem; text-align: right;', text: `${count} (${pct}%)` })
    );
  });

  const reviewItems = reviews.recent.map(r => {
    const starsStr = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    return h('div', { class: 'review-item' },
      h('div', { class: 'review-top' },
        h('span', { class: 'review-stars', text: starsStr }),
        h('span', null, formatDate(r.createdAt))
      ),
      r.comment ? h('p', { class: 'review-text', text: `"${r.comment}"` }) : h('p', { class: 'review-meta', text: '(Tanpa pesan teks)' }),
      h('div', { class: 'review-meta' },
        r.setTitle ? `Kuis: ${r.setTitle} • ` : '',
        r.roomCode ? `Ruang: ${r.roomCode} • ` : '',
        `Bahasa: ${r.lang.toUpperCase()}`
      )
    );
  });

  const reviewsSection = h('section', { class: 'admin-section' },
    h('h2', { text: 'Ulasan & Feedback Audiens' }),
    h('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1.5rem;' },
      h('div', { class: 'admin-card' },
        h('h3', { style: 'font-size: 1.15rem; font-weight: 800; margin-bottom: 0.8rem;', text: 'Distribusi Bintang' }),
        distBars
      ),
      h('div', { style: 'display: flex; flex-direction: column; gap: 0.8rem; max-height: 28rem; overflow-y: auto;' },
        reviewItems.length ? reviewItems : h('p', { class: 'sub', text: 'Belum ada ulasan audiens yang masuk.' })
      )
    )
  );

  // Section 3: Riwayat Sesi Terbaru
  const sessionRows = sessions.map(s => h('tr', null,
    h('td', { class: 'num', text: formatDate(s.createdAt) }),
    h('td', { style: 'font-weight: 800;', text: s.roomCode }),
    h('td', null, s.setTitle),
    h('td', { class: 'num', text: `${s.participants} peserta` }),
    h('td', null, s.lang.toUpperCase())
  ));

  const sessionsSection = h('section', { class: 'admin-section' },
    h('h2', { text: 'Riwayat Sesi Terakhir' }),
    h('div', { class: 'admin-table-wrap' },
      h('table', { class: 'admin-table' },
        h('thead', null,
          h('tr', null,
            h('th', { text: 'Waktu' }),
            h('th', { text: 'Kode Ruang' }),
            h('th', { text: 'Set Kuis' }),
            h('th', { text: 'Peserta' }),
            h('th', { text: 'Bahasa' })
          )
        ),
        h('tbody', null, sessionRows.length ? sessionRows : h('tr', null, h('td', { colspan: 5, text: 'Belum ada sesi kuis tercatat.' })))
      )
    )
  );

  const container = h('div', { class: 'admin-container' },
    header,
    cards,
    heatmapSection,
    reviewsSection,
    sessionsSection
  );

  mount(app, container);
}

// Initial check
async function init() {
  const key = getAdminKey();
  if (!key) return renderAuthForm();
  const data = await fetchMetrics(key);
  if (data?.error === 'disabled') {
    return renderAuthForm('Akses admin dinonaktifkan di server (ADMIN_KEY belum diset di .env)');
  }
  if (!data) return renderAuthForm('Kunci akses tidak valid atau telah kedaluwarsa');
  renderDashboard(data, key);
}

init();
