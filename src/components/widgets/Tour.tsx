'use client';
/* Tur fitur dipandu robot AI. Di kunjungan pertama muncul kartu sambutan Ya / Tidak. Bila Ya: robot menjelaskan fitur satu per satu (teks + suara),
   menyorot bagian yang dibahas, dan SELURUH halaman dikunci selama tur (klik dan keyboard) supaya pengguna tidak berpindah ke fitur lain.
   Tur sendiri yang menggerakkan halaman: membuka satu perusahaan, berpindah tab, dan membuka satu berita agar isinya bisa dijelaskan.
   Kontrol: Kembali, Lanjut, Lewati (loncati langkah ini), Hentikan (akhiri tur). Penjelasan sudah tertulis (tanpa memanggil AI, tanpa token).
   Pilihan tersimpan di localStorage 'ms.tour'. Bisa diulang lewat tombol "?" di jendela asisten atau tombol "Tur" di bilah atas. */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/components/providers/AppProvider';
import { LS } from '@/lib/client/storage';
import { voice } from '@/lib/client/voice';
import Robot from './Robot';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ctx: 'home' = Beranda; 'company' = halaman perusahaan (tab: nama tab); 'modal' = modal detail berita di tab Berita.
// Teks "A I" dieja untuk suara dan ditampilkan sebagai "AI".
type Step = { ctx?: 'home' | 'company' | 'modal'; tab?: string; sel?: string; wait?: boolean; title: string; say: string | (() => string) };
const STEPS: (companyName: () => string) => Step[] = (companyName) => [
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
  { ctx: 'company', tab: 'dossier', sel: '#cbody .dz-hero, #cbody .dz-start', wait: true, title: 'Dossier korporasi', say: 'Dossier merangkum empat hal dari berita: pemilik dan pengendali, klien dan proyek, akta dan perubahan korporasi, serta fasilitas bank. Tiap poin membawa kutipan dan nomor berita yang bisa diklik, dan statusnya jelas: dari berita saja, atau berita yang mengutip dokumen resmi. Dokumennya sendiri belum diperiksa aplikasi.' },
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
  { ctx: 'home', sel: '.shell-nav a[href="/jobs"]', title: 'Task Runner', say: 'Task Runner adalah tempat menjalankan pengambilan data: mencari berita, mengambil isi artikel, klasifikasi A I, analisis, dan dossier. Prosesnya berjalan di server dan bisa dilanjutkan bila terputus.' },
  { ctx: 'home', sel: '.shell-help', title: 'HELP', say: 'Halaman help menjelaskan alur kerja, sumber data, rumus rating, dan batasan. Sebaiknya dibaca sebelum memakai hasilnya.' },
  { ctx: 'home', sel: '#asst-logo', title: 'Asisten AI', say: 'Saya selalu ada di sini. Klik logo saya untuk bertanya soal portofolio, perusahaan, atau berita yang sedang dibuka. Anda bisa menyeret saya ke sudut mana pun, dan saya akan menjawab dengan suara.' },
  { ctx: 'home', title: 'Selesai', say: 'Itu semua. Ingat, hasil aplikasi ini hanya petunjuk awal, bukan keputusan kredit. Selamat bekerja.' },
];

const SPK_ON = <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>;
const SPK_OFF = <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>;

const visible = (el: Element | null): el is Element => {
  if (!el) return false;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
};
const waitFor = (sel: string, ms: number) => new Promise<Element | null>((res) => {
  const t0 = Date.now();
  (function poll() { const el = document.querySelector(sel); if ((el && visible(el)) || Date.now() - t0 > ms) res(el); else setTimeout(poll, 120); })();
});
const modalOpen = () => { const m = document.getElementById('nwModal'); return !!m && !m.hidden; };

