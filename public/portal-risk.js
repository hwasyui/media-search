/* Tab "Risiko AI" + form tambah perusahaan klien. Memakai helper global portal.html: $, esc, nf, api, CS, safeUrl, ago, toast, S, loadPortfolio. */
'use strict';

const RATING_UI = {
  rendah: ['Rendah', '#2fbf71'], tidak_cukup_data: ['Data belum cukup', '#8a93a0'], sedang: ['Sedang', '#fbbf24'], tinggi: ['Tinggi', '#f08a4b'], sangat_tinggi: ['Sangat tinggi', '#ef5b5b'],
};
// Arti tingkat keparahan tag risiko (aturan di src/risk.js). Tingkat = bobot kata pemicu, BUKAN penilaian akhir atas berita.
const LEVEL_TIP = {
  1: 'Tingkat 1 dari 5: sinyal lemah.',
  2: 'Tingkat 2 dari 5: perlu diperhatikan (mis. pergantian pengurus/pemegang saham, kontroversi).',
  3: 'Tingkat 3 dari 5: signifikan (mis. gugatan, rugi, denda, PHK, penghentian sementara).',
  4: 'Tingkat 4 dari 5: berat (mis. tersangka, sanksi/pemblokiran/pencabutan izin, restrukturisasi utang, penghentian operasi).',
  5: 'Tingkat 5 dari 5: sangat berat (mis. pailit/PKPU, gagal bayar, korupsi, penipuan/pencucian uang).',
};
const barColor = (s) => (s >= 70 ? '#ef5b5b' : s >= 45 ? '#f08a4b' : s >= 20 ? '#fbbf24' : '#2fbf71');

