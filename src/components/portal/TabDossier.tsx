'use client';
/* Tab "Dossier Korporasi" untuk due diligence & FAP (hanya tampilan; data dan ekstraksinya ada di src/ai/dossier.js).
   Angka rujukan memakai gaya .ref dan membuka modal berita (data-nid). */
import { type ReactNode, useEffect, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { dt, safeUrl } from '@/lib/client/format';
import type { OverviewCtx } from './CompanyPage';

const Svg = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;

type Mapped = { title?: string; role?: string; text?: string; value?: string; valueLabel?: string; date?: string };
const DZ_SECTIONS: { key: string; icon: ReactNode; title: string; sub: string; c: [string, string]; need: string; map: (it: any) => Mapped }[] = [
  { key: 'pemilik_manfaat', icon: <Svg><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><circle cx="12" cy="10" r="2.2" /><path d="M8.5 16c.8-1.8 2-2.5 3.5-2.5s2.7.7 3.5 2.5" /></Svg>, title: 'Pemilik Manfaat & Pengendali', sub: 'Siapa pemegang saham pengendali (PSP) dan pemilik manfaat akhir (UBO) di balik perusahaan.', c: ['rgba(251,191,36,.14)', 'rgba(251,191,36,.4)'], need: 'Akta pendirian/perubahan, SK Kemenkumham (AHU), dan daftar pemegang saham.',
    map: (it) => ({ title: it.nama, role: it.peran_atau_porsi || 'Pengendali / pemilik' }) },
  { key: 'klien_proyek', icon: <Svg><rect x="3" y="8" width="18" height="12" rx="1" /><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8" /><path d="M3 13h18" /></Svg>, title: 'Klien Utama & Proyek', sub: 'Pemberi kerja (bowheer), mitra, dan kontrak yang menjadi sumber pendapatan.', c: ['rgba(76,141,255,.14)', 'rgba(76,141,255,.4)'], need: 'PO, kontrak kerja, atau invoice debitur.',
    map: (it) => ({ title: it.klien_mitra, text: it.proyek_kontrak, value: it.nilai, valueLabel: 'Nilai' }) },
  { key: 'akta_korporasi', icon: <Svg><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></Svg>, title: 'Akta & Perubahan Korporasi', sub: 'Pendirian, perubahan anggaran dasar, pengurus, dan aksi korporasi (RUPS, divestasi, akuisisi).', c: ['rgba(47,191,113,.13)', 'rgba(47,191,113,.4)'], need: 'Akta perubahan notaris dan SK Kemenkumham (AHU).',
    map: (it) => ({ title: it.peristiwa, date: it.tanggal, text: it.rincian }) },
  { key: 'fasilitas_bank', icon: <Svg><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></Svg>, title: 'Fasilitas Bank & Pinjaman', sub: 'Kreditur, jenis fasilitas, dan plafon kredit yang sudah ada.', c: ['rgba(94,242,255,.12)', 'rgba(94,242,255,.38)'], need: 'SLIK OJK dan surat perjanjian kredit.',
    map: (it) => ({ title: it.kreditor_bank, text: it.jenis_fasilitas, value: it.plafon, valueLabel: 'Plafon' }) },
];

type Ref = { n: number; id?: number; url: string; title?: string; source?: string; date?: string };

const Status = ({ st }: { st?: string }) => (st === 'terverifikasi_dokumen'
  ? <span className="tag t-green" title="Mengutip dokumen::Berita menyebut temuan ini bersumber dari dokumen resmi (akta atau keterbukaan bursa). Ini penilaian AI dari isi berita: aplikasi belum memiliki atau memeriksa dokumennya, jadi tetap cocokkan dengan dokumen aslinya.">Mengutip dokumen (belum dicek)</span>
  : <span className="tag t-amber" title="Dari berita, belum diverifikasi::Diekstrak dari isi berita. Cocokkan dengan dokumen asli (akta, AHU, SLIK) sebelum dipakai.">Dari berita · belum diverifikasi</span>);

function Quote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <blockquote className={'dz-q' + (open ? ' open' : '')} title="Kutipan dari berita (ditulis AI, belum dicek otomatis)::Klik untuk membuka/menutup seluruh kutipan." onClick={() => setOpen((o) => !o)}>“{text}”</blockquote>;
}