export default function Tour() {
  const router = useRouter();
  const { portfolio, closeNews } = useApp();
  const live = useRef({ router, portfolio, closeNews });
  live.current = { router, portfolio, closeNews };

  const [mode, setMode] = useState<'off' | 'welcome' | 'run'>('off');
  const [view, setView] = useState({ i: 0, hasTarget: false });
  const [voiceOn, setVoiceOn] = useState(true);
  const st = useRef({ i: 0, active: false, runId: 0, companyId: null as string | null });
  const blockRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const companyName = () => { const c = live.current.portfolio.find((x) => x.id === st.current.companyId); return c ? (c.ticker || c.name) : ''; };
  const steps = useRef(STEPS(companyName)).current;
  const sayText = (s: Step) => (typeof s.say === 'function' ? s.say() : s.say);

  // perusahaan contoh: yang sudah punya rating dan paling banyak berita
  function pickCompany() {
    const list = live.current.portfolio;
    const rated = list.filter((c) => c.risk && c.risk.rating !== 'tidak_cukup_data');
    const pool = rated.length ? rated : list;
    return pool.slice().sort((a, b) => (b.stats?.total || 0) - (a.stats?.total || 0))[0]?.id || null;
  }
  function closeModal() { if (modalOpen()) live.current.closeNews(); }

  // Siapkan halaman untuk langkah ini (idempotent, jadi tombol Kembali juga aman): Beranda, halaman perusahaan di tab tertentu, atau modal berita terbuka.
  async function enter(s: Step) {
    const mode = s.ctx || 'home';
    if (mode !== 'modal') closeModal();
    if (mode === 'home') {
      if (location.pathname !== '/') { live.current.router.push('/'); await sleep(450); }
      return;
    }
    st.current.companyId = st.current.companyId || pickCompany();
    const id = st.current.companyId;
    if (!id) return;
    const want = '/c/' + encodeURIComponent(id);
    if (!location.pathname.startsWith(want)) { live.current.router.push(want); await sleep(350); await waitFor('#view .tabs', 7000); }
    const tab = mode === 'modal' ? 'berita' : s.tab;
    if (tab) {
      const cur = (document.querySelector('#view .tabs [data-t].on') as HTMLElement | null)?.dataset.t;
      if (cur !== tab) { (document.querySelector('[data-t="' + tab + '"]') as HTMLElement | null)?.click(); await sleep(300); }
    }
    if (mode === 'modal' && !modalOpen()) {
      const a = await waitFor('#cbody .news h3 a, #cbody .lead-main h2 a', 7000);
      if (a) { (a as HTMLElement).click(); await waitFor('#nwBody .nw-sum, #nwBody .nw-text', 7000); }
    }
  }

  // Sorotan mengikuti sasaran; kartu ditaruh di bawah / atas / samping sasaran sesuai ruang yang ada
  const place = useCallback(() => {
    const card = cardRef.current, spot = spotRef.current;
    if (!card || !spot) return;
    if (mode !== 'run') { spot.hidden = true; card.classList.add('center'); card.style.left = ''; card.style.top = ''; return; }
    const s = steps[st.current.i], t = s?.sel ? document.querySelector(s.sel) : null;
    const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight, g = 14;
    if (!t || !visible(t)) { spot.hidden = true; card.classList.add('center'); card.style.left = ''; card.style.top = ''; return; }
    card.classList.remove('center');
    const r = t.getBoundingClientRect(), p = 6;
    spot.hidden = false;
    Object.assign(spot.style, { top: r.top - p + 'px', left: r.left - p + 'px', width: r.width + p * 2 + 'px', height: r.height + p * 2 + 'px' });
    let x: number, y: number;
    if (r.bottom + g + ch <= vh - 12) { y = r.bottom + p + g; x = r.left; }
    else if (r.top - g - ch >= 12) { y = r.top - p - g - ch; x = r.left; }
    else if (r.right + g + cw <= vw - 12) { x = r.right + p + g; y = Math.max(12, Math.min(r.top, vh - ch - 12)); }
    else if (r.left - g - cw >= 12) { x = r.left - p - g - cw; y = Math.max(12, Math.min(r.top, vh - ch - 12)); }
    else { x = (vw - cw) / 2; y = vh - ch - 16; }
    card.style.left = Math.max(12, Math.min(x, vw - cw - 12)) + 'px';
    card.style.top = Math.max(12, Math.min(y, vh - ch - 12)) + 'px';
  }, [mode, steps]);

  const end = useCallback((finished: boolean) => {
    voice.stop();
    LS.set('ms.tour', finished ? 'done' : 'stopped');
    closeModal();                                                  // modal berita yang dibuka tur ditutup lagi
    if (location.pathname !== '/') live.current.router.push('/');
    st.current.runId++; st.current.active = false;
    setMode('off');
  }, []);

  const show = useCallback(async (n: number, dir = 1) => {
    const s = st.current;
    if (!s.active) return;
    const my = ++s.runId;
    voice.stop();
    s.i = n;
    let target: Element | null = null;
    while (s.i >= 0 && s.i < steps.length) {
      const step = steps[s.i];
      await enter(step);
      if (my !== s.runId) return;
      if (!step.sel) break;
      const el = await waitFor(step.sel, step.wait ? 7000 : 1800);
      if (my !== s.runId) return;
      if (visible(el)) { target = el; break; }
      s.i += dir;                                    // sasaran tidak ada (mis. berita tanpa temuan risiko): lewati langkahnya
    }
    if (s.i < 0) s.i = 0;
    if (s.i >= steps.length) return end(true);
    if (target) target.scrollIntoView({ block: 'center', inline: 'nearest' });
    setView({ i: s.i, hasTarget: Boolean(target) });
    voice.speak(sayText(steps[s.i]));
  }, [steps, end]);                                  // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    if (st.current.active) return;
    voice.stop();
    window.dispatchEvent(new Event('ms-assistant-close'));          // jendela chat ditutup selama tur
    closeModal();
    st.current.companyId = null; st.current.active = true;
    setMode('run');
  }, []);

  // Kartu sambutan (kunjungan pertama): Ya / Tidak
  useEffect(() => {
    const t = setTimeout(() => { if (!st.current.active && LS.get('ms.tour') == null) { st.current.active = true; setMode('welcome'); } }, 900);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const on = () => start();
    window.addEventListener('ms-tour-start', on);
    return () => window.removeEventListener('ms-tour-start', on);
  }, [start]);

  // Tur berjalan: kunci halaman, pasang papan ketik, mulai langkah pertama
  useEffect(() => {
    if (mode === 'off') return;
    const inerted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el.id === 'tour-block' || el.id === 'tour-spot' || el.id === 'tour-card' || ['SCRIPT', 'STYLE'].includes(el.tagName) || el.tagName.includes('-')) continue;
      if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); inerted.push(el); }
    }
    const onKey = (e: KeyboardEvent) => {
      if (!st.current.active) return;
      const card = cardRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'welcome') { LS.set('ms.tour', 'no'); st.current.active = false; setMode('off'); } else end(false);
      } else if (mode === 'run' && e.key === 'ArrowRight') { e.preventDefault(); card?.querySelector<HTMLElement>('#trNext')?.click(); }
      else if (mode === 'run' && e.key === 'ArrowLeft') { e.preventDefault(); card?.querySelector<HTMLElement>('#trBack')?.click(); }
      else if (e.key === 'Tab' && card) {                           // fokus tetap di kartu tur
        const f = [...card.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!f.length) return;
        const idx = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        f[(idx + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    const onVoice = (e: Event) => cardRef.current?.querySelector('.tr-av')?.classList.toggle('talk', !!(e as CustomEvent).detail?.speaking);
    const onPref = () => setVoiceOn(voice.enabled);
    addEventListener('keydown', onKey, true); addEventListener('resize', place); addEventListener('scroll', place, true);
    window.addEventListener('ms-voice', onVoice); window.addEventListener('ms-voice-pref', onPref);
    setVoiceOn(voice.enabled);
    if (mode === 'run') show(0, 1);
    return () => {
      inerted.forEach((el) => el.removeAttribute('inert'));
      removeEventListener('keydown', onKey, true); removeEventListener('resize', place); removeEventListener('scroll', place, true);
      window.removeEventListener('ms-voice', onVoice); window.removeEventListener('ms-voice-pref', onPref);
    };
  }, [mode]);                                        // eslint-disable-line react-hooks/exhaustive-deps

  // setelah kartu/langkah dirender: tempatkan sorotan (dan sekali lagi setelah scroll & transisi selesai)
  useEffect(() => {
    if (mode === 'off') return;
    place();
    const t = setTimeout(place, 350);
    cardRef.current?.querySelector<HTMLElement>(mode === 'welcome' ? '#trYes' : '#trNext')?.focus({ preventScroll: true });
    return () => clearTimeout(t);
  }, [mode, view, place]);

  if (mode === 'off' || typeof document === 'undefined') return null;
  const step = steps[view.i];
  const last = view.i === steps.length - 1;
  const text = mode === 'run' ? sayText(step) : '';
  const dim = mode === 'welcome' || !view.hasTarget;

  return createPortal(
    <>
      <div id="tour-block" ref={blockRef} className={dim ? 'dim' : ''}></div>
      <div id="tour-spot" ref={spotRef} hidden></div>
      <div id="tour-card" ref={cardRef} role="dialog" aria-label="Tur fitur">
        {mode === 'welcome' ? (
          <>
            <div className="tr-h" style={{ paddingTop: 18 }}><span className="tr-av"><Robot n={44} id="t" /></span><div><small>ASISTEN AI</small><b>Mau saya pandu keliling aplikasi?</b></div></div>
            <div className="tr-b">Saya akan menjelaskan fitur-fitur utama langkah demi langkah dengan suara: Beranda, halaman perusahaan, dan isi satu berita. Anda bisa melewati atau menghentikan tur kapan saja, dan mengulanginya lewat tombol <b>?</b> di jendela asisten.</div>
            <div className="tr-f">
              <button className="tr-btn pri" id="trYes" type="button" onClick={() => setMode('run')}>Ya, pandu saya</button>{/* klik ini juga memberi izin suara dari browser */}
              <button className="tr-btn" id="trNo" type="button" onClick={() => { LS.set('ms.tour', 'no'); st.current.active = false; setMode('off'); }}>Tidak, nanti saja</button>
            </div>
          </>
        ) : (
          <>
            <div className="tr-bar"><i style={{ width: Math.round(((view.i + 1) / steps.length) * 100) + '%' }}></i></div>
            <div className="tr-h"><span className="tr-av"><Robot n={44} id="t" /></span>
              <div style={{ flex: 1, minWidth: 0 }}><small>LANGKAH {view.i + 1} DARI {steps.length}</small><b>{step.title}</b></div>
              <button className="tr-ic" id="trVoice" type="button" title={voiceOn ? 'Suara aktif. Klik untuk membisukan.' : 'Suara mati. Klik untuk menyalakan.'}
                onClick={() => { voice.setEnabled(!voice.enabled); if (voice.enabled) voice.speak(text); }}>{voiceOn ? SPK_ON : SPK_OFF}</button>
            </div>
            <div className="tr-b">{text.replace(/\bA I\b/g, 'AI')}</div>
            <div className="tr-f">
              <button className="tr-btn" id="trBack" type="button" disabled={view.i === 0} onClick={() => show(view.i - 1, -1)}>Kembali</button>
              <button className="tr-btn pri" id="trNext" type="button" onClick={() => (last ? end(true) : show(view.i + 1, 1))}>{last ? 'Selesai' : 'Lanjut'}</button>
              <span className="sp"></span>
              {!last && <button className="tr-link" id="trSkip" type="button" title="Lewati langkah ini" onClick={() => show(view.i + 1, 1)}>Lewati</button>}
              <button className="tr-link" id="trStop" type="button" onClick={() => end(false)}>Hentikan tur</button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