async function tabRisiko() {
  const c = CS.data.company;
  $('#cbody').innerHTML = '<div class="muted" style="padding:24px 0">Menghitung profil risiko…</div>';
  let p;
  try { p = await api('/api/company/' + encodeURIComponent(c.id) + '/risk'); }
  catch (e) { $('#cbody').innerHTML = '<div class="empty"><b>Gagal memuat profil risiko</b>' + esc(e.message) + '</div>'; return; }
  if (CS.tab !== 'risiko' || CS.data.company.id !== c.id) return;
  const [label, color] = RATING_UI[p.rating] || RATING_UI.rendah;
  const noData = p.rating === 'tidak_cukup_data';
  const cats = Object.entries(p.categories).sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count);
  const detected = cats.filter(([, v]) => v.count > 0).length;
  const byCat = {};
  p.factors.forEach((f) => { (byCat[f.category] ||= []).push(f); });
  const catLabel = (k) => (p.categories[k] ? p.categories[k].label : k);

  const meta = (f) => [
    f.severity ? '<span class="tag ' + (f.severity >= 4 ? 't-red' : f.severity >= 3 ? 't-amber' : 't-gray') + '" title="' + esc((LEVEL_TIP[f.severity] || '') + ' Dinilai AI dari isi artikel; tetap verifikasi ke sumbernya.') + '">tingkat ' + f.severity + '/5</span>' + (f.hit ? '<span class="sm dim" style="flex-basis:100%">“' + esc(f.hit) + '”</span>' : '') : '',
    f.rumor ? '<span class="tag t-amber" title="Dinilai AI sebagai rumor/belum terverifikasi">rumor</span>' : '',
    f.tier === 'official' ? '<span class="tag t-green">sumber resmi</span>' : '',
    f.unverified ? '<span class="tag t-amber" title="Kategori ini baru didukung sumber non-kredibel (medsos/forum/agregator/situs perusahaan) sehingga kontribusinya ke skor dibatasi sampai ada media atau sumber resmi yang memuatnya.">belum ada sumber kredibel</span>' : '',
    f.finance ? '' : (f.direct ? '' : '<span class="tag t-violet" title="Judul tidak menyebut nama perusahaan; bisa menyangkut pihak lain atau hubungan tidak langsung. Periksa sebelum dipakai.">periksa keterkaitan</span>'),
  ].join('');
  const factorHtml = (f) => {
    if (f.finance) return '<div class="rf"><div class="row" style="gap:6px"><span class="tag t-gray">Data keuangan</span></div><div><b>' + esc(f.text) + '</b></div></div>';
    return '<div class="rf" data-nid="' + f.id + '"><div class="row" style="gap:6px;flex-wrap:wrap">' + meta(f) + '</div><div><a href="' + esc(safeUrl(f.url)) + '" data-nid="' + f.id + '" target="_blank" rel="noopener"><b>' + esc(f.title) + '</b></a>'
      + '<div class="sm dim">' + esc(f.source || '') + ' · ' + esc(ago(f.date)) + '</div></div></div>';
  };
  const keyFindings = p.factors.slice(0, 4);

  $('#cbody').innerHTML = `
    <div class="rk-hero">
      <div class="rk-rating" style="--c:${color}">
        <div class="sm muted" style="letter-spacing:.06em">RATING RISIKO · HASIL PENILAIAN AI ATAS BERITA · INDIKATIF</div>
        <div class="rv" style="color:${color}">${esc(label)}</div>
        ${noData ? '<div class="sm muted">Belum ada berita atau data keuangan tersimpan. Ini bukan berarti aman.</div>' : `
        <div class="meter" title="Skor ${p.score} dari 100. Batas: <20 rendah, <45 sedang, <70 tinggi, selebihnya sangat tinggi">
          <span style="width:20%;background:#2fbf71"></span><span style="width:25%;background:#fbbf24"></span><span style="width:25%;background:#f08a4b"></span><span style="width:30%;background:#ef5b5b"></span>
          <i style="left:calc(${Math.min(99, p.score)}% - 2px)"></i></div>
        <div class="row" style="justify-content:space-between"><span class="sm muted">skor <b style="color:var(--text)">${p.score}</b> / 100</span><span class="sm dim">rendah ◂ ▸ sangat tinggi</span></div>`}
      </div>
      <div class="rk-kpis">
        <div><small>Berita terkait (90 hari)</small><b>${p.coverage.newsItems}</b></div>
        <div><small>Bertag risiko</small><b>${p.coverage.tagged}</b></div>
        <div><small>Kategori terdeteksi</small><b>${detected}<span class="dim" style="font-size:14px"> / ${cats.length}</span></b></div>
        <div><small>Data keuangan</small><b>${p.coverage.hasFinancial ? 'Ada' : '<span class="dim">Tidak ada</span>'}</b></div>
      </div>
      <div class="rk-actions">
        <button class="btn wht" id="rkRefresh">⟳ Perbarui berita</button>
        <button class="btn" id="rkPrint">⎙ Cetak laporan</button>
      </div>
    </div>
    <div class="caveats">${p.caveats.map((t) => '<div>⚠ ' + esc(t) + '</div>').join('')}</div>
    <details class="card tbl" style="margin-top:10px"><summary>Bagaimana rating ini dibuat dan seberapa bisa dipercaya?</summary><div style="padding:0 16px 14px;color:var(--muted);line-height:1.7">
      <div>1. <b>AI membaca isi tiap berita</b> dan menilai: apakah perusahaan ini subjek beritanya, dampaknya, dan temuan risiko (kategori, tingkat 1–5, beserta <b>kutipan bukti</b> dari artikel). Temuan yang kutipannya tidak ditemukan di teks artikel dibuang otomatis.</div>
      <div>2. <b>Skor dan rating dihitung dengan rumus tetap</b> dari temuan itu (tingkat × kredibilitas sumber × kebaruan × peran perusahaan). Rumusnya bisa dilihat dan hasilnya sama setiap kali dihitung.</div>
      <div>3. Berita yang <b>belum dinilai AI tidak dihitung</b> (dilaporkan di catatan di atas), jadi rating tidak ditebak dari kata kunci.</div>
      <div style="margin-top:6px"><b>Batasannya:</b> penilaian AI belum diaudit manusia dan bisa keliru, jadi rating ini indikator awal untuk menentukan apa yang perlu diverifikasi, bukan dasar keputusan kredit. Klik tiap temuan untuk membaca beritanya.</div>
      <div style="margin-top:6px">Arti tingkat:</div>${Object.values(LEVEL_TIP).map((t) => '<div>• ' + esc(t) + '</div>').join('')}</div></details>

    ${keyFindings.length ? `<h4>Temuan utama <span class="muted sm">· bukti dengan bobot terbesar</span></h4>
    <div class="kf-grid">${keyFindings.map((f) => `<div class="kf" ${f.id ? 'data-nid="' + f.id + '"' : ''}>
      <div class="row" style="gap:6px;flex-wrap:wrap"><span class="tag t-cyan">${esc(catLabel(f.category))}</span>${meta(f)}</div>
      ${f.finance ? '<div><b>' + esc(f.text) + '</b></div>' : '<div><a href="' + esc(safeUrl(f.url)) + '" data-nid="' + f.id + '" target="_blank" rel="noopener"><b>' + esc(f.title) + '</b></a><div class="sm dim" style="margin-top:3px">' + esc(f.source || '') + ' · ' + esc(ago(f.date)) + '</div></div>'}
    </div>`).join('')}</div>` : ''}

    <h4>Skor per kategori <span class="muted sm">· klik kategori untuk melompat ke buktinya</span></h4>
    <div class="catbars">${cats.map(([k, v]) => `
      <button type="button" class="cb ${v.count ? '' : 'zero'}" data-cat="${k}" ${v.count ? '' : 'disabled'} title="${v.count ? 'Lihat ' + v.count + ' temuan' : 'Tidak ada temuan untuk kategori ini'}">
        <div class="row" style="justify-content:space-between;gap:8px"><b>${esc(v.label)}</b><span class="sm" style="color:${barColor(v.score)};font-weight:800">${v.score}</span></div>
        <div class="track"><i style="width:${Math.max(v.count ? 3 : 0, v.score)}%;background:${barColor(v.score)}"></i></div>
        <div class="sm muted">${v.count ? v.count + ' temuan · tingkat tertinggi ' + v.topSeverity + '/5' : 'tidak ada temuan'}</div>
      </button>`).join('')}</div>

    <h4>Bukti per kategori</h4>
    ${cats.filter(([k]) => byCat[k]).map(([k, v]) => `
      <details class="card tbl" id="risk-${k}" ${v.score >= 20 ? 'open' : ''}><summary>${esc(v.label)} <span class="muted sm">· skor ${v.score} · ${byCat[k].length} bukti</span></summary>
        <div class="rflist">${byCat[k].map(factorHtml).join('')}</div></details>`).join('') || '<div class="card muted">Tidak ada temuan risiko pada data yang tersimpan.</div>'}

    <h4>Checklist verifikasi FAP <span class="muted sm">· langkah lanjutan berdasarkan temuan</span></h4>
    ${p.checklist.length ? '<div class="ck-grid">' + p.checklist.map((g) => `<div class="card"><b>${esc(g.label)}</b>
      ${g.steps.map((s) => '<label class="ck"><input type="checkbox"> <span>' + esc(s) + '</span></label>').join('')}</div>`).join('') + '</div>'
      : '<div class="card muted">Tidak ada temuan yang memerlukan verifikasi tambahan dari data ini. Tetap lengkapi dokumen FAP standar.</div>'}

    <details class="card tbl" style="margin-top:14px"><summary>Cara perhitungan rating</summary><div style="padding:0 16px 14px;color:var(--muted)">${esc(p.method)}</div></details>`;

  // Klik kategori: buka bagian buktinya dan gulir ke sana (tanpa mengubah alamat halaman)
  document.querySelectorAll('.cb[data-cat]').forEach((b) => (b.onclick = () => {
    const d = document.getElementById('risk-' + b.dataset.cat);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1400);
  }));
  $('#rkRefresh').onclick = () => refreshCompany(c.id, $('#rkRefresh'));
  $('#rkPrint').onclick = () => { document.querySelectorAll('details.tbl').forEach((d) => (d.open = true)); window.print(); };
}

