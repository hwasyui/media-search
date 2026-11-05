/* Tur fitur dipandu robot AI. Di kunjungan pertama muncul kartu sambutan Ya / Tidak. Bila Ya: robot menjelaskan fitur satu per satu (teks + suara),
   menyorot bagian yang dibahas, dan SELURUH halaman dikunci selama tur (klik dan keyboard) supaya pengguna tidak berpindah ke fitur lain.
   Tur sendiri yang menggerakkan halaman: membuka satu perusahaan, berpindah tab, dan membuka satu berita agar isinya bisa dijelaskan.
   Kontrol: Kembali, Lanjut, Lewati (loncati langkah ini), Hentikan (akhiri tur). Penjelasan sudah tertulis (tanpa memanggil AI, tanpa token).
   Pilihan tersimpan di localStorage 'ms.tour'. Bisa diulang lewat tombol "?" di jendela asisten. */
(() => {
  'use strict';
  const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ctx: 'home' = Beranda; 'company' = halaman perusahaan (tab: nama tab); 'modal' = modal detail berita di tab Berita.
  // Teks "A I" dieja untuk suara dan ditampilkan sebagai "AI".
  const STEPS = [
    { title: 'Selamat datang', say: 'Halo, saya asisten A I Media Search. Saya akan memandu Anda melihat fitur-fitur utama, termasuk isi halaman perusahaan dan satu berita. Selama tur, bagian lain dikunci supaya Anda tidak tersesat. Anda bisa melewati langkah atau menghentikan tur kapan saja.' },

    // ---- Beranda ----
    { ctx: 'home', sel: '.shell-side', title: 'Daftar perusahaan', say: 'Ini daftar perusahaan debitur yang dipantau. Titik berwarna di kanan nama adalah rating risiko: hijau rendah, kuning sedang, oranye tinggi, merah sangat tinggi, dan abu-abu berarti data belum cukup. Klik nama perusahaan untuk membuka halamannya.' },
    { ctx: 'home', sel: '.top .search', title: 'Pencarian', say: 'Kotak ini untuk mencari perusahaan, kode saham, atau kata kunci berita.' },
    { ctx: 'home', sel: '#addCo', title: 'Tambah perusahaan', say: 'Tombol ini menambah perusahaan klien baru. Isi nama, alias, serta pengurus dan pemegang saham bila ada, karena nama-nama itu ikut dicari di berita.' },
    { ctx: 'home', sel: '#refreshAll', title: 'Perbarui semua', say: 'Tombol ini mengambil berita terbaru untuk semua perusahaan. Untuk pengaturan lengkap dan proses yang bisa dilanjutkan, gunakan Task Runner.' },
    { ctx: 'home', sel: '#exploreMount .ftool', wait: true, title: 'Cari dan filter berita', say: 'Di sini Anda mencari berita, memilih perusahaan dan rentang waktu, mengurutkan, dan menyaring berdasarkan dampak, kategori risiko, dan sumber. Hasilnya langsung berubah di bawahnya.' },
    { ctx: 'home', sel: '#exploreMount .news, #exploreMount .lead-main', wait: true, title: 'Kartu berita', say: 'Setiap kartu adalah satu berita, lengkap dengan ringkasan dan tag. Tag merah berarti A I menilai berita itu berisiko bagi debitur, hijau berarti katalis positif, dan abu-abu berarti belum dinilai. Sekarang saya buka satu perusahaan sebagai contoh.' },

    // ---- Halaman perusahaan ----
    { ctx: 'company', tab: 'ringkasan', sel: '#view .head', wait: true, title: 'Halaman perusahaan', say: () => 'Ini halaman ' + (companyName() || 'satu perusahaan') + '. Di atas ada nama, jenis perusahaan, tombol perbarui berita, dan untuk perusahaan terbuka juga harga saham beserta grafiknya. Perusahaan tertutup menampilkan kartu status profil sebagai gantinya.' },
    { ctx: 'company', tab: 'ringkasan', sel: '#view .tabs', wait: true, title: 'Enam tab', say: 'Isi perusahaan dibagi enam tab: Ringkasan, Risiko A I, Dossier Korporasi, Keuangan, Berita, dan Profil. Saya tunjukkan satu per satu.' },
    { ctx: 'company', tab: 'risiko', sel: '#cbody .rk-hero', wait: true, title: 'Risiko AI: rating', say: 'Ini rating risiko dari nol sampai seratus. A I membaca isi tiap berita dan menemukan risikonya, lalu rumus tetap menghitung skornya. Berita yang belum dinilai A I tidak dihitung, dan ini hanya indikator awal, bukan keputusan kredit.' },
    { ctx: 'company', tab: 'risiko', sel: '#cbody .kf-grid, #cbody .catbars', wait: true, title: 'Risiko AI: bukti', say: 'Di bawahnya ada temuan utama dan skor per kategori: hukum, keuangan, integritas, kepemilikan, operasional, regulasi, dan reputasi. Setiap temuan menyertakan berita dan kutipan buktinya, jadi Anda bisa memeriksanya sendiri.' },
    { ctx: 'company', tab: 'dossier', sel: '#cbody .dz-hero, #cbody .dz-start', wait: true, title: 'Dossier korporasi', say: 'Dossier merangkum empat hal dari berita: pemilik dan pengendali, klien dan proyek, akta dan perubahan korporasi, serta fasilitas bank. Tiap poin membawa kutipan dan nomor berita yang bisa diklik, dan statusnya jelas apakah masih dari berita atau sudah terverifikasi dokumen.' },
    { ctx: 'company', tab: 'keuangan', sel: '#cbody > :first-child', wait: true, title: 'Keuangan', say: 'Tab keuangan berisi harga, valuasi, laporan keuangan kuartalan dan tahunan, serta rasio utang dan arus kas. Datanya hanya ada untuk perusahaan terbuka.' },

    // ---- Berita: daftar dan modal detail ----
    { ctx: 'company', tab: 'berita', sel: '#cbody .ftool', wait: true, title: 'Berita perusahaan', say: 'Tab berita menampilkan semua berita perusahaan ini dengan filter yang sama seperti di Beranda. Sekarang saya buka satu berita untuk menjelaskan isinya.' },
    { ctx: 'modal', sel: '#nwModal .nw-head', wait: true, title: 'Detail berita', say: 'Ini detail satu berita. Di atas ada sumber, tanggal, dan perusahaannya, lalu judulnya. Tombol ungu Tanya A I membuka saya untuk membahas berita ini.' },
    { ctx: 'modal', sel: '#nwBody .nw-sum', wait: true, title: 'Ringkasan dan dampak', say: 'Kotak ini ringkasan isi berita buatan A I, beserta alasan dampaknya bagi debitur: risiko, katalis positif, atau netral. Kalau berita belum dibaca A I, kotaknya kuning bertuliskan belum dinilai, dan berita itu tidak dihitung dalam rating.' },
    { ctx: 'modal', sel: '#nwBody .nw-text', wait: true, title: 'Isi berita', say: 'Ini isi artikel lengkap yang sudah diambil dari situs penerbit, jadi Anda bisa membacanya tanpa pindah halaman. Bila situsnya menolak akses, hanya cuplikan yang tampil.' },
    { ctx: 'modal', sel: '#nwBody .nw-find', title: 'Temuan risiko', say: 'Bila A I menemukan risiko pembiayaan, ia ditampilkan di sini: kategorinya, tingkat keparahan satu sampai lima, dan kutipan bukti yang sudah dicek benar-benar ada di artikel.' },
    { ctx: 'modal', sel: '#nwBody .nw-grid', title: 'Penilaian AI dan sumber', say: 'Bagian ini menunjukkan peran perusahaan dalam berita, apakah fakta, rumor, atau opini, sentimen, dan seberapa yakin A I. Ada juga jenis sumber dan skor kredibilitasnya. Skor sumber hanya menilai jenis situs, bukan kebenaran isinya.' },
    { ctx: 'modal', sel: '#nwBody details.nw-tech', title: 'Detail teknis', say: 'Hal teknis seperti alat yang menemukan berita, kata kunci pencarian, dan status data disimpan di sini, supaya tampilan utama tetap sederhana.' },
    { ctx: 'modal', sel: '#nwModal .nw-foot', title: 'Baca artikel asli', say: 'Di bawah ada tombol untuk menyalin tautan dan membuka artikel aslinya. Selalu cocokkan temuan penting dengan sumber asli.' },

    // ---- Alat & bantuan ----
    { ctx: 'home', sel: '.shell-nav a[href="/jobs.html"]', title: 'Task Runner', say: 'Task Runner adalah tempat menjalankan pengambilan data: mencari berita, mengambil isi artikel, klasifikasi A I, analisis, dan dossier. Prosesnya berjalan di server dan bisa dilanjutkan bila terputus.' },
    { ctx: 'home', sel: '.shell-help', title: 'HELP', say: 'Halaman help menjelaskan alur kerja, sumber data, rumus rating, dan batasan. Sebaiknya dibaca sebelum memakai hasilnya.' },
    { ctx: 'home', sel: '#asst-logo', title: 'Asisten AI', say: 'Saya selalu ada di sini. Klik logo saya untuk bertanya soal portofolio, perusahaan, atau berita yang sedang dibuka. Anda bisa menyeret saya ke sudut mana pun, dan saya akan menjawab dengan suara.' },
    { ctx: 'home', title: 'Selesai', say: 'Itu semua. Ingat, hasil aplikasi ini hanya petunjuk awal, bukan keputusan kredit. Selamat bekerja.' },
  ];

  const css = document.createElement('style');
  css.textContent = `
  #tour-block{position:fixed;inset:0;z-index:150;background:transparent;cursor:default}
  #tour-block.dim{background:rgba(0,0,0,.66)}
  #tour-spot{position:fixed;z-index:151;pointer-events:none;border:2px solid #4c8dff;box-shadow:0 0 0 9999px rgba(0,0,0,.66),0 0 24px rgba(76,141,255,.55);transition:top .25s,left .25s,width .25s,height .25s;border-radius:4px !important}
  #tour-card{position:fixed;z-index:160;left:0;top:0;width:min(380px,calc(100vw - 24px));background:var(--panel,#0f1318);border:1px solid var(--line2,#2e3641);border-top:3px solid #4c8dff;box-shadow:0 18px 60px rgba(0,0,0,.7);color:var(--text,#e6e9ed);font:14px/1.6 Inter,system-ui,sans-serif}
  #tour-card.center{left:50%;top:50%;translate:-50% -50%}
  .tr-h{display:flex;gap:12px;align-items:center;padding:14px 16px 0}
  .tr-av{width:44px;height:44px;flex:none;display:grid;place-items:center} .tr-av svg{width:44px;height:44px;overflow:visible}
  .tr-av.talk .rb-eye{animation:rbtalk .3s infinite} .tr-av.talk svg{animation:rbbob .5s ease-in-out infinite}
  .tr-h b{font-size:15px;display:block} .tr-h small{color:var(--dim,#5b636e);font-size:11.5px;letter-spacing:.08em}
  .tr-b{padding:10px 16px 6px;color:#c5cbd3}
  .tr-f{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px 14px}
  .tr-f .sp{flex:1}
  .tr-btn{border:1px solid var(--line2,#2e3641);background:var(--panel2,#141920);color:var(--text,#e6e9ed);padding:7px 14px;font:inherit;font-weight:600;font-size:13px;cursor:pointer}
  .tr-btn:hover{border-color:#4c8dff} .tr-btn.pri{background:#4c8dff;border-color:#4c8dff;color:#fff} .tr-btn:disabled{opacity:.4;cursor:default}
  .tr-link{background:none;border:0;color:var(--muted,#8a93a0);text-decoration:underline;cursor:pointer;font:inherit;font-size:12.5px;padding:4px 2px}
  .tr-link:hover{color:var(--text,#e6e9ed)}
  .tr-bar{height:3px;background:var(--line,#232932)} .tr-bar i{display:block;height:100%;background:#4c8dff;transition:width .25s}
  .tr-ic{background:none;border:0;color:var(--muted,#8a93a0);cursor:pointer;padding:4px;display:grid} .tr-ic:hover{color:var(--text,#e6e9ed)} .tr-ic svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  @keyframes rbtalk{50%{transform:scaleY(.55)}}`;
  document.head.appendChild(css);

  const SPK_ON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SPK_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  const robot = (n) => (window.msRobot ? window.msRobot(n, 't') : '');
  const sayText = (st) => (typeof st.say === 'function' ? st.say() : st.say);
  const speak = (t) => window.msVoice?.speak(t);

  let els = null, i = 0, active = false, inerted = [], runId = 0, companyId = null, openedModal = false;

  // ----- data portofolio (untuk memilih perusahaan contoh) -----
  const portfolio = () => (typeof S !== 'undefined' && S.portfolio && S.portfolio.length ? S.portfolio : window.shellPortfolio) || [];
  const companyName = () => { const c = portfolio().find((x) => x.id === companyId); return c ? (c.ticker || c.name) : ''; };
  // perusahaan contoh: yang sudah punya rating dan paling banyak berita
  function pickCompany() {
    const list = portfolio();
    const rated = list.filter((c) => c.risk && c.risk.rating !== 'tidak_cukup_data');
    const pool = rated.length ? rated : list;
    return pool.slice().sort((a, b) => (b.stats?.total || 0) - (a.stats?.total || 0))[0]?.id || null;
  }

  function lockPage() {
    inerted = [];
    for (const el of document.body.children) {
      if (el === els.block || el === els.spot || el === els.card || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); inerted.push(el); }
    }
  }
  function unlockPage() { inerted.forEach((el) => el.removeAttribute('inert')); inerted = []; }

  function build() {
    const block = document.createElement('div'); block.id = 'tour-block';
    const spot = document.createElement('div'); spot.id = 'tour-spot'; spot.hidden = true;
    const card = document.createElement('div'); card.id = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Tur fitur');
    document.body.append(block, spot, card);
    els = { block, spot, card };
  }
  function destroy() {
    runId++;
    unlockPage();
    els?.block.remove(); els?.spot.remove(); els?.card.remove(); els = null; active = false;
    removeEventListener('keydown', onKey, true); removeEventListener('resize', place); removeEventListener('scroll', place, true);
    window.removeEventListener('ms-voice', onVoice); window.removeEventListener('ms-voice-pref', paintVoice);
  }

  const waitFor = (sel, ms) => new Promise((res) => {
    const t0 = Date.now();
    (function poll() { const el = document.querySelector(sel); if ((el && visible(el)) || Date.now() - t0 > ms) res(el); else setTimeout(poll, 120); })();
  });
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const modalOpen = () => { const m = document.getElementById('nwModal'); return !!m && !m.hidden; };
  function closeModal() { if (modalOpen() && typeof closeNews === 'function') closeNews(); openedModal = false; }

  // Siapkan halaman untuk langkah ini (idempotent, jadi tombol Kembali juga aman): Beranda, halaman perusahaan di tab tertentu, atau modal berita terbuka.
  async function enter(st) {
    const mode = st.ctx || 'home';
    if (mode !== 'modal') closeModal();
    if (mode === 'home') {
      if (location.hash && location.hash !== '#/') { location.hash = '#/'; await sleep(450); }
      return;
    }
    companyId = companyId || pickCompany();
    if (!companyId) return;
    const want = '#/c/' + encodeURIComponent(companyId);
    if (!location.hash.startsWith(want)) { location.hash = want; await sleep(350); await waitFor('#view .tabs', 7000); }
    const tab = mode === 'modal' ? 'berita' : st.tab;
    if (tab && typeof CS !== 'undefined' && CS.tab !== tab) { document.querySelector('[data-t="' + tab + '"]')?.click(); await sleep(300); }
    if (mode === 'modal' && !modalOpen()) {
      const a = await waitFor('#cbody .news h3 a, #cbody .lead-main h2 a', 7000);
      if (a) { a.click(); openedModal = true; await waitFor('#nwBody .nw-sum, #nwBody .nw-text', 7000); }
    }
  }

  function onVoice(e) { els?.card.querySelector('.tr-av')?.classList.toggle('talk', !!e.detail?.speaking); }
  function paintVoice() { const b = els?.card.querySelector('#trVoice'); if (b) { const on = window.msVoice?.enabled; b.innerHTML = on ? SPK_ON : SPK_OFF; b.title = on ? 'Suara aktif. Klik untuk membisukan.' : 'Suara mati. Klik untuk menyalakan.'; } }

  async function show(n, dir = 1) {
    if (!active) return;
    const my = ++runId;
    window.msVoice?.stop();
    i = n;
    let target = null;
    while (i >= 0 && i < STEPS.length) {
      const st = STEPS[i];
      await enter(st);
      if (my !== runId) return;
      if (!st.sel) break;
      const el = await waitFor(st.sel, st.wait ? 7000 : 1800);
      if (my !== runId) return;
      if (visible(el)) { target = el; break; }
      i += dir;                                    // sasaran tidak ada (mis. berita tanpa temuan risiko): lewati langkahnya
    }
    if (i < 0) i = 0;
    if (i >= STEPS.length) return end(true);
    const st = STEPS[i], last = i === STEPS.length - 1;
    if (target) target.scrollIntoView({ block: 'center', inline: 'nearest' });
    els.block.classList.toggle('dim', !target);
    els.spot.hidden = !target;
    const text = sayText(st);
    els.card.innerHTML = `<div class="tr-bar"><i style="width:${Math.round(((i + 1) / STEPS.length) * 100)}%"></i></div>
      <div class="tr-h"><span class="tr-av">${robot(44)}</span><div style="flex:1;min-width:0"><small>LANGKAH ${i + 1} DARI ${STEPS.length}</small><b>${esc(st.title)}</b></div><button class="tr-ic" id="trVoice" type="button"></button></div>
      <div class="tr-b">${esc(text.replace(/\bA I\b/g, 'AI'))}</div>
      <div class="tr-f"><button class="tr-btn" id="trBack" type="button" ${i === 0 ? 'disabled' : ''}>Kembali</button>
        <button class="tr-btn pri" id="trNext" type="button">${last ? 'Selesai' : 'Lanjut'}</button><span class="sp"></span>
        ${last ? '' : '<button class="tr-link" id="trSkip" type="button" title="Lewati langkah ini">Lewati</button>'}<button class="tr-link" id="trStop" type="button">Hentikan tur</button></div>`;
    paintVoice();
    els.card.querySelector('#trNext').onclick = () => (last ? end(true) : show(i + 1, 1));
    els.card.querySelector('#trBack').onclick = () => show(i - 1, -1);
    const sk = els.card.querySelector('#trSkip'); if (sk) sk.onclick = () => show(i + 1, 1);
    els.card.querySelector('#trStop').onclick = () => end(false);
    els.card.querySelector('#trVoice').onclick = () => { window.msVoice?.setEnabled(!window.msVoice.enabled); if (window.msVoice.enabled) speak(text); };
    els.card.querySelector('#trNext').focus({ preventScroll: true });
    requestAnimationFrame(place);
    setTimeout(place, 350);                          // setelah scroll dan transisi selesai
    speak(text);
  }

  // Sorotan mengikuti sasaran; kartu ditaruh di bawah / atas / samping sasaran sesuai ruang yang ada
  function place() {
    if (!els) return;
    const st = STEPS[i], t = st?.sel ? document.querySelector(st.sel) : null;
    const card = els.card, cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight, g = 14;
    if (!t || !visible(t)) { els.spot.hidden = true; card.classList.add('center'); card.style.left = ''; card.style.top = ''; return; }
    card.classList.remove('center');
    const r = t.getBoundingClientRect(), p = 6;
    els.spot.hidden = false;
    Object.assign(els.spot.style, { top: r.top - p + 'px', left: r.left - p + 'px', width: r.width + p * 2 + 'px', height: r.height + p * 2 + 'px' });
    let x, y;
    if (r.bottom + g + ch <= vh - 12) { y = r.bottom + p + g; x = r.left; }
    else if (r.top - g - ch >= 12) { y = r.top - p - g - ch; x = r.left; }
    else if (r.right + g + cw <= vw - 12) { x = r.right + p + g; y = Math.max(12, Math.min(r.top, vh - ch - 12)); }
    else if (r.left - g - cw >= 12) { x = r.left - p - g - cw; y = Math.max(12, Math.min(r.top, vh - ch - 12)); }
    else { x = (vw - cw) / 2; y = vh - ch - 16; }
    card.style.left = Math.max(12, Math.min(x, vw - cw - 12)) + 'px';
    card.style.top = Math.max(12, Math.min(y, vh - ch - 12)) + 'px';
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); els.card.querySelector('#trNext')?.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); els.card.querySelector('#trBack')?.click(); }
    else if (e.key === 'Tab') {                                    // fokus tetap di kartu tur
      const f = [...els.card.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const idx = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(idx + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }

  function end(finished) {
    window.msVoice?.stop();
    LS('ms.tour', finished ? 'done' : 'stopped');
    closeModal();                                                  // modal berita yang dibuka tur ditutup lagi
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    destroy();
  }

  async function start() {
    if (active) return;
    window.msVoice?.stop();
    window.assistantClose?.();                                      // jendela chat ditutup selama tur
    closeModal();
    companyId = null;
    active = true; build(); lockPage();
    addEventListener('keydown', onKey, true); addEventListener('resize', place); addEventListener('scroll', place, true);
    window.addEventListener('ms-voice', onVoice); window.addEventListener('ms-voice-pref', paintVoice);
    show(0, 1);
  }

  // Kartu sambutan (kunjungan pertama): Ya / Tidak
  function welcome() {
    if (active || LS('ms.tour') != null) return;
    build(); lockPage(); active = true;
    els.block.classList.add('dim'); els.spot.hidden = true; els.card.classList.add('center');
    els.card.innerHTML = `<div class="tr-h" style="padding-top:18px"><span class="tr-av">${robot(44)}</span><div><small>ASISTEN AI</small><b>Mau saya pandu keliling aplikasi?</b></div></div>
      <div class="tr-b">Saya akan menjelaskan fitur-fitur utama langkah demi langkah dengan suara: Beranda, halaman perusahaan, dan isi satu berita. Anda bisa melewati atau menghentikan tur kapan saja, dan mengulanginya lewat tombol <b>?</b> di jendela asisten.</div>
      <div class="tr-f"><button class="tr-btn pri" id="trYes" type="button">Ya, pandu saya</button><button class="tr-btn" id="trNo" type="button">Tidak, nanti saja</button></div>`;
    els.card.querySelector('#trYes').focus({ preventScroll: true });
    els.card.querySelector('#trYes').onclick = () => { destroy(); start(); };                // klik ini juga memberi izin suara dari browser
    els.card.querySelector('#trNo').onclick = () => { LS('ms.tour', 'no'); destroy(); };
    addEventListener('keydown', (e) => { if (active && els && e.key === 'Escape') { LS('ms.tour', 'no'); destroy(); } }, { once: true, capture: true });
  }

  window.msStartTour = start;
  document.getElementById('startTour')?.addEventListener('click', start);                  // tombol Tur di header
  const boot = () => setTimeout(welcome, 900);
  if (document.readyState === 'complete') boot(); else addEventListener('load', boot);
})();
