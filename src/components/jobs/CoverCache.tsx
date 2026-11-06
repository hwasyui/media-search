'use client';
// Panel kecil di Task Runner: ukuran cache gambar sampul dan tombol bersihkan.
import { useCallback, useEffect, useState } from 'react';

type Stats = { files: number; bytes: number; orphans: number; orphanBytes: number; maxBytes: number; running: boolean;
  last: { at: string; removedOrphans: number; removedOld: number; freedBytes: number } | null };

const mb = (b: number) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';

export default function CoverCache() {
  const [s, setS] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { const r = await fetch('/api/covers'); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); setS(j); setErr(''); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const clean = async () => {
    setBusy(true);
    try { const r = await fetch('/api/covers', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); setS(j); setErr(''); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="panel">
      <h3>Cache gambar sampul <span className="chip net">tanpa AI</span></h3>
      <p>Gambar berita diunduh sekali dari situs penerbit dan disimpan di <code>data/covers</code> supaya tetap tampil walau situs memblokir hotlink. Dibersihkan otomatis tiap hari: file yang beritanya sudah tidak ada dibuang, dan bila total melewati batas, yang paling lama diunduh dibuang lebih dulu (gambar diunduh lagi saat beritanya ditampilkan).</p>
      {s ? (
        <p className="note-s">
          <b>{s.files}</b> file, <b>{mb(s.bytes)}</b> dari batas {mb(s.maxBytes)}. Yatim (siap dibuang): {s.orphans} file ({mb(s.orphanBytes)}).
          {s.last ? <> Pembersihan terakhir {new Date(s.last.at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}: {s.last.removedOrphans} yatim dan {s.last.removedOld} lama dibuang ({mb(s.last.freedBytes)}).</> : ' Belum pernah dibersihkan sejak server menyala.'}
        </p>
      ) : <p className="note-s">{err ? 'Gagal memuat: ' + err : 'Memuat…'}</p>}
      <button className="btn" type="button" disabled={busy || s?.running} onClick={clean}>{busy ? 'Membersihkan…' : 'Bersihkan sekarang'}</button>
      {err && s ? <p className="note-s" style={{ color: 'var(--red, #ef5b5b)' }}>{err}</p> : null}
    </div>
  );
}
