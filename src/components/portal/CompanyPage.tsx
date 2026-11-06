'use client';
// Halaman perusahaan: header (identitas, harga / status profil) + enam tab. Pengganti viewCompany/paintCompany di portal.html.
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { ago, dt, nf } from '@/lib/client/format';
import type { Company } from '@/lib/client/types';
import TabBerita from './TabBerita';
import TabDossier from './TabDossier';
import TabKeuangan from './TabKeuangan';
import TabProfil from './TabProfil';
import TabRingkasan from './TabRingkasan';
import TabRisiko from './TabRisiko';
import { useCompanyRefresh } from './useRefresh';

export interface Overview {
  company: Company; financial: any; financialError: string | null; counts: Record<string, number>; stats: any; narrative: { headline: string; body: string[]; watch: { level: string; text: string }[] };
}
export type OverviewCtx = { data: Overview; reload: () => Promise<void> };

function Sparkline({ series, up }: { series?: [number, number][]; up: boolean }) {
  const gid = useId();
  if (!series || series.length < 2) return <div className="muted sm" style={{ paddingTop: 24 }}>Grafik tidak tersedia</div>;
  const w = 400, h = 78, v = series.map((x) => x[1]);
  const min = Math.min(...v), max = Math.max(...v), rg = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 6 - ((y - min) / rg) * (h - 14)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const col = up ? '#22c55e' : '#f87171', last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".28" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} /><path d={line} fill="none" stroke={col} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill={col} />
    </svg>
  );
}

// Kartu untuk perusahaan tertutup: jelaskan terang-terangan apa yang dipantau, apa yang tidak tersedia, dan dokumen apa yang perlu dilengkapi analis.
function PrivateProfile({ c, counts }: { c: Company; counts: Record<string, number> }) {
  const sh = (c.stakeholders || []).filter((x) => x.name);
  return (
    <>
      <div className="eyebrow" style={{ margin: '0 0 8px' }}>STATUS PROFIL · PERUSAHAAN TERTUTUP</div>
      <div className="pf-row"><b>Dipantau lewat berita</b><span>Nama perusahaan{(c.aliases || []).length ? ' + ' + c.aliases!.length + ' alias' : ''}{sh.length ? ' dan ' + sh.length + ' pemangku kepentingan (' + sh.slice(0, 3).map((x) => x.name).join(', ') + (sh.length > 3 ? ', …' : '') + ')' : ''}. Saat ini <b>{counts.all}</b> berita 30 hari.</span></div>
      <div className="pf-row"><b>Tidak tersedia</b><span>Harga saham dan laporan keuangan publik. Rating hanya mencerminkan berita, bukan kondisi keuangan.</span></div>
      <div className="pf-row"><b>Perlu dilengkapi analis</b><span>Akta &amp; SK Kemenkumham (AHU), laporan keuangan audit, SLIK{sh.length ? '' : <>; <span className="down">nama pengurus/pemegang saham belum diisi, sehingga berita lewat mereka belum terpantau</span></>}.</span></div>
    </>
  );
}

