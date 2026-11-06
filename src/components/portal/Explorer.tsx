'use client';
/* Penjelajah berita (dipakai di Beranda dan tab Berita perusahaan).
   Susunan: bilah alat (cari, perusahaan, waktu, urutan, filter; semua kotak setinggi sama) -> chip filter aktif -> hasil. Tanpa tab (dobel dengan filter) dan tanpa mode data mentah.
   Filter lanjutan berupa tombol pilihan (pill) dengan jumlah per pilihan; klik lagi untuk melepas. "Muat lebih banyak" menambah kartu di bawah tanpa
   menggambar ulang halaman. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { resetFeed, setFeed, useFeed } from '@/lib/client/feed-store';
import type { FeedState, NewsRow } from '@/lib/client/types';
import { LeadCard, NewsCard, SideRow } from './NewsUi';

const SORT_OPTS: [string, string][] = [['mix', 'Rekomendasi'], ['latest', 'Terbaru'], ['oldest', 'Terlama'], ['risk', 'Risiko tertinggi'], ['credibility', 'Sumber paling kredibel'], ['seen', 'Paling sering muncul']];
const DAYS_OPTS: [string, string][] = [['7', '7 hari terakhir'], ['14', '14 hari terakhir'], ['30', '30 hari terakhir'], ['90', '90 hari terakhir'], ['365', '1 tahun terakhir'], ['0', 'Semua waktu']];
const PAGE = 24;
const LBL: Record<string, Record<string, string>> = {
  platform: { berita: 'Media massa', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video', resmi: 'Sumber resmi' },
  impact: { buruk: 'Risiko', baik: 'Katalis positif', netral: 'Netral' },
  riskCat: { hukum: 'Hukum & perkara', keuangan: 'Keuangan & pembayaran', integritas: 'Integritas & fraud', kepemilikan: 'Kepemilikan & pengurus', operasional: 'Operasional', regulasi: 'Regulasi & sanksi', reputasi: 'Reputasi' },
  ai: { assessed: 'Sudah dinilai AI', pending: 'Belum dinilai AI' },
  riskMin: { 2: 'Risiko ≥ 2', 3: 'Risiko sedang ke atas (≥ 3)', 4: 'Risiko tinggi (≥ 4)', 5: 'Risiko sangat tinggi (5)' },
};
type PillKey = 'impact' | 'riskCat' | 'platform' | 'ai';
// Kelompok pilihan di panel filter: [kunci state, judul, kunci facet, nama parameter API, petunjuk]
const PILL_GROUPS: [PillKey, string, string, string, string][] = [
  ['impact', 'Dampak (dinilai AI)', 'impact', 'impact', 'Penilaian AI atas isi berita: apakah merugikan debitur (Risiko), menguatkan (Katalis positif), atau tidak berpengaruh (Netral).'],
  ['riskCat', 'Kategori risiko', 'riskCat', 'risk_cat', 'Jenis temuan risiko pembiayaan yang AI temukan tertulis di berita, beserta kutipan buktinya.'],
  ['platform', 'Jenis sumber', 'platform', 'platform', ''],
  ['ai', 'Status penilaian AI', 'ai', 'ai', 'Berita yang belum dinilai AI belum punya dampak dan tag risiko, dan belum dihitung dalam rating.'],
];

const facetCache = new Map<string, { at: number; data: Record<string, Record<string, number>> }>();

// Berita utama harus berita REDAKSI: media massa/sumber resmi, sudah dinilai AI, dan perusahaan jadi subjeknya. Tulisan buatan pengguna (surat pembaca,
// keluhan konsumen, blog/forum), video, dan berita yang hanya menyebut sekilas tidak boleh jadi berita utama (tetap muncul di daftar biasa).
const editorial = (r: NewsRow) => (r.content_kind === 'berita' || r.content_kind === 'resmi') && r.platform !== 'blog' && (r.credibility_tier === 'official' || r.credibility_tier === 'mainstream')
  && r.ai_status === 'ok' && (r.company_role === 'subjek' || r.company_role === 'pihak_terlibat');

const entriesOf = (key: string, facet?: Record<string, number>): [string, string, number][] =>
  Object.entries(facet || {}).filter(([, n]) => n > 0).map(([v, n]) => [v, LBL[key]?.[v] || v, n]);

function Pills({ title, hint, group, entries, cur, onPick }: { title: string; hint: string; group: string; entries: [string, string, number | null][]; cur: string; onPick: (k: string, v: string) => void }) {
  if (!entries.length) return null;
  return (
    <div className="pg">
      <div className="pg-t" title={hint ? title + '::' + hint : undefined}>{title}{hint && <> <span className="dim">ⓘ</span></>}</div>
      <div className="pills">
        {entries.map(([v, label, n]) => (
          <button key={v} type="button" className={'pill' + (String(cur) === String(v) ? ' on' : '')} data-fk={group} data-fv={v} onClick={() => onPick(group, v)}>
            {label}{n != null && <> <i>{n}</i></>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** feedKey: kunci status filter (lihat feed-store). company: id tetap (halaman perusahaan). lead: tata letak berita utama. chips: tampilkan pilihan perusahaan. */