/* ---------- tambah perusahaan klien (tertutup/terbuka) beserta pengurus & pemegang saham ---------- */
function openAddCompany() {
  $('#acModal').hidden = false;
  $('#acName').focus();
}
function closeAddCompany() { $('#acModal').hidden = true; }

// Ubah alias & query tambahan perusahaan yang sedang dibuka (tab Profil)
function openEditSearch() {
  const c = CS.data?.company; if (!c) return;
  $('#qeFor').textContent = c.name;
  $('#qeAlias').value = (c.aliases || []).join(', ');
  $('#qeExtra').value = (c.extraQueries || []).join('\n');
  $('#qeModal').hidden = false;
  $('#qeAlias').focus();
}
async function submitEditSearch(ev) {
  ev.preventDefault();
  const c = CS.data?.company; if (!c) return;
  const btn = $('#qeSubmit'); btn.disabled = true;
  try {
    await api('/api/companies/' + encodeURIComponent(c.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: $('#qeAlias').value.split(',').map((s) => s.trim()).filter(Boolean), extraQueries: $('#qeExtra').value.split('\n').map((l) => l.trim()).filter(Boolean) }),
    });
    $('#qeModal').hidden = true;
    await loadPortfolio();
    await viewCompany(c.id);
    toast('Pencarian diperbarui. Berlaku untuk crawl berikutnya.');
  } catch (e) { toast('Gagal menyimpan: ' + e.message, 7000); }
  finally { btn.disabled = false; }
}
async function submitAddCompany(ev) {
  ev.preventDefault();
  const name = $('#acName').value.trim();
  if (!name) return;
  const stakeholders = $('#acStk').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [n, ...r] = l.split(/\s[-–|]\s|\s*\|\s*/);
    return { name: n.trim(), role: r.join(' - ').trim() || 'Pengurus/pemegang saham' };
  }).filter((s) => s.name);
  const aliases = $('#acAlias').value.split(',').map((s) => s.trim()).filter(Boolean);
  const ticker = $('#acTicker').value.trim().toUpperCase();
  const extraQueries = $('#acExtra').value.split('\n').map((l) => l.trim()).filter(Boolean);
  const btn = $('#acSubmit'); btn.disabled = true;
  try {
    const { company } = await api('/api/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: ticker ? 'public' : 'private', ticker: ticker || undefined, sector: $('#acSector').value.trim() || undefined, aliases: aliases.length ? [name.replace(/^PT\s+/i, ''), ...aliases] : undefined, extraQueries, stakeholders }),
    });
    closeAddCompany();
    $('#acForm').reset();
    await loadPortfolio();
    toast('Perusahaan ditambahkan. Jalankan "Perbarui berita" untuk mulai discovery.');
    location.hash = '#/c/' + company.id;
  } catch (e) { toast('Gagal menambah: ' + e.message, 7000); }
  finally { btn.disabled = false; }
}

