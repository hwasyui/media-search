'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { money, nf } from '@/lib/client/format';
import type { NewsRow } from '@/lib/client/types';
import type { OverviewCtx } from './CompanyPage';
import AnalysisCard from './AnalysisCard';
import { NewsCard } from './NewsUi';

const Pct = ({ v, d = 2 }: { v: number | null | undefined; d?: number }) =>
  v == null ? <span className="muted">–</span> : <span className={v < 0 ? 'down' : 'up'}>{v > 0 ? '+' : ''}{nf(v, d)}%</span>;

export default function TabRingkasan({ data }: OverviewCtx) {
  const { api } = useApp();
  const { narrative: n, financial: fin, company: c } = data;
  const p = fin?.price, v = fin?.valuation;
  const pos = p?.low52w && p?.high52w ? Math.max(0, Math.min(100, ((p.price - p.low52w) / (p.high52w - p.low52w)) * 100)) : null;
  const [top, setTop] = useState<NewsRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items: NewsRow[] }>(`/api/news?company=${encodeURIComponent(c.id)}&limit=6&sort=mix`).then((d) => { if (alive) setTop(d.items); }).catch(() => { if (alive) setTop([]); });
    return () => { alive = false; };
  }, [api, c.id]);

  return (
    <div className="two">
      <div className="card ana"><div className="eyebrow">ANALISIS BERBASIS ATURAN</div>
        <h2>{n.headline}</h2>
        {n.body.length ? n.body.map((s, i) => <p key={i}>{s}</p>) : <p className="muted">Belum ada data.</p>}
        {n.watch.length > 0 && (
          <div className="watch">{n.watch.map((w, i) => (
            <span key={i} className={'tag ' + (w.level === 'baik' ? 't-green' : 't-red')} style={{ whiteSpace: 'normal', padding: '7px 11px' }}>{w.level === 'baik' ? '▲' : '▼'} {w.text}</span>
          ))}</div>
        )}
        <div className="sm dim" style={{ marginTop: 14 }}>Narasi disusun otomatis dari angka yang tampil di halaman ini (tanpa AI).</div>
      </div>
      <div className="card"><div style={{ fontWeight: 700, marginBottom: 6 }}>Sesi terakhir</div>
        {p ? (
          <>
            <div className="kv"><span>Harga</span><b><Pct v={p.dayChangePct} /></b></div>
            <div className="kv"><span>5 hari</span><b><Pct v={p.change5dPct} /></b></div>
            <div className="kv"><span>1 bulan</span><b><Pct v={p.change1mPct} /></b></div>
            <div className="kv"><span>3 bulan</span><b><Pct v={p.change3mPct} /></b></div>
            <div className="kv"><span>Volume</span><b>{nf(p.volume)}</b></div>
            <div className="kv" style={{ display: 'block' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Rentang 52 minggu</span><b>{nf(p.low52w)} – {nf(p.high52w)}</b></div>
              {pos != null && <div className="range"><i style={{ left: `calc(${pos}% - 1px)` }}></i></div>}
            </div>
          </>
        ) : <div className="muted" style={{ padding: '10px 0' }}>Tidak ada data pasar.</div>}
        {v && (
          <>
            <div className="kv"><span>Market cap</span><b>{money(v.marketCap, p?.currency)}</b></div>
            <div className="kv"><span>PER / PBV</span><b>{nf(v.per, 1)}x / {nf(v.pbv, 2)}x</b></div>
            <div className="kv"><span>Dividend yield</span><b>{v.dividendYieldPct == null ? '–' : nf(v.dividendYieldPct, 1) + '%'}</b></div>
          </>
        )}
      </div>
      <div id="aiBox" style={{ gridColumn: '1/-1' }}><AnalysisCard companyId={c.id} /></div>
      <h4 style={{ gridColumn: '1/-1' }}>Berita terpenting</h4>
      <div className="grid" id="topNews" style={{ marginTop: 0, gridColumn: '1/-1' }}>
        {top && (top.length ? top.map((r) => <NewsCard key={r.id} r={r} showCompany={false} />)
          : <div className="empty" style={{ gridColumn: '1/-1' }}><b>Belum ada berita tersimpan</b>Tekan "Perbarui berita" untuk mengambilnya.</div>)}
      </div>
    </div>
  );
}
