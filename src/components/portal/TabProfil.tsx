'use client';
import { type FormEvent, useState } from 'react';
import { useApp } from '@/components/providers/AppProvider';
import { dt } from '@/lib/client/format';
import type { OverviewCtx } from './CompanyPage';

// Ubah alias & query tambahan perusahaan yang sedang dibuka
function EditSearchModal({ company, onClose, onSaved }: { company: OverviewCtx['data']['company']; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api, toast, reloadPortfolio } = useApp();
  const [alias, setAlias] = useState((company.aliases || []).join(', '));
  const [extra, setExtra] = useState((company.extraQueries || []).join('\n'));
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      await api('/api/companies/' + encodeURIComponent(company.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: alias.split(',').map((s) => s.trim()).filter(Boolean), extraQueries: extra.split('\n').map((l) => l.trim()).filter(Boolean) }),
      });
      onClose();
      await reloadPortfolio();
      await onSaved();
      toast('Pencarian diperbarui. Berlaku untuk crawl berikutnya.');
    } catch (e) { toast('Gagal menyimpan: ' + (e as Error).message, 7000); }
    setBusy(false);
  }

  return (
    <div className="modal-ov" id="qeModal">
      <form className="modal-box" id="qeForm" autoComplete="off" onSubmit={submit}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Ubah pencarian berita</h3><button type="button" className="btn" id="qeClose" style={{ padding: '3px 10px' }} onClick={onClose}>✕</button></div>
        <p className="muted sm" style={{ margin: '6px 0 14px' }} id="qeFor">{company.name}</p>
        <label className="fl">Nama lain / merek (pisahkan koma; yang pertama dipakai sebagai nama utama untuk mencari pemangku kepentingan)
          <input id="qeAlias" placeholder="Contoh Karya, CKA" value={alias} onChange={(e) => setAlias(e.target.value)} autoFocus /></label>
        <label className="fl">Query pencarian tambahan (satu per baris)
          <textarea id="qeExtra" rows={4} placeholder={'"Contoh Karya" tambang ilegal\n"Contoh Karya" (PHK OR demo)'} value={extra} onChange={(e) => setExtra(e.target.value)}></textarea></label>
        <p className="muted sm" style={{ margin: '-4px 0 0' }}>Berlaku untuk crawl berikutnya. Berita yang sudah tersimpan tidak berubah.</p>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button type="button" className="btn" id="qeCancel" onClick={onClose}>Batal</button><button className="btn wht" id="qeSubmit" disabled={busy}>Simpan</button></div>
      </form>
    </div>
  );
}

export default function TabProfil({ data, reload }: OverviewCtx) {
  const c = data.company;
  const [editing, setEditing] = useState(false);
  return (
    <div className="two">
      <div className="card">
        <div className="kv"><span>Nama</span><b>{c.name}</b></div>
        <div className="kv"><span>Status</span><b>{c.type === 'public' ? 'Perusahaan terbuka (Tbk)' : 'Tertutup / swasta'}</b></div>
        {c.ticker && <div className="kv"><span>Ticker</span><b>{c.ticker}</b></div>}
        <div className="kv"><span>Sektor</span><b>{c.sector || '-'}</b></div>
        <div className="kv"><span>Alias pencarian</span><b>{(c.aliases || []).length ? (c.aliases || []).map((a, i) => <span key={i}><span className="tag t-gray">{a}</span>{' '}</span>) : '-'}</b></div>
        <div className="kv"><span>Query tambahan</span><b>{(c.extraQueries || []).length ? (c.extraQueries || []).map((q, i) => <span key={i}><span className="tag t-gray">{q}</span>{' '}</span>) : '-'}</b></div>
        <div style={{ marginTop: 10 }}><button type="button" className="btn" id="qeOpen" onClick={() => setEditing(true)}>Ubah pencarian</button></div>
        <div className="kv"><span>Terakhir diperbarui</span><b>{dt(c.lastCrawlAt, '-')}</b></div>
      </div>
      <div className="card"><div style={{ fontWeight: 700, marginBottom: 8 }}>Pemangku kepentingan</div>
        {(c.stakeholders || []).length
          ? (c.stakeholders || []).map((s, i) => <div className="kv" key={i}><span style={{ border: 0, color: 'var(--text)' }}>{s.name}</span><b className="muted sm">{s.role || ''}</b></div>)
          : <div className="muted">Belum ada.</div>}
      </div>
      {editing && <EditSearchModal company={c} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}
