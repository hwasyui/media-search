// Sidebar bersama: dipasang otomatis di portal.html dan jobs.html (Task Runner).
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const here = path.endsWith('/portal.html') || path === '' || path === '/' ? 'portal' : (path.endsWith('/jobs.html') || path.endsWith('/jobs-advanced.html')) ? 'jobs' : path.endsWith('/index.html') ? 'analyzer' : '';

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
      <nav class="shell-nav" id="shellCompanies"><div style="padding:4px 18px;color:var(--sh-dim);font-size:12px">Memuat…</div></nav>
      <div class="shell-h">Alat</div>
      <nav class="shell-nav">
        <a href="/jobs.html" class="${here === 'jobs' ? 'on' : ''}">Task Runner</a>
      </nav>
      <div class="shell-foot" id="shellFoot"></div>`;
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
    window.shellRefresh = loadCompanies;
    loadCompanies();
    addEventListener('hashchange', loadCompanies);
  }

  async function loadCompanies() {
    try {
      const list = await (await fetch('/api/portfolio')).json();
      const cur = (/^#\/c\/([^/]+)/.exec(location.hash) || [])[1];
      document.getElementById('shellCompanies').innerHTML = list.map((c) => {
        const rk = c.risk;
        const st = !rk || rk.rating === 'tidak_cukup_data' ? '' : { rendah: 'ok', sedang: 'amber', tinggi: 'orange', sangat_tinggi: 'risk' }[rk.rating] || '';
        const LABEL = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', sangat_tinggi: 'Sangat tinggi' };
        const tip = !rk ? 'Abu-abu: belum dinilai. Belum ada profil risiko; jalankan crawl di Task Runner atau buka halaman perusahaan.'
          : rk.rating === 'tidak_cukup_data' ? 'Abu-abu: data belum cukup. Belum ada berita atau data keuangan yang tersimpan untuk menilai risiko, bukan berarti aman. Jalankan crawl di Task Runner.'
          : 'Rating risiko ' + LABEL[rk.rating] + ' (skor ' + rk.score + '/100) dari ' + (rk.coverage?.newsItems ?? 0) + ' berita terkait' + (rk.coverage?.hasFinancial ? ' + data keuangan' : '')
            + '. Indikator awal dari informasi publik, bukan keputusan kredit. Klik untuk melihat bukti.';
        const on = here === 'portal' && cur === c.id ? 'on' : '';
        return `<a href="/portal.html#/c/${esc(c.id)}" class="${on}" title="${esc(c.name)}"><span class="tk">${esc(c.ticker || c.id.slice(0, 5).toUpperCase())}</span><span class="nm">${esc(c.name.replace(/^PT\s+/i, ''))}</span><span class="st ${st}" title="${esc(tip)}"></span></a>`;
      }).join('') || '<div style="padding:4px 18px;color:var(--sh-dim);font-size:12px">Belum ada perusahaan.</div>';
      document.getElementById('shellFoot').innerHTML = `${list.length} perusahaan dipantau<div style="margin-top:6px;cursor:help" title="Warna titik di samping nama perusahaan = rating risiko pembiayaan: abu-abu data belum cukup, hijau rendah, kuning sedang, oranye tinggi, merah sangat tinggi. Arahkan kursor ke titik untuk penjelasan.">● warna = rating risiko (hover)</div>`;
      document.querySelector('[data-home]')?.classList.toggle('on', here === 'portal' && !cur);
      window.shellPortfolio = list;
    } catch { /* sidebar tetap tampil tanpa daftar */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
