'use client';
// Bilah atas portal: pencarian (perusahaan dipantau, emiten IDX, kata kunci berita), lapis data, tambah perusahaan, tur, dan perbarui semua.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { nf } from '@/lib/client/format';
import { setFeed } from '@/lib/client/feed-store';
import type { Layer } from '@/lib/client/types';
import { jobSummary, waitJob } from './useRefresh';

type IdxHit = { ticker: string; name: string; sector?: string };

const LAYERS: [Layer, string][] = [['relevan', 'Relevan'], ['cleaned', 'Cleaned'], ['mentah', 'Mentah']];

function AddCompanyModal({ onClose }: { onClose: () => void }) {
  const { api, toast, reloadPortfolio } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = ev.currentTarget;
    const val = (id: string) => (f.elements.namedItem(id) as HTMLInputElement | HTMLTextAreaElement).value;
    const name = val('acName').trim();
    if (!name) return;
    const stakeholders = val('acStk').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [n, ...r] = l.split(/\s[-–|]\s|\s*\|\s*/);
      return { name: n.trim(), role: r.join(' - ').trim() || 'Pengurus/pemegang saham' };
    }).filter((s) => s.name);
    const aliases = val('acAlias').split(',').map((s) => s.trim()).filter(Boolean);
    const ticker = val('acTicker').trim().toUpperCase();
    const extraQueries = val('acExtra').split('\n').map((l) => l.trim()).filter(Boolean);
    setBusy(true);
    try {
      const { company } = await api('/api/companies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: ticker ? 'public' : 'private', ticker: ticker || undefined, sector: val('acSector').trim() || undefined, aliases: aliases.length ? [name.replace(/^PT\s+/i, ''), ...aliases] : undefined, extraQueries, stakeholders }),
      });
      onClose();
      await reloadPortfolio();
      toast('Perusahaan ditambahkan. Jalankan "Perbarui berita" untuk mulai discovery.');
      router.push('/c/' + encodeURIComponent(company.id));
    } catch (e) { toast('Gagal menambah: ' + (e as Error).message, 7000); }
    setBusy(false);
  }

  return (
    <div className="modal-ov" id="acModal" onClick={(e) => { if ((e.target as HTMLElement).id === 'acModal') onClose(); }}>
      <form className="modal-box" id="acForm" autoComplete="off" onSubmit={submit}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Tambah perusahaan klien</h3><button type="button" className="btn" id="acClose" style={{ padding: '3px 10px' }} onClick={onClose}>✕</button></div>
        <p className="muted sm" style={{ margin: '6px 0 14px' }}>Isi dari data debitur di FAP. Nama pengurus dan pemegang saham dari akta ikut dipakai untuk mencari berita (deed discovery).</p>
        <label className="fl">Nama perusahaan *<input id="acName" name="acName" required placeholder="PT Contoh Karya Abadi" autoFocus /></label>
        <div className="row2"><label className="fl">Sektor<input id="acSector" name="acSector" placeholder="Pertambangan / Konstruksi / ..." /></label>
          <label className="fl">Kode saham (bila Tbk)<input id="acTicker" name="acTicker" placeholder="kosongkan bila tertutup" maxLength={6} /></label></div>
        <label className="fl">Nama lain / merek (pisahkan koma)<input id="acAlias" name="acAlias" placeholder="Contoh Karya, CKA" /></label>
        <label className="fl">Pengurus &amp; pemegang saham (satu per baris: Nama - peran)<textarea id="acStk" name="acStk" rows={5} placeholder={'Budi Santoso - Direktur Utama\nSiti Aminah - Komisaris\nPT Induk Makmur - Pemegang saham 60%'}></textarea></label>
        <label className="fl">Query pencarian tambahan (opsional, satu per baris)<textarea id="acExtra" name="acExtra" rows={3} placeholder={'"Contoh Karya" tambang ilegal\n"Contoh Karya" (PHK OR demo)\nBudi Santoso Contoh Karya'}></textarea></label>
        <p className="muted sm" style={{ margin: '-4px 0 0' }}>Teks pencarian bebas (boleh pakai tanda kutip dan OR) yang ikut dijalankan saat crawl, di luar query otomatis dari nama, alias, dan pengurus.</p>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button type="button" className="btn" id="acCancel" onClick={onClose}>Batal</button><button className="btn wht" id="acSubmit" disabled={busy}>Simpan</button></div>
      </form>
    </div>
  );
}