// Chip sumber: nomor berita + nama media; klik membuka modal beritanya
function Source({ it, refBy }: { it: any; refBy: Map<number, Ref> }) {
  const r = it.ref_n ? refBy.get(it.ref_n) : null;
  if (!r && !it.url) return <span className="dz-src none" title="Sumber::Rujukan berita tidak tersedia.">{it.dasar || 'Tanpa rujukan'}</span>;
  const url = (r && r.url) || it.url, nid = r && r.id;
  const name = (r && r.source) || it.source_name || 'Sumber';
  const tip = (r ? r.title : name) + '::' + [name, r && r.date].filter(Boolean).join(' · ') + ' — klik untuk membuka beritanya.';
  return (
    <a className="dz-src" href={safeUrl(url)} {...(nid ? { 'data-nid': nid } : {})} target="_blank" rel="noopener" title={tip}>
      {it.ref_n ? <span className="ref">{it.ref_n}</span> : null}<span className="nm">{name}</span>
    </a>
  );
}

function DossierView({ d, onRegen, busy }: { d: any; onRegen: () => void; busy: boolean }) {
  const s = d.sections || {};
  const refs: Ref[] = d.refs || [];
  const refBy = new Map(refs.map((r) => [r.n, r]));
  const stats = d.stats || { total_items: 0, verified_count: 0, unverified_count: 0 };
  const genDate = dt(d.generated_at, '-');

  return (
    <>
      <div className="dz-hero">
        <div>
          <div className="eyebrow" style={{ color: 'var(--cyan)', marginBottom: 4 }}>DOSSIER KORPORASI · DUE DILIGENCE</div>
          <h3>Struktur, klien, akta, dan fasilitas bank</h3>
          <p>{d.ringkasan || ''}</p>
          <div className="dz-meta">Diperbarui {genDate} · disusun dari {stats.news_analyzed || refs.length} berita</div>
        </div>
        <div className="dz-kpis">
          <div className="dz-kpi"><small>Total temuan</small><b>{stats.total_items}</b></div>
          <div className="dz-kpi" title="Mengutip dokumen::Temuan yang menurut AI bersumber dari dokumen resmi yang dikutip berita. Dokumennya belum diperiksa aplikasi."><small>Mengutip dokumen</small><b style={{ color: 'var(--green)' }}>{stats.verified_count}</b></div>
          <div className="dz-kpi" title="Dari berita::Temuan dari isi berita yang masih perlu dicocokkan dengan dokumen asli."><small>Dari berita</small><b style={{ color: 'var(--amber)' }}>{stats.unverified_count}</b></div>
          <button className="btn wht" id="btnExtractDossier" style={{ alignSelf: 'center' }} disabled={busy} onClick={onRegen}>{busy ? 'Menyusun dari berita…' : '⟳ Buat ulang'}</button>
        </div>
      </div>
      <div className="dz-legend">
        <span><Status st="terverifikasi_dokumen" /></span><span><Status st="dari_berita" /></span>
        <span>Setiap poin menyertakan <b style={{ color: 'var(--text)' }}>kutipan</b> (ditulis AI, belum dicek otomatis) dan <b style={{ color: 'var(--text)' }}>nomor berita</b> yang bisa diklik. Poin tanpa rujukan berita yang valid dibuang.</span>
      </div>
      <div className="dz-grid">{DZ_SECTIONS.map((sec) => {
        const data = s[sec.key] || {};
        const items: any[] = data.data_tersedia && data.items?.length ? data.items : [];
        return (
          <section className="dz-card" key={sec.key} style={{ ['--c-bg' as string]: sec.c[0], ['--c-bd' as string]: sec.c[1] }}>
            <div className="dz-ch"><span className="dz-ic">{sec.icon}</span><div style={{ minWidth: 0 }}><h4>{sec.title}</h4><p>{sec.sub}</p></div><span className={'dz-n ' + (items.length ? 'has' : '')} title="Jumlah temuan di bagian ini">{items.length}</span></div>
            <div className="dz-body">{items.length ? items.map((it, i) => {
              const m = sec.map(it);
              return (
                <div className="dz-it" key={i}>
                  <div className="dz-t">{m.title || '-'}</div>
                  <div className="dz-sub">
                    {m.role && <span className="dz-pill role">{m.role}</span>}{m.date && <span className="dz-pill date">{m.date}</span>}{m.text && <span>{m.text}</span>}
                    {m.value && <span className="dz-pill" title={`${m.valueLabel}::Angka seperti yang tertulis di berita; belum dicek ke dokumen.`}>{m.valueLabel} {m.value}</span>}
                  </div>
                  {it.kutipan_asli && <Quote text={it.kutipan_asli} />}
                  <div className="dz-f"><Status st={it.status_verifikasi} /><Source it={it} refBy={refBy} /></div>
                </div>
              );
            }) : (
              <div className="dz-empty"><span className="ic"><Svg><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7" /></Svg></span>
                <div><b>Belum ada data di berita</b>{data.pesan_kosong || 'Belum ada data untuk bagian ini.'}<div className="sm dim" style={{ marginTop: 6 }}>Dokumen yang dibutuhkan: {sec.need}</div></div></div>
            )}</div>
          </section>
        );
      })}</div>
      {refs.length > 0 && (
        <details className="card tbl dz-refs" style={{ marginTop: 18 }}>
          <summary>Daftar berita yang dirujuk ({refs.length})</summary>
          <div className="dz-rl"><div className="sm dim" style={{ paddingBottom: 8 }}>Angka pada kartu di atas adalah nomor berita pada daftar ini. Klik untuk membuka beritanya.</div>
            {refs.map((r) => (
              <div className="dz-rr" key={r.n}><span className="ref">{r.n}</span><a href={safeUrl(r.url)} {...(r.id ? { 'data-nid': r.id } : {})} target="_blank" rel="noopener">{r.title}</a><small>{r.source || ''}{r.date ? ' · ' + r.date : ''}</small></div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export default function TabDossier({ data }: OverviewCtx) {
  const { api, toast } = useApp();
  const c = data.company;
  const [d, setD] = useState<any>(undefined);        // undefined = memuat, null = belum dibuat
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setD(undefined); setErr(null);
    api<{ dossier: any }>('/api/company/' + encodeURIComponent(c.id) + '/dossier').then((r) => { if (alive) setD(r.dossier || null); }).catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [api, c.id]);

  async function regen() {
    setBusy(true);
    toast('Sedang menyusun dossier korporasi dari berita lengkap…', 4000);
    try {
      const res = await api<{ dossier: any }>('/api/company/' + encodeURIComponent(c.id) + '/dossier', { method: 'POST' });
      toast('Dossier korporasi berhasil diperbarui!');
      setD(res.dossier);
    } catch (e) { toast('Gagal menyusun dossier: ' + (e as Error).message, 8000); }
    setBusy(false);
  }

  if (err) return <div className="empty"><b>Gagal memuat dossier</b>{err}</div>;
  if (d === undefined) return <div className="muted" style={{ padding: '24px 0' }}>Memuat dossier korporasi…</div>;
  if (!d) {
    return (
      <div className="dz-start">
        <div className="eyebrow" style={{ color: 'var(--cyan)' }}>DOSSIER KORPORASI</div>
        <h3>Dossier belum dibuat</h3>
        <p>AI membaca isi berita yang sudah tersimpan dan menyusun empat bagian kunci untuk due diligence. Setiap poin wajib punya rujukan berita (poin tanpa rujukan yang valid dibuang). AI juga diminta menyertakan kutipan persis dari berita, tetapi kutipan di dossier belum dicek otomatis ke teks artikel, jadi bacalah beritanya.</p>
        <div className="dz-parts">{DZ_SECTIONS.map((s) => <span key={s.key}><i className="dz-mi">{s.icon}</i>{s.title}</span>)}</div>
        <button className="btn wht" id="btnExtractDossier" style={{ padding: '11px 24px', fontWeight: 700 }} disabled={busy} onClick={regen}>{busy ? 'Menyusun dari berita…' : 'Buat dossier dari berita'}</button>
      </div>
    );
  }
  return <DossierView d={d} onRegen={regen} busy={busy} />;
}