export default function CompanyPage({ id }: { id: string }) {
  const { api, toast, dataVersion } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState('ringkasan');
  const [finBusy, setFinBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<Overview>(`/api/company/${encodeURIComponent(id)}/overview`)); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, [api, id]);

  useEffect(() => { setData(null); setErr(null); setTab('ringkasan'); }, [id]);
  useEffect(() => { load(); }, [load, dataVersion]);        // id atau lapis data berganti: muat ulang

  const refresh = useCompanyRefresh(id, load);

  async function refreshFinancial() {
    setFinBusy(true);
    try {
      const r = await api('/api/company/' + encodeURIComponent(id) + '/financial/refresh', { method: 'POST' });
      toast(r.saved ? 'Data keuangan diperbarui dan disimpan.' : 'Sebagian sumber gagal (' + Object.values(r.errors || {}).join('; ') + '); data lama dipertahankan.', r.saved ? 4500 : 8000);
      await load();
    } catch (e) { toast('Gagal memperbarui data keuangan: ' + (e as Error).message, 8000); }
    setFinBusy(false);
  }

  if (err) return <div className="empty"><b>{err}</b><Link className="btn" href="/">Kembali ke Beranda</Link></div>;
  if (!data) return <div className="muted">Memuat…</div>;

  const { company: c, financial: fin, financialError, counts } = data;
  const p = fin?.price, isPub = c.type === 'public';
  const initials = (c.ticker || c.name.replace(/^PT\s+/i, '')).slice(0, 2).toUpperCase();
  const up = (p?.dayChangePct ?? 0) >= 0;
  const chg = p?.price && p.dayChangePct != null ? p.price * p.dayChangePct / (100 + p.dayChangePct) : null;
  const tabs: [string, string][] = [['ringkasan', 'Ringkasan'], ['risiko', 'Risiko AI'], ['dossier', 'Dossier Korporasi'], ['keuangan', 'Keuangan'], ['berita', `Berita (${counts.all})`], ['profil', 'Profil']];
  const ctx: OverviewCtx = { data, reload: load };

  return (
    <>
      <div className="head">
        <div>
          <div className="muted sm" style={{ marginBottom: 14 }}><Link href="/">Beranda</Link> / {c.ticker || c.name}</div>
          <div className="ident"><div className="avatar">{initials}</div>
            <div>
              <div className="row"><h1>{c.ticker || c.name.replace(/^PT\s+/i, '')}</h1>
                <span className={'tag ' + (isPub ? 't-green' : 't-gray')}>{isPub ? 'Tbk / Emiten' : 'Tertutup / Swasta'}</span></div>
              <div className="muted" style={{ marginTop: 4 }}>{c.name} · {c.sector || '-'}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 22 }}>
            <button className="btn wht" id="btnRefresh" disabled={refresh.label !== null} onClick={refresh.run}>
              {refresh.label !== null ? <><span className="spin"></span> {refresh.label}</> : '⟳ Perbarui berita'}
            </button>
            <span className="muted sm" id="lastCrawl">{c.lastCrawlAt ? 'Terakhir diperbarui ' + ago(c.lastCrawlAt) : 'Belum pernah diperbarui'}</span>
          </div>
        </div>
        <div className="price">
          {p ? (
            <>
              <div className="muted">Harga terakhir{p.asOf && <> <span className="dim sm">· {ago(p.asOf)}</span></>}{fin.stale?.price && <> <span className="tag t-amber">snapshot tersimpan · sumber sedang membatasi akses</span></>}</div>
              <div className="pr-body">
                <div className="spark"><Sparkline series={p.series} up={(p.change3mPct ?? 0) >= 0} /></div>
                <div className="pr-num">
                  <span className="big">{nf(p.price)}</span>
                  <span className={up ? 'up' : 'down'} style={{ fontWeight: 700 }}>{up ? '▲' : '▼'} {chg != null ? nf(chg) : ''} ({p.dayChangePct > 0 ? '+' : ''}{nf(p.dayChangePct, 2)}%)</span>
                  <span className="sm dim">Data per {dt(fin.fetchedAt)}{fin.stale?.price ? ' (snapshot lama)' : ''}</span>
                  <button className="btn" id="btnFin" style={{ padding: '3px 10px' }} title="Ambil harga, valuasi, dan laporan keuangan terbaru dari sumber lalu simpan ke DB" disabled={finBusy} onClick={refreshFinancial}>
                    {finBusy ? <span className="spin"></span> : '⟳ Perbarui'}
                  </button>
                </div>
              </div>
            </>
          ) : isPub ? <div className="muted">{financialError || 'Data harga tidak tersedia'}</div> : <PrivateProfile c={c} counts={counts} />}
        </div>
      </div>
      <div className="tabs" style={{ marginTop: 26 }}>
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} data-t={k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div id="cbody">
        {tab === 'ringkasan' && <TabRingkasan {...ctx} />}
        {tab === 'risiko' && <TabRisiko {...ctx} refresh={refresh} />}
        {tab === 'dossier' && <TabDossier {...ctx} />}
        {tab === 'keuangan' && <TabKeuangan {...ctx} />}
        {tab === 'berita' && <TabBerita {...ctx} />}
        {tab === 'profil' && <TabProfil {...ctx} />}
      </div>
    </>
  );
}