export default function Explorer({ feedKey, company, lead, chips }: { feedKey: string; company?: string; lead?: boolean; chips?: boolean }) {
  const { api, portfolio, toast, layer, dataVersion } = useApp();
  const st = useFeed(feedKey);
  const fixedCompany = company || st.company || '';

  const [first, setFirst] = useState<NewsRow[] | null>(null);
  const [more, setMore] = useState<NewsRow[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Record<string, Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qText, setQText] = useState(st.q);
  const qTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setQText(st.q); }, [st.q]);

  // Parameter pencarian (tanpa `offset`); berubah => muat ulang dari awal
  const qs = useMemo(() => {
    const p = new URLSearchParams({ sort: st.sort, limit: String(PAGE), days: st.days });
    if (fixedCompany) p.set('company', fixedCompany);
    if (st.q) p.set('q', st.q);
    for (const [k, , , param] of PILL_GROUPS) if (st[k]) p.set(param, st[k]);
    if (st.riskMin) p.set('risk_min', st.riskMin);
    if (st.source) p.set('source', st.source);
    return p.toString();
  }, [st.sort, st.days, st.q, st.impact, st.riskCat, st.platform, st.ai, st.riskMin, st.source, fixedCompany]);

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      try {
        const key = [fixedCompany, st.days, layer].join('|');
        const hit = facetCache.get(key);
        const facetsP = hit && Date.now() - hit.at < 60000 ? Promise.resolve(hit.data)
          : api<Record<string, Record<string, number>>>('/api/news/facets?' + new URLSearchParams({ days: st.days, ...(fixedCompany ? { company: fixedCompany } : {}) })).then((data) => { facetCache.set(key, { at: Date.now(), data }); return data; });
        const [d, f] = await Promise.all([api<{ items: NewsRow[]; total: number }>('/api/news?' + qs), facetsP]);
        if (!alive) return;
        setFirst(d.items); setMore([]); setTotal(d.total); setFacets(f); setExhausted(false);
      } catch (e) { if (alive) setError((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [api, qs, fixedCompany, st.days, layer, dataVersion]);

  if (error) return <div className="empty"><b>Gagal memuat berita</b>{error}</div>;
  if (!first) return null;

  const set = (k: keyof FeedState, v: string) => setFeed(feedKey, { [k]: v } as Partial<FeedState>);
  const loaded = exhausted ? total : first.length + more.length;
  const nFilters = PILL_GROUPS.filter(([k]) => st[k]).length + (st.riskMin ? 1 : 0) + (st.source ? 1 : 0);

  // Filter aktif (chip di bawah bilah alat)
  const act: [string, string][] = [];
  if (st.q) act.push(['q', 'Cari: “' + st.q + '”']);
  if (chips && st.company) { const c = portfolio.find((x) => x.id === st.company); act.push(['company', c ? c.ticker || c.name : st.company]); }
  for (const [k] of PILL_GROUPS) if (st[k]) act.push([k, LBL[k][st[k]] || st[k]]);
  if (st.riskMin) act.push(['riskMin', LBL.riskMin[st.riskMin] || 'Risiko ≥ ' + st.riskMin]);
  if (st.source) act.push(['source', 'Sumber: ' + st.source]);
  if (st.days !== '30') act.push(['days', (DAYS_OPTS.find((d) => d[0] === st.days) || ['', st.days])[1]]);

  const onPick = (k: string, v: string) => set(k as keyof FeedState, String((st as unknown as Record<string, string>)[k]) === v ? '' : v);
  const srcList: [string, string][] = [['', 'Semua sumber'], ...Object.entries(facets.source || {}).map(([d, n]) => [d, d + ' (' + n + ')'] as [string, string])];

  const leadAt = first.findIndex((r) => editorial(r) && r.company_role === 'subjek');
  const showLead = Boolean(lead) && st.sort === 'mix' && !st.q && !nFilters && !st.company && first.length >= 5 && leadAt >= 0;
  const sortLbl = (SORT_OPTS.find((s) => s[0] === st.sort) || ['', ''])[1];

  async function loadMore() {
    if (busy) return;
    setBusy(true);
    try {
      const q2 = new URLSearchParams(qs); q2.set('offset', String(loaded)); q2.set('limit', String(PAGE));
      const d = await api<{ items: NewsRow[] }>('/api/news?' + q2);
      setMore((m) => [...m, ...d.items]);
      if (!d.items.length) setExhausted(true);       // data berubah: hentikan agar tombol tidak menggantung
    } catch (e) { toast('Gagal memuat: ' + (e as Error).message); }
    setBusy(false);
  }

  const card = (r: NewsRow) => <NewsCard key={r.id} r={r} showCompany={!fixedCompany} />;

  let list;
  if (!first.length) {
    list = (
      <div className="empty"><b>Tidak ada berita yang cocok</b>
        {act.length ? <>Filter terlalu ketat atau belum ada data untuk pilihan ini.<div style={{ marginTop: 12 }}><button className="btn" id="freset2" type="button" onClick={() => resetFeed(feedKey)}>Reset semua filter</button></div></>
          : 'Belum ada berita tersimpan. Jalankan crawl di Task Runner.'}
      </div>
    );
  } else if (showLead) {
    const lr = first[leadAt], rest = first.filter((_, i) => i !== leadAt);
    const side = rest.filter(editorial).slice(0, 4), sideSet = new Set(side), others = rest.filter((r) => !sideSet.has(r));
    list = (
      <>
        <div className="lead">
          <LeadCard r={lr} />
          <div className="lead-side"><div className="eyebrow" style={{ margin: '2px 0 0' }}>PILIHAN REDAKSI</div>{side.map((r) => <SideRow key={r.id} r={r} />)}</div>
        </div>
        <div className="grid" id="fgrid">{others.map(card)}{more.map(card)}</div>
      </>
    );
  } else {
    list = <div className="grid" id="fgrid">{first.map(card)}{more.map(card)}</div>;
  }

  return (
    <>
      <div className="ftool">
        <div className="fsearch-w fc"><span className="fsi">⌕</span>
          <input id="fq" className="fsearch" type="search" placeholder="Cari judul, isi, atau sumber…" value={qText} autoComplete="off"
            onChange={(e) => { const v = e.target.value; setQText(v); clearTimeout(qTimer.current); qTimer.current = setTimeout(() => set('q', v.trim()), 450); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { clearTimeout(qTimer.current); set('q', e.currentTarget.value.trim()); } }} />
        </div>
        {chips && (
          <label className="fc"><span>Perusahaan</span>
            <select id="fco" value={st.company} onChange={(e) => set('company', e.target.value)}>
              <option value="">Semua perusahaan</option>
              {portfolio.map((c) => <option key={c.id} value={c.id}>{(c.ticker ? c.ticker + ' · ' : '') + c.name.replace(/^PT\s+/i, '') + (c.stats && c.stats.total ? ' (' + c.stats.total + ')' : '')}</option>)}
            </select>
          </label>
        )}
        <label className="fc"><span>Waktu</span><select id="fdays" value={st.days} onChange={(e) => set('days', e.target.value)}>{DAYS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="fc"><span>Urutkan</span><select id="fsort" value={st.sort} onChange={(e) => set('sort', e.target.value)}>{SORT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <button className={'btn fbtn' + (nFilters ? ' has' : '')} id="fadv" type="button" aria-expanded={st._adv} onClick={() => setFeed(feedKey, { _adv: !st._adv })}>
          ⚙ Filter{nFilters > 0 && <> <span className="badge">{nFilters}</span></>}
        </button>
      </div>
      <div className="fpanel" id="fpanel" hidden={!st._adv}>
        {PILL_GROUPS.map(([k, title, fk, , hint]) => <Pills key={k} group={k} title={title} hint={hint} entries={entriesOf(k, facets[fk])} cur={st[k]} onPick={onPick} />)}
        <Pills group="riskMin" title="Tingkat risiko minimal" hint="Tingkat keparahan tertinggi dari temuan risiko pada berita, skala 1 (ringan) sampai 5 (sangat tinggi)."
          entries={[['3', LBL.riskMin[3], null], ['4', LBL.riskMin[4], null], ['5', LBL.riskMin[5], null]]} cur={st.riskMin} onPick={onPick} />
        <div className="pg"><div className="pg-t">Sumber (situs)</div>
          <label className="fc wide"><select id="fsrc" value={st.source} onChange={(e) => set('source', e.target.value)}>{srcList.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
      </div>
      {act.length > 0 && (
        <div className="active">
          {act.map(([k, t]) => <button key={k} type="button" className="achip" data-x={k} title="Lepas filter" onClick={() => set(k as keyof FeedState, k === 'days' ? '30' : '')}>{t} <b>✕</b></button>)}
          <button type="button" className="alink" id="freset" onClick={() => resetFeed(feedKey)}>Reset semua</button>
        </div>
      )}
      <div className="fcount" id="fcount">{first.length || loaded ? <>Menampilkan <b>{loaded}</b> dari <b>{total}</b> berita · urutan: {sortLbl.toLowerCase()}</> : null}</div>
      {list}
      <div id="fmoreW" style={{ textAlign: 'center', marginTop: 20 }}>
        {loaded < total && (
          <button className="btn" id="fmore" type="button" disabled={busy} onClick={loadMore}>
            {busy ? 'Memuat…' : <>Muat {Math.min(PAGE, total - loaded)} berita lagi <span className="dim">(sisa {total - loaded})</span></>}
          </button>
        )}
      </div>
    </>
  );
}
