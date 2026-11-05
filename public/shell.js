// Sidebar bersama: dipasang otomatis di portal.html dan jobs.html (Task Runner).
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const here = path.endsWith('/portal.html') || path === '' || path === '/' ? 'portal' : (path.endsWith('/jobs.html') || path.endsWith('/jobs-advanced.html')) ? 'jobs' : path.endsWith('/index.html') ? 'analyzer' : path.endsWith('/help.html') ? 'help' : '';

  function mount() {
    const main = document.createElement('div');
    main.className = 'shell-main';
    [...document.body.childNodes].forEach((n) => main.appendChild(n));
    const side = document.createElement('aside');
    side.className = 'shell-side';
    side.innerHTML = `
      <a class="shell-logo" href="/portal.html#/"><i>M</i><span>Media Search</span></a>
      <div class="shell-h">Utama</div>
      <nav class="shell-nav">
        <a href="/portal.html#/" class="${here === 'portal' && !/#\/c\//.test(location.hash) ? 'on' : ''}" data-home>Beranda</a>
      </nav>
      <div class="shell-h">Portofolio</div>
      <div class="shell-search" id="shellSearchW" hidden><input id="shellSearch" type="search" placeholder="Cari perusahaan atau ticker…" autocomplete="off" aria-label="Cari perusahaan"></div>
      <nav class="shell-nav" id="shellCompanies"><div style="padding:4px 18px;color:var(--sh-dim);font-size:12px">Memuat…</div></nav>
      <div class="shell-h">Alat</div>
      <nav class="shell-nav">
        <a href="/jobs.html" class="${here === 'jobs' ? 'on' : ''}">Task Runner</a>
      </nav>
      <div class="shell-foot"><a class="shell-help ${here === 'help' ? 'on' : ''}" href="/help.html">HELP</a><div id="shellFoot">Prototype</div></div>`;
    document.body.classList.add('has-shell');
    // Bar atas khusus HP/tablet (tombol ☰) di dalam area konten, dan lapisan gelap untuk menutup menu
    const mbar = document.createElement('div');
    mbar.className = 'shell-mbar';
    mbar.innerHTML = '<button type="button" id="shellBurger" aria-label="Buka menu" aria-expanded="false">☰</button><a href="/portal.html#/"><i>M</i>Media Search</a>';
    main.prepend(mbar);
    const scrim = document.createElement('div');
    scrim.className = 'shell-scrim';
    document.body.append(side, main, scrim);     // urutan: sidebar (kolom 1), konten (kolom 2)
    const setMenu = (open) => { side.classList.toggle('open', open); scrim.classList.toggle('on', open); mbar.querySelector('button').setAttribute('aria-expanded', String(open)); };
    mbar.querySelector('button').onclick = () => setMenu(!side.classList.contains('open'));
    scrim.onclick = () => setMenu(false);
    side.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });        // pilih menu -> tertutup
    addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    addEventListener('hashchange', () => setMenu(false));
    if (!window.__msTip) { const sc = document.createElement('script'); sc.src = '/tooltip.js'; document.head.appendChild(sc); }      // tooltip bergaya di semua halaman
    window.shellRefresh = loadCompanies;
    loadCompanies();
    addEventListener('hashchange', loadCompanies);
  }

  // Kode singkat perusahaan tanpa ticker: inisial nama bila terdiri dari beberapa kata, selain itu 5 huruf pertama
  const codeOf = (c) => {
    const w = String(c.name || '').replace(/\b(pt|tbk|persero|cv)\b|[()]/gi, ' ').split(/\s+/).filter(Boolean);
    return (w.length >= 2 ? w.slice(0, 4).map((x) => x[0]).join('') : (w[0] || c.id).slice(0, 5)).toUpperCase();
  };

  // Daftar portofolio: awalnya hanya SHELL_FIRST perusahaan; "Tampilkan lainnya" menambah SHELL_STEP; kotak cari menyaring seluruh daftar (nama, ticker, id, alias).
  const SHELL_FIRST = 8, SHELL_STEP = 8;
  let allCompanies = [], shellQ = '', shellLimit = SHELL_FIRST;
  const LABEL = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', sangat_tinggi: 'Sangat tinggi' };
  const companyRow = (c, cur) => {
    const rk = c.risk;
    const st = !rk || rk.rating === 'tidak_cukup_data' ? '' : { rendah: 'ok', sedang: 'amber', tinggi: 'orange', sangat_tinggi: 'risk' }[rk.rating] || '';
    const cv = rk?.coverage || {};
    const basis = cv.assessed != null
      ? 'Dihitung dari ' + cv.assessed + ' berita yang sudah dinilai AI' + (cv.hasFinancial ? ' + data keuangan' : '') + (cv.unassessed ? '; ' + cv.unassessed + ' berita lain belum dinilai AI dan tidak dihitung.' : '.')
      : 'Perhitungan lama (' + (cv.newsItems ?? 0) + ' berita, belum memakai penilaian AI atas isi berita). Buka halaman perusahaan untuk menghitung ulang.';
    const tip = !rk ? 'Belum dinilai::Belum ada profil risiko. Jalankan crawl di Task Runner atau buka halaman perusahaan.'
      : rk.rating === 'tidak_cukup_data' ? 'Data belum cukup::Belum ada berita yang dinilai AI atau data keuangan untuk menilai risiko. Ini bukan berarti aman.'
      : 'Rating risiko pembiayaan: ' + LABEL[rk.rating] + ' (skor ' + rk.score + ' dari 100)::' + basis + ' Ini indikator awal, bukan keputusan kredit. Klik perusahaan untuk melihat buktinya. Cara hitung ada di HELP.';
    const on = here === 'portal' && cur === c.id ? 'on' : '';
    return `<a href="/portal.html#/c/${esc(c.id)}" class="${on}" title="${esc(c.name)}"><span class="tk">${esc(c.ticker || codeOf(c))}</span><span class="nm">${esc(c.name.replace(/^PT\s+/i, ''))}</span><span class="st ${st}" title="${esc(tip)}"></span></a>`;
  };

  function renderCompanies() {
    const nav = document.getElementById('shellCompanies');
    if (!nav) return;
    const cur = (/^#\/c\/([^/]+)/.exec(location.hash) || [])[1];
    const q = shellQ.trim().toLowerCase();
    const hit = (c) => [c.name, c.ticker, c.id, ...(Array.isArray(c.aliases) ? c.aliases : [])].some((x) => String(x || '').toLowerCase().includes(q));
    const rows = q ? allCompanies.filter(hit) : allCompanies;
    let shown = q ? rows : rows.slice(0, shellLimit);
    // perusahaan yang sedang dibuka selalu terlihat, walau di luar batas tampilan
    if (!q && cur && !shown.some((c) => c.id === cur)) { const a = rows.find((c) => c.id === cur); if (a) shown = [...shown, a]; }
    const left = rows.length - shown.length;
    nav.innerHTML = shown.map((c) => companyRow(c, cur)).join('')
      || '<div style="padding:4px 18px;color:var(--sh-dim);font-size:12px">' + (q ? 'Tidak ada perusahaan yang cocok.' : 'Belum ada perusahaan.') + '</div>';
    if (!q && left > 0) nav.insertAdjacentHTML('beforeend', '<button type="button" class="shell-more" data-more="1">Tampilkan ' + Math.min(SHELL_STEP, left) + ' lainnya <span>(sisa ' + left + ')</span></button>');
    else if (!q && shellLimit > SHELL_FIRST && rows.length > SHELL_FIRST) nav.insertAdjacentHTML('beforeend', '<button type="button" class="shell-more" data-more="0">Ringkas daftar</button>');
    const w = document.getElementById('shellSearchW');
    if (w) w.hidden = allCompanies.length <= 6;       // kotak cari baru berguna bila daftarnya cukup panjang
  }

  async function loadCompanies() {
    try {
      allCompanies = await (await fetch('/api/portfolio')).json();
      renderCompanies();
      const cur = (/^#\/c\/([^/]+)/.exec(location.hash) || [])[1];
      document.getElementById('shellFoot').innerHTML = 'Prototype';
      document.querySelector('[data-home]')?.classList.toggle('on', here === 'portal' && !cur);
      window.shellPortfolio = allCompanies;
    } catch { /* sidebar tetap tampil tanpa daftar */ }
  }

  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'shellSearch') { shellQ = e.target.value; renderCompanies(); } });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.shell-more');
    if (!b) return;
    shellLimit = b.dataset.more === '1' ? shellLimit + SHELL_STEP : SHELL_FIRST;
    renderCompanies();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