export default function TopBar() {
  const { api, layer, setLayer, portfolio, reloadPortfolio, toast, bumpData } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [sugg, setSugg] = useState<{ v: string; idx: IdxHit[] | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [allLabel, setAllLabel] = useState<string | null>(null);
  const [layerCounts, setLayerCounts] = useState<Record<string, any> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch('/api/news/layers').then((r) => r.json()).then(setLayerCounts).catch(() => {}); }, []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.search')) setSugg(null); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const local = sugg ? portfolio.filter((c) => {
    const low = sugg.v.toLowerCase();
    return c.name.toLowerCase().includes(low) || (c.ticker || '').toLowerCase().includes(low) || (c.aliases || []).some((a) => a.toLowerCase().includes(low));
  }).slice(0, 5) : [];

  async function suggest(v: string) {
    setSugg({ v, idx: null });
    try {
      const { results } = await api<{ results: IdxHit[] }>('/api/idx/search?q=' + encodeURIComponent(v));
      const have = new Set(portfolio.map((c) => c.ticker));
      setSugg((cur) => (cur && cur.v === v ? { v, idx: results.filter((r) => !have.has(r.ticker)).slice(0, 6) } : cur));
    } catch { setSugg((cur) => (cur && cur.v === v ? { v, idx: [] } : cur)); }
  }
  function onInput(value: string) {
    setQ(value);
    clearTimeout(timer.current);
    const v = value.trim();
    if (v.length < 2) { setSugg(null); return; }
    timer.current = setTimeout(() => suggest(v), 250);
  }
  function search(value: string) {
    setSugg(null);
    setFeed('home', { q: value.trim(), company: '' });
    if (pathname !== '/') router.push('/');
  }
  async function addCompany(x: IdxHit) {
    try {
      const { company } = await api('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: x.name, ticker: x.ticker, type: 'public', sector: x.sector }) });
      setSugg(null); setQ('');
      await reloadPortfolio();
      toast(`${x.ticker} ditambahkan ke portofolio.`);
      router.push('/c/' + encodeURIComponent(company.id));
    } catch (e) { toast('Gagal menambah: ' + (e as Error).message, 6000); }
  }

  async function refreshAll() {
    setAllLabel('');
    try {
      const job = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'portfolio', options: {} }) });
      const j = await waitJob(api, job.id, (x) => { const p = x.progress || {}; if (p.companyTotal) setAllLabel(`${p.companyIndex}/${p.companyTotal} ${(p.company || '').replace(/^PT\s+/i, '').slice(0, 14)}`); });
      toast(jobSummary(j) + ' Detail ada di Task Runner.', 6000);
    } catch (e) { toast('Gagal memperbarui: ' + (e as Error).message, 8000); }
    setAllLabel(null);
    await reloadPortfolio().catch(() => {});
    bumpData();
  }

  const opt = (v: Layer, base: string) => {
    const c = layerCounts;
    if (!c || c[v] == null) return { text: base, title: undefined };
    const n = c.cerita && c.cerita[v] != null ? c.cerita[v] : c[v];
    return { text: `${base} (${nf(n)})`, title: `${nf(n)} berita (cerita yang sama untuk beberapa perusahaan dihitung sekali); ${nf(c[v])} baris bila dihitung per perusahaan` };
  };

  return (
    <>
      <header className="top">
        <div className="search" ref={boxRef}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input id="q" autoComplete="off" placeholder="Cari perusahaan, ticker (BBCA, GOTO), atau kata kunci berita…" value={q}
            onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(e.currentTarget.value); }} />
          <div className={'sugg' + (sugg ? ' open' : '')} id="sugg">
            {sugg && (
              <>
                {local.length > 0 && <h6>DIPANTAU</h6>}
                {local.map((c) => (
                  <Link prefetch={false} key={c.id} href={`/c/${encodeURIComponent(c.id)}`} onClick={() => { setSugg(null); setQ(''); }}>
                    <span className="tk">{c.ticker || ''}</span>{c.name}<small>{c.type === 'public' ? 'Tbk' : 'Swasta'}</small>
                  </Link>
                ))}
                {sugg.idx === null ? <><h6>BURSA EFEK INDONESIA</h6><div className="dim sm" style={{ padding: '8px 14px' }}>Mencari…</div></>
                  : sugg.idx.length > 0 ? <><h6>BURSA EFEK INDONESIA · TAMBAHKAN</h6>{sugg.idx.map((x, i) => <button key={i} data-add={i} onClick={() => addCompany(x)}><span className="tk">{x.ticker}</span>{x.name}<small>+ pantau</small></button>)}</> : null}
                <h6>BERITA</h6><button data-q={sugg.v} onClick={() => search(q)}>🔎 Cari berita "{sugg.v}"</button>
              </>
            )}
          </div>
        </div>
        <label className="fc" style={{ height: 38, borderRadius: 10 }} title="Lapis data berita yang ditampilkan::Relevan (bawaan): berita yang dinilai AI memang membahas perusahaan dan isinya cukup panjang. Cleaned: alamat asli artikel di situs penerbit sudah ketemu dan isinya bukan tutorial, promo, atau lowongan; belum tentu terkait perusahaan. Mentah: semua hasil crawl.">
          <span>Lapis</span>
          <select id="layerSel" value={layer} onChange={(e) => setLayer(e.target.value as Layer)}>
            {LAYERS.map(([v, base]) => { const o = opt(v, base); return <option key={v} value={v} title={o.title}>{o.text}</option>; })}
          </select>
        </label>
        <button className="btn" id="addCo" title="Tambah perusahaan klien (debitur)" onClick={() => setAdding(true)}>＋ Perusahaan</button>
        <button className="btn" id="startTour" title="Tur fitur::Robot AI memandu Anda melihat fitur-fitur utama langkah demi langkah, dengan suara." onClick={() => window.dispatchEvent(new Event('ms-tour-start'))}>▶ Tur</button>
        <button className="btn" id="refreshAll" title="Ambil berita terbaru untuk semua perusahaan" disabled={allLabel !== null} onClick={refreshAll}>
          {allLabel !== null ? <><span className="spin"></span> {allLabel}</> : '⟳ Perbarui semua'}
        </button>
      </header>
      {adding && <AddCompanyModal onClose={() => setAdding(false)} />}
    </>
  );
}
