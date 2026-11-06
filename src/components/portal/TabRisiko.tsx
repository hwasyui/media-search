'use client';
// Tab "Risiko AI": rating, temuan utama, skor per kategori, bukti per kategori, checklist verifikasi FAP.
import { useEffect, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { ago, safeUrl } from '@/lib/client/format';
import type { OverviewCtx } from './CompanyPage';
import type { useCompanyRefresh } from './useRefresh';

const RATING_UI: Record<string, [string, string]> = {
  rendah: ['Rendah', '#2fbf71'], tidak_cukup_data: ['Data belum cukup', '#8a93a0'], sedang: ['Sedang', '#fbbf24'], tinggi: ['Tinggi', '#f08a4b'], sangat_tinggi: ['Sangat tinggi', '#ef5b5b'],
};
// Arti tingkat keparahan tag risiko (aturan di src/risk/risk.js). Tingkat = bobot kata pemicu, BUKAN penilaian akhir atas berita.
const LEVEL_TIP: Record<number, string> = {
  1: 'Tingkat 1 dari 5: sinyal lemah.',
  2: 'Tingkat 2 dari 5: perlu diperhatikan (mis. pergantian pengurus/pemegang saham, kontroversi).',
  3: 'Tingkat 3 dari 5: signifikan (mis. gugatan, rugi, denda, PHK, penghentian sementara).',
  4: 'Tingkat 4 dari 5: berat (mis. tersangka, sanksi/pemblokiran/pencabutan izin, restrukturisasi utang, penghentian operasi).',
  5: 'Tingkat 5 dari 5: sangat berat (mis. pailit/PKPU, gagal bayar, korupsi, penipuan/pencucian uang).',
};
const barColor = (s: number) => (s >= 70 ? '#ef5b5b' : s >= 45 ? '#f08a4b' : s >= 20 ? '#fbbf24' : '#2fbf71');

type Factor = { id?: number; finance?: boolean; text?: string; title?: string; url?: string; source?: string; date?: string; category: string; severity?: number; hit?: string; rumor?: boolean; tier?: string; unverified?: boolean; direct?: boolean };

function Meta({ f }: { f: Factor }) {
  return (
    <>
      {f.severity ? (
        <>
          <span className={'tag ' + (f.severity >= 4 ? 't-red' : f.severity >= 3 ? 't-amber' : 't-gray')} title={(LEVEL_TIP[f.severity] || '') + ' Dinilai AI dari isi artikel; tetap verifikasi ke sumbernya.'}>tingkat {f.severity}/5</span>
          {f.hit && <span className="sm dim" style={{ flexBasis: '100%' }}>“{f.hit}”</span>}
        </>
      ) : null}
      {f.rumor && <span className="tag t-amber" title="Dinilai AI sebagai rumor/belum terverifikasi">rumor</span>}
      {f.tier === 'official' && <span className="tag t-green">sumber resmi</span>}
      {f.unverified && <span className="tag t-amber" title="Kategori ini baru didukung sumber non-kredibel (medsos/forum/agregator/situs perusahaan) sehingga kontribusinya ke skor dibatasi sampai ada media atau sumber resmi yang memuatnya.">belum ada sumber kredibel</span>}
      {!f.finance && !f.direct && <span className="tag t-violet" title="Judul tidak menyebut nama perusahaan; bisa menyangkut pihak lain atau hubungan tidak langsung. Periksa sebelum dipakai.">periksa keterkaitan</span>}
    </>
  );
}

export default function TabRisiko({ data, refresh }: OverviewCtx & { refresh: ReturnType<typeof useCompanyRefresh> }) {
  const { api } = useApp();
  const c = data.company;
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setP(null); setErr(null);
    api('/api/company/' + encodeURIComponent(c.id) + '/risk').then((x) => { if (alive) setP(x); }).catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [api, c.id, data]);

  if (err) return <div className="empty"><b>Gagal memuat profil risiko</b>{err}</div>;
  if (!p) return <div className="muted" style={{ padding: '24px 0' }}>Menghitung profil risiko…</div>;

  const [label, color] = RATING_UI[p.rating] || RATING_UI.rendah;
  const noData = p.rating === 'tidak_cukup_data';
  const cats: [string, any][] = Object.entries(p.categories).sort((a: any, b: any) => b[1].score - a[1].score || b[1].count - a[1].count) as [string, any][];
  const detected = cats.filter(([, v]) => v.count > 0).length;
  const byCat: Record<string, Factor[]> = {};
  (p.factors as Factor[]).forEach((f) => { (byCat[f.category] ||= []).push(f); });
  const catLabel = (k: string) => (p.categories[k] ? p.categories[k].label : k);
  const keyFindings: Factor[] = p.factors.slice(0, 4);

  const FactorRow = ({ f }: { f: Factor }) => f.finance
    ? <div className="rf"><div className="row" style={{ gap: 6 }}><span className="tag t-gray">Data keuangan</span></div><div><b>{f.text}</b></div></div>
    : (
      <div className="rf" data-nid={f.id}><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Meta f={f} /></div>
        <div><a href={safeUrl(f.url)} data-nid={f.id} target="_blank" rel="noopener"><b>{f.title}</b></a>
          <div className="sm dim">{f.source || ''} · {ago(f.date)}</div></div></div>
    );

  function jump(k: string) {
    const d = document.getElementById('risk-' + k) as HTMLDetailsElement | null;
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1400);
  }

  return (
    <>
      <div className="rk-hero">
        <div className="rk-rating" style={{ ['--c' as string]: color }}>
          <div className="sm muted" style={{ letterSpacing: '.06em' }}>RATING RISIKO · HASIL PENILAIAN AI ATAS BERITA · INDIKATIF</div>
          <div className="rv" style={{ color }}>{label}</div>
          {noData ? <div className="sm muted">Belum ada berita atau data keuangan tersimpan. Ini bukan berarti aman.</div> : (
            <>
              <div className="meter" title={`Skor ${p.score} dari 100. Batas: <20 rendah, <45 sedang, <70 tinggi, selebihnya sangat tinggi`}>
                <span style={{ width: '20%', background: '#2fbf71' }}></span><span style={{ width: '25%', background: '#fbbf24' }}></span><span style={{ width: '25%', background: '#f08a4b' }}></span><span style={{ width: '30%', background: '#ef5b5b' }}></span>
                <i style={{ left: `calc(${Math.min(99, p.score)}% - 2px)` }}></i>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="sm muted">skor <b style={{ color: 'var(--text)' }}>{p.score}</b> / 100</span><span className="sm dim">rendah ◂ ▸ sangat tinggi</span></div>
            </>
          )}
        </div>
        <div className="rk-kpis">
          <div><small>Berita terkait (90 hari)</small><b>{p.coverage.newsItems}</b></div>
          <div><small>Bertag risiko</small><b>{p.coverage.tagged}</b></div>
          <div><small>Kategori terdeteksi</small><b>{detected}<span className="dim" style={{ fontSize: 14 }}> / {cats.length}</span></b></div>
          <div><small>Data keuangan</small><b>{p.coverage.hasFinancial ? 'Ada' : <span className="dim">Tidak ada</span>}</b></div>
        </div>
        <div className="rk-actions">
          <button className="btn wht" id="rkRefresh" disabled={refresh.label !== null} onClick={refresh.run}>{refresh.label !== null ? <><span className="spin"></span> {refresh.label}</> : '⟳ Perbarui berita'}</button>
          <button className="btn" id="rkPrint" onClick={() => { document.querySelectorAll<HTMLDetailsElement>('details.tbl').forEach((d) => (d.open = true)); window.print(); }}>⎙ Cetak laporan</button>
        </div>
      </div>
      <div className="caveats">{p.caveats.map((t: string, i: number) => <div key={i}>⚠ {t}</div>)}</div>
      <details className="card tbl" style={{ marginTop: 10 }}><summary>Bagaimana rating ini dibuat dan seberapa bisa dipercaya?</summary>
        <div style={{ padding: '0 16px 14px', color: 'var(--muted)', lineHeight: 1.7 }}>
          <div>1. <b>AI membaca isi tiap berita</b> dan menilai: apakah perusahaan ini subjek beritanya, dampaknya, dan temuan risiko (kategori, tingkat 1–5, beserta <b>kutipan bukti</b> dari artikel). Temuan yang kutipannya tidak ditemukan di teks artikel dibuang otomatis.</div>
          <div>2. <b>Skor dan rating dihitung dengan rumus tetap</b> dari temuan itu (tingkat × kredibilitas sumber × kebaruan × peran perusahaan). Rumusnya bisa dilihat dan hasilnya sama setiap kali dihitung.</div>
          <div>3. Berita yang <b>belum dinilai AI tidak dihitung</b> (dilaporkan di catatan di atas), jadi rating tidak ditebak dari kata kunci.</div>
          <div style={{ marginTop: 6 }}><b>Batasannya:</b> penilaian AI belum diaudit manusia dan bisa keliru, jadi rating ini indikator awal untuk menentukan apa yang perlu diverifikasi, bukan dasar keputusan kredit. Klik tiap temuan untuk membaca beritanya.</div>
          <div style={{ marginTop: 6 }}>Arti tingkat:</div>{Object.values(LEVEL_TIP).map((t, i) => <div key={i}>• {t}</div>)}
        </div>
      </details>

      {keyFindings.length > 0 && (
        <>
          <h4>Temuan utama <span className="muted sm">· bukti dengan bobot terbesar</span></h4>
          <div className="kf-grid">{keyFindings.map((f, i) => (
            <div className="kf" key={i} {...(f.id ? { 'data-nid': f.id } : {})}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="tag t-cyan">{catLabel(f.category)}</span><Meta f={f} /></div>
              {f.finance ? <div><b>{f.text}</b></div> : <div><a href={safeUrl(f.url)} data-nid={f.id} target="_blank" rel="noopener"><b>{f.title}</b></a><div className="sm dim" style={{ marginTop: 3 }}>{f.source || ''} · {ago(f.date)}</div></div>}
            </div>
          ))}</div>
        </>
      )}

      <h4>Skor per kategori <span className="muted sm">· klik kategori untuk melompat ke buktinya</span></h4>
      <div className="catbars">{cats.map(([k, v]) => (
        <button type="button" key={k} className={'cb ' + (v.count ? '' : 'zero')} data-cat={k} disabled={!v.count} title={v.count ? 'Lihat ' + v.count + ' temuan' : 'Tidak ada temuan untuk kategori ini'} onClick={() => jump(k)}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><b>{v.label}</b><span className="sm" style={{ color: barColor(v.score), fontWeight: 800 }}>{v.score}</span></div>
          <div className="track"><i style={{ width: Math.max(v.count ? 3 : 0, v.score) + '%', background: barColor(v.score) }}></i></div>
          <div className="sm muted">{v.count ? v.count + ' temuan · tingkat tertinggi ' + v.topSeverity + '/5' : 'tidak ada temuan'}</div>
        </button>
      ))}</div>

      <h4>Bukti per kategori</h4>
      {cats.filter(([k]) => byCat[k]).length ? cats.filter(([k]) => byCat[k]).map(([k, v]) => (
        <details className="card tbl" id={'risk-' + k} key={k} open={v.score >= 20}>
          <summary>{v.label} <span className="muted sm">· skor {v.score} · {byCat[k].length} bukti</span></summary>
          <div className="rflist">{byCat[k].map((f, i) => <FactorRow f={f} key={i} />)}</div>
        </details>
      )) : <div className="card muted">Tidak ada temuan risiko pada data yang tersimpan.</div>}

      <h4>Checklist verifikasi FAP <span className="muted sm">· langkah lanjutan berdasarkan temuan</span></h4>
      {p.checklist.length ? (
        <div className="ck-grid">{p.checklist.map((g: any, i: number) => (
          <div className="card" key={i}><b>{g.label}</b>
            {g.steps.map((s: string, j: number) => <label className="ck" key={j}><input type="checkbox" /> <span>{s}</span></label>)}
          </div>
        ))}</div>
      ) : <div className="card muted">Tidak ada temuan yang memerlukan verifikasi tambahan dari data ini. Tetap lengkapi dokumen FAP standar.</div>}

      <details className="card tbl" style={{ marginTop: 14 }}><summary>Cara perhitungan rating</summary><div style={{ padding: '0 16px 14px', color: 'var(--muted)' }}>{p.method}</div></details>
    </>
  );
}