/* ---------- gambar artikel lazy: diminta hanya untuk berita yang sedang tampil, lalu disisipkan ---------- */
const lazyAsked = new Set();
let lazyTimer;
function scheduleLazy() { clearTimeout(lazyTimer); lazyTimer = setTimeout(runLazyImages, 350); }
function insertLazyImage(node, id) {
  const src = '/img/' + id;                                          // gambar disajikan dari cache lokal server
  const img = '<img class="cover" src="' + src + '" alt="" loading="lazy" referrerpolicy="no-referrer"';
  if (node.classList.contains('side-row')) {
    node.insertAdjacentHTML('afterbegin', '<img class="sth" src="' + src + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">');
  } else {
    // kartu selalu punya .thumb berisi placeholder logo penerbit; gambar ditumpuk di atasnya (bila gagal dimuat, placeholder tetap terlihat)
    const t = node.querySelector('.thumb');
    if (t) t.insertAdjacentHTML('beforeend', img + ' onerror="this.remove()">');
    else node.insertAdjacentHTML('afterbegin', '<div class="thumb' + (node.classList.contains('lead-main') ? ' big' : '') + '">' + img + ' onerror="this.remove()"></div>');
  }
}
async function runLazyImages() {
  const pending = [...document.querySelectorAll('[data-lazyimg]')];
  const fresh = [...new Set(pending.map((n) => n.dataset.lazyimg))].filter((id) => !lazyAsked.has(id)).slice(0, 12);
  if (!fresh.length) { pending.forEach((n) => n.removeAttribute('data-lazyimg')); return; }
  fresh.forEach((id) => lazyAsked.add(id));
  try {
    const r = await api('/api/news/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: fresh.map(Number) }) });
    for (const id of fresh) {
      for (const n of document.querySelectorAll('[data-lazyimg="' + id + '"]')) {
        n.removeAttribute('data-lazyimg');
        if (r.images?.[id]) insertLazyImage(n, id);
      }
    }
  } catch { /* tanpa gambar: kartu tetap normal */ }
  if (document.querySelector('[data-lazyimg]')) scheduleLazy();
}
new MutationObserver(scheduleLazy).observe(document.getElementById('view'), { childList: true, subtree: true });
