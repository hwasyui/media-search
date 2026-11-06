'use client';
// Kartu Analisis AI di tab Ringkasan: baca yang terakhir tersimpan / buat yang baru (data keuangan + berita 30 hari -> AI -> simpan).
import { type ReactNode, useEffect, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { dt, safeUrl } from '@/lib/client/format';

const KONDISI: Record<string, [string, string]> = { positif: ['t-green', 'Positif'], negatif: ['t-red', 'Negatif'], campuran: ['t-amber', 'Campuran'], netral: ['t-gray', 'Netral'] };

export type Ref = { n: number; id?: number; url: string; title?: string; source?: string; date?: string };

/** Teks yang memuat penanda [n] menjadi tautan rujukan berita (membuka modal berita). */
export function RefText({ text, refs }: { text: string; refs: Ref[] }): ReactNode {
  return String(text ?? '').split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return part;
    const r = refs.find((x) => x.n === Number(m[1]));
    if (!r) return part;
    return (
      <a key={i} className="ref" href={safeUrl(r.url)} {...(r.id ? { 'data-nid': r.id } : {})} target="_blank" rel="noopener"
        title={(r.title || 'Berita') + '::' + [r.source, r.date ? String(r.date).slice(0, 10) : ''].filter(Boolean).join(' · ') + (r.id ? ' — klik untuk membuka beritanya.' : '')}>{m[1]}</a>
    );
  });
}

export default function AnalysisCard({ companyId }: { companyId: string }) {
  const { api, toast } = useApp();
  const [a, setA] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setA(null); setLoaded(false);
    api<{ analysis: any }>(`/api/company/${encodeURIComponent(companyId)}/ai-analysis`)
      .then((r) => { if (alive) setA(r.analysis || null); })
      .catch(() => { /* tampilkan tombol */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [api, companyId]);

  async function run() {
    setBusy(true);
    try {
      const r = await api<{ analysis: any }>(`/api/company/${encodeURIComponent(companyId)}/ai-analysis`, { method: 'POST' });
      setA(r.analysis);
    } catch (e) { toast('Analisis AI gagal: ' + (e as Error).message, 8000); }
    setBusy(false);
  }

  if (!loaded) return null;
  if (!a) {
    return (
      <div className="card ai"><div className="eyebrow">ANALISIS AI</div>
        <div className="muted" style={{ marginBottom: 12 }}>Belum ada analisis AI untuk perusahaan ini. AI merangkum data keuangan dan berita 30 hari yang sudah tersimpan, lengkap dengan rujukan.</div>
        <button className="btn pri" id="aiGo" disabled={busy} onClick={run}>{busy ? <><span className="spin"></span> Menganalisis…</> : '✦ Buat analisis AI'}</button>
      </div>
    );
  }

  const k = KONDISI[a.kondisi] || KONDISI.netral;
  const refs: Ref[] = a.refs || [];
  const list = (items: any[] | undefined, cls: string, sign: string) => (items?.length ? items.map((x, i) => (
    <div className="ai-pt" key={i}><span className={'tag ' + cls}>{sign}</span>
      <div><b>{x.poin}</b>
        <div className="sm muted">Dasar: <RefText text={x.dasar} refs={refs} />
          {x.basis === 'tanpa_rujukan_berita' && <> <span className="tag t-amber" title="Poin ini tidak merujuk ke berita mana pun (mis. hanya angka keuangan). Tidak bisa ditelusuri otomatis: periksa sendiri.">belum tertelusuri ke berita</span></>}
        </div>
      </div>
    </div>
  )) : <div className="muted sm">Tidak ada.</div>);

  return (
    <div className="card ai">
      <div className="row" style={{ justifyContent: 'space-between' }}><div className="eyebrow" style={{ margin: 0 }}>ANALISIS AI</div>
        <span className="row" style={{ gap: 8 }}>
          {a.rating_risiko && <span className="tag t-gray">Rating AI: {String(a.rating_risiko).replace('_', ' ')}</span>}
          <span className={'tag ' + k[0]}>{k[1]}</span><span className="tag t-gray">Keyakinan {a.keyakinan}</span>
          <button className="btn" id="aiRegen" style={{ padding: '5px 10px' }} disabled={busy} onClick={run}>{busy ? <><span className="spin"></span> Menganalisis…</> : '⟳ Buat ulang'}</button>
        </span>
      </div>
      <h2 style={{ fontSize: 20, margin: '12px 0 8px', letterSpacing: '-.01em' }}>{a.headline}</h2>
      <p style={{ color: '#c5cbd3', lineHeight: 1.7 }}>{a.ringkasan}</p>
      {a.temuan_deed?.length > 0 && <><div className="ai-h" style={{ marginTop: 14, color: 'var(--cyan)' }}>Temuan deed discovery (pengurus, pemegang saham, akta)</div>{list(a.temuan_deed, 't-violet', '§')}</>}
      <div className="ai-cols"><div><div className="ai-h up">▲ Faktor positif</div>{list(a.faktor_positif, 't-green', '+')}</div>
        <div><div className="ai-h down">▼ Faktor risiko</div>{list(a.faktor_risiko, 't-red', '−')}</div></div>
      {a.verifikasi?.length > 0 && <><div className="ai-h" style={{ marginTop: 14 }}>Yang perlu diverifikasi di FAP</div><ul style={{ paddingLeft: 18, color: '#c5cbd3' }}>{a.verifikasi.map((v: string, i: number) => <li key={i}>{v}</li>)}</ul></>}
      {a.outlook && <><div className="ai-h" style={{ marginTop: 14 }}>Outlook</div><p style={{ color: '#c5cbd3' }}>{a.outlook}</p></>}
      {a.pantau?.length > 0 && <><div className="ai-h" style={{ marginTop: 10 }}>Yang perlu dipantau</div><ul style={{ paddingLeft: 18, color: '#c5cbd3' }}>{a.pantau.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></>}
      <details style={{ marginTop: 14 }}><summary className="sm muted" style={{ cursor: 'pointer' }}>Daftar berita yang dirujuk ({refs.length})</summary>
        <div className="sm dim" style={{ padding: '6px 0 8px' }}>Angka di “Dasar” (mis. <span className="ref">3</span>) adalah nomor berita pada daftar ini. Nomor dibuat per analisis: berita dengan bukti risiko terbesar lebih dulu, lalu berita terbaru. Nomornya berganti setiap analisis dibuat ulang. Klik angka atau judul untuk membuka beritanya.</div>
        {refs.map((r) => (
          <div className="kv" key={r.n}><span style={{ border: 0 }}><span className="ref">{r.n}</span> <a href={safeUrl(r.url)} {...(r.id ? { 'data-nid': r.id } : {})} target="_blank" rel="noopener" style={{ color: 'var(--cyan)' }}>{r.title}</a></span><b className="dim sm">{r.source || ''}</b></div>
        ))}
      </details>
      <div className="sm dim" style={{ marginTop: 12 }}>Dibuat {dt(a.generatedAt, '-')} oleh {a.model || 'AI'} dari {a.newsCount} berita{a.hasFinancial ? ' + data keuangan' : ''}. Bantuan analisis dari data yang tersedia, bukan keputusan kredit; verifikasi ke dokumen sumber sebelum dipakai.</div>
    </div>
  );
}
