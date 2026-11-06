'use client';
// Kerangka bersama: sidebar (portofolio, Task Runner, HELP) + area konten. Pengganti shell.js.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import type { Company } from '@/lib/client/types';

const SHELL_FIRST = 8, SHELL_STEP = 8;
const LABEL: Record<string, string> = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', sangat_tinggi: 'Sangat tinggi' };
const DOT: Record<string, string> = { rendah: 'ok', sedang: 'amber', tinggi: 'orange', sangat_tinggi: 'risk' };

// Kode singkat perusahaan tanpa ticker: inisial nama bila terdiri dari beberapa kata, selain itu 5 huruf pertama
function codeOf(c: Company) {
  const w = String(c.name || '').replace(/\b(pt|tbk|persero|cv)\b|[()]/gi, ' ').split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? w.slice(0, 4).map((x) => x[0]).join('') : (w[0] || c.id).slice(0, 5)).toUpperCase();
}

function riskTip(c: Company) {
  const rk = c.risk;
  const cv = (rk?.coverage || {}) as Record<string, any>;
  const basis = cv.assessed != null
    ? 'Dihitung dari ' + cv.assessed + ' berita yang sudah dinilai AI' + (cv.hasFinancial ? ' + data keuangan' : '') + (cv.unassessed ? '; ' + cv.unassessed + ' berita lain belum dinilai AI dan tidak dihitung.' : '.')
    : 'Perhitungan lama (' + (cv.newsItems ?? 0) + ' berita, belum memakai penilaian AI atas isi berita). Buka halaman perusahaan untuk menghitung ulang.';
  if (!rk) return 'Belum dinilai::Belum ada profil risiko. Jalankan crawl di Task Runner atau buka halaman perusahaan.';
  if (rk.rating === 'tidak_cukup_data') return 'Data belum cukup::Belum ada berita yang dinilai AI atau data keuangan untuk menilai risiko. Ini bukan berarti aman.';
  return 'Rating risiko pembiayaan: ' + LABEL[rk.rating] + ' (skor ' + rk.score + ' dari 100)::' + basis + ' Ini indikator awal, bukan keputusan kredit. Klik perusahaan untuk melihat buktinya. Cara hitung ada di HELP.';
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { portfolio } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(SHELL_FIRST);

  const cur = /^\/c\/([^/]+)/.exec(pathname)?.[1] ? decodeURIComponent(/^\/c\/([^/]+)/.exec(pathname)![1]) : undefined;
  const here = pathname === '/' || pathname.startsWith('/c/') ? 'portal' : pathname.startsWith('/jobs') ? 'jobs' : pathname.startsWith('/help') ? 'help' : '';

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const { shown, left, rows } = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const hit = (c: Company) => [c.name, c.ticker, c.id, ...(Array.isArray(c.aliases) ? c.aliases : [])].some((x) => String(x || '').toLowerCase().includes(ql));
    const rows = ql ? portfolio.filter(hit) : portfolio;
    let shown = ql ? rows : rows.slice(0, limit);
    // perusahaan yang sedang dibuka selalu terlihat, walau di luar batas tampilan
    if (!ql && cur && !shown.some((c) => c.id === cur)) { const a = rows.find((c) => c.id === cur); if (a) shown = [...shown, a]; }
    return { shown, left: rows.length - shown.length, rows };
  }, [portfolio, q, limit, cur]);
  const searching = q.trim() !== '';

  return (
    <div className="shell-root">
      <aside className={'shell-side' + (open ? ' open' : '')} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>
        <Link className="shell-logo" href="/"><i>M</i><span>Media Search</span></Link>
        <div className="shell-h">Utama</div>
        <nav className="shell-nav">
          <Link href="/" className={here === 'portal' && !cur ? 'on' : ''} data-home>Beranda</Link>
        </nav>
        <div className="shell-h">Portofolio</div>
        <div className="shell-search" id="shellSearchW" hidden={portfolio.length <= 6}>
          <input id="shellSearch" type="search" placeholder="Cari perusahaan atau ticker…" autoComplete="off" aria-label="Cari perusahaan" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <nav className="shell-nav" id="shellCompanies">
          {shown.map((c) => {
            const rk = c.risk;
            const st = !rk || rk.rating === 'tidak_cukup_data' ? '' : DOT[rk.rating] || '';
            return (
              <Link key={c.id} href={`/c/${encodeURIComponent(c.id)}`} className={here === 'portal' && cur === c.id ? 'on' : ''} title={c.name}>
                <span className="tk">{c.ticker || codeOf(c)}</span><span className="nm">{c.name.replace(/^PT\s+/i, '')}</span><span className={'st ' + st} title={riskTip(c)} />
              </Link>
            );
          })}
          {portfolio.length === 0 && <div style={{ padding: '4px 18px', color: 'var(--sh-dim)', fontSize: 12 }}>Memuat…</div>}
          {portfolio.length > 0 && shown.length === 0 && <div style={{ padding: '4px 18px', color: 'var(--sh-dim)', fontSize: 12 }}>{searching ? 'Tidak ada perusahaan yang cocok.' : 'Belum ada perusahaan.'}</div>}
          {!searching && left > 0 && (
            <button type="button" className="shell-more" onClick={() => setLimit((n) => n + SHELL_STEP)}>Tampilkan {Math.min(SHELL_STEP, left)} lainnya <span>(sisa {left})</span></button>
          )}
          {!searching && left <= 0 && limit > SHELL_FIRST && rows.length > SHELL_FIRST && (
            <button type="button" className="shell-more" onClick={() => setLimit(SHELL_FIRST)}>Ringkas daftar</button>
          )}
        </nav>
        <div className="shell-h">Alat</div>
        <nav className="shell-nav">
          <Link href="/jobs" className={here === 'jobs' ? 'on' : ''}>Task Runner</Link>
        </nav>
        <div className="shell-foot"><Link className={'shell-help ' + (here === 'help' ? 'on' : '')} href="/help">HELP</Link><div id="shellFoot">Prototype</div></div>
      </aside>

      <div className="shell-main">
        <div className="shell-mbar">
          <button type="button" id="shellBurger" aria-label="Buka menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          <Link href="/"><i>M</i>Media Search</Link>
        </div>
        {children}
      </div>
      <div className={'shell-scrim' + (open ? ' on' : '')} onClick={() => setOpen(false)} />
    </div>
  );
}
